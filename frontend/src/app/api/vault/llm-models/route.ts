import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { defaultBaseUrlForProvider, type ResolvedLlmConfig } from "@/lib/agent/llm-client";

export interface FetchedModelOption {
  id: string;
  label: string;
  isFree: boolean;
  supportsTools: boolean;
  contextLength?: number;
  note?: string;
}

const GEMINI_RECOMMENDED_FREE = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemma-4-26b-a4b-it",
  "gemini-3.8-flash",
]);

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      provider?: string;
      apiKey?: string;
      accountAlias?: string;
      baseUrl?: string;
      onlyFree?: boolean;
    };

    const rawProv = String(body.provider || "gemini").trim().toLowerCase();
    const provider: ResolvedLlmConfig["provider"] =
      rawProv === "groq" || rawProv === "openai" || rawProv === "openrouter" || rawProv === "ollama"
        ? rawProv
        : "gemini";
    const onlyFree = body.onlyFree !== false;

    let apiKey = (body.apiKey || "").trim();
    let storedBaseUrl: string | undefined;

    if (!apiKey && body.accountAlias) {
      const cred = await getDecryptedCredential(user.userId, "llm", body.accountAlias);
      if (cred) {
        apiKey = cred.secret;
        const meta = (cred.metadata || {}) as { baseUrl?: string };
        storedBaseUrl = meta.baseUrl;
      }
    }

    const rawBase = (body.baseUrl || storedBaseUrl || "").trim();
    const baseUrl =
      rawBase.startsWith("http://") || rawBase.startsWith("https://")
        ? rawBase.replace(/\/$/, "")
        : defaultBaseUrlForProvider(provider);

    if (provider === "gemini") {
      const keyToUse = apiKey || process.env.GEMINI_API_KEY || "";
      if (!keyToUse) {
        return NextResponse.json(
          { error: "Enter a Gemini API key first (or edit an existing saved key)." },
          { status: 400 }
        );
      }

      const res = await fetch(`${baseUrl}/models?pageSize=100`, {
        headers: { "x-goog-api-key": keyToUse },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Gemini models fetch failed (${res.status}): ${txt.slice(0, 140)}` },
          { status: 400 }
        );
      }

      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
          inputTokenLimit?: number;
        }>;
      };

      const options: FetchedModelOption[] = (data.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter(
          (id) =>
            !/embedding|imagen|veo|lyria|tts|transcribe|robotics|computer-use|deep-research|image/i.test(
              id
            ) && id !== "gemini-2.5-flash"
        )
        .map((id) => {
          const isGemma = id.startsWith("gemma-");
          const recommended = GEMINI_RECOMMENDED_FREE.has(id);
          return {
            id,
            label: recommended ? `${id} (Recommended Free)` : id,
            isFree: /flash|gemma/i.test(id),
            supportsTools: !isGemma,
            note: isGemma ? "Text only (no tool calling)" : recommended ? "Fast + Tool Calling" : undefined,
          };
        })
        .filter((m) => !onlyFree || m.isFree)
        .sort((a, b) => {
          const ar = GEMINI_RECOMMENDED_FREE.has(a.id) ? 0 : 1;
          const br = GEMINI_RECOMMENDED_FREE.has(b.id) ? 0 : 1;
          return ar - br || a.id.localeCompare(b.id);
        });

      return NextResponse.json({ ok: true, provider, models: options });
    }

    if (provider === "openrouter") {
      // OpenRouter /models is public and gives exact pricing + supported_parameters!
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `OpenRouter models fetch failed (${res.status}).` },
          { status: 400 }
        );
      }

      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
          supported_parameters?: string[];
        }>;
      };

      const options: FetchedModelOption[] = (data.data || [])
        .map((m) => {
          const isFree =
            m.id === "openrouter/free" ||
            m.id.endsWith(":free") ||
            (m.pricing?.prompt === "0" && m.pricing?.completion === "0");
          const supportsTools =
            m.id === "openrouter/free" || Boolean(m.supported_parameters?.includes("tools"));
          return {
            id: m.id,
            label: m.id,
            isFree,
            supportsTools,
            contextLength: m.context_length,
            note: supportsTools ? "Tools OK" : "No tool calls",
          };
        })
        .filter((m) => !onlyFree || m.isFree)
        .sort((a, b) => {
          if (a.id === "openrouter/free") return -1;
          if (b.id === "openrouter/free") return 1;
          if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1;
          return a.id.localeCompare(b.id);
        });

      return NextResponse.json({ ok: true, provider, models: options });
    }

    // Groq / OpenAI / Ollama
    const keyToUse = apiKey || (provider === "groq" ? process.env.GROQ_API_KEY || "" : "");
    const headers: Record<string, string> = {};
    if (keyToUse && keyToUse !== "ollama") {
      headers["Authorization"] = `Bearer ${keyToUse}`;
    }

    const res = await fetch(`${baseUrl}/models`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `${provider.toUpperCase()} models fetch failed (${res.status}): ${txt.slice(0, 140)}` },
        { status: 400 }
      );
    }

    const data = (await res.json()) as {
      data?: Array<{ id: string; context_window?: number }>;
    };

    const options: FetchedModelOption[] = (data.data || [])
      .filter((m) => {
        if (provider !== "groq") return true;
        return !/whisper|orpheus|prompt-guard|safeguard/i.test(m.id);
      })
      .map((m) => ({
        id: m.id,
        label: m.context_window ? `${m.id} (${Math.round(m.context_window / 1024)}k ctx)` : m.id,
        isFree: provider === "groq" || provider === "ollama",
        supportsTools: true,
        contextLength: m.context_window,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return NextResponse.json({ ok: true, provider, models: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch provider models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

