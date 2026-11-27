import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getWorkerAuthContext } from "@/lib/auth/api-token";
import { studioTargetForTask } from "@/lib/batch/studio-headless";
import { prepareWorkerModel } from "@/lib/catalog/worker-model";
import { extractModelRefsFromGraph } from "@/lib/workflow/registry";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function POST(req: NextRequest) {
  try {
    const auth = await getWorkerAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = await req.json().catch(() => ({}));
    const workerId = String(body.workerId || "unknown-worker");
    if (auth.worker && !auth.worker.targets.includes(workerId)) {
      return NextResponse.json({ error: "Target outside worker session." }, { status: 403 });
    }
    const rawCapabilities: unknown = body.capabilities;
    const capabilities: string[] = Array.isArray(rawCapabilities)
      ? rawCapabilities.map((c) => String(c))
      : [];
    const stagePreference = String(body.stagePreference || "any");
    const hotCheckpoints = new Set(
      (Array.isArray(body.hotCheckpoints) ? (body.hotCheckpoints as unknown[]) : []).map((s: unknown) =>
        String(s).toLowerCase()
      )
    );
    const cachedFilenames = new Set(
      (Array.isArray(body.cachedFilenames) ? (body.cachedFilenames as unknown[]) : []).map((s: unknown) =>
        String(s).toLowerCase()
      )
    );

    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - 5 * 60 * 1000); // 5-minute lease

    // 1. Lease Reaper: Reset stale processing tasks belonging to this user
    await prisma.batchTask.updateMany({
      where: {
        batch: { userId: auth.userId },
        status: "PROCESSING",
        updatedAt: { lt: leaseCutoff },
      },
      data: {
        status: "PENDING",
        assignedTarget: null,
      },
    });

    // 2. Find next pending tasks matching capabilities (ignoring PAUSED batches)
    const whereClause: {
      batch: { userId: string; status: { in: string[] } };
      status: string;
      workerProfile?: { in: string[] };
      OR: { assignedTarget: string | null }[];
    } = {
      batch: {
        userId: auth.userId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      status: "PENDING",
      OR: [{ assignedTarget: null }, { assignedTarget: workerId }],
    };

    if (capabilities.length > 0) {
      whereClause.workerProfile = { in: capabilities };
    }

    const candidates = await prisma.batchTask.findMany({
      where: whereClause,
      orderBy: [{ sequenceIndex: "asc" }, { createdAt: "asc" }],
      take: 50,
      include: {
        batch: {
          select: {
            id: true,
            title: true,
            sourceApp: true,
            executionMode: true,
          },
        },
      },
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        task: null,
        message: "No queued tasks matching capabilities",
      });
    }

    // Parse DAG dependencies across candidates and check completed status in one query
    const candidateDeps = new Map<string, string[]>();
    const allDepIds = new Set<string>();
    for (const c of candidates) {
      if (!c.dependsOnTaskIdsJson) {
        candidateDeps.set(c.id, []);
        continue;
      }
      try {
        const parsed = JSON.parse(c.dependsOnTaskIdsJson);
        const deps = Array.isArray(parsed)
          ? parsed.filter((d): d is string => typeof d === "string" && d.length > 0)
          : [];
        candidateDeps.set(c.id, deps);
        for (const d of deps) allDepIds.add(d);
      } catch {
        candidateDeps.set(c.id, []);
      }
    }

    const completedDepOutputs = new Map<
      string,
      Array<{ filename?: string; previewUrl?: string; gdriveFileId?: string; localPath?: string }>
    >();
    const completedDepSet = new Set<string>();
    if (allDepIds.size > 0) {
      const depRows = await prisma.batchTask.findMany({
        where: {
          id: { in: Array.from(allDepIds) },
          status: "COMPLETED",
        },
        select: { id: true, outputFilesJson: true },
      });
      for (const r of depRows) {
        completedDepSet.add(r.id);
        if (r.outputFilesJson) {
          try {
            const parsedOut = JSON.parse(r.outputFilesJson);
            if (Array.isArray(parsedOut)) completedDepOutputs.set(r.id, parsedOut);
          } catch {}
        }
      }
    }

    // Score dependency-ready candidates using hot checkpoint locality, local /tmp cache hits, and Dual-T4 stage affinity
    const readyScored = candidates
      .filter((c) => {
        const target = studioTargetForTask(c);
        if (target && target !== workerId) return false;
        const deps = candidateDeps.get(c.id) || [];
        return deps.every((depId) => completedDepSet.has(depId));
      })
      .map((c) => {
        let score = -c.sequenceIndex * 0.01;
        const ckptLower = (c.baseCheckpoint || "").toLowerCase();
        if (ckptLower && hotCheckpoints.has(ckptLower)) {
          score += 120;
        }
        if (c.requiredModelsJson) {
          try {
            const reqArr = JSON.parse(c.requiredModelsJson);
            if (Array.isArray(reqArr)) {
              for (const rm of reqArr) {
                const fn = String(rm?.filename || "").split("/").pop()?.toLowerCase() || "";
                if (fn && cachedFilenames.has(fn)) {
                  score += 20;
                }
              }
            }
          } catch {}
        }
        if (stagePreference === "stage1_preferred") {
          score += c.stageIndex === 1 ? 45 : -25;
        } else if (stagePreference === "stage2_preferred") {
          score += c.stageIndex === 2 ? 45 : -25;
        }
        return { c, score };
      })
      .sort((a, b) => b.score - a.score);

    // Atomic claim with compare-and-set (`status: "PENDING"`) to eliminate multi-GPU race conditions
    let nextTask: (typeof candidates)[number] | null = null;
    for (const { c } of readyScored) {
      const claimRes = await prisma.batchTask.updateMany({
        where: {
          id: c.id,
          assignedTarget: c.assignedTarget,
          status: "PENDING",
        },
        data: {
          status: "PROCESSING",
          assignedTarget: workerId,
          updatedAt: now,
        },
      });

      if (claimRes.count > 0) {
        nextTask = c;
        break;
      }
    }

    if (!nextTask) {
      return NextResponse.json({
        task: null,
        message: "No dependency-ready queued tasks available",
      });
    }

    // Mark parent batch as RUNNING if it was QUEUED
    await prisma.batchJob.updateMany({
      where: {
        id: nextTask.batchId,
        status: "QUEUED",
      },
      data: {
        status: "RUNNING",
      },
    });

    let inputParams: Record<string, unknown> = {};
    if (nextTask.inputParamsJson) {
      try {
        inputParams = JSON.parse(nextTask.inputParamsJson);
      } catch {}
    }

    let compiledGraph: unknown = null;
    if (nextTask.compiledGraphJson) {
      try {
        compiledGraph = JSON.parse(nextTask.compiledGraphJson);
      } catch {}
    }

    let requiredModels: Array<{
      category: string;
      filename: string;
      slug?: string;
      mirrors?: Array<{ url: string; authHeader?: string; expectedSizeBytes?: number; sha256?: string; sourceKind: string }>;
    }> = [];
    if (nextTask.requiredModelsJson) {
      try {
        const parsed = JSON.parse(nextTask.requiredModelsJson);
        if (Array.isArray(parsed)) requiredModels = parsed;
      } catch {}
    }

    const refs = new Map<string, { category: string; filename: string; slug?: string }>();
    const graphRefs = compiledGraph && typeof compiledGraph === "object"
      ? extractModelRefsFromGraph(compiledGraph as Record<string, unknown>) : [];
    for (const ref of [...graphRefs, ...requiredModels]) {
      if (ref && ref.filename && ref.category) {
        refs.set(ref.category + "/" + ref.filename, ref);
      }
    }
    let modelPreparationError: string | null = null;
    try {
      const normalized = Array.from(refs.values(), (r) => ({ ...r, filename: r.filename.split("/").pop()! }));
      const assets = await prisma.modelAsset.findMany({ where: { userId: auth.userId,
        OR: [{ filename: { in: normalized.map((r) => r.filename) } }, { slug: { in: normalized.flatMap((r) => r.slug ? [r.slug] : []) } }] } });
      requiredModels = await Promise.all(
        normalized.map(async (ref) => {
          const asset =
            assets.find((a) => ref.slug && a.slug === ref.slug) ||
            assets.find(
              (a) =>
                a.filename === ref.filename &&
                (a.category === ref.category ||
                  (["unet", "diffusion_models"].includes(a.category) &&
                    ["unet", "diffusion_models"].includes(ref.category)))
            );
          if (!asset) {
            return {
              assetSlug: ref.slug || ref.filename,
              filename: ref.filename,
              category: ref.category,
              subdir: ref.category === "ultralytics" ? "bbox" : "",
              mirrors: [],
              sha256: "",
              expectedSizeBytes: 0,
              backupToGdrive: false,
              allowGdriveFallback: body.driveReady === true,
              sourceError: "Model not registered in catalog: " + ref.filename,
            };
          }
          return prepareWorkerModel(auth.userId, auth.worker?.provider || "external", asset, {
            hasDrive: body.driveReady === true,
          });
        })
      );
    } catch (error) {
      modelPreparationError = error instanceof Error ? error.message : "Model resolution failed.";
    }

    // Resolve parent dependency outputs (for Stage 1 -> Stage 2 or Anchor -> Coverage handoff) and patch placeholders
    const nextDeps = candidateDeps.get(nextTask.id) || [];
    const dependsOnOutputs = nextDeps.flatMap((depId) => completedDepOutputs.get(depId) || []);
    const firstParentFilename = dependsOnOutputs.find((o) => typeof o?.filename === "string" && o.filename)?.filename;
    if (firstParentFilename && compiledGraph && typeof compiledGraph === "object") {
      for (const node of Object.values(compiledGraph as Record<string, Record<string, unknown>>)) {
        const inputs = node?.inputs as Record<string, unknown> | undefined;
        if (
          node?.class_type === "LoadImage" &&
          (inputs?.image === "__STAGE1_OUTPUT_IMAGE__" || inputs?.image === "__ANCHOR_OUTPUT_IMAGE__")
        ) {
          inputs.image = firstParentFilename;
        }
      }
    }

    // Lookahead Prefetch: identify up to 3 un-cached models from upcoming queued checkpoint bins
    let nextPrefetchModels: unknown[] = [];
    try {
      const upcoming = candidates.filter(
        (c) => c.id !== nextTask!.id && c.baseCheckpoint !== nextTask!.baseCheckpoint
      );
      const prefetchRefs = new Map<string, { category: string; filename: string; slug?: string }>();
      for (const up of upcoming) {
        if (!up.requiredModelsJson) continue;
        try {
          const parsed = JSON.parse(up.requiredModelsJson);
          if (!Array.isArray(parsed)) continue;
          for (const rm of parsed) {
            const fn = String(rm?.filename || "").split("/").pop() || "";
            const cat = String(rm?.category || "");
            if (!fn || !cat || cachedFilenames.has(fn.toLowerCase())) continue;
            prefetchRefs.set(`${cat}/${fn}`, {
              category: cat,
              filename: fn,
              slug: typeof rm.slug === "string" ? rm.slug : undefined,
            });
            if (prefetchRefs.size >= 3) break;
          }
        } catch {}
        if (prefetchRefs.size >= 3) break;
      }

      if (prefetchRefs.size > 0) {
        const refList = Array.from(prefetchRefs.values());
        const prefetchAssets = await prisma.modelAsset.findMany({
          where: {
            userId: auth.userId,
            OR: [
              { filename: { in: refList.map((r) => r.filename) } },
              { slug: { in: refList.flatMap((r) => (r.slug ? [r.slug] : [])) } },
            ],
          },
        });
        nextPrefetchModels = await Promise.all(
          refList
            .map((r) => {
              const asset =
                prefetchAssets.find((a) => r.slug && a.slug === r.slug) ||
                prefetchAssets.find((a) => a.filename === r.filename);
              return asset
                ? prepareWorkerModel(auth.userId, auth.worker?.provider || "external", asset, {
                    hasDrive: body.driveReady === true,
                  })
                : null;
            })
            .filter((p): p is NonNullable<typeof p> => p !== null)
        );
      }
    } catch {
      nextPrefetchModels = [];
    }

    return NextResponse.json({
      task: {
        id: nextTask.id,
        batchId: nextTask.batchId,
        batchTitle: nextTask.batch.title,
        sequenceIndex: nextTask.sequenceIndex,
        stageIndex: nextTask.stageIndex,
        sceneKey: nextTask.sceneKey,
        trackType: nextTask.trackType,
        workerProfile: nextTask.workerProfile,
        workflowSlug: nextTask.workflowSlug,
        baseCheckpoint: nextTask.baseCheckpoint,
        requiredModels,
        dependsOnOutputs,
        modelPreparationError,
        inputParams,
        compiledGraph,
      },
      nextPrefetchModels,
      leaseSeconds: 300,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to claim task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

