import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/crypto/vault";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: LlmToolCall[];
}

export interface ResolvedLlmConfig {
  provider: "gemini" | "openai" | "openrouter" | "ollama";
  model: string;
  apiKey: string;
  baseUrl: string;
}

export async function resolveUserLlmConfig(
  userId: string,
  preferredAlias?: string
): Promise<ResolvedLlmConfig | null> {
  const settings = await getOrCreateWorkspaceSettings(userId);
  const creds = await prisma.credential.findMany({
    where: { userId, provider: "llm" },
    orderBy: { updatedAt: "desc" },
  });

  if (creds.length === 0) return null;

  const targetAlias = (preferredAlias || settings.preferredLlmProvider || "").toLowerCase();
  const chosen =
    creds.find((c) => c.accountAlias.toLowerCase() === targetAlias) || creds[0];

  const apiKey = decryptSecret({
    ciphertext: chosen.encryptedKey,
    iv: chosen.iv,
    authTag: chosen.authTag,
  });

  let meta: { llmProvider?: string; model?: string; baseUrl?: string } = {};
  if (chosen.metadataJson) {
    try {
      meta = JSON.parse(chosen.metadataJson);
    } catch {
      meta = {};
    }
  }

  const rawProv = (meta.llmProvider || chosen.accountAlias || "gemini").toLowerCase();
  const provider: ResolvedLlmConfig["provider"] =
    rawProv === "openai" || rawProv === "openrouter" || rawProv === "ollama"
      ? rawProv
      : "gemini";

  const defaultModel =
    provider === "gemini"
      ? settings.preferredLlmModel || "gemini-2.5-flash"
      : provider === "openai"
      ? "gpt-4.1-mini"
      : provider === "openrouter"
      ? "google/gemini-2.5-flash"
      : "qwen2.5:14b";

  const defaultBase =
    provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : provider === "ollama"
      ? "http://127.0.0.1:11434/v1"
      : "https://api.openai.com/v1";

  return {
    provider,
    model: (meta.model || chosen.username || defaultModel).trim(),
    apiKey,
    baseUrl: (meta.baseUrl || defaultBase).replace(/\/$/, ""),
  };
}

export interface LlmTurnResult {
  text: string;
  toolCalls: LlmToolCall[];
  provider: string;
  model: string;
}

/**
 * Unified multi-provider LLM chat completion supporting function/tool calling across
 * Google Gemini, OpenAI, OpenRouter, and Ollama OpenAI-compatible endpoints.
 */
export async function callLlmWithTools(params: {
  config: ResolvedLlmConfig;
  systemPrompt: string;
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
}): Promise<LlmTurnResult> {
  const { config, systemPrompt, messages, tools = [], temperature = 0.25 } = params;

  if (config.provider === "gemini") {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "assistant") {
          const parts: Array<Record<string, unknown>> = [];
          if (m.content) parts.push({ text: m.content });
          if (m.toolCalls?.length) {
            for (const tc of m.toolCalls) {
              parts.push({ functionCall: { name: tc.name, args: tc.args } });
            }
          }
          return { role: "model", parts };
        }
        if (m.role === "tool") {
          let parsedResp: unknown = { result: m.content };
          try {
            parsedResp = JSON.parse(m.content);
          } catch {
            parsedResp = { result: m.content };
          }
          return {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: m.toolName || "tool",
                  response:
                    parsedResp && typeof parsedResp === "object" && !Array.isArray(parsedResp)
                      ? parsedResp
                      : { result: parsedResp },
                },
              },
            ],
          };
        }
        return { role: "user", parts: [{ text: m.content }] };
      });

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature },
    };

    if (tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const res = await fetch(
      `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini error (${res.status}): ${errText.slice(0, 220)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: { name: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts: string[] = [];
    const toolCalls: LlmToolCall[] = [];
    parts.forEach((p, idx) => {
      if (p.text) textParts.push(p.text);
      if (p.functionCall?.name) {
        toolCalls.push({
          id: `gem_${Date.now()}_${idx}`,
          name: p.functionCall.name,
          args: p.functionCall.args || {},
        });
      }
    });

    return {
      text: textParts.join("\n").trim(),
      toolCalls,
      provider: config.provider,
      model: config.model,
    };
  }

  // OpenAI / OpenRouter / Ollama compatible chat/completions
  const oaiMessages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          };
        }
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId || "call_0",
            content: m.content,
          };
        }
        return { role: m.role, content: m.content };
      }),
  ];

  const payload: Record<string, unknown> = {
    model: config.model,
    messages: oaiMessages,
    temperature,
  };
  if (tools.length > 0) {
    payload.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey !== "ollama") {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${config.provider.toUpperCase()} error (${res.status}): ${errText.slice(0, 220)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function?: { name: string; arguments?: string };
        }>;
      };
    }>;
  };

  const msg = data.choices?.[0]?.message;
  const toolCalls: LlmToolCall[] = (msg?.tool_calls || []).map((tc, idx) => {
    let args: Record<string, unknown> = {};
    if (tc.function?.arguments) {
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    return {
      id: tc.id || `oai_${Date.now()}_${idx}`,
      name: tc.function?.name || "unknown",
      args,
    };
  });

  return {
    text: (msg?.content || "").trim(),
    toolCalls,
    provider: config.provider,
    model: config.model,
  };
}

/**
 * Helper to ask the configured LLM for structured JSON output (used by Drive classification
 * Preview & Review and Flexible External Ingestion Adapter).
 */
export async function callLlmJson<T>(params: {
  userId: string;
  systemPrompt: string;
  userPrompt: string;
  preferredAlias?: string;
}): Promise<{ data: T; provider: string; model: string } | null> {
  const config = await resolveUserLlmConfig(params.userId, params.preferredAlias);
  if (!config) return null;

  const res = await callLlmWithTools({
    config,
    systemPrompt: `${params.systemPrompt}\n\nCRITICAL: Respond with valid raw JSON only. No markdown fences.`,
    messages: [{ role: "user", content: params.userPrompt }],
    temperature: 0.15,
  });

  const cleaned = res.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as T;
  return { data: parsed, provider: res.provider, model: res.model };
}

