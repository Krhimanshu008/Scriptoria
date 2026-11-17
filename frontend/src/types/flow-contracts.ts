// frontend/src/types/flow-contracts.ts

export type FlowConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "IDLE"
  | "BUSY_GENERATING"
  | "SYNCING_INGREDIENTS"
  | "PAUSED"
  | "ERROR";

export type FlowIngredientCategory =
  | "CHARACTER"
  | "LOCATION"
  | "PROP"
  | "STYLE";

export type FlowMediaType = "IMAGE" | "VIDEO";

export type FlowModelEngine =
  | "NANO_BANANA_2_1"
  | "NANO_BANANA_PRO"
  | "NANO_BANANA_2_LITE"
  | "NANO_BANANA"
  | "IMAGEN_3"
  | "OMNI_1_2_FLASH"
  | "OMNI_1_1_FLASH"
  | "VEO_3_1_LITE"
  | "VEO_3_1_FAST"
  | "VEO_3_1_QUALITY"
  | "VEO_2"
  | "VEO_3"
  | "FLOW_AUTO";

export type FlowThinkingLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTRA_THOROUGH";

export type FlowVideoMode = "FRAMES" | "INGREDIENTS";

export type FlowAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";

export type FlowTaskStatus =
  | "QUEUED"
  | "DISPATCHED"
  | "INJECTING_PROMPT"
  | "AWAITING_RENDER"
  | "DOWNLOADING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type FlowQueueActionType =
  | "PAUSE"
  | "RESUME"
  | "CANCEL_TASK"
  | "RETRY_TASK"
  | "CLEAR_FAILED"
  | "FLUSH_ALL"
  | "PING_COMPANION";

export interface FlowIngredientRef {
  readonly ingredient_id: string;
  readonly mention_handle: string;
  readonly category: FlowIngredientCategory;
  readonly flow_internal_tag_id?: string | null;
}

export interface FlowCompanionStatus {
  readonly session_id: string;
  readonly connection_state: FlowConnectionState;
  readonly flow_project_id: string;
  readonly active_tab_url?: string | null;
  readonly extension_version: string;
  readonly user_agent?: string | null;
  readonly active_task_id?: string | null;
  readonly queued_tasks_count: number;
  readonly completed_tasks_count: number;
  readonly failed_tasks_count: number;
  readonly available_ingredients: readonly string[];
  readonly last_heartbeat_at: string;
  readonly last_error?: string | null;
}

export interface FlowIngredientSyncItem {
  readonly ingredient_id: string;
  readonly project_id: string;
  readonly flow_project_id: string;
  readonly name: string;
  readonly mention_handle: string;
  readonly category: FlowIngredientCategory;
  readonly visual_prompt: string;
  readonly reference_image_url?: string | null;
  readonly character_profile_id?: string | null;
  readonly scene_id?: string | null;
  readonly flow_internal_tag_id?: string | null;
}

export interface FlowIngredientSync {
  readonly sync_id?: string;
  readonly project_id: string;
  readonly flow_project_id?: string;
  readonly direction?: "PUSH_TO_FLOW" | "PULL_FROM_FLOW" | "RECONCILE";
  readonly ingredients: readonly FlowIngredientSyncItem[];
  readonly auto_create_missing?: boolean;
  readonly requested_at?: string;
}

export interface FlowGenerationTask {
  readonly task_id?: string;
  readonly project_id: string;
  readonly flow_project_id?: string;
  readonly scene_id?: string | null;
  readonly character_profile_id?: string | null;
  readonly beat_id?: string | null;
  readonly prompt: string;
  readonly negative_prompt?: string | null;
  readonly ingredient_refs?: readonly FlowIngredientRef[];
  readonly media_type?: FlowMediaType;
  readonly model_engine?: FlowModelEngine;
  readonly aspect_ratio?: FlowAspectRatio;
  readonly candidate_count?: number;
  readonly thinking_level?: FlowThinkingLevel;
  readonly video_mode?: FlowVideoMode;
  readonly video_duration_seconds?: number;
  readonly video_resolution?: "360p" | "720p";
  readonly seed?: number | null;
  readonly priority?: number;
  readonly timeout_seconds?: number;
  readonly status?: FlowTaskStatus;
  readonly retry_count?: number;
  readonly created_at?: string;
}

