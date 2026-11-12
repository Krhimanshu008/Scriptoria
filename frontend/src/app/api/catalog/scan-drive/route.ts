import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import { scanAllModelsInGDriveApi } from "@/lib/gdrive/client";
import { callLlmJson } from "@/lib/agent/llm-client";
import { appendSystemLog } from "@/lib/logs/logger";

export interface DrivePreviewCandidate {
  gdriveFileId: string;
  filename: string;
  category: string;
  subdir: string;
  relativePath: string;
  sizeBytes: number;
  suggestedSlug: string;
  displayName: string;
  modality: "IMAGE" | "AUDIO" | "VIDEO" | "SHARED";
  compatibleBase: string;
  vramEstimateGb: number;
  aiReviewed: boolean;
  notes?: string;
}

function heuristicClassify(file: {
  id: string;
  name: string;
  category: string;
  subdir: string;
  relativePath: string;
  sizeBytes: number;
}): DrivePreviewCandidate {
  const lower = file.name.toLowerCase();
  const cat = file.category.toLowerCase();

  let modality: DrivePreviewCandidate["modality"] = "IMAGE";
  if (cat.includes("tts") || cat.includes("audio") || cat.includes("kokoro") || lower.includes("mmaudio")) {
    modality = "AUDIO";
  } else if (cat.includes("video") || cat.includes("lipsync") || lower.includes("ltx") || lower.includes("wan")) {
    modality = "VIDEO";
  } else if (cat === "vae" || cat === "upscale_models" || cat === "ultralytics" || cat === "sams") {
    modality = "SHARED";
  }

  let compatibleBase = "SDXL";
  if (lower.includes("illustrious")) compatibleBase = "Illustrious";
  else if (lower.includes("noob")) compatibleBase = "NoobAI";
  else if (lower.includes("pony")) compatibleBase = "Pony";
  else if (lower.includes("flux")) compatibleBase = "Flux.1";
  else if (lower.includes("qwen")) compatibleBase = "Qwen-Edit";
  else if (lower.includes("ltx")) compatibleBase = "LTX-Video";
  else if (lower.includes("wan")) compatibleBase = "Wan2.1";
  else if (lower.includes("kokoro")) compatibleBase = "Kokoro";
  else if (lower.includes("f5")) compatibleBase = "F5-TTS";

  const sizeGb = file.sizeBytes > 0 ? file.sizeBytes / 1024 ** 3 : 0;
  const vramEstimateGb = Number(
    (sizeGb > 0 ? Math.min(15.2, Math.max(0.4, sizeGb * 1.08)) : cat === "loras" ? 0.4 : 4.0).toFixed(1)
  );

  const cleanBase = file.name.replace(/\.[^.]+$/, "");
  const displayName = cleanBase.replace(/[_-]+/g, " ").trim();
  const suggestedSlug = `${cat}-${cleanBase}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return {
    gdriveFileId: file.id,
    filename: file.name,
    category: file.category,
    subdir: file.subdir,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    suggestedSlug,
    displayName,
    modality,
    compatibleBase,
    vramEstimateGb,
    aiReviewed: false,
  };
}

/**
 * GET /api/catalog/scan-drive?ai=true
 * Scans the user's 5 TB Google Drive `models/` tree and returns:
 * - syncedCount: existing catalog models confirmed present on Drive
 * - previewCandidates: new unrecognized files classified by heuristics + optional AI Review (NOT imported yet!)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserCatalogSeeded(user.userId);
    const useAi = req.nextUrl.searchParams.get("ai") !== "false";

    const [scan, existingAssets] = await Promise.all([
      scanAllModelsInGDriveApi(user.userId),
      prisma.modelAsset.findMany({ where: { userId: user.userId } }),
    ]);

    const byFilename = new Map(
      existingAssets.map((a) => [`${a.category.toLowerCase()}/${a.filename.toLowerCase()}`, a])
    );
    const byNameOnly = new Map(existingAssets.map((a) => [a.filename.toLowerCase(), a]));

    const alreadyLinked: Array<{ slug: string; filename: string; category: string; gdriveFileId: string }> = [];
    const unrecognized: DrivePreviewCandidate[] = [];

    for (const file of scan.files) {
      const matched =
        byFilename.get(`${file.category.toLowerCase()}/${file.name.toLowerCase()}`) ||
        byNameOnly.get(file.name.toLowerCase());

      if (matched) {
        alreadyLinked.push({
          slug: matched.slug,
          filename: matched.filename,
          category: matched.category,
          gdriveFileId: file.id,
        });
        if (matched.backupStatus !== "BACKED_UP" || matched.gdriveFileId !== file.id) {
          await prisma.modelAsset
            .update({
              where: { id: matched.id },
              data: {
                backupStatus: "BACKED_UP",
                gdriveFileId: file.id,
                gdrivePath: `${scan.baseFolder}/models/${file.relativePath}`,
                lastVerifiedAt: new Date(),
                ...(file.sizeBytes > 0 && !matched.sizeBytes ? { sizeBytes: file.sizeBytes } : {}),
              },
            })
            .catch(() => null);
        }
      } else {
        unrecognized.push(heuristicClassify(file));
      }
    }

    let aiProviderUsed: string | null = null;
    if (useAi && unrecognized.length > 0) {
      try {
        const subset = unrecognized.slice(0, 40).map((u) => ({
          filename: u.filename,
          category: u.category,
          subdir: u.subdir,
          sizeGb: Number((u.sizeBytes / 1024 ** 3).toFixed(2)),
        }));

        const aiRes = await callLlmJson<{
          classifications: Array<{
            filename: string;
            displayName?: string;
            modality?: "IMAGE" | "AUDIO" | "VIDEO" | "SHARED";
            compatibleBase?: string;
            vramEstimateGb?: number;
            notes?: string;
          }>;
        }>({
          userId: user.userId,
          systemPrompt:
            "You classify ComfyUI AI model files discovered on Google Drive. Return JSON `{ classifications: [...] }` with concise human-friendly `displayName`, `modality` (IMAGE|AUDIO|VIDEO|SHARED), `compatibleBase` (SDXL|Illustrious|NoobAI|Pony|Flux.1|Qwen-Edit|LTX-Video|Wan2.1|Kokoro|F5-TTS|Audio|General), realistic `vramEstimateGb` for 16GB Tesla T4, and 1-sentence `notes`.",
          userPrompt: JSON.stringify(subset),
        });

        if (aiRes?.data?.classifications) {
          aiProviderUsed = `${aiRes.provider}:${aiRes.model}`;
          const aiMap = new Map(
            aiRes.data.classifications.map((c) => [c.filename.toLowerCase(), c])
          );
          for (const item of unrecognized) {
            const c = aiMap.get(item.filename.toLowerCase());
            if (c) {
              if (c.displayName) item.displayName = c.displayName;
              if (c.modality) item.modality = c.modality;
              if (c.compatibleBase) item.compatibleBase = c.compatibleBase;
              if (typeof c.vramEstimateGb === "number" && c.vramEstimateGb > 0) {
                item.vramEstimateGb = Number(c.vramEstimateGb.toFixed(1));
              }
              if (c.notes) item.notes = c.notes;
              item.aiReviewed = true;
            }
          }
        }
      } catch {
        // Keep heuristic classification cleanly if AI fails or quota limits apply
      }
    }

    return NextResponse.json({
      baseFolder: scan.baseFolder,
      totalDriveFiles: scan.files.length,
      linkedCount: alreadyLinked.length,
      alreadyLinked,
      previewCandidates: unrecognized,
      aiReviewedCount: unrecognized.filter((u) => u.aiReviewed).length,
      aiProviderUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to scan Google Drive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/catalog/scan-drive
 * Commits user-reviewed Drive model candidates into ModelAsset after Preview & Review.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const items = Array.isArray(body.items) ? (body.items as DrivePreviewCandidate[]) : [];
    const baseFolder = String(body.baseFolder || "NovelVisualizer/ComfyUI_Storage");

    if (items.length === 0) {
      return NextResponse.json({ error: "No reviewed models selected to import." }, { status: 400 });
    }

    let imported = 0;
    for (const item of items) {
      const slug =
        (item.suggestedSlug || `${item.category}-${item.filename}`)
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .slice(0, 64) || `drive-${Date.now()}`;

      await prisma.modelAsset.upsert({
        where: { userId_slug: { userId: user.userId, slug } },
        update: {
          displayName: item.displayName || item.filename,
          modality: item.modality || "IMAGE",
          compatibleBase: item.compatibleBase || "SDXL",
          vramEstimateGb: Number(item.vramEstimateGb || 4),
          gdriveFileId: item.gdriveFileId,
          gdrivePath: `${baseFolder}/models/${item.relativePath || `${item.category}/${item.filename}`}`,
          backupStatus: "BACKED_UP",
          lastVerifiedAt: new Date(),
        },
        create: {
          userId: user.userId,
          slug,
          displayName: item.displayName || item.filename,
          modality: item.modality || "IMAGE",
          category: item.category,
          subdir: item.subdir || "",
          filename: item.filename,
          sizeBytes: item.sizeBytes > 0 ? item.sizeBytes : null,
          vramEstimateGb: Number(item.vramEstimateGb || 4),
          compatibleBase: item.compatibleBase || "SDXL",
          recommendedConfigJson: item.notes ? JSON.stringify({ notes: item.notes }) : null,
          gdriveFileId: item.gdriveFileId,
          gdrivePath: `${baseFolder}/models/${item.relativePath || `${item.category}/${item.filename}`}`,
          backupStatus: "BACKED_UP",
          isSeeded: false,
          lastVerifiedAt: new Date(),
        },
      });
      imported++;
    }

    await appendSystemLog({
      userId: user.userId,
      category: "ACTION",
      level: "SUCCESS",
      message: `Approved & imported ${imported} Drive model(s) from Preview & Review into Master Catalog.`,
    });

    return NextResponse.json({ ok: true, imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import reviewed Drive models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

