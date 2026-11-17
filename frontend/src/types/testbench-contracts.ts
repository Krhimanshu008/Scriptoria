export const EXPECTED_CONTRACT_HASH =
  "1f380a6ec248d105711bcaf038409b2d3373004f51797a24961e958f68ea98ab" as const;

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "CONTRACT_MISMATCH"
  | "VRAM_BUSY"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export type ErrorStage =
  | "nextjs_proxy"
  | "fastapi_validation"
  | "parser"
  | "vram_coordinator"
  | "sqlite_fts";

export interface ErrorDetail {
  field?: string | null;
  message: string;
  code?: string | null;
  input_type?: string | null;
}

export interface ApiErrorBody {
  code: ErrorCode;
  stage: ErrorStage;
  message: string;
  trace_id: string;
  retryable: boolean;
  retry_after_ms?: number | null;
  details: ErrorDetail[];
}

export interface ApiErrorEnvelope {
  ok: false;
  error: ApiErrorBody;
}

export interface SpanRange {
  codepoint_start: number;
  codepoint_end: number;
  utf16_start: number;
  utf16_end: number;
}

export type DependencyStatus = "healthy" | "degraded" | "unavailable";

export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  latency_ms: number;
  message?: string | null;
}

export interface SystemHealthResponse {
  ok: true;
  status: DependencyStatus;
  timestamp_utc: string;
  trace_id: string;
  dependencies: DependencyHealth[];
}

export interface ContractLimits {
  max_payload_bytes: number;
  max_text_chars: number;
  max_chapters_per_document: number;
  request_timeout_ms: number;
}

export interface ContractManifestResponse {
  ok: true;
  contract_hash: string;
  schema_version: string;
  openapi_version: string;
  trace_id: string;
  limits: ContractLimits;
}

export type PrimitiveValue = string | number | boolean;

export interface EchoValidateRequest {
  text: string;
  probe_cp_start?: number | null;
  probe_cp_end?: number | null;
  metadata?: Record<string, PrimitiveValue>;
}

export interface EchoValidateResponse {
  ok: true;
  trace_id: string;
  echoed_text: string;
  codepoint_length: number;
  utf16_length: number;
  utf8_byte_length: number;
  full_span: SpanRange;
  probe_span?: SpanRange | null;
  metadata: Record<string, PrimitiveValue>;
}

export interface ParserProfile {
  id: string;
  label: string;
  description: string;
  max_chunk_words: number;
  max_chunk_tokens: number;
  normalize_ligatures: boolean;
  scene_break_min_blank_lines: number;
}

export interface ParserPresetsResponse {
  ok: true;
  trace_id: string;
  default_profile_id: string;
  default_word_cap: number;
  default_token_cap: number;
  supported_extensions: string[];
  ligature_map: Record<string, string>;
  profiles: ParserProfile[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface ParseDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  span?: SpanRange | null;
  line?: number | null;
  column?: number | null;
}

export type DocumentNodeType =
  | "document"
  | "chapter"
  | "scene"
  | "paragraph"
  | "scene_break";

export interface DocumentNode {
  node_id: string;
  node_type: DocumentNodeType;
  title?: string | null;
  order_index: number;
  span: SpanRange;
  children: DocumentNode[];
}

export interface ParsedChunk {
  chunk_id: string;
  chapter_index: number;
  scene_index: number;
  chunk_index: number;
  raw_text: string;
  normalized_text: string;
  span: SpanRange;
  codepoint_length: number;
  utf16_length: number;
  sha256: string;
}

export interface ParseInspectRequest {
  raw_text: string;
  source_name?: string;
  normalize_ligatures?: boolean;
  include_ast?: boolean;
  include_chunks?: boolean;
}

export interface ParseInspectResponse {
  ok: true;
  trace_id: string;
  source_name: string;
  normalized_markdown: string;
  raw_codepoint_length: number;
  raw_utf16_length: number;
  normalized_codepoint_length: number;
  normalized_utf16_length: number;
  chapter_count: number;
  scene_count: number;
  document_tree?: DocumentNode | null;
  chunks: ParsedChunk[];
  diagnostics: ParseDiagnostic[];
}

// ============================================================================
// Sprint 2: Cloud VM Swarm & Extraction Contracts
// ============================================================================

export type MatchQuality = "EXACT" | "FUZZY" | "UNMATCHED";

export interface QuoteAnchorMatch {
  exact_quote: string;
  span?: SpanRange | null;
  match_quality: MatchQuality;
  similarity_score: number;
}

export interface VisualBeat {
  beat_order: number;
  shot_suggestion: string;
  focal_elements: string[];
  quote_anchor: QuoteAnchorMatch;
}

export interface CharacterPresence {
  entity_id: string;
  name_in_scene: string;
  action: string;
  emotional_state: string;
  clothing_mention?: string | null;
}

export interface ExtractedScene {
  scene_id: string;
  scene_order: number;
  start_char_offset: number;
  end_char_offset: number;
  verbatim_summary: string;
  location_name: string;
  time_of_day: string;
  characters_present: CharacterPresence[];
  beats: VisualBeat[];
}

export type EntityType = "CHARACTER" | "LOCATION" | "ITEM" | "FACTION";

export interface ExtractedEntityItem {
  entity_id: string;
  canonical_name: string;
  aliases: string[];
  short_visual_tag: string;
  entity_type: EntityType;
}

export interface RollingGlossarySnapshot {
  entities: ExtractedEntityItem[];
  last_completed_chapter: number;
}

export interface ChapterExtractionRequest {
  book_id: string;
  chapter_index: number;
  chapter_title?: string | null;
  raw_text: string;
  glossary?: RollingGlossarySnapshot | null;
  worker_target?: string;
  simulate_delay_s?: number | null;
}

export interface QuoteMatchStats {
  total_beats: number;
  exact_matches: number;
  fuzzy_matches: number;
  unmatched: number;
  match_rate_percent: number;
}

export interface ChapterExtractionResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  chapter_index: number;
  scenes: ExtractedScene[];
  discovered_entities: ExtractedEntityItem[];
  updated_glossary: RollingGlossarySnapshot;
  quote_stats: QuoteMatchStats;
  diagnostics: string[];
}

