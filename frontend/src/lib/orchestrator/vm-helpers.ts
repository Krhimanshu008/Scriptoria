import { VmInstance } from "@prisma/client";

export interface PrewarmModelRef {
  slug?: string;
  category: string;
  filename: string;
}

export type DualT4TopologyMode =
  | "dual_parallel"
  | "dual_pipeline"
  | "dual_split"
  | "copilot_split"
  | "single";

export type LlmTopologyMode =
  | "llm_layer_split"
  | "llm_dual_replica"
  | "llm_ab_arena"
  | "llm_swarm_multi";

export interface LlmEndpointTelemetry {
  port: number;
  gpu: string;
  model: string;
  service: string;
  ready?: boolean;
}

export interface BootMetadata {
  modelFetch?: boolean;
  draftMode?: boolean;
  draftArmedAt?: number;
  autoLoadOnBoot?: boolean;
  runtimeMode?: "idle_empty" | "loading_model" | "llm_ready" | "comfy_ready" | string;
  activeModelName?: string | null;
  activeModelRepo?: string | null;
  stepDurations?: Record<string, number>;
  currentStepElapsed?: number;
  totalBootElapsed?: number;
  topologyMode?: DualT4TopologyMode | string;
  requestedTopologyMode?: DualT4TopologyMode | string | null;
  llmTopologyMode?: LlmTopologyMode | string;
  requestedLlmTopology?: LlmTopologyMode | string | null;
  llmEndpoints?: LlmEndpointTelemetry[];
  hotModels?: Record<string, string[]>;
  disk?: { totalGb: number; usedGb: number; freeGb: number } | null;
  cachedModels?: Record<string, string[]>;
  storageFiles?: Array<{ category: string; name: string; sizeBytes: number }>;
  activeTransfer?: {
    filename: string;
    category?: string;
    percentage: number;
    speedMbps?: number;
    bytesDone?: number;
    totalBytes?: number;
    queueCount?: number;
    source?: string;
  } | null;
  recentLog?: string | null;
  driveNeedsReconnect?: boolean;
}

export function parseBootMetadata(jsonStr: string | null | undefined): BootMetadata | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === "object" ? (parsed as BootMetadata) : null;
  } catch {
    return null;
  }
}

