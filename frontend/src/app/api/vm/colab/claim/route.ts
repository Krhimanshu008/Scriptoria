import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { signVmRegistrationToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { buildUnifiedNotebookPythonCode } from "@/lib/orchestrator/notebook-builder";
import { getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { verifyColabRunnerToken } from "@/lib/orchestrator/colab-runner";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const target = String(body.target || "").trim();
    const runnerToken = String(body.runnerToken || "").trim();

    if (!target || !runnerToken) {
      return NextResponse.json(
        { error: "target and runnerToken are required." },
        { status: 400 }
      );
    }

    const verified = await verifyColabRunnerToken(target, runnerToken);
    if (!verified) {
      return NextResponse.json(
        { error: "Invalid or revoked Colab runner token. Rotate/re-sync your notebook from Scriptoria." },
        { status: 401 }
      );
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: verified.userId, target } },
    });
    if (!vm || vm.provider !== "colab") {
      return NextResponse.json({ error: `Colab slot '${target}' not found.` }, { status: 404 });
    }

    const gdriveCred = await getUserGDriveCredential(verified.userId);
    if (!gdriveCred) {
      return NextResponse.json(
        { error: "Google Drive credential is missing in Scriptoria Settings Vault." },
        { status: 400 }
      );
    }

    const vmSecret = generateVmSecret();
    const registrationJwt = signVmRegistrationToken({
      userId: verified.userId,
      sessionGroup: vm.sessionGroup,
      targets: [vm.target],
      vmSecret,
    });

    const webhook = await resolveReachableWebhookBaseUrl(req);
    const appWebhookUrl = webhook.url;
    const profileSpec = getWorkerProfile(vm.workerProfile);
    const workspaceSettings = await getOrCreateWorkspaceSettings(verified.userId);
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

    const pythonCode = buildUnifiedNotebookPythonCode({
      provider: "colab",
      appWebhookUrl,
      registrationJwt,
      vmSecret,
      gdriveTokenJson: gdriveCred.rawTokenJson,
      gdriveBaseFolder: gdriveCred.baseFolder || workspaceSettings.gdriveBaseFolder,
      gpuTargets: [vm.target],
      accountAlias: vm.accountAlias,
      workerProfile: profileSpec.id,
      customNodes: profileSpec.customNodes,
      idleTimeoutSeconds: effectiveIdleMinutes * 60,
      prewarmModels,
    });

    await prisma.vmInstance.updateMany({
      where: { userId: verified.userId, sessionGroup: vm.sessionGroup },
      data: {
        status: "STARTING",
        stepProgress: 1,
        vmSecret,
        publicUrl: "",
        lastError: null,
      },
    });

    await appendSystemLog({
      userId: verified.userId,
      vmInstanceId: vm.id,
      category: "COLAB",
      level: "SUCCESS",
      message: `Colab launcher claimed fresh session ID for ${target} (${vm.accountAlias}).`,
    });

    return NextResponse.json({
      ok: true,
      target: vm.target,
      accountAlias: vm.accountAlias,
      pythonCode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to claim Colab session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