export type VramLockMode = "IDLE" | "EXTRACTION_SWARM" | "IMAGE_GEN_COMFYUI";

export interface VramEvictionState {
  ok: true;
  trace_id: string;
  active_mode: VramLockMode;
  lock_holder?: string | null;
  vram_allocated_mb: number;
  gpu_device_name?: string | null;
  lock_acquired_timestamp?: string | null;
}

export interface VramLockRequest {
  requested_mode: VramLockMode;
  client_id: string;
  force?: boolean;
}

export interface SwarmPortStatus {
  port: number;
  service: string;
  listening: boolean;
  mode: "LIVE_SOCKET" | "SIMULATED_READY";
}

export interface SwarmTargetNodeStatus {
  target_id: string;
  accelerator_type: "GPU" | "TPU" | "CPU";
  device_name: string;
  port: number;
  reachable: boolean;
  status: "ONLINE" | "BUSY" | "STANDBY" | "OFFLINE";
  latency_ms: number;
}

export interface SwarmStatusResponse {
  ok: true;
  trace_id: string;
  targets: Record<string, SwarmTargetNodeStatus>;
  ports: Record<string, SwarmPortStatus>;
  active_ports: number[];
  vram_state: VramEvictionState;
}

export interface ExtractionCheckpointItem {
  book_id: string;
  chapter_index: number;
  completed_at: string;
  scene_count: number;
  entity_count: number;
  sha256_hash: string;
}

export interface ExtractionCheckpointsResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  checkpoints: ExtractionCheckpointItem[];
  can_resume_at_chapter: number;
}

export interface CrashSimulationRequest {
  book_id: string;
  fail_at_chapter: number;
  total_chapters?: number;
}

export interface CrashSimulationResponse {
  ok: true;
  trace_id: string;
  crashed_at_chapter: number;
  completed_before_crash: number[];
  resumable_chapter: number;
  idempotent_verified: boolean;
}

// ============================================================================
// Sprint 3: Stage-2 Book Compiler & Temporal Graph Contracts
// ============================================================================

export type EntityVisualTier = "TIER_1_CORE" | "TIER_2" | "TIER_3";
export type CompiledEntityType = "CHARACTER" | "LOCATION" | "ITEM" | "FACTION";

export interface CompiledEntitySummary {
  entity_id: string;
  canonical_name: string;
  aliases: string[];
  entity_type: CompiledEntityType;
  visual_tier: EntityVisualTier;
  importance_score: number;
  base_anatomy?: string | null;
  first_seen_chapter: number;
  scene_presence_count: number;
}

export interface CompiledLocationSummary {
  location_id: string;
  canonical_name: string;
  parent_location_id?: string | null;
  materialized_path: string;
  environment_tags: string[];
}

export type TimelineTimeType =
  | "PRESENT"
  | "FLASHBACK"
  | "DREAM"
  | "TIME_SKIP"
  | "PARALLEL_POV";

export interface TimelineTickSummary {
  tick_index: number;
  narrative_seq: number;
  story_time_tick: number;
  chapter_index: number;
  scene_id: string;
  time_type: TimelineTimeType;
  is_flashback: boolean;
  location_id: string;
  location_name: string;
  characters_present: string[];
  summary: string;
}

