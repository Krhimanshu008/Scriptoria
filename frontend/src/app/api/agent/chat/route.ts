import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import {
  callLlmWithTools,
  resolveUserLlmConfig,
  type LlmChatMessage,
} from "@/lib/agent/llm-client";
import {
  AGENT_TOOL_DEFINITIONS,
  MUTATING_AGENT_TOOLS,
  executeAgentTool,
} from "@/lib/agent/tools";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const sessionId = req.nextUrl.searchParams.get("sessionId");
    const sessions = await prisma.agentSession.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
      take: 15,
    });

    const active =
      (sessionId ? sessions.find((s) => s.id === sessionId) : sessions[0]) || null;

    const messages = active
      ? await prisma.agentMessage.findMany({
          where: { sessionId: active.id },
          orderBy: { createdAt: "asc" },
          take: 50,
        })
      : [];

    return NextResponse.json({
      sessions,
      activeSession: active,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCallsJson ? JSON.parse(m.toolCallsJson) : null,
        proposedAction: m.proposedActionJson ? JSON.parse(m.proposedActionJson) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load agent session";
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
      sessionId?: string;
      message?: string;
      mode?: "COPILOT" | "AUTONOMOUS";
      newSession?: boolean;
    };

    const userText = String(body.message || "").trim();
    if (!userText) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const llmConfig = await resolveUserLlmConfig(user.userId);
    if (!llmConfig) {
      return NextResponse.json(
        {
          error:
            "No Agentic AI Provider Key is stored in Settings yet. Add a Gemini, OpenAI, OpenRouter, or Ollama key in Settings → Stored Keys.",
        },
        { status: 400 }
      );
    }

    const settings = await getOrCreateWorkspaceSettings(user.userId);
    const mode = body.mode || settings.agentMode || "COPILOT";

    let session =
      body.sessionId && !body.newSession
        ? await prisma.agentSession.findFirst({
            where: { id: body.sessionId, userId: user.userId },
          })
        : null;

    if (!session) {
      session = await prisma.agentSession.create({
        data: {
          userId: user.userId,
          title: userText.slice(0, 48) || "Studio Direction",
          mode,
        },
      });
    } else if (session.mode !== mode) {
      session = await prisma.agentSession.update({
        where: { id: session.id },
        data: { mode },
      });
    }

    await prisma.agentMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: userText,
      },
    });

    const historyRows = await prisma.agentMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: 16,
    });

    const llmMessages: LlmChatMessage[] = historyRows.map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    }));

    const systemPrompt = `You are Scriptoria's Agentic AI Creative Director & GPU Cluster Orchestrator.
Current Mode: ${mode} (${mode === "COPILOT" ? "Ask approval via mutating tools for render/batch execution" : "Execute validated plans directly"}).
Hardware Constraints: All Kaggle/Colab GPUs are 16 GB Tesla T4s; always respect 16 GB VRAM budget & prefer sdxl_vae_fp16_fix for SDXL/Illustrious.
${settings.systemInstructions ? `User Custom Studio Rules: ${settings.systemInstructions}` : ""}

Use tools (` +
      `get_cluster_state, search_catalog, compose_and_validate_workflow` +
      `) to inspect live GPUs and models before proposing or launching jobs. Keep explanations crisp, actionable, and honest about which GPUs are online or offline.`;

    const executedTraces: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = [];
    let proposedAction: {
      toolName: string;
      args: Record<string, unknown>;
      status: "PENDING_APPROVAL";
    } | null = null;
    let finalAssistantText = "";

    // Bounded tool-calling loop (max 4 steps)
    for (let step = 0; step < 4; step++) {
      const turn = await callLlmWithTools({
        config: llmConfig,
        systemPrompt,
        messages: llmMessages,
        tools: AGENT_TOOL_DEFINITIONS,
      });

      if (!turn.toolCalls.length) {
        finalAssistantText = turn.text;
        break;
      }

      llmMessages.push({
        role: "assistant",
        content: turn.text,
        toolCalls: turn.toolCalls,
      });

      let pausedForApproval = false;
      for (const tc of turn.toolCalls) {
        if (mode === "COPILOT" && MUTATING_AGENT_TOOLS.has(tc.name)) {
          proposedAction = {
            toolName: tc.name,
            args: tc.args,
            status: "PENDING_APPROVAL",
          };
          llmMessages.push({
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            content: JSON.stringify({
              status: "AWAITING_USER_APPROVAL",
              message: "Presented approval card to user in Co-Pilot mode.",
            }),
          });
          pausedForApproval = true;
          continue;
        }

        const result = await executeAgentTool(user.userId, tc.name, tc.args).catch((err) => ({
          error: err instanceof Error ? err.message : "Tool failed",
        }));
        executedTraces.push({ name: tc.name, args: tc.args, result });
        llmMessages.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }

      if (pausedForApproval && !turn.text) {
        finalAssistantText =
          "I prepared an execution plan using your live cluster state and catalog. Review and click **Approve & Execute** below when ready.";
        break;
      }
      if (step === 3 && !finalAssistantText) {
        finalAssistantText = turn.text || "Completed tool analysis.";
      }
    }

    const savedAssistant = await prisma.agentMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content:
          finalAssistantText ||
          "Reviewed cluster and catalog. Ready for your next command.",
        toolCallsJson: executedTraces.length ? JSON.stringify(executedTraces) : null,
        proposedActionJson: proposedAction ? JSON.stringify(proposedAction) : null,
      },
    });

    return NextResponse.json({
      sessionId: session.id,
      provider: llmConfig.provider,
      model: llmConfig.model,
      message: {
        id: savedAssistant.id,
        role: savedAssistant.role,
        content: savedAssistant.content,
        toolCalls: executedTraces,
        proposedAction,
        createdAt: savedAssistant.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

