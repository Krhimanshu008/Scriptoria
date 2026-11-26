import type { WorkflowPipelineKind, WorkflowBuildSpec } from "@/lib/workflow/compiler";

export const WORKFLOW_MANIFEST_VERSION = "1.0" as const;
export const MEDIA_JOB_CONTRACT_VERSION = "1.0" as const;

export type MediaModality = "IMAGE" | "AUDIO" | "VIDEO" | "MULTIMODAL";

export interface WorkflowInputFieldV1 {
  type: "string" | "number" | "integer" | "boolean" | "image_url" | "audio_url" | "video_url";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface WorkflowRequiredModelV1 {
  category: string;
  filename: string;
  slug?: string;
}

export interface WorkflowOutputSpecV1 {
  modality: MediaModality;
  expectedFormat?: string;
  driveSubfolderPattern?: string;
}

export interface WorkflowManifestV1 {
  version: typeof WORKFLOW_MANIFEST_VERSION;
  slug: string;
  name: string;
  modality: MediaModality;
  categoryTag: string;
  targetProfile: string;
  description: string;
  vramRequiredGb: number;
  requiredModels: Array<string | WorkflowRequiredModelV1>;
  requiredNodes: string[];
  inputSchema: Record<string, WorkflowInputFieldV1>;
  outputSpec: WorkflowOutputSpecV1;
  isSeeded?: boolean;
  apiGraphTemplate?: Record<string, unknown>;
}

export interface MediaJobRequestV1 {
  version?: typeof MEDIA_JOB_CONTRACT_VERSION;
  workflowSlug?: string;
  pipeline?: WorkflowPipelineKind;
  spec?: Partial<WorkflowBuildSpec>;
  target?: string; // "auto" | "gpu0" | "gpu1" | ...
  mode?: "realtime" | "queue";
  ensureModels?: boolean;
  inputs?: Record<string, unknown>;
  seed?: number;
  title?: string;
  sceneKey?: string;
}

export interface MediaArtifactV1 {
  modality: "IMAGE" | "AUDIO" | "VIDEO" | "BINARY";
  filename: string;
  gdriveFileId?: string;
  gdrivePath?: string;
  storageUri?: string;
  previewUrl?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface MediaJobResultV1 {
  version: typeof MEDIA_JOB_CONTRACT_VERSION;
  jobId: string;
  batchId?: string;
  taskId?: string;
  status: "QUEUED" | "TRANSFERRING_MODELS" | "PROCESSING" | "COMPLETED" | "FAILED";
  target?: string;
  workerProfile?: string;
  workflowSlug?: string;
  promptId?: string;
  executionTimeMs?: number;
  elapsedMs?: number;
  queueRunning?: number;
  queuePending?: number;
  artifacts: MediaArtifactV1[];
  error?: string;
  statusUrl: string;
  warnings?: string[];
  ensureResults?: unknown[];
}
