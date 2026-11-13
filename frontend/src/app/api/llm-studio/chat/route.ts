import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { callLlmWithTools, resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  imageDataUrls?: string[];
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  systemPrompt?: string;
  mode?: "chat" | "json" | "vision_qa";
  jsonSchema?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  temperature?: number;
  maxTokens?: number;
  fallbackToVault?: boolean;
}

function splitThinkBlock(raw: string): { thinking: string | null; answer: string } {
  const match = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (!match) {
    return { thinking: null, answer: raw.trim() };
  }
  const thinking = match[1].trim();
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return { thinking: thinking || null, answer };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as ChatRequestBody;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "At least one message is required." }, { status: 400 });
    }

    const mode = body.mode || "chat";
    const reasoningEffort = body.reasoningEffort || "none";
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.25;
    const maxTokens = typeof body.maxTokens === "number" ? Math.min(4096, Math.max(64, body.maxTokens)) : 2048;
    const fallbackToVault = Boolean(body.fallbackToVault);

    let systemPrompt = (body.systemPrompt || "You are a helpful AI studio assistant.").trim();
    if (reasoningEffort === "none") {
      systemPrompt += "\nDo NOT output internal thought or <think> tags. Answer directly and concisely.";
    }
    if (mode === "json" || mode === "vision_qa") {
      const schemaNote = body.jsonSchema?.trim()
        ? `\nRespond ONLY with valid JSON conforming to:\n${body.jsonSchema.trim()}`
        : "\nRespond ONLY with valid JSON.";
      systemPrompt = `${systemPrompt}${schemaNote}`;
    }

    const onlineVm = await prisma.vmInstance.findFirst({
      where: {
        userId: user.userId,
        workerProfile: {
          in: ["LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B", "TPU_QWEN27B_V5E"],
        },
        status: "ONLINE",
      },
      orderBy: { lastHeartbeat: "desc" },
    });

    if (onlineVm?.publicUrl) {
      const base = onlineVm.publicUrl.replace(/\/$/, "");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (onlineVm.vmSecret) {
        headers["Authorization"] = `Bearer ${onlineVm.vmSecret}`;
        headers["X-VM-Secret"] = onlineVm.vmSecret;
      }

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
        model: "qwen-27b",
        messages: openAiMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        cache_prompt: true,
        chat_template_kwargs: {
          enable_thinking: reasoningEffort !== "none" && reasoningEffort !== "low",
        },
      };
      if (mode === "json" || mode === "vision_qa") {
        payload.response_format = { type: "json_object" };
      }

      const t0 = Date.now();
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(240000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Kaggle Qwen server returned HTTP ${res.status}: ${errText.slice(0, 300)}` },
          { status: 502 }
        );
      }

      // Collect SSE stream server-side so Cloudflare Quick Tunnel never hits 100s HTTP 524 idle timeout
      let rawContent = "";
      let streamReasoning = "";
      let respModel = "qwen-27b";
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

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
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              if (chunk.model) respModel = chunk.model;
              if (chunk.usage) usage = chunk.usage;
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.content) rawContent += delta.content;
              if (delta?.reasoning_content) streamReasoning += delta.reasoning_content;
            } catch {
              // ignore partial/comment SSE chunk
            }
          }
        }
      }

      const latencyMs = Date.now() - t0;
      const split = splitThinkBlock(rawContent);
      const thinking = streamReasoning.trim() || split.thinking;
      const completionTokens = usage?.completion_tokens ?? null;
      const tokPerSec =
        completionTokens && latencyMs > 0
          ? Number(((completionTokens / latencyMs) * 1000).toFixed(1))
          : null;

      return NextResponse.json({
        source: "kaggle_qwen_vlm",
        target: onlineVm.target,
        model: respModel,
        answer: split.answer || rawContent,
        thinking,
        latencyMs,
        usage,
        tokPerSec,
      });
    }

    // Fallback when Kaggle Acc #2 is offline
    const hasImages = messages.some((m) => m.imageDataUrls && m.imageDataUrls.length > 0);
    if (!fallbackToVault || hasImages) {
      return NextResponse.json(
        {
          error: hasImages
            ? "Kaggle Acc #2 (QWEN-LLM) is offline. Boot QWEN-LLM on /vms to test VLM image inspection."
            : "Kaggle Acc #2 (QWEN-LLM) is offline. Boot QWEN-LLM on /vms or enable Vault Fallback.",
        },
        { status: 503 }
      );
    }

    const candidates = await resolveCandidateLlmConfigs(user.userId);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "QWEN-LLM is offline and no Vault/env LLM keys are configured." },
        { status: 503 }
      );
    }

    const t0 = Date.now();
    const res = await callLlmWithTools({
      config: candidates[0],
      systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
    });
    const latencyMs = Date.now() - t0;

    return NextResponse.json({
      source: `vault_fallback (${res.provider})`,
      target: null,
      model: res.model,
      answer: res.text,
      thinking: null,
      latencyMs,
      usage: null,
      tokPerSec: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM Studio chat request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

