import type {
  DispatchLlmResult,
  LlmChatMode,
  LlmReasoningEffort,
  LlmTargetService,
} from "@/lib/llm/dispatch-llm";
import type {
  BootMetadata,
  GpuHardwareTelemetry,
  LlmEndpointTelemetry,
  LlmLastTurnTelemetry,
  LlmMtpTelemetry,
  LlmSlotTelemetry,
  LlmTopologyMode,
  LlmWatchdogTelemetry,
} from "@/lib/orchestrator/vm-helpers";
import type { LlmWorkflowStep } from "@/app/api/llm-studio/workflows/route";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";

export interface LlmAncillaryReadiness {
  engine: {
    status: "ready" | "partial" | "outdated" | "offline";
    label: string;
    version: string | null;
    hasDraftMtp: boolean;
    hasMetrics: boolean;
    isNativeSm75?: boolean;
    sm75BuildRunning?: boolean;
  };
  weights: {
    status: "loaded" | "cached" | "staging" | "missing" | "offline";
    file: string;
    sizeGb: number;
    source: "dataset" | "tmp" | "missing";
  };
  vision: {
    status: "loaded" | "cached" | "missing" | "offline";
    file: string;
    loaded: boolean;
    bypassedOnLastTurn: boolean;
    lastEncodeMs: number | null;
  };
  dataset: {
    status: "attached" | "wrong_dataset" | "on_demand";
    slug: string | null;
    wrongSlug?: string | null;
    attachedSlugs: string[];
  };
  storage: {
    freeGb: number | null;
    usedGb: number | null;
    totalGb: number | null;
    status: "healthy" | "warn" | "critical" | "unknown";
  };
  syncFailover: {
    driveHealthy: boolean;
    driveNeedsReconnect: boolean;
    vaultFallbackCount: number;
    vaultProviders: string[];
  };
}

export interface HealthOnlineVm {
  target: string;
  peerTargets?: string[];
  sessionGroup?: string;
  accountAlias: string;
  workerProfile: string;
  profileLabel: string;
  loadedModel: string | null;
  runtimeMode?: string | null;
  activeModelName?: string | null;
  publicUrl: string | null;
  headless: boolean;
  llmTopologyMode: LlmTopologyMode | string | null;
  requestedLlmTopology: LlmTopologyMode | string | null;
  llmEndpoints: LlmEndpointTelemetry[];
  gpuName: string;
  vramTotalGb: number;
  vramUsedGb: number;
  reachable: boolean;
  probeLatencyMs: number | null;
  probeError: string | null;
}

export interface LlmHealthResponse {
  vmStatus: string;
  target: string | null;
  peerTargets?: string[];
  accountAlias: string;
  endpointPreview: string | null;
  reachable: boolean;
  loadedModel: string | null;
  runtimeMode?: string | null;
  activeModelName?: string | null;
  bootStep?: number;
  uptimeSeconds?: number;
  probeLatencyMs: number | null;
  probeError: string | null;
  gpuName: string | null;
  vramTotalGb: number;
  vramUsedGb: number;
  vaultFallbackCount: number;
  vaultProviders: Array<{ provider: string; model: string; label: string }>;
  onlineVms: HealthOnlineVm[];
  gpus: GpuHardwareTelemetry[];
  slot: LlmSlotTelemetry | null;
  mtp: LlmMtpTelemetry | null;
  lastTurn: LlmLastTurnTelemetry | null;
  watchdog: LlmWatchdogTelemetry | null;
  ancillary: LlmAncillaryReadiness;
  activeTransfer: BootMetadata["activeTransfer"] | null;
  recentLogs: string[];
}

export type { DispatchLlmResult };

export interface LlmTargetOption {
  value: string; // e.g. "auto", "gpu0::default", "gpu0::replica0", "vault:gemini"
  label: string;
  targetVm: string;
  targetService: LlmTargetService;
  badge: string;
}

export interface LlmTopologyOption {
  mode: LlmTopologyMode;
  shortLabel: string;
  title: string;
  description: string;
}

