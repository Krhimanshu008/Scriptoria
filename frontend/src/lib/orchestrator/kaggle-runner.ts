import type { NextRequest } from "next/server";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { syncKaggleTunnelBeaconInDrive } from "@/lib/gdrive/client";
import { kaggleCustomKernelSlug } from "@/lib/orchestrator/kaggle-connection";
import {
  KAGGLE_RUNNER_PROVIDER,
  buildKaggleLauncherNotebookJson,
  buildKagglePermanentLauncherCode,
  type KagglePermanentLauncherConfig,
} from "@/lib/orchestrator/notebook-builder";
import { getOrCreateRunnerToken } from "@/lib/orchestrator/runner-token";
import { getKaggleKernelSlug } from "@/lib/orchestrator/vm-helpers";
import {
  peekActiveTunnelUrl,
  resolveReachableWebhookBaseUrl,
} from "@/lib/orchestrator/webhook-tunnel";

export class KaggleRunnerSetupError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface PreparedKagglePermanentCell {
  launcherCfg: KagglePermanentLauncherConfig;
  primaryUrl: string;
  beaconUrl: string | null;
  notebookUrl: string | null;
  pythonCode: string;
  notebookJson: ReturnType<typeof buildKaggleLauncherNotebookJson>;
}

/**
 * Resolves webhook + Drive tunnel beacon + permanent runner token and builds
 * both the copyable Python launcher cell and downloadable .ipynb payload.
 */
export async function prepareKagglePermanentCell(params: {
  req: NextRequest;
  userId: string;
  vm: {
    target: string;
    accountAlias: string;
    sessionGroup: string;
    workerProfile: string;
  };
}): Promise<PreparedKagglePermanentCell> {
  const { req, userId, vm } = params;
  const webhook = await resolveReachableWebhookBaseUrl(req);
  if (webhook.mode === "unreachable") {
    throw new KaggleRunnerSetupError(
      webhook.reason || "No reachable public callback URL for Kaggle notebook.",
      400
    );
  }

  const primaryUrl = webhook.url.replace(/\/$/, "");
  const isEphemeralTunnel = /trycloudflare\.com/i.test(primaryUrl);
  let beaconUrl: string | null = null;
  if (isEphemeralTunnel) {
    const beaconFileId = await syncKaggleTunnelBeaconInDrive(userId, primaryUrl).catch(
      () => null
    );
    if (beaconFileId) {
      beaconUrl = `https://drive.google.com/uc?export=download&id=${beaconFileId}`;
    }
  }

  const runnerToken = await getOrCreateRunnerToken(
    KAGGLE_RUNNER_PROVIDER,
    userId,
    vm.sessionGroup
  );

  const kaggleCred = await getDecryptedCredential(userId, "kaggle", vm.accountAlias).catch(
    () => null
  );
  const isTpu = vm.target.startsWith("tpu") || vm.workerProfile === "TPU_QWEN27B_V5E";
  const kernelSlug = getKaggleKernelSlug(
    vm.accountAlias,
    isTpu,
    kaggleCustomKernelSlug(kaggleCred?.metadata, isTpu)
  );
  const notebookUrl = kaggleCred?.username
    ? `https://www.kaggle.com/code/${kaggleCred.username}/${kernelSlug}/edit`
    : null;

  const launcherCfg: KagglePermanentLauncherConfig = {
    target: vm.target,
    runnerToken,
    primaryUrl,
    beaconUrl,
  };

  return {
    launcherCfg,
    primaryUrl,
    beaconUrl,
    notebookUrl,
    pythonCode: buildKagglePermanentLauncherCode(launcherCfg),
    notebookJson: buildKaggleLauncherNotebookJson(launcherCfg),
  };
}

/**
 * Non-blocking helper for /api/vm/accounts and /api/vm/status to keep the Drive
 * tunnel beacon updated whenever a local trycloudflare.com tunnel starts or rotates.
 */
export function syncDriveTunnelBeaconIfEphemeral(userId: string): void {
  const liveTunnelUrl = peekActiveTunnelUrl();
  if (liveTunnelUrl && /trycloudflare\.com/i.test(liveTunnelUrl)) {
    void syncKaggleTunnelBeaconInDrive(userId, liveTunnelUrl).catch(() => {});
  }
}
