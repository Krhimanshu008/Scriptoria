import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { callLlmWithTools, resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { parseBootMetadata } from "@/lib/orchestrator/vm-helpers";

export type LlmChatMode = "chat" | "json" | "vision_qa";
export type LlmReasoningEffort = "none" | "low" | "medium" | "high";
export type LlmTargetService =
  | "default"
  | "extract"
  | "tag"
  | "qc"
  | "rag"
  | "replica0"
  | "replica1"
  | "model_a"
  | "model_b";

export interface IncomingLlmMessage {
  role: "user" | "assistant";
  content: string;
  imageDataUrls?: string[];
}

export type LlmExecutionRoute =
  | "dual_t4_local_relay"
  | "dual_t4_direct_tunnel"
  | "vault_cloud_fallback";

export interface LlmRawTimings {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_token_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_token_ms?: number;
  predicted_per_second?: number;
  cache_n?: number;
  draft_n?: number;
  draft_n_accepted?: number;
}

export interface LlmMtpTurnStats {
  draftN: number;
  draftNAccepted: number;
  acceptancePct: number | null;
  meanTokensPerStep: number | null;
}

export interface DispatchLlmParams {
  userId: string;
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
  targetVm?: string;
  targetService?: LlmTargetService;
  vaultProvider?: string;
  modelOverride?: string;
}

export interface DispatchLlmResult {
  source: string;
  executionRoute: LlmExecutionRoute;
  target: string | null;
  model: string;
  answer: string;
  thinking: string | null;
  latencyMs: number;
  workerLatencyMs: number | null;
  ttftMs: number | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  timings: LlmRawTimings | null;
  tokPerSec: number | null;
  rawDecodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  effectiveTokPerSec: number | null;
  relayOverheadMs: number | null;
  cacheN: number | null;
  promptTokens: number | null;
  thinkingTokens: number;
  answerTokens: number;
  tokenSplitEstimated: boolean;
  visionEncodeMs: number | null;
  visionTokens: number | null;
  visionBypassed: boolean;
  mtpStats: LlmMtpTurnStats | null;
  jsonValidation: {
    isValidJson: boolean;
    missingKeys: string[];
    parseError?: string;
  } | null;
}

export function splitThinkBlock(raw: string): { thinking: string | null; answer: string } {
  const match = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (!match) {
    return { thinking: null, answer: raw.trim() };
  }
  const thinking = match[1].trim();
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return { thinking: thinking || null, answer };
}

export function validateJsonAgainstSchema(
  rawText: string,
  jsonSchema?: string
): DispatchLlmResult["jsonValidation"] {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const missingKeys: string[] = [];
    if (jsonSchema?.trim()) {
      try {
        const schemaObj = JSON.parse(jsonSchema) as { required?: string[] };
        if (Array.isArray(schemaObj.required)) {
          for (const key of schemaObj.required) {
            if (!parsed || typeof parsed !== "object" || !(key in parsed)) {
              missingKeys.push(String(key));
            }
          }
        }
      } catch {
        // Ignore malformed schema metadata during validation check
      }
    }
    return {
      isValidJson: missingKeys.length === 0,
      missingKeys,
    };
  } catch (err) {
    return {
      isValidJson: false,
      missingKeys: [],
      parseError: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export function buildLlmResponseFormat(
  mode: LlmChatMode,
  jsonSchema?: string
): Record<string, unknown> | undefined {
  if (mode !== "json" && mode !== "vision_qa") return undefined;
  const trimmed = jsonSchema?.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const schema: Record<string, unknown> = { ...parsed };
        if (!schema.type) schema.type = "object";
        if (schema.type === "object" && !schema.properties) {
          const props: Record<string, unknown> = {};
          if (Array.isArray(schema.required)) {
            for (const key of schema.required) {
              props[String(key)] = {};
            }
          }
          schema.properties = props;
        }
        if (schema.type === "object" && schema.additionalProperties === undefined) {
          schema.additionalProperties = true;
        }
        return {
          type: "json_schema",
          json_schema: {
            name: "scriptoria_output",
            strict: true,
            schema,
          },
        };
      }
    } catch {
      // Fall back to generic json_object when schema metadata is not valid JSON
    }
  }
  return { type: "json_object" };
}

