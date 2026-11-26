import { prisma } from "@/lib/db/prisma";
import { prepareWorkerModel } from "@/lib/catalog/worker-model";
import type { NextRequest } from "next/server";
import type { VmInstance } from "@prisma/client";
import { signVmRegistrationToken } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { getWorkerProfile, isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { buildUnifiedNotebookPythonCode } from "@/lib/orchestrator/notebook-builder";
import { buildTpuNotebookPythonCode } from "@/lib/orchestrator/tpu-notebook-builder";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import { sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";

export class WorkerPayloadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface AssembleWorkerPayloadInput {
  userId: string;
  vm: VmInstance;
  groupVms: VmInstance[];
  req: NextRequest;
  runtimeVmSecret: string;
  workerMode?: "headless_safe" | "interactive_tunnel";
  customDatasets?: string[];
}

export interface AssembledWorkerPayload {
  pythonCode: string;
  registrationJwt: string;
  groupTargets: string[];
  profileId: string;
  isTpu: boolean;
  webhookMode: string;
}

/**
 * Shared server-side worker payload builder used by `/api/vm/kaggle/claim` and `/api/vm/colab/claim`.
 * Decrypts Vault credentials only after an authenticated VM runtime claim and never embeds secrets
 * statically into saved notebook source.
 */
export async function assembleWorkerRuntimePayload(
  input: AssembleWorkerPayloadInput
): Promise<AssembledWorkerPayload> {
  const { userId, vm, groupVms, req, runtimeVmSecret, workerMode = "headless_safe", customDatasets = [] } =
    input;

  const gdriveCred = await getUserGDriveCredential(userId, undefined, { ensureFresh: true }).catch(() => null);
  const isLlmProfile = isLlmWorkerProfile(vm.workerProfile);

  const sortedGroupVms = sortVmsByCanonicalTarget(groupVms);
  const groupTargets = sortedGroupVms.map((gv) => gv.target);
  const registrationJwt = signVmRegistrationToken({
    userId,
    sessionGroup: vm.sessionGroup,
    targets: groupTargets,
    vmSecret: runtimeVmSecret,
  });

  const webhook = await resolveReachableWebhookBaseUrl(req);
  if (webhook.mode === "unreachable") {
    throw new WorkerPayloadError(
      webhook.reason || "No reachable public callback URL found for cloud VMs.",
      400
    );
  }

  const profileSpec = getWorkerProfile(vm.workerProfile);
  const workspaceSettings = await getOrCreateWorkspaceSettings(userId);
  const effectiveIdleMinutes =
    vm.idleTimeoutMinutes ?? workspaceSettings.idleTimeoutMinutes ?? 15;

  const gpuProfiles = sortedGroupVms.map((gv) => gv.workerProfile || profileSpec.id);
  const mergedNodeMap = new Map<string, { name: string; repoUrl: string }>();
  for (const pId of gpuProfiles) {
    for (const cn of getWorkerProfile(pId).customNodes) {
      mergedNodeMap.set(cn.repoUrl, cn);
    }
  }
  const mergedCustomNodes = Array.from(mergedNodeMap.values());

  const prewarmMap = new Map<string, { category: string; filename: string }>();
  const datasetSet = new Set<string>(customDatasets);
  for (const gv of sortedGroupVms) {
    if (gv.prewarmModelsJson) {
      try {
        const parsed = JSON.parse(gv.prewarmModelsJson);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.category === "string" && typeof item.filename === "string") {
              prewarmMap.set(`${item.category}/${item.filename}`, {
                category: item.category,
                filename: item.filename,
              });
            }
          }
        }
      } catch {
        // ignore invalid prewarm json
      }
    }
    if (gv.kaggleDatasetsJson) {
      try {
        const parsedDs = JSON.parse(gv.kaggleDatasetsJson);
        if (Array.isArray(parsedDs)) {
          for (const ds of parsedDs) {
            if (typeof ds === "string" && ds.trim().includes("/")) {
              datasetSet.add(ds.trim());
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const prewarmModels = await Promise.all(Array.from(prewarmMap.values(), async (item) => {
    const asset = await prisma.modelAsset.findFirst({ where: { userId, ...item } });
    if (!asset) throw new WorkerPayloadError("Startup model missing from catalog: " + item.filename);
    return prepareWorkerModel(userId, vm.provider, asset, {
      hasDrive: Boolean(gdriveCred?.parsed.access_token || gdriveCred?.parsed.refresh_token),
    });
  }));
  const isTpu = profileSpec.accelerator === "tpu";
  const isKaggle = vm.provider === "kaggle";

  const pythonCode = isTpu
    ? buildTpuNotebookPythonCode({
        appWebhookUrl: webhook.url,
        registrationJwt,
        vmSecret: runtimeVmSecret,
        accountAlias: vm.accountAlias,
        gpuTargets: groupTargets,
        idleTimeoutSeconds: effectiveIdleMinutes * 60,
        quietStdout: isKaggle,
      })
    : buildUnifiedNotebookPythonCode({
        provider: isKaggle ? "kaggle" : "colab",
        appWebhookUrl: webhook.url,
        registrationJwt,
        vmSecret: runtimeVmSecret,
        gdriveTokenJson: gdriveCred?.rawTokenJson || "",
        gdriveBaseFolder: gdriveCred?.baseFolder || workspaceSettings.gdriveBaseFolder,
        gpuTargets: groupTargets,
        gpuProfiles,
        accountAlias: vm.accountAlias,
        workerProfile: profileSpec.id,
        customNodes: mergedCustomNodes,
        idleTimeoutSeconds: effectiveIdleMinutes * 60,
        prewarmModels,
        enableOfflineDatasetScan: vm.accountAlias === "acc1" || datasetSet.size > 0,
        headlessMode: isKaggle && !isLlmProfile && workerMode === "headless_safe",
        quietStdout: isKaggle,
      });

  return {
    pythonCode,
    registrationJwt,
    groupTargets,
    profileId: profileSpec.id,
    isTpu,
    webhookMode: webhook.mode,
  };
}
