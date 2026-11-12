import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { executeAgentTool } from "@/lib/agent/tools";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { messageId: string; decision: "approve" | "reject" };
    if (!body.messageId) {
      return NextResponse.json({ error: "messageId is required." }, { status: 400 });
    }

    const msg = await prisma.agentMessage.findUnique({
      where: { id: body.messageId },
      include: { session: true },
    });
    if (!msg || msg.session.userId !== user.userId || !msg.proposedActionJson) {
      return NextResponse.json({ error: "Pending proposal not found." }, { status: 404 });
    }

    const proposed = JSON.parse(msg.proposedActionJson) as {
      toolName: string;
      args: Record<string, unknown>;
      status: string;
      result?: unknown;
    };

    if (body.decision === "reject") {
      const next = { ...proposed, status: "REJECTED" };
      await prisma.agentMessage.update({
        where: { id: msg.id },
        data: { proposedActionJson: JSON.stringify(next) },
      });
      return NextResponse.json({ ok: true, proposedAction: next });
    }

    const result = await executeAgentTool(user.userId, proposed.toolName, proposed.args);
    const next = { ...proposed, status: "EXECUTED", result };
    await prisma.agentMessage.update({
      where: { id: msg.id },
      data: { proposedActionJson: JSON.stringify(next) },
    });

    return NextResponse.json({ ok: true, proposedAction: next, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute approved plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

