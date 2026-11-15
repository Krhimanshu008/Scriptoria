export const EXPECTED_CONTRACT_HASH =
  "08e0a0b8a38adab857ec8d2c933dfd88fbbed1e0036ff675f0a18b165f036292" as const;

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