export class LlmDispatchError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CF_SAFE_RELAY_TIMEOUT_MS = 92_000;

export function computeTurnTelemetry(opts: {
  answer: string;
  thinking: string | null;
  hasImages: boolean;
  wallLatencyMs: number;
  workerLatencyMs: number | null;
  usage: DispatchLlmResult["usage"];
  timings: LlmRawTimings | null;
  visionMeta?: { bypassed?: boolean; encodeMs?: number | null; visionTokens?: number | null } | null;
}) {
  const { answer, thinking, hasImages, wallLatencyMs, workerLatencyMs, usage, timings, visionMeta } = opts;

  const predictedN = timings?.predicted_n ?? usage?.completion_tokens ?? null;
  const rawDecodeTokPerSec =
    typeof timings?.predicted_per_second === "number" && timings.predicted_per_second > 0
      ? Number(timings.predicted_per_second.toFixed(1))
      : null;
  const prefillTokPerSec =
    typeof timings?.prompt_per_second === "number" && timings.prompt_per_second > 0
      ? Number(timings.prompt_per_second.toFixed(1))
      : null;
  const effectiveTokPerSec =
    predictedN && wallLatencyMs > 0
      ? Number(((predictedN / wallLatencyMs) * 1000).toFixed(1))
      : null;

  const modelComputeMs =
    typeof timings?.prompt_ms === "number" && typeof timings?.predicted_ms === "number"
      ? timings.prompt_ms + timings.predicted_ms
      : workerLatencyMs;
  const relayOverheadMs =
    modelComputeMs !== null ? Math.max(0, Math.round(wallLatencyMs - modelComputeMs)) : null;

  let thinkingTokens = 0;
  let answerTokens = 0;
  let tokenSplitEstimated = false;
  const reportedReasoning = usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof reportedReasoning === "number" && typeof predictedN === "number") {
    thinkingTokens = Math.min(predictedN, Math.max(0, reportedReasoning));
    answerTokens = Math.max(0, predictedN - thinkingTokens);
  } else if (thinking && thinking.length > 0) {
    tokenSplitEstimated = true;
    const totalChars = Math.max(1, thinking.length + answer.length);
    if (typeof predictedN === "number" && predictedN > 0) {
      thinkingTokens = Math.round((thinking.length / totalChars) * predictedN);
      answerTokens = Math.max(0, predictedN - thinkingTokens);
    } else {
      thinkingTokens = Math.ceil(thinking.length / 3.8);
      answerTokens = Math.ceil(answer.length / 3.8);
    }
  } else {
    answerTokens = typeof predictedN === "number" ? predictedN : Math.ceil(answer.length / 3.8);
    tokenSplitEstimated = typeof predictedN !== "number";
  }

  let mtpStats: LlmMtpTurnStats | null = null;
  if (typeof timings?.draft_n === "number" && timings.draft_n > 0) {
    const draftN = timings.draft_n;
    const draftNAccepted = timings.draft_n_accepted ?? 0;
    const acceptancePct = Number(((draftNAccepted / draftN) * 100).toFixed(1));
    const verifSteps = Math.max(1, (predictedN ?? draftNAccepted + 1) - draftNAccepted);
    const meanTokensPerStep = predictedN
      ? Number(Math.max(1, predictedN / verifSteps).toFixed(2))
      : null;
    mtpStats = { draftN, draftNAccepted, acceptancePct, meanTokensPerStep };
  }

  const cacheN =
    typeof timings?.cache_n === "number"
      ? timings.cache_n
      : usage?.prompt_tokens_details?.cached_tokens ?? null;
  const promptTokens =
    typeof timings?.prompt_n === "number"
      ? timings.prompt_n + (cacheN ?? 0)
      : usage?.prompt_tokens ?? null;

  return {
    timings,
    tokPerSec: rawDecodeTokPerSec ?? effectiveTokPerSec,
    rawDecodeTokPerSec,
    prefillTokPerSec,
    effectiveTokPerSec,
    relayOverheadMs,
    cacheN,
    promptTokens,
    thinkingTokens,
    answerTokens,
    tokenSplitEstimated,
    visionEncodeMs: hasImages ? (visionMeta?.encodeMs ?? null) : 0,
    visionTokens: hasImages ? (visionMeta?.visionTokens ?? null) : 0,
    visionBypassed: visionMeta?.bypassed ?? !hasImages,
    mtpStats,
  };
}

