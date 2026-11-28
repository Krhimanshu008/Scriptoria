import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { isLlmWorkerProfile, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import {
  parseBootMetadata,
  type GpuHardwareTelemetry,
  type LlmEndpointTelemetry,
} from "@/lib/orchestrator/vm-helpers";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allVms = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
      orderBy: { target: "asc" },
    });

    // Exclude TPU targets and select GPU/LLM VMs only
    const llmVms = allVms.filter(
      (v) =>
        !v.target.startsWith("tpu") &&
        v.workerProfile !== "TPU_QWEN27B_V5E" &&
        (isLlmWorkerProfile(v.workerProfile) ||
          parseBootMetadata(v.bootMetadataJson)?.topologyMode === "copilot_split")
    );

    const onlineRows = llmVms.filter((v) => v.status === "ONLINE");
    // Group ONLINE rows by sessionGroup so 1 Kaggle Dual-T4 VM (gpu0+gpu1 or gpu2+gpu3) appears once
    const groupMap = new Map<string, typeof llmVms>();
    for (const row of onlineRows) {
      const grp = row.sessionGroup || row.target;
      const arr = groupMap.get(grp) || [];
      arr.push(row);
      groupMap.set(grp, arr);
    }

    const startingLlm = llmVms.find((v) => v.status === "STARTING");
    const offlinePreferredVm =
      llmVms.find((v) => v.workerProfile === "LLM_QWEN_VLM") || llmVms[0] || null;

    const probedVms = await Promise.all(
      Array.from(groupMap.values()).map(async (groupRows) => {
        const vm = groupRows.find((r) => Boolean(r.bootMetadataJson)) || groupRows[0];
        const meta = parseBootMetadata(vm.bootMetadataJson);
        const profileSpec = getWorkerProfile(vm.workerProfile);
        const headless = !vm.publicUrl;

        let reachable = false;
        let loadedModel: string | null = null;
        let probeLatencyMs: number | null = null;
        let probeError: string | null = null;
        const runtimeMode =
          meta?.runtimeMode ||
          ((meta?.llmEndpoints?.length || 0) > 0 ? "llm_ready" : "idle_empty");
        const activeModelName =
          meta?.activeModelName ?? meta?.llmEndpoints?.[0]?.model ?? null;

        if (headless) {
          const hbAgeMs = vm.lastHeartbeat ? Date.now() - vm.lastHeartbeat.getTime() : 999_999;
          reachable = hbAgeMs < 240_000;
          probeLatencyMs = reachable ? 15 : null;
          loadedModel =
            meta?.llmEndpoints?.[0]?.model ||
            (runtimeMode === "llm_ready"
              ? activeModelName || profileSpec?.label || vm.workerProfile
              : null);
          if (!reachable) probeError = "Heartbeat stale";
        } else {
          const base = vm.publicUrl!.replace(/\/$/, "");
          const headers: Record<string, string> = {};
          if (vm.vmSecret) {
            headers["Authorization"] = `Bearer ${vm.vmSecret}`;
            headers["X-VM-Secret"] = vm.vmSecret;
          }

          const t0 = Date.now();
          try {
            const modelsRes = await fetch(`${base}/v1/models`, {
              headers,
              signal: AbortSignal.timeout(4000),
            });
            probeLatencyMs = Date.now() - t0;

            if (modelsRes.ok) {
              reachable = true;
              const mJson = (await modelsRes.json()) as { data?: Array<{ id?: string }> };
              loadedModel = mJson.data?.[0]?.id || null;
            } else {
              probeError = `HTTP ${modelsRes.status}`;
            }
          } catch (err) {
            probeLatencyMs = Date.now() - t0;
            probeError = err instanceof Error ? err.message : "Unreachable";
          }
        }

        const displayName =
          runtimeMode === "idle_empty" && !loadedModel && !meta?.llmEndpoints?.length
            ? null
            : loadedModel || activeModelName || profileSpec?.label || vm.workerProfile;

        const peerVramTotal = groupRows.reduce((s, r) => s + (r.vramTotalGb || 15), 0);
        const peerVramUsed = groupRows.reduce((s, r) => s + (r.vramUsedGb || 0), 0);
        const gpusFromMeta = meta?.gpus && meta.gpus.length > 0 ? meta.gpus : null;
        const vramTotalGb = gpusFromMeta
          ? Number(gpusFromMeta.reduce((s, g) => s + (g.vramTotalGb || 0), 0).toFixed(2))
          : Number((peerVramTotal || vm.vramTotalGb || 30).toFixed(2));
        const vramUsedGb = gpusFromMeta
          ? Number(gpusFromMeta.reduce((s, g) => s + (g.vramUsedGb || 0), 0).toFixed(2))
          : Number(peerVramUsed.toFixed(2));

        return {
          row: vm,
          peerRows: groupRows,
          meta,
          dto: {
            target: vm.target,
            peerTargets: groupRows.map((r) => r.target),
            sessionGroup: vm.sessionGroup,
            accountAlias: vm.accountAlias,
            workerProfile: vm.workerProfile,
            profileLabel: profileSpec?.label || vm.workerProfile,
            loadedModel: displayName,
            runtimeMode,
            activeModelName: activeModelName || displayName,
            publicUrl: vm.publicUrl || null,
            headless,
            llmTopologyMode: meta?.llmTopologyMode || null,
            requestedLlmTopology: meta?.requestedLlmTopology || null,
            llmEndpoints: (meta?.llmEndpoints || []) as LlmEndpointTelemetry[],
            gpuName: vm.gpuName || "Tesla T4 x2",
            vramTotalGb,
            vramUsedGb,
            reachable,
            probeLatencyMs,
            probeError,
          },
        };
      })
    );

    const primaryEntry =
      probedVms.find((v) => v.dto.reachable) || probedVms[0] || null;
    const primaryVm = primaryEntry?.dto || null;
    const primaryRow = primaryEntry?.row || startingLlm || offlinePreferredVm;
    const primaryMeta = primaryEntry?.meta || parseBootMetadata(primaryRow?.bootMetadataJson);

    const gpus: GpuHardwareTelemetry[] = (() => {
      if (primaryEntry && primaryMeta?.gpus && primaryMeta.gpus.length > 0) {
        return primaryMeta.gpus;
      }
      if (primaryEntry) {
        const isTensorSplit =
          primaryVm?.llmTopologyMode === "llm_layer_split" ||
          primaryMeta?.requestedLlmTopology === "llm_layer_split";
        return primaryEntry.peerRows.map((r, idx) => {
          const tot = Number((r.vramTotalGb || 15).toFixed(2));
          const used = Number((r.vramUsedGb || 0).toFixed(2));
          return {
            index: idx,
            name: r.gpuName || `Tesla T4 GPU ${idx}`,
            role: isTensorSplit
              ? idx === 0
                ? "TP 50% + mmproj"
                : "TP 50% + KV"
              : idx === 0
              ? "53% + mmproj"
              : "47% + KV Cache",
            vramTotalGb: tot,
            vramUsedGb: used,
            vramFreeGb: Number(Math.max(0, tot - used).toFixed(2)),
            tempC: null,
            utilPct: null,
            powerW: null,
            powerLimitW: 70,
          };
        });
      }
      return [];
    })();

    const attachedDatasets: string[] = (() => {
      try {
        const parsed = primaryRow?.kaggleDatasetsJson
          ? JSON.parse(primaryRow.kaggleDatasetsJson)
          : [];
        return Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          : [];
      } catch {
        return [];
      }
    })();
    const qwenDatasetSlug =
      attachedDatasets.find((d) => /qwen|llm|gguf/i.test(d)) || null;
    const wrongDatasetSlug =
      !qwenDatasetSlug && attachedDatasets.length > 0 ? attachedDatasets[0] : null;

    const vaultFallbacks = await resolveCandidateLlmConfigs(user.userId);
    const runtimeMode = primaryVm?.runtimeMode || (startingLlm ? "starting" : "offline");
    const isNativeSm75 = Boolean(primaryMeta?.binaryInfo?.isNativeSm75);
    const sm75BuildRunning = Boolean(primaryMeta?.binaryInfo?.sm75BuildRunning);

    const ancillary = {
      engine: {
        status: !primaryVm
          ? ("offline" as const)
          : primaryMeta?.binaryInfo?.isV2Ready
          ? ("ready" as const)
          : primaryMeta?.binaryInfo?.hasDraftMtp
          ? ("partial" as const)
          : ("outdated" as const),
        label: primaryMeta?.binaryInfo?.isV2Ready
          ? isNativeSm75
            ? "llama-server sm_75 Native · MTP"
            : "llama-server CUDA 12 v2 · MTP"
          : primaryMeta?.binaryInfo?.hasDraftMtp
          ? "CUDA 12 · MTP (No /metrics)"
          : primaryVm
          ? "Legacy Binary (No MTP)"
          : "Offline",
        version: primaryMeta?.binaryInfo?.version ?? null,
        hasDraftMtp: Boolean(primaryMeta?.binaryInfo?.hasDraftMtp),
        hasMetrics: Boolean(primaryMeta?.binaryInfo?.hasMetrics),
        isNativeSm75,
        sm75BuildRunning,
      },
      weights: {
        status: !primaryVm
          ? ("offline" as const)
          : runtimeMode === "llm_ready"
          ? ("loaded" as const)
          : primaryMeta?.activeTransfer?.category === "llm"
          ? ("staging" as const)
          : primaryMeta?.ancillary?.weightsPresent
          ? ("cached" as const)
          : ("missing" as const),
        file: primaryMeta?.ancillary?.weightsFile ?? "Qwen3.8-27B-UD-Q4_K_M.gguf",
        sizeGb: primaryMeta?.ancillary?.weightsGb ?? 16.56,
        source: primaryMeta?.ancillary?.weightsSource ?? ("missing" as const),
      },
      vision: {
        status: !primaryVm
          ? ("offline" as const)
          : primaryMeta?.ancillary?.mmprojLoaded
          ? ("loaded" as const)
          : primaryMeta?.ancillary?.mmprojPresent
          ? ("cached" as const)
          : ("missing" as const),
        file: primaryMeta?.ancillary?.mmprojFile ?? "mmproj-F16.gguf",
        loaded: Boolean(primaryMeta?.ancillary?.mmprojLoaded),
        bypassedOnLastTurn: primaryMeta?.lastTurnTelemetry?.visionBypassed ?? true,
        lastEncodeMs: primaryMeta?.lastTurnTelemetry?.visionEncodeMs ?? null,
      },
      dataset: {
        status: qwenDatasetSlug
          ? ("attached" as const)
          : wrongDatasetSlug
          ? ("wrong_dataset" as const)
          : ("on_demand" as const),
        slug: qwenDatasetSlug,
        wrongSlug: wrongDatasetSlug,
        attachedSlugs: attachedDatasets,
      },
      storage: {
        freeGb: primaryMeta?.disk?.freeGb ?? null,
        usedGb: primaryMeta?.disk?.usedGb ?? null,
        totalGb: primaryMeta?.disk?.totalGb ?? null,
        status:
          primaryMeta?.disk?.freeGb == null
            ? ("unknown" as const)
            : primaryMeta.disk.freeGb < 5
            ? ("critical" as const)
            : !qwenDatasetSlug && primaryMeta.disk.freeGb < 18.5
            ? ("warn" as const)
            : ("healthy" as const),
      },
      syncFailover: {
        driveHealthy: Boolean(primaryMeta?.driveHealthy) && !primaryMeta?.driveNeedsReconnect,
        driveNeedsReconnect: Boolean(primaryMeta?.driveNeedsReconnect),
        vaultFallbackCount: vaultFallbacks.length,
        vaultProviders: vaultFallbacks.map(
          (c) => `${c.provider.toUpperCase()} (${c.model})`
        ),
      },
    };

    const watchdog = (() => {
      const wd = primaryMeta?.watchdog;
      if (!primaryVm || !wd) return null;
      const hbAgeSec = primaryEntry?.row.lastHeartbeat
        ? Math.max(0, Math.floor((Date.now() - primaryEntry.row.lastHeartbeat.getTime()) / 1000))
        : 0;
      return {
        idleRemainingSec:
          typeof wd.idleRemainingSec === "number"
            ? Math.max(0, wd.idleRemainingSec - hbAgeSec)
            : null,
        idleTimeoutSec: wd.idleTimeoutSec,
        lastActiveEpoch: wd.lastActiveEpoch,
      };
    })();

    const uptimeSeconds =
      primaryEntry?.row.onlineSince && primaryVm
        ? Math.max(0, Math.floor((Date.now() - primaryEntry.row.onlineSince.getTime()) / 1000))
        : 0;

    return NextResponse.json({
      vmStatus: primaryVm ? "ONLINE" : startingLlm?.status || offlinePreferredVm?.status || "OFFLINE",
      target: primaryVm?.target || startingLlm?.target || offlinePreferredVm?.target || null,
      peerTargets: primaryVm?.peerTargets || (primaryVm?.target ? [primaryVm.target] : []),
      accountAlias: primaryVm?.accountAlias || startingLlm?.accountAlias || offlinePreferredVm?.accountAlias || "acc1",
      endpointPreview: primaryVm?.publicUrl
        ? `${primaryVm.publicUrl.replace(/\/$/, "")}/v1`
        : primaryVm?.headless
        ? "Safe Headless Outbound Relay"
        : null,
      reachable: Boolean(primaryVm?.reachable),
      loadedModel: primaryVm?.loadedModel || null,
      runtimeMode: primaryVm?.runtimeMode || (startingLlm ? "starting" : "offline"),
      activeModelName: primaryVm?.activeModelName || null,
      bootStep: primaryEntry?.row.stepProgress ?? startingLlm?.stepProgress ?? 0,
      uptimeSeconds,
      probeLatencyMs: primaryVm?.probeLatencyMs || null,
      probeError: primaryVm?.probeError || null,
      gpuName: primaryVm?.gpuName || offlinePreferredVm?.gpuName || null,
      vramTotalGb: primaryVm?.vramTotalGb || 30,
      vramUsedGb: primaryVm?.vramUsedGb || 0,
      vaultFallbackCount: vaultFallbacks.length,
      vaultProviders: vaultFallbacks.map((c) => ({
        provider: c.provider,
        model: c.model,
        label: `${c.provider.toUpperCase()} (${c.model})`,
      })),
      onlineVms: probedVms.map((p) => p.dto),
      gpus,
      slot: primaryMeta?.slotTelemetry ?? null,
      mtp: primaryMeta?.mtpTelemetry ?? null,
      lastTurn: primaryMeta?.lastTurnTelemetry ?? null,
      watchdog,
      ancillary,
      activeTransfer: primaryMeta?.activeTransfer ?? null,
      recentLogs: primaryMeta?.recentLogs ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect LLM Studio health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
