import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, signVmRegistrationToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { buildUnifiedNotebookPythonCode } from "@/lib/orchestrator/notebook-builder";
import { buildTpuNotebookPythonCode } from "@/lib/orchestrator/tpu-notebook-builder";
import { getWorkerProfile, isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import {
  sanitizeVmForClient,
  sortVmsByCanonicalTarget,
} from "@/lib/orchestrator/vm-helpers";
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

    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    const groupVms = await prisma.vmInstance.findMany({
      where: { userId: user.userId, sessionGroup: vm.sessionGroup },
    });
    const groupTargets = sortVmsByCanonicalTarget(groupVms).map((v) => v.target);

    // TOGGLE OFF: Kill running or starting session across entire sessionGroup
    if (vm.status === "ONLINE" || vm.status === "BUSY" || vm.status === "STARTING") {
      if (vm.publicUrl) {
        await VmGateway.killVm(vm);
      } else if (vm.provider === "kaggle") {
        try {
          const [kaggleCred, kaggleMeta] = await Promise.all([
            getDecryptedCredential(user.userId, "kaggle", vm.accountAlias),
            getDecryptedCredential(user.userId, "kaggle-meta", vm.accountAlias),
          ]);
          const sessionId = Number(kaggleMeta?.secret || 0);
          if (kaggleCred?.username && sessionId > 0) {
            await KaggleOrchestrator.cancelKernelSession(
              {
                username: kaggleCred.username,
                key: kaggleCred.secret,
                authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
              },
              sessionId
            );
          }
        } catch {
          // ignore best-effort session cancel
        }
      }

      await prisma.vmInstance.updateMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        data: {
          status: "OFFLINE",
          stepProgress: 0,
          vramUsedGb: 0,
          latencyMs: null,
          onlineSince: null,
          publicUrl: "",
          vmSecret: null,
        },
      });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: "WARN",
        message: `Shutdown triggered for ${vm.sessionGroup} (${groupTargets.join(", ")}).`,
      });

      const refreshed = await prisma.vmInstance.findMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
      });

      return NextResponse.json({
        message: "Termination triggered",
        vm: sanitizeVmForClient(refreshed.find((r) => r.target === target) || vm),
        groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
      });
    }

    // TOGGLE ON: Provision Kaggle or prepare Colab bundle
    let gdriveCred: Awaited<ReturnType<typeof getUserGDriveCredential>> = null;
    let gdriveDecryptError: string | null = null;
    try {
      gdriveCred = await getUserGDriveCredential(user.userId);
    } catch (err) {
      gdriveDecryptError =
        err instanceof Error ? err.message : "Failed to decrypt Google Drive credential";
    }

    const isLlmProfile = isLlmWorkerProfile(vm.workerProfile);
    if (!gdriveCred && !isLlmProfile) {
      return NextResponse.json(
        {
          error: gdriveDecryptError
            ? `Google Drive credential could not be decrypted (${gdriveDecryptError}). Re-save Google Drive in Settings → Vault or sync ENCRYPTION_KEY with Vercel.`
            : "Missing Google Drive credential in Settings Vault. Please add your Rclone/OAuth token first.",
        },
        { status: 400 }
      );
    }

    const vmSecret = generateVmSecret();
    const registrationJwt = signVmRegistrationToken({
      userId: user.userId,
      sessionGroup: vm.sessionGroup,
      targets: groupTargets,
      vmSecret,
    });

    const webhook = await resolveReachableWebhookBaseUrl(req);
    if (webhook.mode === "unreachable") {
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ERROR",
        level: "ERROR",
        message: webhook.reason || "No reachable public webhook URL for cloud VM heartbeat.",
      });
      return NextResponse.json(
        { error: webhook.reason || "No reachable public callback URL found for cloud VMs." },
        { status: 400 }
      );
    }
    const appWebhookUrl = webhook.url;

    if (vm.provider === "kaggle") {
      let kaggleCred: Awaited<ReturnType<typeof getDecryptedCredential>> = null;
      try {
        kaggleCred = await getDecryptedCredential(user.userId, "kaggle", vm.accountAlias);
      } catch (err) {
        return NextResponse.json(
          {
            error: `Kaggle '${vm.accountAlias}' credential could not be decrypted (${
              err instanceof Error ? err.message : "decrypt error"
            }). Re-save it in Settings → Vault or sync ENCRYPTION_KEY.`,
          },
          { status: 400 }
        );
      }
      if (!kaggleCred || !kaggleCred.username) {
        return NextResponse.json(
          { error: `Missing Kaggle credentials for account '${vm.accountAlias}' in Settings Vault.` },
          { status: 400 }
        );
      }

      const profileSpec = getWorkerProfile(vm.workerProfile);
      const workspaceSettings = await getOrCreateWorkspaceSettings(user.userId);
      const effectiveIdleMinutes =
        vm.idleTimeoutMinutes ?? workspaceSettings.idleTimeoutMinutes ?? 15;
      let prewarmModels: Array<{ category: string; filename: string }> = [];
      if (vm.prewarmModelsJson) {
        try {
          const parsed = JSON.parse(vm.prewarmModelsJson);
          if (Array.isArray(parsed)) prewarmModels = parsed;
        } catch {
          prewarmModels = [];
        }
      }

      const isTpu = profileSpec.accelerator === "tpu";
      const pythonCode = isTpu
        ? buildTpuNotebookPythonCode({
            appWebhookUrl,
            registrationJwt,
            vmSecret,
            accountAlias: vm.accountAlias,
            gpuTargets: groupTargets,
            idleTimeoutSeconds: effectiveIdleMinutes * 60,
          })
        : buildUnifiedNotebookPythonCode({
            provider: "kaggle",
            appWebhookUrl,
            registrationJwt,
            vmSecret,
            gdriveTokenJson: gdriveCred?.rawTokenJson || "",
            gdriveBaseFolder: gdriveCred?.baseFolder || workspaceSettings.gdriveBaseFolder,
            gpuTargets: groupTargets,
            accountAlias: vm.accountAlias,
            workerProfile: profileSpec.id,
            customNodes: profileSpec.customNodes,
            idleTimeoutSeconds: effectiveIdleMinutes * 60,
            prewarmModels,
            enableOfflineDatasetScan: vm.accountAlias === "acc1",
          });

      await prisma.vmInstance.updateMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        data: {
          status: "STARTING",
          stepProgress: 1,
          vmSecret,
          publicUrl: "",
          lastError: null,
        },
      });

      try {
        const kernelSlug = isTpu
          ? `kaggle-tpu-runner-${vm.accountAlias}`
          : `kaggle-dual-gpu-runner-${vm.accountAlias}`;

        const pushRes = await KaggleOrchestrator.pushKernel({
          credentials: {
            username: kaggleCred.username,
            key: kaggleCred.secret,
            authType: (kaggleCred.authType === "bearer" ? "bearer" : "basic"),
          },
          kernelSlug,
          pythonCode,
          datasetDataSources: isTpu
            ? ["rahim3/qwen3-8-27b-bf16", "rahim3/qwen38-tpu-env-v5e8"]
            : [],
          enableTpu: isTpu,
          enableGpu: !isTpu,
          machineShape: isTpu ? "TpuV5E8" : "NvidiaTeslaT4",
        });

        if (pushRes.kernelSessionId) {
          await saveUserCredential(user.userId, {
            provider: "kaggle-meta",
            accountAlias: vm.accountAlias,
            username: kaggleCred.username,
            rawSecret: String(pushRes.kernelSessionId),
            authType: "session_id",
            metadata: {
              kernelSessionId: pushRes.kernelSessionId,
              pushedAt: new Date().toISOString(),
            },
          });
        }

        await appendSystemLog({
          userId: user.userId,
          vmInstanceId: vm.id,
          category: "KAGGLE",
          level: "SUCCESS",
          message: isTpu
            ? `Pushed Kaggle TPU v5e-8 kernel (${vm.accountAlias}, callback=${webhook.mode}) for ${groupTargets.join(" & ")} -> ${pushRes.url}`
            : `Pushed Kaggle Dual-T4 kernel (${vm.accountAlias}, callback=${webhook.mode}) for ${groupTargets.join(" & ")} -> ${pushRes.url}`,
        });

        const refreshed = await prisma.vmInstance.findMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        });

        return NextResponse.json({
          message: "Kaggle Dual-GPU provisioning initiated",
          kernelUrl: pushRes.url,
          vm: sanitizeVmForClient(refreshed.find((r) => r.target === target) || vm),
          groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
        });
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : "Kaggle push failed";
        await prisma.vmInstance.updateMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
          data: { status: "ERROR", stepProgress: 0, lastError: msg },
        });
        await appendSystemLog({
          userId: user.userId,
          vmInstanceId: vm.id,
          category: "ERROR",
          level: "ERROR",
          message: `Kaggle boot failed (${vm.accountAlias}): ${msg}`,
        });
        return NextResponse.json({ error: msg }, { status: 502 });
      }
    }

    if (vm.provider === "colab") {
      await prisma.vmInstance.updateMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        data: {
          status: "STARTING",
          stepProgress: 1,
          vmSecret,
          publicUrl: "",
          lastError: null,
        },
      });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COLAB",
        level: "INFO",
        message: `Colab session armed for ${target}. Download the generated .ipynb and run in Google Colab.`,
      });

      const refreshed = await prisma.vmInstance.findUnique({ where: { id: vm.id } });
      return NextResponse.json({
        message: "Colab notebook ready for launch",
        colabNotebookUrl: `/api/vm/colab/${target}/notebook`,
        vm: sanitizeVmForClient(refreshed || vm),
      });
    }

    return NextResponse.json({ error: `Unsupported provider: ${vm.provider}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

