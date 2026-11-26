import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateVmSecret } from "@/lib/crypto/vault";
import { verifyColabRunnerToken } from "@/lib/orchestrator/colab-runner";
import {
  assembleWorkerRuntimePayload,
  WorkerPayloadError,
} from "@/lib/orchestrator/worker-payload";
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

    const groupVms = await prisma.vmInstance.findMany({
      where: { userId: verified.userId, sessionGroup: vm.sessionGroup },
    });

    const vmSecret = generateVmSecret();
    const assembled = await assembleWorkerRuntimePayload({
      userId: verified.userId,
      vm,
      groupVms,
      req,
      runtimeVmSecret: vmSecret,
      workerMode: "interactive_tunnel",
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
      pythonCode: assembled.pythonCode,
    });
  } catch (error) {
    if (error instanceof WorkerPayloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to claim Colab session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