export const LLM_TOPOLOGY_OPTIONS: LlmTopologyOption[] = [
  {
    mode: "llm_layer_split",
    shortLabel: "Layer Split · 32GB",
    title: "Pooled Dual-T4 Layer Split (GPU0+GPU1)",
    description: "Splits 1 heavy model (27B VLM or 35B MoE) ~50:50 across both T4 GPUs (32GB combined VRAM).",
  },
  {
    mode: "llm_dual_replica",
    shortLabel: "Dual Replica · 2x T4",
    title: "2x Parallel Independent Replicas (GPU0 :8190 + GPU1 :8191)",
    description: "Runs two identical 8B/9B workers independently for 2x batch eval & concurrent throughput.",
  },
  {
    mode: "llm_ab_arena",
    shortLabel: "A/B Arena · Model A vs B",
    title: "Side-by-Side Dual Model Arena (GPU0 Model A + GPU1 Model B)",
    description: "Hosts Qwen3.5-9B Reasoning on GPU0 and Qwen3-VL-8B Vision on GPU1 simultaneously.",
  },
  {
    mode: "llm_swarm_multi",
    shortLabel: "Swarm Multi · 4 Services",
    title: "4-Service Micro-Swarm (Reason + Extract + Vision + RAG)",
    description: "Splits 9B Reasoning (:8190), 4B Fast JSON (:8191), MiniCPM-V OCR (:8192) and Embeddings (:8193).",
  },
];

export interface LlmProfileLaunchOption {
  id: WorkerProfileId;
  label: string;
  hint: string;
}

export const LLM_LAUNCH_PROFILES: LlmProfileLaunchOption[] = [
  { id: "LLM_QWEN_FAST_8B", label: "Qwen3-VL 8B / Dual Replica", hint: "~5.1 GB · Best for Dual Replica 2x T4 & Vision QA" },
  { id: "LLM_QWEN_TEXT_TURBO", label: "Qwen3.5-9B Text Turbo", hint: "~6.2 GB · High-speed text + reasoning + A/B Arena" },
  { id: "LLM_QWEN_VLM", label: "Qwen3.8-27B VLM + MTP", hint: "~19 GB · Dual-T4 layer split with Native MTP + Vision" },
  { id: "LLM_QWEN_MOE_35B", label: "Qwen3.6-35B-A3B MoE", hint: "~22 GB · Sparse MoE fast decode across Dual-T4" },
  { id: "LLM_LIGHTWEIGHT_SWARM", label: "4-Service LLM Swarm", hint: "~11 GB · Parallel Reasoning + JSON Extract + OCR + RAG" },
];

export interface PlaygroundPreset {
  id: string;
  label: string;
  mode: LlmChatMode;
  reasoningEffort: LlmReasoningEffort;
  targetService: LlmTargetService;
  systemPrompt: string;
  jsonSchema: string;
  samplePrompt: string;
}

