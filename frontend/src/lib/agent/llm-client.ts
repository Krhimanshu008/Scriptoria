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
  provider: "gemini" | "groq" | "openai" | "openrouter" | "ollama";
  model: string;
  apiKey: string;
  baseUrl: string;
  source: "vault" | "env";
}

export const FREE_RECOMMENDED_MODELS: Record<ResolvedLlmConfig["provider"], string> = {
  gemini: "gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-120b",
  openrouter: "openrouter/free",
  openai: "gpt-4.1-mini",
  ollama: "qwen2.5:14b",
};

export function defaultBaseUrlForProvider(provider: ResolvedLlmConfig["provider"]): string {
  switch (provider) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "ollama":
      return "http://127.0.0.1:11434/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

function normalizeProvider(raw: string): ResolvedLlmConfig["provider"] {
  const p = raw.trim().toLowerCase();
  if (p === "groq" || p === "openai" || p === "openrouter" || p === "ollama") return p;
  return "gemini";
}

function normalizeModelForProvider(
  provider: ResolvedLlmConfig["provider"],
  rawModel?: string | null
): string {
  const trimmed = (rawModel || "").trim();
  if (!trimmed) return FREE_RECOMMENDED_MODELS[provider];

  // Auto-upgrade known sunsetted free-tier models
  if (provider === "gemini" && (trimmed === "gemini-2.5-flash" || trimmed === "gemini-2.0-flash")) {
    return "gemini-3.5-flash-lite";
  }
  if (provider === "groq" && trimmed === "llama-3.3-70b-versatile") {
    return "openai/gpt-oss-120b";
  }
  return trimmed;
}

function sanitizeBaseUrl(provider: ResolvedLlmConfig["provider"], candidate?: string | null): string {
  const trimmed = (candidate || "").trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/$/, "");
  }
  return defaultBaseUrlForProvider(provider);
}

function looksLikeBrowserAutofill(secret: string): boolean {
  const s = secret.trim();
  if (!s || s.includes("@")) return true;
  // Common accidental placeholder password string
  if (s.toLowerCase() === "changeme123!") return true;
  return false;
}

/**
 * Returns an ordered list of valid LLM configurations (Vault keys prioritized by user preference,
 * followed by `.env` free-tier keys as automatic failover).
 */
export async function resolveCandidateLlmConfigs(
  userId: string,
  preferredAlias?: string
): Promise<ResolvedLlmConfig[]> {
  const settings = await getOrCreateWorkspaceSettings(userId);
  const creds = await prisma.credential.findMany({
    where: { userId, provider: "llm" },
    orderBy: { updatedAt: "desc" },
  });

  const preferredProv = (preferredAlias || settings.preferredLlmProvider || "gemini").toLowerCase();
  const candidates: ResolvedLlmConfig[] = [];

  const pushUnique = (cfg: ResolvedLlmConfig) => {
    if (looksLikeBrowserAutofill(cfg.apiKey)) return;
    if (
      candidates.some(
        (c) => c.provider === cfg.provider && c.apiKey === cfg.apiKey && c.model === cfg.model
      )
    ) {
      return;
    }
    candidates.push(cfg);
  };

  // Prefer live self-hosted Kaggle Qwen LLM VM when ONLINE and no explicit Vault alias overrides it
  if (!preferredAlias) {
    const onlineQwen = await prisma.vmInstance.findFirst({
      where: {
        userId,
        workerProfile: { in: ["LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO"] },
        status: "ONLINE",
      },
      orderBy: { lastHeartbeat: "desc" },
    });
    if (onlineQwen?.publicUrl && onlineQwen.vmSecret) {
      pushUnique({
        provider: "openai",
        model: "qwen-27b",
        apiKey: onlineQwen.vmSecret,
        baseUrl: `${onlineQwen.publicUrl.replace(/\/$/, "")}/v1`,
        source: "env",
      });
    }
  }

  // Sort Vault entries so any key matching user's preferred provider/alias goes first
  const sortedCreds = [...creds].sort((a, b) => {
    const getProv = (row: typeof a) => {
      try {
        const m = row.metadataJson ? (JSON.parse(row.metadataJson) as { llmProvider?: string }) : {};
        return (m.llmProvider || row.accountAlias).toLowerCase();
      } catch {
        return row.accountAlias.toLowerCase();
      }
    };
    const am =
      a.accountAlias.toLowerCase() === preferredProv || getProv(a) === preferredProv ? 0 : 1;
    const bm =
      b.accountAlias.toLowerCase() === preferredProv || getProv(b) === preferredProv ? 0 : 1;
    return am - bm;
  });

  for (const c of sortedCreds) {
    try {
      const apiKey = decryptSecret({
        ciphertext: c.encryptedKey,
        iv: c.iv,
        authTag: c.authTag,
      });
      let meta: { llmProvider?: string; model?: string; baseUrl?: string } = {};
      if (c.metadataJson) {
        try {
          meta = JSON.parse(c.metadataJson);
        } catch {
          meta = {};
        }
      }
      const provider = normalizeProvider(meta.llmProvider || c.accountAlias || "gemini");
      const rawModel =
        c.accountAlias.toLowerCase() === preferredProv
          ? meta.model || c.username || settings.preferredLlmModel
          : meta.model || c.username;

      pushUnique({
        provider,
        model: normalizeModelForProvider(provider, rawModel),
        apiKey,
        baseUrl: sanitizeBaseUrl(provider, meta.baseUrl),
        source: "vault",
      });
    } catch {
      // Skip malformed/unreadable row
    }
  }

  // Env-backed free-tier fallbacks (helps both fresh local setups & rate-limit resilience)
  const envEntries: Array<{ provider: ResolvedLlmConfig["provider"]; key?: string; model?: string }> = [
    {
      provider: "gemini",
      key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    },
    {
      provider: "gemini",
      key: process.env.GOOGLE_API_KEY_SECONDARY,
      model: "gemini-3.5-flash-lite",
    },
    {
      provider: "groq",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    },
    {
      provider: "openrouter",
      key: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
    },
  ];

  // Put env entry matching preferredProv ahead of other env fallbacks
  envEntries.sort((a, b) => {
    const am = a.provider === preferredProv ? 0 : 1;
    const bm = b.provider === preferredProv ? 0 : 1;
    return am - bm;
  });

  for (const entry of envEntries) {
    if (!entry.key) continue;
    pushUnique({
      provider: entry.provider,
      model: normalizeModelForProvider(entry.provider, entry.model),
      apiKey: entry.key.trim(),
      baseUrl: defaultBaseUrlForProvider(entry.provider),
      source: "env",
    });
  }

  return candidates;
}

