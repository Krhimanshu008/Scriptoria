import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyVmClaimToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import {
  assembleWorkerRuntimePayload,
  WorkerPayloadError,
} from "@/lib/orchestrator/worker-payload";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const target = String(body.target || "").trim();
    const claimToken = String(body.claimToken || "").trim();

    if (!target || !claimToken) {
      return NextResponse.json(
        { error: "target and claimToken are required." },
        { status: 400 }
      );
    }

    const verified = verifyVmClaimToken(claimToken);
    if (!verified || !verified.targets.includes(target)) {
      return NextResponse.json(
        { error: "Invalid or expired Kaggle session claim token." },
        { status: 401 }
      );
    }

    // Single-use atomic claim: only succeeds if slot group is still STARTING with matching claimSecret
    const runtimeVmSecret = generateVmSecret();
    const claimRes = await prisma.vmInstance.updateMany({
      where: {
        userId: verified.userId,
        sessionGroup: verified.sessionGroup,
        status: "STARTING",
        vmSecret: verified.claimSecret,
      },
      data: {
        vmSecret: runtimeVmSecret,
        stepProgress: 2,
        lastHeartbeat: new Date(),
        lastError: null,
      },
    });

    if (claimRes.count === 0) {
      return NextResponse.json(
        { error: "Session already claimed, cancelled, or superseded." },
        { status: 410 }
      );
    }

    const groupVms = await prisma.vmInstance.findMany({
      where: { userId: verified.userId, sessionGroup: verified.sessionGroup },
    });
    const vm = groupVms.find((v) => v.target === target) || groupVms[0];
    if (!vm || vm.provider !== "kaggle") {
      return NextResponse.json(
        { error: `Kaggle slot '${target}' not found.` },
        { status: 404 }
      );
    }

    const assembled = await assembleWorkerRuntimePayload({
      userId: verified.userId,
      vm,
      groupVms,
      req,
      runtimeVmSecret,
      workerMode: verified.workerMode || "headless_safe",
      customDatasets: verified.customDatasets || [],
    });

    await appendSystemLog({
      userId: verified.userId,
      vmInstanceId: vm.id,
      category: "KAGGLE",
      level: "SUCCESS",
      message: `Kaggle VM (${vm.accountAlias} / ${assembled.groupTargets.join("+")}) claimed runtime script in RAM (${verified.workerMode || "headless_safe"}).`,
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
    const message = error instanceof Error ? error.message : "Failed to claim Kaggle session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
