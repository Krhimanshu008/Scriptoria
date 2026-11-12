import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const sessions = await prisma.llmChatSession.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sessions";
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
      title?: string;
      mode?: string;
      systemPrompt?: string;
      jsonSchema?: string;
      temperature?: number;
      maxTokens?: number;
      reasoningEffort?: string;
    };

    const session = await prisma.llmChatSession.create({
      data: {
        userId: user.userId,
        title: body.title || "New Chat",
        mode: body.mode || "chat",
        systemPrompt: body.systemPrompt || null,
        jsonSchema: body.jsonSchema || null,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.25,
        maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : 2048,
        reasoningEffort: body.reasoningEffort || "none",
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

