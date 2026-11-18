import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { isLlmWorkerProfile, getWorkerProfile } from "@/lib/catalog/worker-profiles";

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

    const llmVms = allVms.filter((v) => isLlmWorkerProfile(v.workerProfile));
    const onlineLlmVms = allVms.filter(
      (v) => v.status === "ONLINE" && v.publicUrl && isLlmWorkerProfile(v.workerProfile)
    );
    const startingLlm = llmVms.find((v) => v.status === "STARTING");
    const acc2WrongProfile = allVms.find(
      (v) =>
        v.accountAlias === "acc2" &&
        v.provider === "kaggle" &&
        !isLlmWorkerProfile(v.workerProfile) &&
        (v.status === "ONLINE" || v.status === "STARTING")
    );

    // Probe all online LLM VMs in parallel so user can select between different models
    const probedVms = await Promise.all(
      onlineLlmVms.map(async (vm) => {
        const base = vm.publicUrl!.replace(/\/$/, "");
        const headers: Record<string, string> = {};
        if (vm.vmSecret) {
          headers["Authorization"] = `Bearer ${vm.vmSecret}`;
          headers["X-VM-Secret"] = vm.vmSecret;
        }

        let reachable = false;
        let loadedModel: string | null = null;
        let probeLatencyMs: number | null = null;
        let probeError: string | null = null;

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

        const profileSpec = getWorkerProfile(vm.workerProfile);
        const displayName =
          loadedModel ||
          profileSpec?.label ||
          (vm.workerProfile === "LLM_QWEN_TEXT_TURBO"
            ? "Qwen 27B Ultra Text"
            : vm.workerProfile === "LLM_LIGHTWEIGHT_SWARM"
            ? "Qwen 2.5 Swarm (4B+9B)"
            : vm.workerProfile === "LLM_QWEN_VLM"
            ? "Qwen 2.5-VL Vision"
            : vm.workerProfile);

        return {
          target: vm.target,
          accountAlias: vm.accountAlias,
          workerProfile: vm.workerProfile,
          profileLabel: profileSpec?.label || vm.workerProfile,
          loadedModel: displayName,
          publicUrl: vm.publicUrl,
          gpuName: vm.target.startsWith("tpu")
            ? "TPU v5e-8 (8 chips · 128GB HBM)"
            : vm.gpuName || "Tesla T4 x2",
          vramTotalGb: vm.target.startsWith("tpu") ? 128 : vm.vramTotalGb || 30,
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
      accountAlias: primaryVm?.accountAlias || llmVms[0]?.accountAlias || "acc2",
      endpointPreview: primaryVm?.publicUrl
        ? `${primaryVm.publicUrl.replace(/\/$/, "")}/v1`
        : null,
      reachable: Boolean(primaryVm?.reachable),
      loadedModel: primaryVm?.loadedModel || null,
      probeLatencyMs: primaryVm?.probeLatencyMs || null,
      probeError: primaryVm?.probeError || null,
      gpuName: primaryVm?.gpuName || llmVms[0]?.gpuName || null,
      vramTotalGb: primaryVm?.vramTotalGb || llmVms[0]?.vramTotalGb || 30,
      vramUsedGb: primaryVm?.vramUsedGb || llmVms[0]?.vramUsedGb || 0,
      acc2RunningWrongProfile: acc2WrongProfile
        ? {
            target: acc2WrongProfile.target,
            workerProfile: acc2WrongProfile.workerProfile,
            status: acc2WrongProfile.status,
          }
        : null,
      vaultFallbackCount: vaultFallbacks.length,
      onlineVms: probedVms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect LLM Studio health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