export function mergeBootMetadata(
  existingJson: string | null | undefined,
  rawTelem: Record<string, unknown>
): BootMetadata | null {
  const prev = parseBootMetadata(existingJson) || {};
  const reportedTopo =
    typeof rawTelem.topologyMode === "string" ? rawTelem.topologyMode : undefined;
  const reqTopo =
    prev.requestedTopologyMode && reportedTopo && prev.requestedTopologyMode === reportedTopo
      ? null
      : prev.requestedTopologyMode ?? undefined;
  const reportedLlmTopo =
    typeof rawTelem.llmTopologyMode === "string" ? rawTelem.llmTopologyMode : undefined;
  const reqLlmTopo =
    prev.requestedLlmTopology &&
    reportedLlmTopo &&
    prev.requestedLlmTopology === reportedLlmTopo
      ? null
      : prev.requestedLlmTopology ?? undefined;

  const hasAny =
    Boolean(rawTelem.stepDurations || rawTelem.currentStepElapsed || rawTelem.totalBootElapsed) ||
    Boolean(
      reportedTopo ||
        reportedLlmTopo ||
        rawTelem.llmEndpoints ||
        rawTelem.cachedModels ||
        rawTelem.storageFiles ||
        rawTelem.disk ||
        rawTelem.hotModels ||
        rawTelem.activeTransfer !== undefined ||
        rawTelem.recentLog !== undefined ||
        rawTelem.driveNeedsReconnect !== undefined
    ) ||
    Boolean(Object.keys(prev).length > 0);

  if (!hasAny) return null;

  return {
    ...prev,
    modelFetch:
      rawTelem.modelFetch !== undefined ? rawTelem.modelFetch === true : prev.modelFetch,
    draftMode: prev.draftMode,
    draftArmedAt: prev.draftArmedAt,
    autoLoadOnBoot:
      rawTelem.autoLoadOnBoot !== undefined ? rawTelem.autoLoadOnBoot === true : prev.autoLoadOnBoot,
    runtimeMode:
      typeof rawTelem.runtimeMode === "string" ? rawTelem.runtimeMode : prev.runtimeMode,
    activeModelName:
      rawTelem.activeModelName !== undefined
        ? (typeof rawTelem.activeModelName === "string" ? rawTelem.activeModelName : null)
        : prev.activeModelName,
    activeModelRepo:
      rawTelem.activeModelRepo !== undefined
        ? (typeof rawTelem.activeModelRepo === "string" ? rawTelem.activeModelRepo : null)
        : prev.activeModelRepo,
    stepDurations:
      (rawTelem.stepDurations as Record<string, number> | undefined) ?? prev.stepDurations,
    currentStepElapsed:
      typeof rawTelem.currentStepElapsed === "number"
        ? rawTelem.currentStepElapsed
        : prev.currentStepElapsed,
    totalBootElapsed:
      typeof rawTelem.totalBootElapsed === "number"
        ? rawTelem.totalBootElapsed
        : prev.totalBootElapsed,
    topologyMode: reportedTopo ?? prev.topologyMode,
    requestedTopologyMode: reqTopo,
    llmTopologyMode: reportedLlmTopo ?? prev.llmTopologyMode,
    requestedLlmTopology: reqLlmTopo,
    llmEndpoints: Array.isArray(rawTelem.llmEndpoints)
      ? (rawTelem.llmEndpoints as LlmEndpointTelemetry[])
      : prev.llmEndpoints,
    hotModels:
      rawTelem.hotModels && typeof rawTelem.hotModels === "object"
        ? (rawTelem.hotModels as Record<string, string[]>)
        : prev.hotModels,
    disk:
      rawTelem.disk && typeof rawTelem.disk === "object"
        ? (rawTelem.disk as BootMetadata["disk"])
        : prev.disk,
    cachedModels:
      rawTelem.cachedModels && typeof rawTelem.cachedModels === "object"
        ? (rawTelem.cachedModels as Record<string, string[]>)
        : prev.cachedModels,
    storageFiles: Array.isArray(rawTelem.storageFiles)
      ? (rawTelem.storageFiles as BootMetadata["storageFiles"])
      : prev.storageFiles,
    activeTransfer:
      rawTelem.activeTransfer === null
        ? null
        : rawTelem.activeTransfer && typeof rawTelem.activeTransfer === "object"
        ? (rawTelem.activeTransfer as BootMetadata["activeTransfer"])
        : prev.activeTransfer,
    recentLog:
      rawTelem.recentLog === null
        ? null
        : typeof rawTelem.recentLog === "string"
        ? rawTelem.recentLog
        : prev.recentLog,
    driveNeedsReconnect:
      typeof rawTelem.driveNeedsReconnect === "boolean"
        ? rawTelem.driveNeedsReconnect
        : prev.driveNeedsReconnect,
  };
}

export function markBootMetadataOffline(
  existingJson: string | null | undefined
): string | null {
  const prev = parseBootMetadata(existingJson);
  if (!prev) return existingJson ?? null;
  return JSON.stringify({
    ...prev,
    runtimeMode: "offline",
    activeModelName: null,
    activeModelRepo: null,
    llmEndpoints: [],
    hotModels: undefined,
    activeTransfer: null,
    recentLog: null,
    driveNeedsReconnect: false,
  });
}

