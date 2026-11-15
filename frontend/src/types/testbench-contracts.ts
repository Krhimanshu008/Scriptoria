export const EXPECTED_CONTRACT_HASH =
  "b9f84ad7eac059f176856cb7494625e513693aed0a26dbd224bc4e54ffb1881a" as const;

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
  latency_ms?: number | null;
  detail?: string | null;
  checked_at: string;
}

export interface SystemHealthResponse {
  ok: true;
  status: DependencyStatus;
  service: string;
  version: string;
  trace_id: string;
  uptime_seconds: number;
  timestamp: string;
  dependencies: Record<string, DependencyHealth>;
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
