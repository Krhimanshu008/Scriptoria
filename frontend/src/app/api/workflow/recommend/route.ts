import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { callLlmJson, resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import {
  recommendWorkflowStacks,
  type RecommendationTaskType,
  type RecommendWorkflowInput,
} from "@/lib/workflow/recommender";
import type { ControlNetMode, IpConnectorMode, RelightMode, StylePresetId } from "@/lib/workflow/modules";

interface LlmClassification {
  task?: RecommendationTaskType;
  stylePreset?: StylePresetId;
  consistencyMode?: IpConnectorMode | "auto" | "none";
  controlNetMode?: ControlNetMode;
  relight?: RelightMode;
  characterCount?: number;
  promptHint?: string;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json()) as RecommendWorkflowInput & {
      useLlmClassifier?: boolean;
    };

    const effectiveInput: RecommendWorkflowInput = { ...body };

    // When a free-form goal is given without explicit task/style, enrich via LLM if configured (safe fallback otherwise)
    if (body.goal && body.useLlmClassifier !== false && (!body.task || !body.stylePreset)) {
      const llmCandidates = await resolveCandidateLlmConfigs(auth.userId).catch(() => []);
      if (llmCandidates.length > 0) {
        const llmRes = await callLlmJson<LlmClassification>({
          userId: auth.userId,
          systemPrompt:
            "Classify a user's visual storytelling goal for ComfyUI on Kaggle Dual-T4 into JSON: { task: 'txt2img'|'character_turnaround'|'consistent_ip'|'multi_char_scene'|'controlnet_guided'|'relight_composite'|'image_edit'|'panorama_360'|'storyboard_fast'|'portrait', stylePreset: 'anime_vibrant'|'anime_dramatic_vpred'|'anime_clean_cel'|'manhwa_webtoon'|'painterly_fantasy'|'lineart_sketch'|'gothic_dark'|'photoreal_cinematic'|'panorama_360', consistencyMode: 'none'|'noob_ipa_mk1'|'style_aligned'|'anima_ref_v2'|'flux3_ref_latent'|'qwen21_ref_strength'|'sdxl_ipa_photoreal', controlNetMode: 'none'|'canny'|'depth'|'lineart_anime'|'openpose'|'tile'|'qwen_fun_union'|'moss_color_depth', relight: 'none'|'qwen_light_migration'|'lbm_relight', characterCount: number, promptHint: string }. Keep non-commercial anime best-in-class options eligible.",
          userPrompt: body.goal,
        }).catch(() => null);

        if (llmRes?.data) {
          if (!effectiveInput.task && llmRes.data.task) effectiveInput.task = llmRes.data.task;
          if (!effectiveInput.stylePreset && llmRes.data.stylePreset) {
            effectiveInput.stylePreset = llmRes.data.stylePreset;
          }
          if (!effectiveInput.consistencyMode && llmRes.data.consistencyMode) {
            effectiveInput.consistencyMode = llmRes.data.consistencyMode;
          }
          if (!effectiveInput.controlNetMode && llmRes.data.controlNetMode) {
            effectiveInput.controlNetMode = llmRes.data.controlNetMode;
          }
          if (!effectiveInput.relight && llmRes.data.relight) {
            effectiveInput.relight = llmRes.data.relight;
          }
          if (!effectiveInput.characterCount && typeof llmRes.data.characterCount === "number") {
            effectiveInput.characterCount = llmRes.data.characterCount;
          }
        }
      }
    }

    const result = await recommendWorkflowStacks(auth.userId, effectiveInput);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to recommend workflows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
