import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { isLlmWorkerProfile, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { parseBootMetadata, type LlmEndpointTelemetry } from "@/lib/orchestrator/vm-helpers";

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

    const llmVms = allVms.filter(
      (v) =>
        isLlmWorkerProfile(v.workerProfile) ||
        parseBootMetadata(v.bootMetadataJson)?.topologyMode === "copilot_split"
    );
    const onlineLlmVms = llmVms.filter((v) => v.status === "ONLINE");
    const startingLlm = llmVms.find((v) => v.status === "STARTING");

    // Inspect online LLM VMs (supports both tunneled URLs and Safe Headless Kaggle mode)
    const probedVms = await Promise.all(
      onlineLlmVms.map(async (vm) => {
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
          reachable = hbAgeMs < 90_000;
          probeLatencyMs = reachable ? 15 : null;
          loadedModel =
            meta?.llmEndpoints?.[0]?.model ||
            (runtimeMode === "llm_ready" ? activeModelName || profileSpec?.label || vm.workerProfile : null);
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
            const [modelsRes, ckptRes] = await Promise.all([
              fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(4000) }),
              fetch(`${base}/object_info/CheckpointLoaderSimple`, {
                headers,
                signal: AbortSignal.timeout(4000),
              }).catch(() => null),
            ]);
            probeLatencyMs = Date.now() - t0;

            if (modelsRes.ok) {
              reachable = true;
              const mJson = (await modelsRes.json()) as { data?: Array<{ id?: string }> };
              loadedModel = mJson.data?.[0]?.id || null;
            } else {
              probeError = `HTTP ${modelsRes.status}`;
            }

            if (ckptRes?.ok) {
              const cJson = (await ckptRes.json()) as {
                CheckpointLoaderSimple?: {
                  input?: { required?: { ckpt_name?: string[][] } };
                };
              };
              const ckpt = cJson.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0];
              if (ckpt) loadedModel = ckpt;
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

        return {
          target: vm.target,
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
          gpuName: vm.target.startsWith("tpu")
            ? "TPU v5e-8 (8 chips · 128GB HBM)"
            : vm.gpuName || "Tesla T4 x2",
          vramTotalGb: vm.target.startsWith("tpu") ? 128 : vm.vramTotalGb || 16,
          vramUsedGb: vm.vramUsedGb || 0,
          reachable,
          probeLatencyMs,
          probeError,
        };
      })
    );

    const primaryVm = probedVms.find((v) => v.reachable) || probedVms[0] || null;
    const vaultFallbacks = await resolveCandidateLlmConfigs(user.userId);

    return NextResponse.json({
      vmStatus: primaryVm ? "ONLINE" : startingLlm?.status || llmVms[0]?.status || "OFFLINE",
      target: primaryVm?.target || startingLlm?.target || llmVms[0]?.target || null,
      accountAlias: primaryVm?.accountAlias || llmVms[0]?.accountAlias || "acc1",
      endpointPreview: primaryVm?.publicUrl
        ? `${primaryVm.publicUrl.replace(/\/$/, "")}/v1`
        : primaryVm?.headless
        ? "Safe Headless Outbound Relay"
        : null,
      reachable: Boolean(primaryVm?.reachable),
      loadedModel: primaryVm?.loadedModel || null,
      runtimeMode: primaryVm?.runtimeMode || null,
      activeModelName: primaryVm?.activeModelName || null,
      probeLatencyMs: primaryVm?.probeLatencyMs || null,
      probeError: primaryVm?.probeError || null,
      gpuName: primaryVm?.gpuName || llmVms[0]?.gpuName || null,
      vramTotalGb: primaryVm?.vramTotalGb || llmVms[0]?.vramTotalGb || 16,
      vramUsedGb: primaryVm?.vramUsedGb || 0,
      vaultFallbackCount: vaultFallbacks.length,
      vaultProviders: vaultFallbacks.map((c) => ({
        provider: c.provider,
        model: c.model,
        label: `${c.provider.toUpperCase()} (${c.model})`,
      })),
      onlineVms: probedVms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect LLM Studio health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
