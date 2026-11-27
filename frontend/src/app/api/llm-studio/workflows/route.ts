import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export interface LlmWorkflowStep {
  id: string;
  name: string;
  targetVm: string; // "auto" | "gpu0" | "vault:gemini" | ...
  targetService: "default" | "extract" | "tag" | "qc" | "rag" | "replica0" | "replica1" | "model_a" | "model_b";
  mode: "chat" | "json";
  systemPrompt: string;
  promptTemplate: string; // supports {{input}} and {{prev.output}}
  jsonSchema?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();
    await ensureUserCatalogSeeded(user.userId);

    const rows = await prisma.workflowTemplate.findMany({
      where: { userId: user.userId, modality: "LLM" },
      orderBy: [{ isSeeded: "desc" }, { updatedAt: "desc" }],
    });

    const workflows = rows.map((w) => {
      let steps: LlmWorkflowStep[] = [];
      try {
        const parsed = JSON.parse(w.apiGraphTemplateJson || "{}") as { steps?: LlmWorkflowStep[] };
        if (Array.isArray(parsed.steps)) steps = parsed.steps;
      } catch {}
      return {
        id: w.id,
        slug: w.slug,
        name: w.name,
        categoryTag: w.categoryTag,
        description: w.description,
        isSeeded: w.isSeeded,
        steps,
        updatedAt: w.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ workflows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load LLM workflows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json()) as {
      name?: string;
      description?: string;
      categoryTag?: string;
      steps?: LlmWorkflowStep[];
    };

    const name = String(body.name || "").trim();
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!name || steps.length === 0) {
      return NextResponse.json(
        { error: "Workflow name and at least one step are required." },
        { status: 400 }
      );
    }

    const slug = `llm-custom-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)}-${Date.now().toString(36)}`;

    const created = await prisma.workflowTemplate.create({
      data: {
        userId: user.userId,
        slug,
        name,
        modality: "LLM",
        categoryTag: body.categoryTag || "custom-chain",
        targetProfile: "LLM_QWEN_VLM",
        description: body.description || `${steps.length}-step custom LLM workflow`,
        vramRequiredGb: 8.0,
        requiredModelsJson: "[]",
        requiredNodesJson: JSON.stringify(steps.map((s) => s.name)),
        apiGraphTemplateJson: JSON.stringify({ kind: "llm_chain_v1", steps }),
        inputSchemaJson: JSON.stringify({ type: "object", properties: { input: { type: "string" } } }),
        isSeeded: false,
      },
    });

    return NextResponse.json({ ok: true, id: created.id, slug: created.slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save LLM workflow";
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
      return NextResponse.json({ error: "Workflow id required" }, { status: 400 });
    }
    await prisma.workflowTemplate.deleteMany({
      where: { id, userId: user.userId, modality: "LLM", isSeeded: false },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete LLM workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
