import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import {
  buildFastbootCachePythonCode,
  buildLlmDatasetPythonCode,
} from "@/lib/orchestrator/fastboot-builder";
import { getWorkerProfile, isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import {
  getDefaultPresetForLlmProfile,
  resolveLlmPresetById,
} from "@/lib/llm/llm-model-presets";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.provider !== "kaggle") {
      return NextResponse.json({ error: `Kaggle VM target '${target}' not found.` }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as { profileId?: string; presetId?: string };
    const profile = getWorkerProfile(body.profileId || vm.workerProfile || "IMAGE_CORE");
    if (profile.accelerator === "tpu") {
      return NextResponse.json(
        { error: `Profile '${profile.id}' uses TPU HBM runtime and does not require a Kaggle Dataset build.` },
        { status: 400 }
      );
    }

    const cred = await getDecryptedCredential(user.userId, "kaggle", vm.accountAlias);
    if (!cred?.username || !cred.secret) {
      return NextResponse.json(
        { error: `Missing Kaggle credentials for '${vm.accountAlias}' in Settings Vault.` },
        { status: 400 }
      );
    }

    const isLlm = isLlmWorkerProfile(profile.id);
    const preset = isLlm
      ? resolveLlmPresetById(body.presetId) || getDefaultPresetForLlmProfile(profile.id)
      : null;

    const kernelSlug = isLlm ? "ml-llm-dataset-builder" : "ml-env-cache-builder";
    const pythonCode = isLlm && preset
      ? buildLlmDatasetPythonCode({
          presetId: preset.id,
          shortLabel: preset.shortLabel,
          primaryRepo: preset.repoId,
          fileHints: preset.preferredFilenames,
          mmprojHints: preset.mmprojHints,
          companions: (preset.companionRepos || []).map((c) => ({
            role: c.role,
            repoId: c.repoId,
            fileHints: c.preferredFilenames,
            mmprojHints: c.mmprojHints,
          })),
        })
      : buildFastbootCachePythonCode(profile.id);

    const pushRes = await KaggleOrchestrator.pushKernel({
      credentials: {
        username: cred.username,
        key: cred.secret,
        authType: cred.authType === "bearer" ? "bearer" : "basic",
      },
      kernelSlug,
      pythonCode,
      datasetDataSources: [],
      enableGpu: false,
      enableTpu: false,
    });

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "KAGGLE",
      level: "SUCCESS",
      message: isLlm && preset
        ? `Triggered 0-GPU CPU Qwen LLM Dataset builder (${preset.shortLabel}) -> ${pushRes.url}`
        : `Triggered 0-GPU CPU FastBoot cache build (${profile.id}) -> ${pushRes.url}`,
    });

    return NextResponse.json({
      ok: true,
      kind: isLlm ? "llm_dataset" : "comfy_fastboot",
      profileId: profile.id,
      presetId: preset?.id || null,
      kernelSlug,
      username: cred.username,
      suggestedDatasetSlug: isLlm ? `${cred.username}/scriptoria-qwen-llm` : `${cred.username}/scriptoria-comfy-env`,
      url: pushRes.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger FastBoot CPU build";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
