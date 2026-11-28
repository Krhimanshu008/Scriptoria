import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import {
  dispatchLlmChat,
  LlmDispatchError,
  type IncomingLlmMessage,
  type LlmChatMode,
  type LlmReasoningEffort,
  type LlmTargetService,
} from "@/lib/llm/dispatch-llm";

interface ChatRequestBody {
  messages: IncomingLlmMessage[];
  systemPrompt?: string;
  mode?: LlmChatMode;
  jsonSchema?: string;
  reasoningEffort?: LlmReasoningEffort;
  enableThinking?: boolean;
  cachePrompt?: boolean;
  temperature?: number;
  maxTokens?: number;
  fallbackToVault?: boolean;
  targetService?: LlmTargetService;
  targetVm?: string;
  modelOverride?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as ChatRequestBody;
    const result = await dispatchLlmChat({
      userId: user.userId,
      messages: Array.isArray(body.messages) ? body.messages : [],
      systemPrompt: body.systemPrompt,
      mode: body.mode || "chat",
      jsonSchema: body.jsonSchema,
      reasoningEffort: body.reasoningEffort || "none",
      enableThinking: typeof body.enableThinking === "boolean" ? body.enableThinking : undefined,
      cachePrompt: typeof body.cachePrompt === "boolean" ? body.cachePrompt : undefined,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      fallbackToVault: Boolean(body.fallbackToVault),
      targetService: body.targetService || "default",
      targetVm: body.targetVm || "auto",
      modelOverride: body.modelOverride,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LlmDispatchError) {
      return NextResponse.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "LLM Studio execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
