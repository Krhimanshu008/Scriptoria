import { prisma } from "@/lib/db/prisma";
import { callLlmJson } from "@/lib/agent/llm-client";

export type BatchTrackKind =
  | "VISUAL"
  | "AUDIO_TTS"
  | "AUDIO_SFX"
  | "AUDIO_BGM"
  | "VIDEO_I2V"
  | "LIPSYNC";

export interface CanonicalSceneSpec {
  sceneKey: string;
  title?: string;
  tracks: {
    visual?: {
      prompt: string;
      negativePrompt?: string;
      baseModel?: string;
      pipeline?: "sdxl_txt2img" | "sdxl_detailer_upscale" | "flux_gguf" | "qwen_edit";
      loras?: Array<{ filename: string; strength?: number }>;
      width?: number;
      height?: number;
      steps?: number;
      cfg?: number;
    };
    audio_tts?: {
      text: string;
      voice?: string;
      speed?: number;
      pipeline?: "audio_kokoro" | "audio_f5";
      refAudioPath?: string;
    };
    audio_sfx?: {
      prompt: string;
      durationSec?: number;
    };
    audio_bgm?: {
      mood: string;
      durationSec?: number;
    };
    video_i2v?: {
      motionPrompt: string;
      numFrames?: number;
      dependsOnVisual?: boolean;
    };
    lipsync?: {
      dependsOnVisual?: boolean;
      dependsOnTts?: boolean;
    };
  };
}

export interface ScriptoriaSceneSpecV1 {
  specVersion: "1.0";
  sourceApp: string;
  projectId?: string;
  title: string;
  idempotencyKey?: string;
  webhookCallbackUrl?: string;
  preferFreeColabFirst?: boolean;
  quotaReserveFloorHours?: number;
  defaults?: {
    stylePreset?: string;
    baseModel?: string;
    width?: number;
    height?: number;
  };
  scenes: CanonicalSceneSpec[];
  normalizedBy: "canonical" | "ai-adapter" | "heuristic-fallback";
  adapterNotes?: string;
}

export function getPublicOpenApiSchemaDoc(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Scriptoria External Scene Ingestion & Batch GPU API",
      version: "1.0.0",
      description:
        "Standardized flexible API allowing Book Visualiser and external apps to submit canonical scene specs OR raw story text/arbitrary JSON for multi-GPU batch execution.",
    },
    servers: [{ url: baseUrl }],
    endpoints: {
      "POST /api/v1/ingest": {
        auth: "Bearer sk_scriptoria_... (or Dashboard Session)",
        modes: [
          "Canonical JSON (ScriptoriaSceneSpec v1 with scenes[].tracks)",
          "Flexible Adapter (rawText, chapterMarkdown, arbitrary JSON + optional adapterHints)",
        ],
        queryParams: {
          dryRun: "boolean (true = validate, normalize, & estimate GPU/VRAM plan without queuing)",
        },
      },
      "GET /api/v1/batch": "List all batch jobs & resource coalescing status",
      "GET /api/v1/batch/{batchId}": "Poll live batch status & trigger multi-GPU affinity tick",
      "POST /api/v1/batch/{batchId}/tick": "Explicitly advance scheduler queue on online GPUs",
    },
  };
}

/**
 * Normalizes either strict `ScriptoriaSceneSpec v1` JSON OR arbitrary raw text/Markdown/JSON
 * from Book Visualiser or any external tool into canonical multi-track tasks.
 */
