import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import { inspectRemoteModelUrl } from "@/lib/catalog/source-resolver";
import { WORKER_PROFILE_LIST } from "@/lib/catalog/worker-profiles";
import { sanitizeModelCategory } from "@/lib/orchestrator/rclone-client";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserCatalogSeeded(user.userId);

    const modality = req.nextUrl.searchParams.get("modality")?.toUpperCase();
    const category = req.nextUrl.searchParams.get("category")?.toLowerCase();
    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();

    const [models, workflows] = await Promise.all([
      prisma.modelAsset.findMany({
        where: {
          userId: user.userId,
          ...(modality && modality !== "ALL" ? { modality } : {}),
          ...(category && category !== "all" ? { category } : {}),
        },
        orderBy: [{ modality: "asc" }, { category: "asc" }, { displayName: "asc" }],
      }),
      prisma.workflowTemplate.findMany({
        where: {
          userId: user.userId,
          ...(modality && modality !== "ALL" ? { modality } : {}),
        },
        orderBy: [{ modality: "asc" }, { name: "asc" }],
      }),
    ]);

    const filteredModels = q
      ? models.filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            m.filename.toLowerCase().includes(q) ||
            m.compatibleBase.toLowerCase().includes(q) ||
            m.category.toLowerCase().includes(q)
        )
      : models;

    return NextResponse.json({
      models: filteredModels.map((m) => ({
        ...m,
        requiredCustomNodes: m.requiredCustomNodesJson
          ? JSON.parse(m.requiredCustomNodesJson)
          : [],
        recommendedConfig: m.recommendedConfigJson ? JSON.parse(m.recommendedConfigJson) : null,
      })),
      workflows: workflows.map((w) => ({
        ...w,
        requiredModels: JSON.parse(w.requiredModelsJson || "[]"),
        requiredNodes: JSON.parse(w.requiredNodesJson || "[]"),
      })),
      workerProfiles: WORKER_PROFILE_LIST,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    if (body.action === "inspect_url") {
      const rawUrl = String(body.url || "").trim();
      if (!rawUrl) {
        return NextResponse.json({ error: "URL is required." }, { status: 400 });
      }
      const meta = await inspectRemoteModelUrl(user.userId, rawUrl);
      return NextResponse.json({ metadata: meta });
    }

    const displayName = String(body.displayName || "").trim();
    const filename = String(body.filename || "").trim();
    const category = sanitizeModelCategory(String(body.category || "checkpoints"));
    const subdir = String(body.subdir || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    const modality = String(body.modality || "IMAGE").toUpperCase();
    const compatibleBase = String(body.compatibleBase || "SDXL").trim();

    if (!displayName || !filename) {
      return NextResponse.json(
        { error: "displayName and filename are required." },
        { status: 400 }
      );
    }

    const baseSlug = (body.slug ? String(body.slug) : displayName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = baseSlug || `custom-${Date.now()}`;

    const asset = await prisma.modelAsset.upsert({
      where: { userId_slug: { userId: user.userId, slug } },
      update: {
        displayName,
        modality,
        category,
        subdir,
        filename,
        sizeBytes: body.sizeBytes != null ? Number(body.sizeBytes) : null,
        vramEstimateGb: body.vramEstimateGb != null ? Number(body.vramEstimateGb) : 0,
        compatibleBase,
        hfRepoId: body.hfRepoId ? String(body.hfRepoId).trim() : null,
        hfFilePath: body.hfFilePath ? String(body.hfFilePath).trim() : null,
        civitaiModelId: body.civitaiModelId ? String(body.civitaiModelId).trim() : null,
        civitaiVersionId: body.civitaiVersionId ? String(body.civitaiVersionId).trim() : null,
        directUrl: body.directUrl ? String(body.directUrl).trim() : null,
        sha256: body.sha256 ? String(body.sha256).trim().toLowerCase() : null,
      },
      create: {
        userId: user.userId,
        slug,
        displayName,
        modality,
        category,
        subdir,
        filename,
        sizeBytes: body.sizeBytes != null ? Number(body.sizeBytes) : null,
        vramEstimateGb: body.vramEstimateGb != null ? Number(body.vramEstimateGb) : 0,
        compatibleBase,
        hfRepoId: body.hfRepoId ? String(body.hfRepoId).trim() : null,
        hfFilePath: body.hfFilePath ? String(body.hfFilePath).trim() : null,
        civitaiModelId: body.civitaiModelId ? String(body.civitaiModelId).trim() : null,
        civitaiVersionId: body.civitaiVersionId ? String(body.civitaiVersionId).trim() : null,
        directUrl: body.directUrl ? String(body.directUrl).trim() : null,
        sha256: body.sha256 ? String(body.sha256).trim().toLowerCase() : null,
        backupStatus: "NONE",
        isSeeded: false,
      },
    });

    return NextResponse.json({ asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save catalog model";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    await prisma.modelAsset.deleteMany({
      where: { id, userId: user.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete model";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

