import type {
  LlmChatMode,
  LlmReasoningEffort,
  LlmTargetService,
} from "@/lib/llm/dispatch-llm";
import type { LlmEndpointTelemetry, LlmTopologyMode } from "@/lib/orchestrator/vm-helpers";
import type { LlmWorkflowStep } from "@/app/api/llm-studio/workflows/route";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";

export interface HealthOnlineVm {
  target: string;
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
  accountAlias: string;
  endpointPreview: string | null;
  reachable: boolean;
  loadedModel: string | null;
  runtimeMode?: string | null;
  activeModelName?: string | null;
  probeLatencyMs: number | null;
  probeError: string | null;
  gpuName: string | null;
  vramTotalGb: number;
  vramUsedGb: number;
  vaultFallbackCount: number;
  vaultProviders: Array<{ provider: string; model: string; label: string }>;
  onlineVms: HealthOnlineVm[];
}

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
  { id: "LLM_QWEN_VLM", label: "Qwen3.8-27B VLM + Draft", hint: "~18 GB · Dual-T4 layer split flagship reasoning + Vision" },
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
    targetService: "extract",
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

export function buildTargetOptions(health?: LlmHealthResponse): LlmTargetOption[] {
  const opts: LlmTargetOption[] = [
    {
      value: "auto::default",
      label: "Auto Route (Active LLM VM -> Vault Fallback)",
      targetVm: "auto",
      targetService: "default",
      badge: "AUTO",
    },
  ];

  const seen = new Set<string>(["auto::default"]);

  for (const vm of health?.onlineVms || []) {
    const baseLabel = `${vm.target.toUpperCase()} · ${vm.loadedModel || vm.profileLabel}${vm.headless ? " (Relay)" : ""}`;
    const defVal = `${vm.target}::default`;
    if (!seen.has(defVal)) {
      seen.add(defVal);
      opts.push({
        value: defVal,
        label: baseLabel,
        targetVm: vm.target,
        targetService: "default",
        badge: vm.reachable ? "ONLINE" : "STALE",
      });
    }

    if (vm.llmTopologyMode === "llm_dual_replica") {
      opts.push(
        { value: `${vm.target}::replica0`, label: `${vm.target.toUpperCase()} GPU0 Replica (:8190)`, targetVm: vm.target, targetService: "replica0", badge: "T4-0" },
        { value: `${vm.target}::replica1`, label: `${vm.target.toUpperCase()} GPU1 Replica (:8191)`, targetVm: vm.target, targetService: "replica1", badge: "T4-1" }
      );
    } else if (vm.llmTopologyMode === "llm_ab_arena") {
      opts.push(
        { value: `${vm.target}::model_a`, label: `${vm.target.toUpperCase()} GPU0 Model A (Reasoning :8190)`, targetVm: vm.target, targetService: "model_a", badge: "MOD-A" },
        { value: `${vm.target}::model_b`, label: `${vm.target.toUpperCase()} GPU1 Model B (Vision :8191)`, targetVm: vm.target, targetService: "model_b", badge: "MOD-B" }
      );
    } else if (vm.llmTopologyMode === "llm_swarm_multi" || vm.workerProfile === "LLM_LIGHTWEIGHT_SWARM") {
      opts.push(
        { value: `${vm.target}::extract`, label: `${vm.target.toUpperCase()} Swarm · Extract (:8191)`, targetVm: vm.target, targetService: "extract", badge: "4B" },
        { value: `${vm.target}::qc`, label: `${vm.target.toUpperCase()} Swarm · Vision QC (:8192)`, targetVm: vm.target, targetService: "qc", badge: "VLM" },
        { value: `${vm.target}::rag`, label: `${vm.target.toUpperCase()} Swarm · RAG Embed (:8193)`, targetVm: vm.target, targetService: "rag", badge: "RAG" }
      );
    }
  }

  for (const vp of health?.vaultProviders || []) {
    const vKey = `vault:${vp.provider}::default`;
    if (!seen.has(vKey)) {
      seen.add(vKey);
      opts.push({
        value: vKey,
        label: `Vault API · ${vp.label}`,
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

export async function downscaleImageToDataUrl(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
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
