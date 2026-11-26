import { checkKaggleConnection } from "@/lib/orchestrator/kaggle-connection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, signVmClaimToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { buildKaggleThinClaimStubCode } from "@/lib/orchestrator/notebook-builder";
import { getWorkerProfile, isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import {
  getKaggleKernelSlug,
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

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      force?: boolean;
      workerMode?: "headless_safe" | "interactive_tunnel";
    };
    const requestedWorkerMode =
      body.workerMode === "interactive_tunnel" ? "interactive_tunnel" : "headless_safe";
    const isKillRequested =
      body.action === "kill" ||
      body.action === "reset" ||
      Boolean(body.force);

    // TOGGLE OFF / FORCE KILL: Kill running, starting, or errored session across entire sessionGroup
    if (
      isKillRequested ||
      vm.status === "ONLINE" ||
      vm.status === "BUSY" ||
      vm.status === "STARTING"
    ) {
      const sidecarStopped = vm.publicUrl ? await VmGateway.killVm(vm) : false;
      if (!sidecarStopped && vm.provider === "kaggle") {
        const metaProvider = vm.target.startsWith("tpu") ? "kaggle-tpu-meta" : "kaggle-meta";
        const [credential, meta] = await Promise.all([
          getDecryptedCredential(user.userId, "kaggle", vm.accountAlias),
          getDecryptedCredential(user.userId, metaProvider, vm.accountAlias),
        ]);
        const sessionId = Number(meta?.secret || 0);
        if (credential?.username && sessionId > 0) {
          const result = await KaggleOrchestrator.cancelKernelSession({
            username: credential.username, key: credential.secret,
            authType: credential.authType === "bearer" ? "bearer" : "basic",
          }, sessionId);
          if (!result.ok) {
            return NextResponse.json({ error: result.errorMessage || "Kaggle could not confirm cancellation." }, { status: 502 });
          }
          await saveUserCredential(user.userId, {
            provider: metaProvider, accountAlias: vm.accountAlias, username: credential.username,
            rawSecret: "0", authType: "session_id",
          });
        } else if (groupVms.some((slot) => ["ONLINE", "BUSY", "STARTING"].includes(slot.status))) {
          return NextResponse.json({ error: "The Kaggle session ID is unavailable. Check the original notebook in Kaggle before resetting this slot." }, { status: 409 });
        }
      } else if (vm.publicUrl && !sidecarStopped) {
        return NextResponse.json({ error: "The worker did not confirm shutdown." }, { status: 502 });
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
          lastError: null,
        },
      });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ACTION",
        level: "WARN",
        message: `Shutdown & session release triggered for ${vm.sessionGroup} (${groupTargets.join(", ")}).`,
      });

      const refreshed = await prisma.vmInstance.findMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
      });

      return NextResponse.json({
        message: "Session terminated and slot reset to OFFLINE",
        vm: sanitizeVmForClient(refreshed.find((r) => r.target === target) || vm),
        groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
      });
    }

    // TOGGLE ON: Provision Kaggle or prepare Colab bundle
    const isLlmProfile = isLlmWorkerProfile(vm.workerProfile);

    const claimSecret = generateVmSecret();

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
      const conflict = await checkKaggleConnection(user.userId, vm.accountAlias);
      if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
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

      for (const row of groupVms) {
        const entries: { filename: string; category: string }[] = JSON.parse(row.prewarmModelsJson || "[]");
        if (!entries.length) continue;
        const reviewed = await prisma.modelAsset.findMany({ where: {
          userId: user.userId, reviewedSha256: { not: null },
          OR: entries.map(({ category, filename }) => ({ category, filename })),
        }, select: { filename: true, category: true } });
        const pending = entries.find((m) => !reviewed.some((r) => r.filename === m.filename && r.category === m.category));
        if (pending) return NextResponse.json({ error: "Review startup model in Models before launching: " + pending.filename }, { status: 422 });
      }

      const sortedGroupVms = sortVmsByCanonicalTarget(groupVms);
      const profileSpec = getWorkerProfile(vm.workerProfile);
      const customDatasets = Array.from(
        new Set(
          sortedGroupVms.flatMap((gv) => {
            if (!gv.kaggleDatasetsJson) return [] as string[];
            try {
              const parsedDs = JSON.parse(gv.kaggleDatasetsJson);
              return Array.isArray(parsedDs)
                ? parsedDs.filter((ds): ds is string => typeof ds === "string" && ds.trim().includes("/")).map((ds) => ds.trim())
                : [];
            } catch {
              return [];
            }
          })
        )
      );

      const isTpu = profileSpec.accelerator === "tpu";
      const claimToken = signVmClaimToken({
        userId: user.userId,
        sessionGroup: vm.sessionGroup,
        targets: groupTargets,
        claimSecret,
        workerMode: requestedWorkerMode,
        isTpu,
        customDatasets,
      });
      // Push only a ~22-line dynamic claim stub (zero model lists, ComfyUI setup, or Vault secrets)
      const pythonCode = buildKaggleThinClaimStubCode({
        appWebhookUrl,
        target: groupTargets[0] || target,
        claimToken,
      });

      await prisma.vmInstance.updateMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        data: {
          status: "STARTING",
          stepProgress: 1,
          vmSecret: claimSecret,
          publicUrl: "",
          lastError: null,
        },
      });

      // Pre-Push Ghost Session Cancellation: Cancel any lingering previous session to prevent Kaggle queue lockout
      try {
        const metaProvider = isTpu ? "kaggle-tpu-meta" : "kaggle-meta";
        const kaggleMeta = await getDecryptedCredential(user.userId, metaProvider, vm.accountAlias);
        const prevSessionId = Number(kaggleMeta?.secret || 0);
        if (prevSessionId > 0 && kaggleCred?.username) {
          console.info(
            `[Kaggle Toggle] Auto-cancelling previous session ${prevSessionId} for ${vm.accountAlias} before new push...`
          );
          await KaggleOrchestrator.cancelKernelSession(
            {
              username: kaggleCred.username,
              key: kaggleCred.secret,
              authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
            },
            prevSessionId
          );
        }
      } catch (cleanErr) {
        console.warn(`[Kaggle Toggle] Pre-push cleanup skipped for ${vm.accountAlias}:`, cleanErr);
      }

      try {
        const kernelSlug = getKaggleKernelSlug(vm.accountAlias, isTpu);

        const pushRes = await KaggleOrchestrator.pushKernel({
          credentials: {
            username: kaggleCred.username,
            key: kaggleCred.secret,
            authType: (kaggleCred.authType === "bearer" ? "bearer" : "basic"),
          },
          kernelSlug,
          pythonCode,
          datasetDataSources: isTpu
            ? Array.from(new Set(["rahim3/qwen3-8-27b-bf16", "rahim3/qwen38-tpu-env-v5e8", ...customDatasets]))
            : isLlmProfile && profileSpec.id === "LLM_QWEN_VLM"
            ? Array.from(new Set(["swift15/qwen38-27b-q4km-gguf", ...customDatasets]))
            : customDatasets,
          enableTpu: isTpu,
          enableGpu: !isTpu,
          machineShape: isTpu ? "TpuV5E8" : "NvidiaTeslaT4",
        });

        if (pushRes.kernelSessionId) {
          await saveUserCredential(user.userId, {
            provider: isTpu ? "kaggle-tpu-meta" : "kaggle-meta",
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
          vmSecret: claimSecret,
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

