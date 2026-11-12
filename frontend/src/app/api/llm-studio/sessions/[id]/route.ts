import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();
    const { id } = await context.params;

    const session = await prisma.llmChatSession.findFirst({
      where: { id, userId: user.userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();
    const { id } = await context.params;

    const body = await req.json();

    const updated = await prisma.llmChatSession.updateMany({
      where: { id, userId: user.userId },
      data: {
        ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
        ...(typeof body.mode === "string" ? { mode: body.mode } : {}),
        ...(typeof body.systemPrompt === "string" ? { systemPrompt: body.systemPrompt } : {}),
        ...(typeof body.jsonSchema === "string" ? { jsonSchema: body.jsonSchema } : {}),
        ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
        ...(typeof body.maxTokens === "number" ? { maxTokens: body.maxTokens } : {}),
        ...(typeof body.reasoningEffort === "string" ? { reasoningEffort: body.reasoningEffort } : {}),
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();
    const { id } = await context.params;

    await prisma.llmChatSession.deleteMany({
      where: { id, userId: user.userId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();
    const { id } = await context.params;

    const session = await prisma.llmChatSession.findFirst({
      where: { id, userId: user.userId },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = (await req.json()) as {
      messages: Array<{
        role: "user" | "assistant";
        content: string;
        thinking?: string | null;
        imageDataUrls?: string[];
        meta?: Record<string, unknown>;
      }>;
    };

    if (Array.isArray(body.messages) && body.messages.length > 0) {
      await prisma.$transaction([
        ...body.messages.map((m) =>
          prisma.llmChatMessage.create({
            data: {
              sessionId: session.id,
              role: m.role,
              content: m.content || "",
              thinking: m.thinking || null,
              imagesJson: m.imageDataUrls ? JSON.stringify(m.imageDataUrls) : null,
              metaJson: m.meta ? JSON.stringify(m.meta) : null,
            },
          })
        ),
        prisma.llmChatSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        }),
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