export async function resolveUserLlmConfig(
  userId: string,
  preferredAlias?: string
): Promise<ResolvedLlmConfig | null> {
  const list = await resolveCandidateLlmConfigs(userId, preferredAlias);
  return list[0] ?? null;
}

export interface LlmTurnResult {
  text: string;
  toolCalls: LlmToolCall[];
  provider: string;
  model: string;
}

/**
 * Unified multi-provider LLM chat completion supporting function/tool calling across
 * Google Gemini, Groq, OpenAI, OpenRouter, and Ollama OpenAI-compatible endpoints.
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
          if (parts.length === 0) parts.push({ text: "Proceeding." });
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
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini (${config.model}) error ${res.status}: ${errText.slice(0, 220)}`);
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

  // Groq / OpenAI / OpenRouter / Ollama compatible chat/completions
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
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL || "https://scriptoria.krhimanshu.in";
    headers["X-Title"] = "Scriptoria Studio";
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `${config.provider.toUpperCase()} (${config.model}) error ${res.status}: ${errText.slice(0, 220)}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
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

  const resolvedText = (msg?.content || msg?.reasoning_content || "").trim();
  return {
    text: resolvedText,
    toolCalls,
    provider: config.provider,
    model: config.model,
  };
}

/**
 * Calls the preferred LLM provider and automatically fails over across any other configured
 * free/paid providers (Gemini -> Groq -> OpenRouter) if rate limits (429), 503, or bad configs occur.
 */
export async function callLlmWithFailover(params: {
  userId: string;
  systemPrompt: string;
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  preferredAlias?: string;
}): Promise<LlmTurnResult> {
  const candidates = await resolveCandidateLlmConfigs(params.userId, params.preferredAlias);
  if (candidates.length === 0) {
    throw new Error(
      "No valid LLM API key found in Vault or environment. Add a Gemini, Groq, or OpenRouter free key in Settings."
    );
  }

  const errors: string[] = [];
  for (const config of candidates) {
    try {
      return await callLlmWithTools({
        config,
        systemPrompt: params.systemPrompt,
        messages: params.messages,
        tools: params.tools,
        temperature: params.temperature,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${config.provider}(${config.model}): ${msg}`);
    }
  }

  throw new Error(`All configured AI providers failed -> ${errors.join(" | ")}`);
}

/**
 * Helper to ask the configured LLM for structured JSON output with automatic free-tier failover.
 */
export async function callLlmJson<T>(params: {
  userId: string;
  systemPrompt: string;
  userPrompt: string;
  preferredAlias?: string;
}): Promise<{ data: T; provider: string; model: string } | null> {
  const candidates = await resolveCandidateLlmConfigs(params.userId, params.preferredAlias);
  if (candidates.length === 0) return null;

  const res = await callLlmWithFailover({
    userId: params.userId,
    preferredAlias: params.preferredAlias,
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
