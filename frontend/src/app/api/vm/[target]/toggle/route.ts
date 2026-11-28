import { kaggleCustomKernelSlug } from "@/lib/orchestrator/kaggle-connection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, signVmClaimToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { buildKaggleThinClaimStubCode } from "@/lib/orchestrator/notebook-builder";
import { getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import {
  KaggleRunnerSetupError,
  prepareKagglePermanentCell,
} from "@/lib/orchestrator/kaggle-runner";
import {
  getKaggleKernelSlug,
  markBootMetadataOffline,
  parseBootMetadata,
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
      forcePushCpu?: boolean;
      workerMode?: "headless_safe" | "interactive_tunnel";
    };
    const requestedWorkerMode =
      body.workerMode === "interactive_tunnel" ? "interactive_tunnel" : "headless_safe";
    const isDraftCellRequested = body.action === "draft_cell";
    const isKillRequested =
      !isDraftCellRequested &&
      (body.action === "kill" ||
        body.action === "reset" ||
        (body.action !== "boot" && Boolean(body.force)));

    // TOGGLE OFF / FORCE KILL: Kill running, starting, or errored session across entire sessionGroup
    if (
      !isDraftCellRequested &&
      (isKillRequested ||
        vm.status === "ONLINE" ||
        vm.status === "BUSY" ||
        vm.status === "STARTING")
    ) {
      const sidecarStopped = vm.publicUrl ? await VmGateway.killVm(vm) : false;
      if (!sidecarStopped && vm.provider === "kaggle") {
        const isTpu = vm.target.startsWith("tpu");
        const metaProvider = isTpu ? "kaggle-tpu-meta" : "kaggle-meta";
        const [credential, meta] = await Promise.all([
          getDecryptedCredential(user.userId, "kaggle", vm.accountAlias),
          getDecryptedCredential(user.userId, metaProvider, vm.accountAlias),
        ]);
        const sessionId = Number(meta?.secret || 0);
        if (credential?.username) {
          const kaggleCreds = {
            username: credential.username,
            key: credential.secret,
            authType: (credential.authType === "bearer" ? "bearer" : "basic") as "bearer" | "basic",
          };
          if (sessionId > 0) {
            await KaggleOrchestrator.cancelKernelSession(kaggleCreds, sessionId).catch(() => null);
          }
          // Only push CPU overwrite if explicitly requested; normal Stop relies on vmSecret invalidation -> 410 os._exit(0)
          // so we don't spawn a masking Version #2 commit over the running Version #1 in Kaggle /kernels/status.
          if (body.forcePushCpu === true) {
            const customSlug = kaggleCustomKernelSlug(credential.metadata, isTpu);
            const kernelSlug = getKaggleKernelSlug(vm.accountAlias, isTpu, customSlug);
            await KaggleOrchestrator.releaseKernelGpu(kaggleCreds, kernelSlug).catch(() => null);
          }
          await saveUserCredential(user.userId, {
            provider: metaProvider,
            accountAlias: vm.accountAlias,
            username: credential.username,
            rawSecret: "0",
            authType: "session_id",
          }).catch(() => null);
        }
      } else if (vm.publicUrl && !sidecarStopped && !isKillRequested) {
        return NextResponse.json({ error: "The worker did not confirm shutdown." }, { status: 502 });
      }

      for (const peer of groupVms) {
        await prisma.vmInstance.update({
          where: { id: peer.id },
          data: {
            status: "OFFLINE",
            stepProgress: 0,
            vramUsedGb: 0,
            latencyMs: null,
            onlineSince: null,
            publicUrl: "",
            vmSecret: null,
            bootMetadataJson: markBootMetadataOffline(peer.bootMetadataJson),
            lastError: null,
          },
        });
      }

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
      const customSlug = kaggleCustomKernelSlug(kaggleCred.metadata, isTpu);
      const kernelSlug = getKaggleKernelSlug(vm.accountAlias, isTpu, customSlug);
      const kaggleAuth = {
        username: kaggleCred.username,
        key: kaggleCred.secret,
        authType: (kaggleCred.authType === "bearer" ? "bearer" : "basic") as "bearer" | "basic",
      };

      const mintClaimAndStub = async () => {
        const claimToken = signVmClaimToken({
          userId: user.userId,
          sessionGroup: vm.sessionGroup,
          targets: groupTargets,
          claimSecret,
          workerMode: requestedWorkerMode,
          isTpu,
          customDatasets,
        });
        const pythonCode = buildKaggleThinClaimStubCode({
          appWebhookUrl,
          target: groupTargets[0] || target,
          claimToken,
        });
        const existingMeta = parseBootMetadata(vm.bootMetadataJson) || {};
        const nextMeta = isDraftCellRequested
          ? { ...existingMeta, draftMode: true, draftArmedAt: Date.now() }
          : { ...existingMeta, draftMode: false };
        await prisma.vmInstance.updateMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
          data: {
            status: "STARTING",
            stepProgress: 1,
            vmSecret: claimSecret,
            publicUrl: "",
            bootMetadataJson: JSON.stringify(nextMeta),
            lastError: isDraftCellRequested
              ? "Armed for Kaggle Interactive Draft Session — paste cell code & press Run."
              : null,
          },
        });
        return pythonCode;
      };

      // Fast path for already-allotted Kaggle Interactive Draft Sessions (/edit):
      // Returns the permanent non-expiring runner cell without queueing a SaveKernel batch run.
      if (isDraftCellRequested) {
        let prepared;
        try {
          prepared = await prepareKagglePermanentCell({ req, userId: user.userId, vm });
        } catch (prepErr) {
          if (prepErr instanceof KaggleRunnerSetupError) {
            return NextResponse.json({ error: prepErr.message }, { status: prepErr.status });
          }
          throw prepErr;
        }
        await appendSystemLog({
          userId: user.userId,
          vmInstanceId: vm.id,
          category: "KAGGLE",
          level: "INFO",
          message: `Generated Permanent Interactive Cell for ${vm.accountAlias} (${groupTargets.join(" & ")}, callback=${prepared.primaryUrl}).`,
        });
        const refreshed = await prisma.vmInstance.findMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        });
        return NextResponse.json({
          message: "Copied permanent claim cell for Interactive Kaggle Session",
          draftCode: prepared.pythonCode,
          webhookUrl: prepared.primaryUrl,
          beaconUrl: prepared.beaconUrl,
          notebookUrl: prepared.notebookUrl,
          vm: sanitizeVmForClient(refreshed.find((r) => r.target === target) || vm),
          groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
        });
      }

      // Anti-duplicate guard 1: cooldown right after a recent heartbeat so an exiting container never overlaps a new boot
      const newestHeartbeatMs = Math.max(
        0,
        ...sortedGroupVms.map((gv) => (gv.lastHeartbeat ? gv.lastHeartbeat.getTime() : 0))
      );
      if (newestHeartbeatMs > 0 && Date.now() - newestHeartbeatMs < 35_000) {
        return NextResponse.json(
          {
            error: `Previous container for ${vm.accountAlias} is still shutting down (~25s teardown window). Wait a moment before rebooting to prevent 2× GPU quota usage.`,
          },
          { status: 409 }
        );
      }

      // Anti-duplicate guard 2: refuse launching a second parallel Kaggle GPU session if Kaggle reports running/queued
      const preflightStatus = await KaggleOrchestrator.getKernelStatus(kaggleAuth, kernelSlug).catch(() => null);
      if (preflightStatus && (preflightStatus.status === "running" || preflightStatus.status === "queued")) {
        return NextResponse.json(
          {
            error: `Kaggle reports '${kernelSlug}' is already ${preflightStatus.status} on @${kaggleCred.username}. Stop or wait for it to exit before launching another session.`,
          },
          { status: 409 }
        );
      }

      // Push only a ~22-line dynamic claim stub (zero model lists, ComfyUI setup, or Vault secrets)
      const pythonCode = await mintClaimAndStub();

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
        const pushRes = await KaggleOrchestrator.pushKernel({
          credentials: kaggleAuth,
          kernelSlug,
          pythonCode,
          datasetDataSources: isTpu
            ? Array.from(new Set(["rahim3/qwen3-8-27b-bf16", "rahim3/qwen38-tpu-env-v5e8", ...customDatasets]))
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

