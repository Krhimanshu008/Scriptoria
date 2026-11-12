import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, signVmRegistrationToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  buildColabLauncherNotebookJson,
  buildColabNotebookJson,
  buildColabSelfUpdatingLauncherCode,
  buildUnifiedNotebookPythonCode,
} from "@/lib/orchestrator/notebook-builder";
import { getOrCreateColabRunnerToken } from "@/lib/orchestrator/colab-runner";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";

export async function GET(
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

    if (!vm || vm.provider !== "colab") {
      return NextResponse.json({ error: "Colab target not found." }, { status: 404 });
    }

    const format = req.nextUrl.searchParams.get("format");
    const standalone = req.nextUrl.searchParams.get("standalone") === "true";
    const webhook = await resolveReachableWebhookBaseUrl(req);
    if (webhook.mode === "unreachable") {
      return NextResponse.json(
        { error: webhook.reason || "No reachable public callback URL for Colab notebook." },
        { status: 400 }
      );
    }
    const appWebhookUrl = webhook.url;

    // Default: thin self-renewing launcher cell (re-usable forever, no stale 410 errors!)
    if (!standalone) {
      const runnerToken = await getOrCreateColabRunnerToken(user.userId, vm.target);
      const launcherCfg = { appWebhookUrl, target: vm.target, runnerToken };

      if (format === "python") {
        const pythonCode = buildColabSelfUpdatingLauncherCode(launcherCfg);
        return NextResponse.json({ target, pythonCode });
      }

      const nb = buildColabLauncherNotebookJson(launcherCfg);
      return new NextResponse(JSON.stringify(nb, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/x-ipynb+json",
          "Content-Disposition": `attachment; filename="scriptoria-${target}-runner.ipynb"`,
        },
      });
    }

    // Legacy standalone mode (only if explicitly requested with ?standalone=true)
    const gdriveCred = await getUserGDriveCredential(user.userId);
    if (!gdriveCred) {
      return NextResponse.json(
        { error: "Configure Google Drive in Settings Vault before generating a Colab notebook." },
        { status: 400 }
      );
    }

    const vmSecret = vm.vmSecret || generateVmSecret();
    if (!vm.vmSecret) {
      await prisma.vmInstance.update({
        where: { id: vm.id },
        data: { vmSecret, status: "STARTING", stepProgress: 1 },
      });
    }

    const registrationJwt = signVmRegistrationToken({
      userId: user.userId,
      sessionGroup: vm.sessionGroup,
      targets: [vm.target],
      vmSecret,
    });

    const buildCfg = {
      provider: "colab" as const,
      appWebhookUrl,
      registrationJwt,
      vmSecret,
      gdriveTokenJson: gdriveCred.rawTokenJson,
      gdriveBaseFolder: gdriveCred.baseFolder,
      gpuTargets: [vm.target],
      accountAlias: vm.accountAlias,
    };

    if (format === "python") {
      const pythonCode = buildUnifiedNotebookPythonCode(buildCfg);
      return NextResponse.json({ target, pythonCode });
    }

    const nb = buildColabNotebookJson(buildCfg);
    return new NextResponse(JSON.stringify(nb, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ipynb+json",
        "Content-Disposition": `attachment; filename="scriptoria-${target}-runner.ipynb"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notebook generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
