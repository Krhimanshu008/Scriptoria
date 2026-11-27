import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { dispatchLlmChat, LlmDispatchError, type IncomingLlmMessage } from "@/lib/llm/dispatch-llm";

/**
 * Standard OpenAI-compatible POST /v1/chat/completions bridge authenticated via
 * Dashboard session or Bearer sk_scriptoria_... API key.
 * Routes across online Dual-T4 / TPU LLM workers (direct tunnel or Safe Headless Relay)
 * or configured Vault API fallbacks.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json()) as {
      model?: string;
      messages?: Array<{ role: string; content: unknown }>;
      temperature?: number;
      max_tokens?: number;
      response_format?: { type?: string };
      targetVm?: string;
      targetService?: "default" | "extract" | "tag" | "qc" | "rag" | "replica0" | "replica1" | "model_a" | "model_b";
      fallbackToVault?: boolean;
    };

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const systemMsgs: string[] = [];
    const userAssistantMsgs: IncomingLlmMessage[] = [];

    for (const m of rawMessages) {
      const contentStr = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      if (m.role === "system") {
        systemMsgs.push(contentStr);
      } else if (m.role === "user" || m.role === "assistant") {
        userAssistantMsgs.push({ role: m.role, content: contentStr });
      }
    }

    const res = await dispatchLlmChat({
      userId: auth.userId,
      messages: userAssistantMsgs,
      systemPrompt: systemMsgs.join("\n\n") || undefined,
      mode: body.response_format?.type === "json_object" ? "json" : "chat",
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      targetVm: body.targetVm || "auto",
      targetService: body.targetService || "default",
      modelOverride: body.model,
      fallbackToVault: body.fallbackToVault !== false,
    });

    return NextResponse.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: res.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: res.answer,
            ...(res.thinking ? { reasoning_content: res.thinking } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      scriptoria_meta: {
        source: res.source,
        target: res.target,
        latencyMs: res.latencyMs,
        tokPerSec: res.tokPerSec,
      },
    });
  } catch (error) {
    if (error instanceof LlmDispatchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Completion error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