export interface PublicVmInstance {
  id: string;
  target: string;
  displayName: string;
  provider: string;
  accountAlias: string;
  sessionGroup: string;
  workerProfile: string;
  idleTimeoutMinutes: number | null;
  prewarmModels: PrewarmModelRef[];
  kaggleDatasets?: string[];
  bootMetadata?: BootMetadata | null;
  internalPort: number;
  publicUrl: string;
  useRouteLess: boolean;
  status: string;
  stepProgress: number;
  lastHeartbeat: string | null;
  onlineSince: string | null;
  latencyMs: number | null;
  vramTotalGb: number | null;
  vramUsedGb: number | null;
  gpuName: string | null;
  lastError: string | null;
  uptimeSeconds: number;
}

const TARGET_ORDER = [
  "gpu0", "gpu1", "gpu2", "gpu3", "gpu4", "gpu5", "gpu6", "gpu7",
  "gcgpu", "gcgpu1",
  "tpu0", "tpu1", "tpu2", "tpu3"
];

export function getKaggleKernelSlug(
  accountAlias: string,
  isTpu = false,
  customSlug?: string | null
): string {
  const cleanedCustom = (customSlug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (cleanedCustom.length >= 3) {
    if (isTpu && !cleanedCustom.endsWith("-tpu")) {
      return `${cleanedCustom}-tpu`;
    }
    return cleanedCustom;
  }
  void accountAlias;
  return isTpu ? "ml-tpu-inference-lab" : "ml-batch-inference-lab";
}

export function sortVmsByCanonicalTarget(vms: VmInstance[]): VmInstance[] {
  return [...vms].sort((a, b) => {
    const ia = TARGET_ORDER.indexOf(a.target);
    const ib = TARGET_ORDER.indexOf(b.target);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

export function sanitizeVmForClient(vm: VmInstance): PublicVmInstance {
  let uptimeSeconds = 0;
  if (vm.onlineSince && (vm.status === "ONLINE" || vm.status === "BUSY")) {
    uptimeSeconds = Math.max(0, Math.floor((Date.now() - vm.onlineSince.getTime()) / 1000));
  }

  let prewarmModels: PrewarmModelRef[] = [];
  if (vm.prewarmModelsJson) {
    try {
      const parsed = JSON.parse(vm.prewarmModelsJson);
      if (Array.isArray(parsed)) {
        prewarmModels = parsed.filter(
          (item): item is PrewarmModelRef =>
            Boolean(item && typeof item.category === "string" && typeof item.filename === "string")
        );
      }
    } catch {
      prewarmModels = [];
    }
  }

  let bootMetadata: BootMetadata | null = null;
  if (vm.bootMetadataJson) {
    try {
      bootMetadata = JSON.parse(vm.bootMetadataJson);
    } catch {
      bootMetadata = null;
    }
  }

  let kaggleDatasets: string[] = [];
  if (vm.kaggleDatasetsJson) {
    try {
      const parsed = JSON.parse(vm.kaggleDatasetsJson);
      if (Array.isArray(parsed)) {
        kaggleDatasets = parsed.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
      }
    } catch {
      kaggleDatasets = [];
    }
  }

  return {
    id: vm.id,
    target: vm.target,
    displayName: vm.displayName || vm.target.toUpperCase(),
    provider: vm.provider,
    accountAlias: vm.accountAlias,
    sessionGroup: vm.sessionGroup,
    workerProfile: vm.workerProfile || "BASE_COMFY",
    idleTimeoutMinutes: vm.idleTimeoutMinutes ?? null,
    prewarmModels,
    kaggleDatasets,
    bootMetadata,
    internalPort: vm.internalPort,
    publicUrl: vm.publicUrl,
    useRouteLess: vm.useRouteLess,
    status: vm.status,
    stepProgress: vm.stepProgress,
    lastHeartbeat: vm.lastHeartbeat ? vm.lastHeartbeat.toISOString() : null,
    onlineSince: vm.onlineSince ? vm.onlineSince.toISOString() : null,
    latencyMs: vm.latencyMs,
    vramTotalGb: vm.vramTotalGb,
    vramUsedGb: vm.vramUsedGb,
    gpuName: vm.gpuName,
    lastError: vm.lastError,
    uptimeSeconds,
  };
}