export type GraphEdgeType =
  | "CO_OCCURRENCE"
  | "INTERACTION"
  | "LOCATED_IN"
  | "POSSESSES"
  | "FAMILY"
  | "ALLIANCE";

export interface GraphEdgeSummary {
  edge_id: string;
  source_id: string;
  target_id: string;
  edge_type: GraphEdgeType;
  weight: number;
  bidirectional: boolean;
}

export interface CompileBookRequest {
  book_id: string;
  use_demo_if_empty?: boolean;
}

export interface CompiledBookGraphResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  total_chapters: number;
  total_scenes: number;
  total_beats: number;
  entities: Record<string, CompiledEntitySummary>;
  locations: Record<string, CompiledLocationSummary>;
  timeline: TimelineTickSummary[];
  edges: GraphEdgeSummary[];
  has_cycles_detected: boolean;
  cycle_break_count: number;
  duration_sec: number;
}

export interface TimelineResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  total_ticks: number;
  flashback_count: number;
  ticks: TimelineTickSummary[];
}

export interface CharacterRegistryResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  characters: CompiledEntitySummary[];
  tier_counts: Record<string, number>;
}

export interface LocationTreeResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  locations: CompiledLocationSummary[];
  root_locations: string[];
  cycle_free_verified: boolean;
}

// ============================================================================
// Sprint 4: Hybrid RAG, Graph RAG & Turso SQL Contracts
// ============================================================================

export interface RagHybridSearchRequest {
  book_id?: string;
  query: string;
  max_narrative_seq?: number;
  top_k?: number;
}

export interface HybridSearchResultItem {
  chunk_id: string;
  narrative_seq: number;
  story_time_tick: number;
  quote_anchor: string;
  shot_suggestion: string;
  focal_elements: string[];
  bm25_rank: number | null;
  vector_rank: number | null;
  rrf_score: number;
  is_future_spoiler: boolean;
}

export interface RagHybridSearchResponse {
  ok: true;
  trace_id: string;
  query: string;
  max_narrative_seq: number;
  total_hits: number;
  future_blocked_chunks: number;
  results: HybridSearchResultItem[];
}

export interface TimelineStateQueryRequest {
  book_id?: string;
  character_ids: string[];
  tick?: number;
}

export interface TimelineEntityStateItem {
  character_id: string;
  name: string;
  tick: number;
  outfit: string;
  injuries: string[];
  location_id: string;
  items_held: string[];
}

export interface TimelineStateQueryResponse {
  ok: true;
  trace_id: string;
  tick: number;
  states: TimelineEntityStateItem[];
}

export interface GraphTraversalRequest {
  book_id?: string;
  seed_entity: string;
  max_hops?: number;
  tick?: number;
  max_narrative_seq?: number;
}

export interface GraphTraversalNode {
  entity_id: string;
  canonical_name: string;
  entity_type: string;
  distance_hops: number;
}

export interface GraphTraversalEdge {
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
}

export interface GraphTraversalResponse {
  ok: true;
  trace_id: string;
  seed_entity: string;
  max_hops: number;
  nodes: GraphTraversalNode[];
  edges: GraphTraversalEdge[];
}

export interface SqlConsoleRequest {
  book_id?: string;
  sql: string;
}

export interface SqlConsoleResponse {
  ok: true;
  trace_id: string;
  columns: string[];
  rows: any[][];
  row_count: number;
  execution_time_ms: number;
  read_only_enforced: true;
  error?: string | null;
}

export interface DatabaseFootprintResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  db_size_kb: number;
  budget_kb: number;
  percent_used: number;
  total_chunks: number;
  within_budget: boolean;
}

export interface TursoSyncRequest {
  book_id?: string;
  target_url?: string | null;
}

export interface TursoSyncResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  synced: boolean;
  cloud_url: string;
  sync_latency_ms: number;
}

export interface PackageRAGRequest {
  book_id?: string;
  force_rebuild?: boolean;
}

export interface PackageRAGResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  db_size_kb: number;
  budget_kb: number;
  percent_used: number;
  total_chunks: number;
  within_budget: boolean;
  r2_key: string;
  duration_sec: number;
}

// ============================================================================
// Sprint 5: E2E Pipeline Stepper & QA Scorecard Contracts
// ============================================================================

export type EdgeCaseStatus = "PASS" | "WARN" | "FAIL";

export interface EdgeCaseCheckResult {
  id: string;
  name: string;
  stage: string;
  status: EdgeCaseStatus;
  score: string;
  description: string;
  evidence: string;
  latency_ms: number;
}

export type ScorecardOverallStatus = "PASSED" | "WARNING" | "FAILED";

export interface ScorecardResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  total_checks: number;
  passed_checks: number;
  warn_checks: number;
  failed_checks: number;
  overall_score_percent: number;
  overall_status: ScorecardOverallStatus;
  checks: EdgeCaseCheckResult[];
  evaluated_at_utc: string;
}