export async function dispatchLlmChat(params: DispatchLlmParams): Promise<DispatchLlmResult> {
  await ensureDbSchemaReady();

  const {
    userId,
    messages,
    mode = "chat",
    jsonSchema,
    reasoningEffort = "none",
    enableThinking,
    cachePrompt = true,
    temperature = 0.25,
    maxTokens = 2048,
    fallbackToVault = true,
    targetVm = "auto",
    targetService = "default",
    vaultProvider,
    modelOverride,
  } = params;

  if (!messages || messages.length === 0) {
    throw new LlmDispatchError("At least one message is required.", 400);
  }

  const effectiveEnableThinking =
    typeof enableThinking === "boolean"
      ? enableThinking
      : reasoningEffort === "medium" || reasoningEffort === "high";

  let systemPrompt = (params.systemPrompt || "You are a precise, helpful AI engineering and reasoning assistant.").trim();
  if (!effectiveEnableThinking) {
    systemPrompt += "\nDo NOT output internal thought or <think> tags. Answer directly and concisely.";
  }
  if (mode === "json" || mode === "vision_qa") {
    const schemaNote = jsonSchema?.trim()
      ? `\nRespond ONLY with valid JSON conforming to:\n${jsonSchema.trim()}`
      : "\nRespond ONLY with valid JSON.";
    systemPrompt = `${systemPrompt}${schemaNote}`;
  }

  const clampedMaxTokens = Math.min(8192, Math.max(64, maxTokens));
  const hasImages = messages.some((m) => m.imageDataUrls && m.imageDataUrls.length > 0);
  const useExplicitVault = targetVm === "vault" || targetVm.startsWith("vault:") || Boolean(vaultProvider);
  const explicitProviderName = targetVm.startsWith("vault:")
    ? targetVm.slice("vault:".length)
    : vaultProvider;

  if (!useExplicitVault) {
    let onlineVm = null;
    if (targetVm && targetVm !== "auto") {
      onlineVm = await prisma.vmInstance.findFirst({
        where: {
          userId,
          target: targetVm,
          status: "ONLINE",
        },
      });
    }

    if (!onlineVm) {
      const llmVms = await prisma.vmInstance.findMany({
        where: {
          userId,
          status: "ONLINE",
        },
        orderBy: { lastHeartbeat: "desc" },
      });
      onlineVm =
        llmVms.find(
          (v) =>
            isLlmWorkerProfile(v.workerProfile) ||
            parseBootMetadata(v.bootMetadataJson)?.topologyMode === "copilot_split"
        ) || null;
    }

    if (onlineVm) {
      const vmMeta = parseBootMetadata(onlineVm.bootMetadataJson);
      const hasEndpoints = (vmMeta?.llmEndpoints?.length ?? 0) > 0;
      if (vmMeta?.runtimeMode === "idle_empty" && !hasEndpoints) {
        if (!fallbackToVault) {
          throw new LlmDispatchError(
            `VM '${onlineVm.target}' is ONLINE (Idle · Empty Compute) with no LLM model loaded in VRAM. Stage & Load a model from GPU Cluster or LLM Studio first.`,
            409
          );
        }
        onlineVm = null;
      }
    }

    if (onlineVm) {
      const openAiMessages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => {
          if (m.role === "user" && m.imageDataUrls && m.imageDataUrls.length > 0) {
            const parts: Array<Record<string, unknown>> = [
              { type: "text", text: m.content || "Analyze these images." },
              ...m.imageDataUrls.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ];
            return { role: "user", content: parts };
          }
          return { role: m.role, content: m.content };
        }),
      ];

      const payload: Record<string, unknown> = {
        model: modelOverride || "default",
        messages: openAiMessages,
        temperature,
        max_tokens: clampedMaxTokens,
        stream: true,
        stream_options: { include_usage: true },
        cache_prompt: cachePrompt,
        chat_template_kwargs: {
          enable_thinking: effectiveEnableThinking,
        },
      };
      const respFormat = buildLlmResponseFormat(mode, jsonSchema);
      if (respFormat) {
        payload.response_format = respFormat;
      }

      // Path A: Direct HTTP/Tunnel SSE execution
      if (onlineVm.publicUrl) {
        const base = onlineVm.publicUrl.replace(/\/$/, "");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (targetService && targetService !== "default") {
          headers["X-Target-Service"] = targetService;
        }
        if (onlineVm.vmSecret) {
          headers["Authorization"] = `Bearer ${onlineVm.vmSecret}`;
          headers["X-VM-Secret"] = onlineVm.vmSecret;
        }

        const t0 = Date.now();
        let ttftMs: number | null = null;
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(240000),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new LlmDispatchError(
            `LLM worker (${onlineVm.target}) returned HTTP ${res.status}: ${errText.slice(0, 300)}`,
            res.status === 409 ? 409 : 502
          );
        }

        let rawContent = "";
        let streamReasoning = "";
        let respModel = modelOverride || onlineVm.workerProfile;
        let usage: DispatchLlmResult["usage"] = null;
        let timings: LlmRawTimings | null = null;

        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const chunk = JSON.parse(jsonStr) as {
                  model?: string;
                  choices?: Array<{
                    delta?: { content?: string; reasoning_content?: string };
                  }>;
                  usage?: DispatchLlmResult["usage"];
                  timings?: LlmRawTimings;
                };
                if (chunk.model) respModel = chunk.model;
                if (chunk.usage) usage = chunk.usage;
                if (chunk.timings) timings = chunk.timings;
                const delta = chunk.choices?.[0]?.delta;
                if (delta?.content || delta?.reasoning_content) {
                  if (ttftMs === null) ttftMs = Date.now() - t0;
                }
                if (delta?.content) rawContent += delta.content;
                if (delta?.reasoning_content) streamReasoning += delta.reasoning_content;
              } catch {
                // Ignore partial SSE frames
              }
            }
          }
        }

        const wallLatencyMs = Date.now() - t0;
        const split = splitThinkBlock(rawContent);
        const answer = split.answer || rawContent;
        const thinking = streamReasoning.trim() || split.thinking;
        const telemetry = computeTurnTelemetry({
          answer,
          thinking,
          hasImages,
          wallLatencyMs,
          workerLatencyMs: wallLatencyMs,
          usage,
          timings,
        });

        return {
          source: `${onlineVm.accountAlias.toUpperCase()} (${onlineVm.workerProfile}${targetService !== "default" ? `:${targetService}` : ""})`,
          executionRoute: "dual_t4_direct_tunnel",
          target: onlineVm.target,
          model: respModel,
          answer,
          thinking,
          latencyMs: wallLatencyMs,
          workerLatencyMs: wallLatencyMs,
          ttftMs,
          usage,
          ...telemetry,
          jsonValidation: mode === "json" || mode === "vision_qa" ? validateJsonAgainstSchema(answer, jsonSchema) : null,
        };
      }

      // Path B: Safe Headless Mode Outbound Relay (no inbound tunnel needed)
      const { stream_options: _omitStreamOpts, ...relayPayloadBase } = payload;
      void _omitStreamOpts;
      const relayPayload = { ...relayPayloadBase, stream: false };
      const relay = await prisma.llmRelayRequest.create({
        data: {
          userId,
          targetVm: onlineVm.target,
          targetService,
          requestPayloadJson: JSON.stringify(relayPayload),
          status: "PENDING",
        },
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt < CF_SAFE_RELAY_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 250));
        const row = await prisma.llmRelayRequest.findUnique({ where: { id: relay.id } });
        if (!row) break;
        if (row.status === "FAILED") {
          const errMsg = row.errorMessage || "Safe Headless LLM execution failed.";
          const errStatus =
            errMsg.includes("409") || errMsg.toLowerCase().includes("no llm model loaded")
              ? 409
              : 502;
          throw new LlmDispatchError(errMsg, errStatus);
        }
        if (row.status === "COMPLETED") {
          const wallLatencyMs = Date.now() - startedAt;
          const workerLatencyMs = row.latencyMs ?? null;
          const resp = row.responseJson
            ? (JSON.parse(row.responseJson) as {
                model?: string;
                choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
                usage?: DispatchLlmResult["usage"];
                timings?: LlmRawTimings;
                scriptoria_vision?: { bypassed?: boolean; encodeMs?: number | null; visionTokens?: number | null };
              })
            : {};
          const rawMsg = resp.choices?.[0]?.message?.content || "";
          const split = splitThinkBlock(rawMsg);
          const answer = split.answer || rawMsg;
          const thinking = resp.choices?.[0]?.message?.reasoning_content?.trim() || split.thinking;
          const telemetry = computeTurnTelemetry({
            answer,
            thinking,
            hasImages,
            wallLatencyMs,
            workerLatencyMs,
            usage: resp.usage ?? null,
            timings: resp.timings ?? null,
            visionMeta: resp.scriptoria_vision ?? null,
          });

          return {
            source: `${onlineVm.accountAlias.toUpperCase()} Safe-Relay (${onlineVm.workerProfile}${targetService !== "default" ? `:${targetService}` : ""})`,
            executionRoute: "dual_t4_local_relay",
            target: row.assignedTarget || onlineVm.target,
            model: resp.model || modelOverride || onlineVm.workerProfile,
            answer,
            thinking,
            latencyMs: wallLatencyMs,
            workerLatencyMs,
            ttftMs: null,
            usage: resp.usage ?? null,
            ...telemetry,
            jsonValidation: mode === "json" || mode === "vision_qa" ? validateJsonAgainstSchema(answer, jsonSchema) : null,
          };
        }
      }
      throw new LlmDispatchError(
        `Safe Headless relay exceeded ${Math.round(CF_SAFE_RELAY_TIMEOUT_MS / 1000)}s (stopped cleanly before Cloudflare 100s timeout). Try Thinking OFF or lower max_tokens.`,
        504,
        "relay_timeout_cf_guard"
      );
    }
  }

  // Path C: Configured Vault Cloud / External API Provider
  if (!useExplicitVault && (!fallbackToVault || hasImages)) {
    throw new LlmDispatchError(
      hasImages
        ? "No online Vision LLM GPU worker found. Boot Qwen3.8-27B VLM (or enable Vault text mode)."
        : "No online GPU LLM worker found. Boot Qwen3.8-27B VLM or enable Vault API fallback.",
      503
    );
  }

  const candidates = await resolveCandidateLlmConfigs(userId);
  const chosen = explicitProviderName
    ? candidates.find((c) => c.provider.toLowerCase() === explicitProviderName.toLowerCase()) || candidates[0]
    : candidates[0];

  if (!chosen) {
    throw new LlmDispatchError(
      "No online LLM worker or configured Vault API keys (Gemini / OpenAI / Anthropic / OpenRouter) found.",
      503
    );
  }

  const t0 = Date.now();
  const res = await callLlmWithTools({
    config: chosen,
    systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature,
  });
  const wallLatencyMs = Date.now() - t0;
  const split = splitThinkBlock(res.text);
  const answer = split.answer || res.text;
  const telemetry = computeTurnTelemetry({
    answer,
    thinking: split.thinking,
    hasImages,
    wallLatencyMs,
    workerLatencyMs: null,
    usage: null,
    timings: null,
  });

  return {
    source: `Vault (${res.provider})`,
    executionRoute: "vault_cloud_fallback",
    target: `vault:${res.provider}`,
    model: res.model,
    answer,
    thinking: split.thinking,
    latencyMs: wallLatencyMs,
    workerLatencyMs: null,
    ttftMs: null,
    usage: null,
    ...telemetry,
    jsonValidation: mode === "json" || mode === "vision_qa" ? validateJsonAgainstSchema(answer, jsonSchema) : null,
  };
}