export interface FlowMediaCandidate {
  readonly candidate_index: number;
  readonly remote_url: string;
  readonly media_type?: FlowMediaType;
  readonly mime_type: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly duration_seconds?: number | null;
  readonly base64_data?: string | null;
  readonly flow_media_key?: string | null;
}

export interface FlowSavedAssetRecord {
  readonly asset_id: string;
  readonly candidate_index: number;
  readonly local_relative_path: string;
  readonly local_absolute_path: string;
  readonly sha256_hash: string;
  readonly file_size_bytes: number;
  readonly mime_type: string;
  readonly source_remote_url: string;
}

export interface FlowMediaResultEvent {
  readonly event_id: string;
  readonly task_id: string;
  readonly project_id: string;
  readonly flow_project_id: string;
  readonly scene_id?: string | null;
  readonly character_profile_id?: string | null;
  readonly beat_id?: string | null;
  readonly status: "COMPLETED" | "FAILED";
  readonly media_type: FlowMediaType;
  readonly model_engine: FlowModelEngine;
  readonly prompt_used: string;
  readonly candidates: readonly FlowMediaCandidate[];
  readonly saved_assets: readonly FlowSavedAssetRecord[];
  readonly rpc_endpoint_captured?: string | null;
  readonly generation_latency_ms?: number | null;
  readonly error_message?: string | null;
  readonly captured_at: string;
}

export interface FlowQueueAction {
  readonly action_id?: string;
  readonly action: FlowQueueActionType;
  readonly target_task_id?: string | null;
  readonly project_id?: string | null;
  readonly reason?: string | null;
  readonly requested_at?: string;
}

export type FlowAudioVoiceMode = "SINGLE_NARRATOR" | "SMART_MULTI_SPEAKER";
export type FlowAudioExecutionMode = "AUTO" | "IN_TAB" | "HEADLESS";

export interface FlowAudioConfig {
  readonly model_name?: "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts";
  readonly voice_mode?: FlowAudioVoiceMode;
  readonly narrator_voice?: string;
  readonly character_voices?: Record<string, string>;
  readonly language?: "en" | "hi";
  readonly enable_emotion_tags?: boolean;
  readonly execution_mode?: FlowAudioExecutionMode;
}

export interface FlowAudioGenerateRequest {
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly raw_text: string;
  readonly config?: FlowAudioConfig;
}

export interface FlowAudioResultEvent {
  readonly task_id: string;
  readonly project_id: string;
  readonly chapter_id: string;
  readonly chapter_title: string;
  readonly audio_path: string;
  readonly duration_seconds: number;
  readonly sample_rate_hz?: number;
  readonly voice_used: string;
  readonly voice_mode: FlowAudioVoiceMode;
  readonly language: string;
  readonly user_notification: string;
  readonly status: "COMPLETED" | "FAILED";
  readonly error_message?: string | null;
  readonly created_at: string;
}

export interface KaraokeWordToken {
  readonly word: string;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly duration_cs: number;
}

export interface FrameAlignmentSpan {
  readonly frame_index: number;
  readonly sentence_span: string;
  readonly audio_start_sec: number;
  readonly audio_end_sec: number;
  readonly duration_sec: number;
  readonly karaoke_tokens: readonly KaraokeWordToken[];
}

export interface FlowForcedAlignmentRequest {
  readonly project_id: string;
  readonly chapter_id: string;
  readonly total_audio_duration_sec: number;
  readonly sentence_spans: readonly string[];
}

export interface FlowForcedAlignmentResult {
  readonly project_id: string;
  readonly chapter_id: string;
  readonly total_duration_sec: number;
  readonly total_frames: number;
  readonly frames: readonly FrameAlignmentSpan[];
  readonly ass_subtitles_text: string;
  readonly created_at: string;
}

export type FlowDispatchRequestBody =
  | {
      readonly kind: "GENERATION_TASK";
      readonly payload: FlowGenerationTask;
    }
  | {
      readonly kind: "INGREDIENT_SYNC";
      readonly payload: FlowIngredientSync;
    }
  | {
      readonly kind: "QUEUE_ACTION";
      readonly payload: FlowQueueAction;
    }
  | {
      readonly kind: "AUDIO_GENERATE";
      readonly payload: FlowAudioGenerateRequest;
    };