export const GENERAL_PLAYGROUND_PRESETS: PlaygroundPreset[] = [
  {
    id: "json-extractor",
    label: "JSON Schema Extractor",
    mode: "json",
    reasoningEffort: "none",
    targetService: "default",
    systemPrompt:
      "You are a deterministic structured data extraction engine. Extract only explicitly stated facts into strict JSON matching the requested schema.",
    jsonSchema: JSON.stringify(
      {
        type: "object",
        required: ["entities", "metrics", "action_items", "summary"],
        properties: {
          entities: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "object" } },
          action_items: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
      null,
      2
    ),
    samplePrompt:
      "Q3 Ops Report: Checkout API P99 latency dropped from 420ms to 165ms after migrating Redis to Cluster mode on Oct 14. Remaining blocker: Stripe webhook retries spiked 12% in us-east-1; Priya needs to patch idempotency keys before Friday.",
  },
  {
    id: "code-reviewer",
    label: "Code & Diff Reviewer",
    mode: "chat",
    reasoningEffort: "medium",
    targetService: "default",
    systemPrompt:
      "You are a staff systems engineer performing a strict code review. Report correctness bugs, race conditions, security flaws, and concrete fixes ordered by severity.",
    jsonSchema: "",
    samplePrompt:
      "Review this TypeScript snippet for concurrency or security bugs:\n\nexport async function transferCredits(fromId: string, toId: string, amount: number) {\n  const sender = await db.user.findUnique({ where: { id: fromId } });\n  if (!sender || sender.credits < amount) throw new Error('Insufficient funds');\n  await db.user.update({ where: { id: fromId }, data: { credits: sender.credits - amount } });\n  await db.user.update({ where: { id: toId }, data: { credits: { increment: amount } } });\n}",
  },
  {
    id: "vision-qa",
    label: "Vision OCR & UI/Diagram QA",
    mode: "vision_qa",
    reasoningEffort: "low",
    targetService: "default",
    systemPrompt:
      "You are a visual UI, document, and diagram inspector. Extract visible text verbatim, identify layout defects or errors, and summarize structured observations as JSON.",
    jsonSchema: JSON.stringify(
      {
        type: "object",
        required: ["detected_text", "key_elements", "issues_or_anomalies", "summary"],
      },
      null,
      2
    ),
    samplePrompt: "Inspect the attached image, transcribe key labels/text, and list any UI or data anomalies.",
  },
  {
    id: "prompt-stress",
    label: "Constraint & Instruction Stress",
    mode: "chat",
    reasoningEffort: "low",
    targetService: "default",
    systemPrompt:
      "Follow every formatting constraint literally. Never add preambles, markdown fences, or apologies.",
    jsonSchema: "",
    samplePrompt:
      "List exactly 5 distributed consensus algorithms. Format each line as `<Index>. <Algorithm> | <Key Tradeoff>` with zero extra lines before or after.",
  },
  {
    id: "tool-call-mock",
    label: "Tool / Function Call Tester",
    mode: "json",
    reasoningEffort: "none",
    targetService: "default",
    systemPrompt:
      "Select the right tool and output a valid JSON object containing `tool_name`, `arguments`, and `confidence` (0..1). Available tools: `query_metrics(service, window)`, `restart_worker(target, reason)`, `notify_oncall(severity, summary)`.",
    jsonSchema: JSON.stringify(
      {
        type: "object",
        required: ["tool_name", "arguments", "confidence"],
      },
      null,
      2
    ),
    samplePrompt:
      "Worker gpu0 has reported out-of-memory errors twice in the last 10 minutes during 4K upscaling. Choose the next operational tool call.",
  },
];

export interface StarterBatchSuite {
  id: string;
  label: string;
  mode: LlmChatMode;
  systemPrompt: string;
  jsonSchema: string;
  casesText: string; // JSONL lines { prompt, expectedContains?, requiredKeys? }
}

