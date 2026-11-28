import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { appendSystemLog } from "@/lib/logs/logger";
import { isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { parseBootMetadata, sanitizeVmForClient, sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";
import {
  CANONICAL_LLM_PRESET,
  getDefaultPresetForLlmProfile,
  resolveLlmPresetById,
} from "@/lib/llm/llm-model-presets";
import {
  enqueueVmCommand,
  ensureVmCommandTableReady,
} from "@/lib/orchestrator/vm-commands";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { resolveImagePackById } from "@/lib/catalog/image-model-packs";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { target } = await params;
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    await ensureVmCommandTableReady();
    const recentCommands = await prisma.vmCommand.findMany({
      where: { userId: user.userId, sessionGroup: vm.sessionGroup },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const bootMeta = parseBootMetadata(vm.bootMetadataJson);
    return NextResponse.json({
      ok: true,
      target: vm.target,
      status: vm.status,
      runtimeMode: bootMeta?.runtimeMode || (vm.status === "ONLINE" ? "idle_empty" : "offline"),
      activeModelName: bootMeta?.activeModelName ?? null,
      activeModelRepo: bootMeta?.activeModelRepo ?? null,
      autoLoadOnBoot: Boolean(bootMeta?.autoLoadOnBoot),
      disk: bootMeta?.disk ?? null,
      recentCommands,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load model control status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      presetId?: string;
      packId?: string;
      repoId?: string;
      modelName?: string;
      fileHints?: string[];
      mmprojHints?: string[];
      topologyMode?: string;
      slug?: string;
      category?: string;
      filename?: string;
      force?: boolean;
    };

    const action = String(body.action || "").trim().toLowerCase();
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }
    if (vm.status !== "ONLINE") {
      return NextResponse.json(
        { error: `VM '${target}' must be ONLINE (currently ${vm.status}) before managing runtime models.` },
        { status: 409 }
      );
    }

    if (action === "stage_image_model") {
      try {
        const result = await ensureModelReadyOnVm({
          userId: user.userId,
          vm,
          slug: body.slug,
          category: body.category,
          filename: body.filename,
          backupToGdrive: true,
          preferSource: "auto",
        });
        return NextResponse.json({ ok: true, result });
      } catch (stageErr) {
        const errStatus =
          typeof (stageErr as { status?: unknown })?.status === "number"
            ? (stageErr as { status: number }).status
            : 400;
        return NextResponse.json(
          { error: stageErr instanceof Error ? stageErr.message : "Failed to stage image model" },
          { status: errStatus }
        );
      }
    }

    if (action === "stage_image_pack") {
      const pack = resolveImagePackById(body.packId);
      if (!pack) {
        return NextResponse.json(
          { error: "Specify a valid packId to stage." },
          { status: 400 }
        );
      }

      await ensureUserCatalogSeeded(user.userId);
      const bootMeta = parseBootMetadata(vm.bootMetadataJson);
      const existingNames = new Set(
        (bootMeta?.storageFiles || []).map((f) => f.name.toLowerCase())
      );
      const packAssets = await prisma.modelAsset.findMany({
        where: { userId: user.userId, slug: { in: pack.slugs } },
        select: { slug: true, filename: true, sizeBytes: true },
      });
      const estimatedRemainingGb = packAssets.reduce((acc, a) => {
        if (existingNames.has(a.filename.toLowerCase())) return acc;
        return acc + (a.sizeBytes ? a.sizeBytes / 1024 ** 3 : pack.approxDiskGb / pack.slugs.length);
      }, 0);
      const diskFreeGb = bootMeta?.disk?.freeGb;
      if (
        !body.force &&
        typeof diskFreeGb === "number" &&
        estimatedRemainingGb > 0 &&
        diskFreeGb < estimatedRemainingGb + 0.8
      ) {
        return NextResponse.json(
          {
            error: `Low /tmp disk space on ${vm.target}: ${diskFreeGb.toFixed(1)} GB free, but '${pack.shortLabel}' needs ~${estimatedRemainingGb.toFixed(1)} GB more.`,
          },
          { status: 409 }
        );
      }

      const results: Array<{
        slug: string;
        status: "started" | "skipped" | "failed";
        file?: string;
        fetchJobId?: string | null;
        error?: string;
      }> = [];
      for (const slug of pack.slugs) {
        try {
          const r = await ensureModelReadyOnVm({
            userId: user.userId,
            vm,
            slug,
            backupToGdrive: true,
            preferSource: "auto",
          });
          results.push({
            slug,
            status: r.status,
            file: r.file,
            fetchJobId: r.fetchJobId ?? null,
          });
        } catch (stageErr) {
          results.push({
            slug,
            status: "failed",
            error: stageErr instanceof Error ? stageErr.message : "Failed to stage model",
          });
        }
      }

      const started = results.filter((r) => r.status === "started").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed").length;
      if (started === 0 && skipped === 0 && failed > 0) {
        return NextResponse.json(
          {
            error: results.find((r) => r.error)?.error || `Failed to stage pack '${pack.shortLabel}'.`,
            packId: pack.id,
            results,
          },
          { status: 400 }
        );
      }

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: failed > 0 ? "WARN" : "INFO",
        message: `Staged image pack '${pack.shortLabel}' on ${vm.target}: ${started} queued, ${skipped} cached${failed > 0 ? `, ${failed} failed` : ""}.`,
      });

      return NextResponse.json({
        ok: true,
        packId: pack.id,
        packLabel: pack.shortLabel,
        results,
        summary: { total: pack.slugs.length, started, skipped, failed },
      });
    }

    if (action === "free_vram") {
      const cmd = await enqueueVmCommand({
        vmInstanceId: vm.id,
        userId: user.userId,
        sessionGroup: vm.sessionGroup,
        target: vm.target,
        action: "FREE_VRAM",
      });
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: "INFO",
        message: `Queued ComfyUI /free VRAM cleanup on ${vm.target}.`,
      });
      return NextResponse.json({ ok: true, command: cmd });
    }

    if (action === "unload_llm") {
      const groupVms = await prisma.vmInstance.findMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
      });
      const cmd = await enqueueVmCommand({
        vmInstanceId: vm.id,
        userId: user.userId,
        sessionGroup: vm.sessionGroup,
        target: vm.target,
        action: "UNLOAD_LLM",
      });
      for (const peer of groupVms) {
        const meta = parseBootMetadata(peer.bootMetadataJson) || {};
        await prisma.vmInstance.update({
          where: { id: peer.id },
          data: {
            bootMetadataJson: JSON.stringify({
              ...meta,
              runtimeMode: "idle_empty",
              activeModelName: null,
              activeModelRepo: null,
              llmEndpoints: [],
            }),
          },
        });
      }
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: "INFO",
        message: `Queued LLM VRAM unload on ${vm.sessionGroup} (${vm.target}).`,
      });
      const refreshed = await prisma.vmInstance.findMany({ where: { userId: user.userId } });
      return NextResponse.json({
        ok: true,
        command: cmd,
        vms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
      });
    }

    if (action === "keep_alive") {
      if (vm.publicUrl) {
        const { VmGateway } = await import("@/lib/orchestrator/vm-gateway");
        await VmGateway.callJson(vm, "/health", {
          method: "GET",
          targetPort: 9999,
          timeoutMs: 5000,
        }).catch(() => null);
      }
      const cmd = await enqueueVmCommand({
        vmInstanceId: vm.id,
        userId: user.userId,
        sessionGroup: vm.sessionGroup,
        target: vm.target,
        action: "KEEP_ALIVE",
      });
      return NextResponse.json({
        ok: true,
        command: cmd,
        pingedAt: new Date().toISOString(),
      });
    }

    if (action === "stage_llm" || action === "load_llm") {
      const preset =
        resolveLlmPresetById(body.presetId) ||
        (body.repoId
          ? null
          : isLlmWorkerProfile(vm.workerProfile)
          ? getDefaultPresetForLlmProfile(vm.workerProfile)
          : CANONICAL_LLM_PRESET);
      const repoId = String(body.repoId || preset?.repoId || "").trim();
      const modelName = String(body.modelName || preset?.shortLabel || repoId).trim();

      if (!repoId) {
        return NextResponse.json(
          { error: "Specify a presetId or HF repoId to stage/load." },
          { status: 400 }
        );
      }

      const bootMeta = parseBootMetadata(vm.bootMetadataJson);
      const hasAttachedDatasets = (() => {
        try {
          const parsed = vm.kaggleDatasetsJson ? JSON.parse(vm.kaggleDatasetsJson) : [];
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return false;
        }
      })();
      const approxDiskGb = preset?.approxDiskGb ?? 0;
      const diskFreeGb = bootMeta?.disk?.freeGb;

      // Guardrail: warn early when staging a large GGUF onto /tmp with insufficient free disk and no dataset attached
      if (
        !body.force &&
        !hasAttachedDatasets &&
        approxDiskGb >= 12 &&
        typeof diskFreeGb === "number" &&
        diskFreeGb < approxDiskGb + 1.5
      ) {
        return NextResponse.json(
          {
            error: `Low /tmp disk space on ${vm.target}: ${diskFreeGb.toFixed(1)} GB free, but '${modelName}' needs ~${approxDiskGb} GB. Attach a 0-GPU Qwen Kaggle Dataset (<username>/scriptoria-qwen-llm) or choose a smaller 8B/9B model.`,
          },
          { status: 409 }
        );
      }

      const commandAction = action === "stage_llm" ? "STAGE_LLM" : "LOAD_LLM";
      const fileHints =
        Array.isArray(body.fileHints) && body.fileHints.length > 0
          ? body.fileHints
          : preset?.preferredFilenames || ["*Q4_K_M*.gguf"];
      const mmprojHints =
        Array.isArray(body.mmprojHints) && body.mmprojHints.length > 0
          ? body.mmprojHints
          : preset?.mmprojHints || [];
      const topologyMode =
        body.topologyMode ||
        (body.presetId ? preset?.recommendedTopology : undefined) ||
        bootMeta?.requestedLlmTopology ||
        bootMeta?.llmTopologyMode ||
        preset?.recommendedTopology ||
        "llm_layer_split";

      const companionRepos = preset?.companionRepos?.map((c) => ({
        role: c.role,
        repoId: c.repoId,
        fileHints: c.preferredFilenames,
        mmprojHints: c.mmprojHints,
      }));

      const cmd = await enqueueVmCommand({
        vmInstanceId: vm.id,
        userId: user.userId,
        sessionGroup: vm.sessionGroup,
        target: vm.target,
        action: commandAction,
        payload: {
          presetId: preset?.id,
          modelName,
          repoId,
          fileHints,
          mmprojHints,
          companionRepos,
          topologyMode,
          approxDiskGb: approxDiskGb || undefined,
        },
      });

      if (commandAction === "LOAD_LLM") {
        const groupVms = await prisma.vmInstance.findMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        });
        for (const peer of groupVms) {
          const meta = parseBootMetadata(peer.bootMetadataJson) || {};
          await prisma.vmInstance.update({
            where: { id: peer.id },
            data: {
              bootMetadataJson: JSON.stringify({
                ...meta,
                runtimeMode: "loading_model",
                activeModelName: modelName,
                activeModelRepo: repoId,
                llmTopologyMode: topologyMode,
                requestedLlmTopology: topologyMode,
              }),
            },
          });
        }
      }

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: "INFO",
        message: `Queued ${commandAction} ('${modelName}' · ${repoId}) on ${vm.sessionGroup}${isLlmWorkerProfile(vm.workerProfile) ? "" : " (copilot split)"}.`,
      });

      const refreshed = await prisma.vmInstance.findMany({ where: { userId: user.userId } });
      return NextResponse.json({
        ok: true,
        command: cmd,
        vms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
      });
    }

    return NextResponse.json(
      { error: `Unsupported action '${action}'. Allowed: stage_llm, load_llm, unload_llm, free_vram, stage_image_model, stage_image_pack.` },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model control error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