export async function normalizeExternalPayload(
  userId: string,
  payload: Record<string, unknown>
): Promise<ScriptoriaSceneSpecV1> {
  const sourceApp = String(payload.sourceApp || "external").trim() || "external";
  const title = String(payload.title || payload.projectTitle || "Untitled Batch").trim();
  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : undefined;
  const webhookCallbackUrl = payload.webhookCallbackUrl
    ? String(payload.webhookCallbackUrl).trim()
    : undefined;
  const defaults =
    payload.defaults && typeof payload.defaults === "object"
      ? (payload.defaults as ScriptoriaSceneSpecV1["defaults"])
      : undefined;

  // Mode A: Canonical `scenes[]` already structured
  if (Array.isArray(payload.scenes) && payload.scenes.length > 0) {
    const first = payload.scenes[0] as Record<string, unknown>;
    if (first && typeof first.tracks === "object" && first.tracks !== null) {
      const scenes: CanonicalSceneSpec[] = payload.scenes.map((raw, idx) => {
        const s = raw as CanonicalSceneSpec;
        return {
          sceneKey: String(s.sceneKey || `scene-${idx + 1}`),
          title: s.title,
          tracks: s.tracks,
        };
      });
      return {
        specVersion: "1.0",
        sourceApp,
        projectId: payload.projectId ? String(payload.projectId) : undefined,
        title,
        idempotencyKey,
        webhookCallbackUrl,
        preferFreeColabFirst: payload.preferFreeColabFirst !== false,
        quotaReserveFloorHours:
          typeof payload.quotaReserveFloorHours === "number" ? payload.quotaReserveFloorHours : 2,
        defaults,
        scenes,
        normalizedBy: "canonical",
      };
    }
  }

  // Mode B: Flexible AI Adapter (arbitrary JSON, Markdown story, screenplay, array of shots)
  const rawContent =
    typeof payload.rawText === "string"
      ? payload.rawText
      : typeof payload.story === "string"
      ? payload.story
      : JSON.stringify(payload).slice(0, 12000);
  const adapterHints = payload.adapterHints ? String(payload.adapterHints) : "";

  const catalogModels = await prisma.modelAsset.findMany({
    where: { userId },
    select: { slug: true, filename: true, modality: true, category: true, compatibleBase: true },
    take: 45,
  });

  try {
    const aiResult = await callLlmJson<{
      title?: string;
      adapterNotes?: string;
      scenes: CanonicalSceneSpec[];
    }>({
      userId,
      systemPrompt: `You normalize external story/project payloads into ScriptoriaSceneSpec v1 JSON.
Available User Models: ${JSON.stringify(catalogModels)}
Return JSON: { "title": string, "adapterNotes": string, "scenes": [{ "sceneKey": "sc_1", "title": string, "tracks": { "visual"?: { "prompt": string, "negativePrompt"?: string, "baseModel"?: string, "width"?: number, "height"?: number }, "audio_tts"?: { "text": string, "voice"?: "af_heart"|"af_bella"|"am_adam" }, "audio_sfx"?: { "prompt": string, "durationSec"?: number }, "audio_bgm"?: { "mood": string, "durationSec"?: number }, "video_i2v"?: { "motionPrompt": string, "dependsOnVisual": true } } }] }.
Generate rich visual ComfyUI prompts matching the user's available models. Limit to at most 20 scenes.`,
      userPrompt: `SourceApp: ${sourceApp}\nHints: ${adapterHints}\nPayload:\n${rawContent.slice(0, 10000)}`,
    });

    if (aiResult?.data?.scenes?.length) {
      return {
        specVersion: "1.0",
        sourceApp,
        projectId: payload.projectId ? String(payload.projectId) : undefined,
        title: aiResult.data.title || title,
        idempotencyKey,
        webhookCallbackUrl,
        preferFreeColabFirst: payload.preferFreeColabFirst !== false,
        quotaReserveFloorHours:
          typeof payload.quotaReserveFloorHours === "number" ? payload.quotaReserveFloorHours : 2,
        defaults,
        scenes: aiResult.data.scenes.map((s, idx) => ({
          sceneKey: String(s.sceneKey || `sc_${idx + 1}`),
          title: s.title,
          tracks: s.tracks || {},
        })),
        normalizedBy: "ai-adapter",
        adapterNotes: aiResult.data.adapterNotes || `Normalized via ${aiResult.provider}:${aiResult.model}`,
      };
    }
  } catch {
    // Fall back deterministically below if LLM unavailable
  }

  // Deterministic paragraph splitter fallback when no LLM key configured
  const paragraphs = rawContent
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 8)
    .slice(0, 12);

  const fallbackScenes: CanonicalSceneSpec[] = (
    paragraphs.length > 0 ? paragraphs : [rawContent.slice(0, 400) || "Cinematic opening scene"]
  ).map((para, idx) => ({
    sceneKey: `scene-${idx + 1}`,
    title: `Scene ${idx + 1}`,
    tracks: {
      visual: {
        prompt: `cinematic story illustration, masterpiece, detailed lighting: ${para.slice(0, 260)}`,
        baseModel: defaults?.baseModel || "waiNSFWIllustrious_v110.safetensors",
        width: defaults?.width || 1024,
        height: defaults?.height || 1024,
      },
      audio_tts: {
        text: para.slice(0, 350),
        voice: "af_heart",
        pipeline: "audio_kokoro",
      },
    },
  }));

  return {
    specVersion: "1.0",
    sourceApp,
    title,
    idempotencyKey,
    webhookCallbackUrl,
    preferFreeColabFirst: true,
    quotaReserveFloorHours: 2,
    defaults,
    scenes: fallbackScenes,
    normalizedBy: "heuristic-fallback",
    adapterNotes: "Used paragraph fallback splitter (add an LLM key in Settings for AI story decomposition).",
  };
}