export const STARTER_BATCH_SUITES: StarterBatchSuite[] = [
  {
    id: "json-suite",
    label: "Structured JSON Extraction (5 cases)",
    mode: "json",
    systemPrompt: "Extract structured JSON with keys `sentiment`, `topic`, and `urgency` (`low` | `medium` | `high`).",
    jsonSchema: JSON.stringify({ required: ["sentiment", "topic", "urgency"] }, null, 2),
    casesText: [
      JSON.stringify({ prompt: "Production DB CPU hit 99% and customer checkouts are timing out!", expectedContains: "high", requiredKeys: ["sentiment", "topic", "urgency"] }),
      JSON.stringify({ prompt: "Love the new dark mode layout — charts load twice as fast now.", expectedContains: "positive", requiredKeys: ["sentiment", "topic", "urgency"] }),
      JSON.stringify({ prompt: "Can we update the footer copyright year from 2025 to 2026 next sprint?", expectedContains: "low", requiredKeys: ["sentiment", "topic", "urgency"] }),
      JSON.stringify({ prompt: "Export CSV throws a 500 error whenever rows contain Japanese characters.", requiredKeys: ["sentiment", "topic", "urgency"] }),
      JSON.stringify({ prompt: "Invoice #4821 double-charged our enterprise account twice today.", expectedContains: "high", requiredKeys: ["sentiment", "topic", "urgency"] }),
    ].join("\n"),
  },
  {
    id: "reasoning-math",
    label: "Logic & Exact Keyword Check (4 cases)",
    mode: "chat",
    systemPrompt: "Solve concisely and state the final numeric or exact answer clearly.",
    jsonSchema: "",
    casesText: [
      JSON.stringify({ prompt: "If 3 workers process 18 jobs in 6 minutes, how many jobs do 5 workers process in 12 minutes at the same rate?", expectedContains: "60" }),
      JSON.stringify({ prompt: "In HTTP status codes, what code indicates Rate Limited (Too Many Requests)?", expectedContains: "429" }),
      JSON.stringify({ prompt: "Convert 16 GiB into MiB cleanly.", expectedContains: "16384" }),
      JSON.stringify({ prompt: "Which SQL clause filters grouped aggregate rows: WHERE or HAVING?", expectedContains: "HAVING" }),
    ].join("\n"),
  },
];

export interface AttachedImageWithEstimate {
  dataUrl: string;
  width: number;
  height: number;
  estimatedVisionTokens: number;
}

/**
 * Estimates Qwen VLM visual tokens matching llama-server's
 * --image-min-tokens 256 --image-max-tokens 1024.
 */
export function estimateQwenVisionTokens(width: number, height: number): number {
  const raw = Math.ceil(Math.max(1, width) / 28) * Math.ceil(Math.max(1, height) / 28);
  return Math.min(1024, Math.max(256, raw));
}

export function buildTargetOptions(health?: LlmHealthResponse): LlmTargetOption[] {
  const opts: LlmTargetOption[] = [
    {
      value: "auto::default",
      label: "Auto Route (2× T4 Qwen3.8-27B -> Vault Fallback)",
      targetVm: "auto",
      targetService: "default",
      badge: "AUTO",
    },
  ];

  const seen = new Set<string>(["auto::default"]);

  for (const vm of health?.onlineVms || []) {
    const defVal = `${vm.target}::default`;
    if (!seen.has(defVal)) {
      seen.add(defVal);
      opts.push({
        value: defVal,
        label: `2× T4 Local (${vm.accountAlias.toUpperCase()} · ${vm.loadedModel || "Qwen3.8-27B VLM"}${vm.headless ? " Relay" : ""})`,
        targetVm: vm.target,
        targetService: "default",
        badge: vm.reachable ? "2×T4" : "STALE",
      });
    }
  }

  for (const vp of health?.vaultProviders || []) {
    const vKey = `vault:${vp.provider}::default`;
    if (!seen.has(vKey)) {
      seen.add(vKey);
      opts.push({
        value: vKey,
        label: `Vault Cloud · ${vp.label}`,
        targetVm: `vault:${vp.provider}`,
        targetService: "default",
        badge: "CLOUD",
      });
    }
  }

  return opts;
}

export function parseTargetOption(combined: string): { targetVm: string; targetService: LlmTargetService } {
  const [vm, svc] = combined.split("::");
  return {
    targetVm: vm || "auto",
    targetService: (svc as LlmTargetService) || "default",
  };
}

export async function downscaleImageWithMetrics(
  file: File,
  maxDim = 1024
): Promise<AttachedImageWithEstimate> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", 0.86),
          width,
          height,
          estimatedVisionTokens: estimateQwenVisionTokens(width, height),
        });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function downscaleImageToDataUrl(file: File, maxDim = 1024): Promise<string> {
  const res = await downscaleImageWithMetrics(file, maxDim);
  return res.dataUrl;
}

export interface WorkflowRecordItem {
  id: string;
  slug: string;
  name: string;
  categoryTag: string;
  description: string;
  isSeeded: boolean;
  steps: LlmWorkflowStep[];
  updatedAt: string;
}
