import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";

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
    const onlineLlm = llmVms.find((v) => v.status === "ONLINE" && v.publicUrl);
    const startingLlm = llmVms.find((v) => v.status === "STARTING");
    const acc2WrongProfile = allVms.find(
      (v) =>
        v.accountAlias === "acc2" &&
        v.provider === "kaggle" &&
        !isLlmWorkerProfile(v.workerProfile) &&
        (v.status === "ONLINE" || v.status === "STARTING")
    );

    let reachable = false;
    let loadedModel: string | null = null;
    let probeLatencyMs: number | null = null;
    let probeError: string | null = null;

    if (onlineLlm?.publicUrl) {
      const base = onlineLlm.publicUrl.replace(/\/$/, "");
      const headers: Record<string, string> = {};
      if (onlineLlm.vmSecret) {
        headers["Authorization"] = `Bearer ${onlineLlm.vmSecret}`;
        headers["X-VM-Secret"] = onlineLlm.vmSecret;
      }

      const t0 = Date.now();
      try {
        const [modelsRes, ckptRes] = await Promise.all([
          fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(6000) }),
          fetch(`${base}/object_info/CheckpointLoaderSimple`, {
            headers,
            signal: AbortSignal.timeout(6000),
          }).catch(() => null),
        ]);
        probeLatencyMs = Date.now() - t0;

        if (modelsRes.ok) {
          reachable = true;
          const mJson = (await modelsRes.json()) as { data?: Array<{ id?: string }> };
          loadedModel = mJson.data?.[0]?.id || null;
        } else {
          probeError = `HTTP ${modelsRes.status} from /v1/models`;
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
        probeError = err instanceof Error ? err.message : "Failed to reach LLM tunnel";
      }
    }

    const vaultFallbacks = await resolveCandidateLlmConfigs(user.userId);

    return NextResponse.json({
      vmStatus: onlineLlm?.status || startingLlm?.status || llmVms[0]?.status || "OFFLINE",
      target: onlineLlm?.target || startingLlm?.target || llmVms[0]?.target || null,
      accountAlias: onlineLlm?.accountAlias || llmVms[0]?.accountAlias || "acc2",
      endpointPreview: onlineLlm?.publicUrl
        ? `${onlineLlm.publicUrl.replace(/\/$/, "")}/v1`
        : null,
      reachable,
      loadedModel,
      probeLatencyMs,
      probeError,
      gpuName: onlineLlm?.gpuName || llmVms[0]?.gpuName || null,
      vramTotalGb: onlineLlm?.vramTotalGb ?? llmVms[0]?.vramTotalGb ?? 30,
      vramUsedGb: onlineLlm?.vramUsedGb ?? llmVms[0]?.vramUsedGb ?? 0,
      acc2RunningWrongProfile: acc2WrongProfile
        ? {
            target: acc2WrongProfile.target,
            workerProfile: acc2WrongProfile.workerProfile,
            status: acc2WrongProfile.status,
          }
        : null,
      vaultFallbackCount: vaultFallbacks.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect LLM Studio health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

