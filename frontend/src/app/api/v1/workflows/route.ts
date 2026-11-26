import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import {
  extractModelRefsFromGraph,
  extractRequiredNodesFromGraph,
  listUserWorkflowManifests,
  toWorkflowManifestV1,
} from "@/lib/workflow/registry";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const modality = req.nextUrl.searchParams.get("modality") || undefined;
    const profile = req.nextUrl.searchParams.get("profile") || undefined;
    const includeGraphs = req.nextUrl.searchParams.get("includeGraphs") === "true";

    const workflows = await listUserWorkflowManifests(auth.userId, {
      modality,
      profile,
      includeGraphs,
    });

    return NextResponse.json({
      version: "1.0",
      count: workflows.length,
      workflows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list workflow manifests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json().catch(() => ({}))) as {
      slug?: string;
      name?: string;
      modality?: string;
      categoryTag?: string;
      targetProfile?: string;
      description?: string;
      vramRequiredGb?: number;
      requiredModels?: unknown[];
      requiredNodes?: string[];
      apiGraphTemplate?: Record<string, unknown>;
      inputSchema?: Record<string, unknown>;
    };

    const slug = String(body.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const name = String(body.name || "").trim();
    const graph = body.apiGraphTemplate;

    if (!slug || !name || !graph || typeof graph !== "object" || Array.isArray(graph)) {
      return NextResponse.json(
        { error: "slug, name, and apiGraphTemplate (ComfyUI API prompt JSON object) are required." },
        { status: 400 }
      );
    }

    const modality = String(body.modality || "IMAGE").toUpperCase();
    const targetProfile = String(body.targetProfile || "IMAGE_CORE").trim();
    const categoryTag = String(body.categoryTag || "custom").trim();
    const description = String(body.description || `Custom workflow manifest (${slug})`).trim();
    const vramRequiredGb = Number(body.vramRequiredGb || 10.0);

    const requiredModels =
      Array.isArray(body.requiredModels) && body.requiredModels.length > 0
        ? body.requiredModels
        : extractModelRefsFromGraph(graph);
    const requiredNodes =
      Array.isArray(body.requiredNodes) && body.requiredNodes.length > 0
        ? body.requiredNodes.map(String)
        : extractRequiredNodesFromGraph(graph);
    const inputSchema =
      body.inputSchema && typeof body.inputSchema === "object" ? body.inputSchema : { prompt: "string" };

    const saved = await prisma.workflowTemplate.upsert({
      where: { userId_slug: { userId: auth.userId, slug } },
      update: {
        name,
        modality,
        categoryTag,
        targetProfile,
        description,
        vramRequiredGb,
        requiredModelsJson: JSON.stringify(requiredModels),
        requiredNodesJson: JSON.stringify(requiredNodes),
        apiGraphTemplateJson: JSON.stringify(graph),
        inputSchemaJson: JSON.stringify(inputSchema),
        isSeeded: false,
      },
      create: {
        userId: auth.userId,
        slug,
        name,
        modality,
        categoryTag,
        targetProfile,
        description,
        vramRequiredGb,
        requiredModelsJson: JSON.stringify(requiredModels),
        requiredNodesJson: JSON.stringify(requiredNodes),
        apiGraphTemplateJson: JSON.stringify(graph),
        inputSchemaJson: JSON.stringify(inputSchema),
        isSeeded: false,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        workflow: toWorkflowManifestV1(saved, true),
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save workflow manifest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