export type PipelineStageExecutionStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface PipelineStageStatus {
  stage_num: number;
  stage_name: string;
  status: PipelineStageExecutionStatus;
  message: string;
  duration_ms: number;
  output_summary: Record<string, any>;
}

export interface E2EPipelineRunRequest {
  book_id?: string;
  force_reparse?: boolean;
  force_reextract?: boolean;
  force_recompile?: boolean;
  force_repackage?: boolean;
}

export interface E2EPipelineRunResponse {
  ok: true;
  trace_id: string;
  book_id: string;
  total_duration_sec: number;
  stages: PipelineStageStatus[];
  scorecard: ScorecardResponse;
}

export type ApiResult<T extends { ok: true }> = T | ApiErrorEnvelope;

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== false || typeof record.error !== "object" || record.error === null) {
    return false;
  }
  const errorBody = record.error as Record<string, unknown>;
  return (
    typeof errorBody.code === "string" &&
    typeof errorBody.stage === "string" &&
    typeof errorBody.message === "string" &&
    typeof errorBody.trace_id === "string"
  );
}

// ---------------------------------------------------------------------------
// Layer E: High-Density Visual Storyboard Contracts (80-100 Frames / Chapter)
// ---------------------------------------------------------------------------

export type ShotType =
  | "EXTREME_WIDE_ESTABLISHING"
  | "WIDE_ESTABLISHING"
  | "MEDIUM_TWO_SHOT"
  | "MEDIUM_SINGLE"
  | "OVER_THE_SHOULDER"
  | "CLOSE_UP_EMOTIONAL"
  | "EXTREME_CLOSE_UP"
  | "INSERT_PROP_DETAIL"
  | "LOW_ANGLE_HEROIC"
  | "HIGH_ANGLE_VULNERABLE"
  | "POINT_OF_VIEW";

export type CameraLens =
  | "24mm anamorphic wide-angle lens"
  | "28mm dynamic wide lens"
  | "35mm prime cinematic lens"
  | "50mm prime portrait lens"
  | "85mm prime telephoto lens";

export interface CharacterFrameState {
  handle: string;
  pose_and_blocking: string;
  facial_expression: string;
  gaze_direction: string;
  wardrobe_state: string;
  held_props: string[];
}

export interface SubSceneFrame {
  frame_index: number;
  scene_id: string;
  sentence_span: string;
  char_start: number;
  char_end: number;
  shot_type: ShotType;
  lens: CameraLens;
  lighting_and_atmosphere: string;
  active_characters: CharacterFrameState[];
  spatial_environment_focus: string;
  compiled_image_prompt: string;
  audio_start_sec?: number | null;
  audio_end_sec?: number | null;
  audio_duration_sec?: number | null;
  image_asset_url?: string | null;
}

export interface MacroScene {
  scene_id: string;
  scene_order: number;
  scene_heading: string;
  location_handle: string;
  time_of_day: string;
  summary: string;
  sub_scenes: SubSceneFrame[];
}

export interface HighDensityChapterStoryboard {
  schema_version: string;
  book_id: string;
  chapter_index: number;
  chapter_title: string;
  total_words: number;
  total_frames: number;
  audio_track_url?: string | null;
  scenes: MacroScene[];
}

export interface DecomposeChapterRequest {
  book_id: string;
  chapter_index?: number;
  chapter_title?: string;
  raw_text: string;
  target_frames?: number;
  global_style?: string;
  engine?: "deterministic" | "multi_ai_brain" | "qwen_swarm";
}

export interface FlowDispatchBatchRequest {
  book_id: string;
  chapter_index: number;
  chapter_title?: string;
  frames: Partial<SubSceneFrame>[];
  aspect_ratio?: string;
  model_engine?: string;
}

export interface AudioSynthesisRequest {
  book_id: string;
  chapter_index: number;
  chapter_title?: string;
  raw_text: string;
  narrator_voice?: string;
  voice_mode?: "SINGLE_NARRATOR" | "SMART_MULTI_SPEAKER";
}

export interface FormatScreenplayRequest {
  book_id: string;
  chapter_index?: number;
  chapter_title?: string;
  raw_text: string;
  narrator_voice?: string;
  voice_mode?: "SINGLE_NARRATOR" | "SMART_MULTI_SPEAKER";
  enable_emotion_tags?: boolean;
}

export interface FormatScreenplayResponse {
  ok: boolean;
  formatted_screenplay: string;
  word_count: number;
  estimated_duration_seconds: number;
  model_recommended: string;
  notice: string;
}

export interface AudioUploadPayload {
  book_id: string;
  chapter_index?: number;
  filename?: string;
  audio_base64: string;
  duration_seconds?: number;
}
