import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyVmClaimToken } from "@/lib/auth/session";
import { generateVmSecret } from "@/lib/crypto/vault";
import {
  assembleWorkerRuntimePayload,
  WorkerPayloadError,
} from "@/lib/orchestrator/worker-payload";
import { KAGGLE_RUNNER_PROVIDER } from "@/lib/orchestrator/notebook-builder";
import { parseRunnerTokenUserId, verifyRunnerToken } from "@/lib/orchestrator/runner-token";
import { markBootMetadataOffline, parseBootMetadata } from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const target = String(body.target || "").trim();
    const claimToken = String(body.claimToken || "").trim();
    const runnerToken = String(body.runnerToken || "").trim();

    if (!target || (!claimToken && !runnerToken)) {
      return NextResponse.json(
        { error: "target and either claimToken or runnerToken are required." },
        { status: 400 }
      );
    }

    // Mode A: Permanent Interactive Runner Auto-Adopt (long-lived per-VM key)
    if (runnerToken) {
      const parsedUserId = parseRunnerTokenUserId(runnerToken);
      if (!parsedUserId) {
        return NextResponse.json(
          { error: "Invalid Kaggle permanent runner token format." },
          { status: 401 }
        );
      }

      const vm = await prisma.vmInstance.findUnique({
        where: { userId_target: { userId: parsedUserId, target } },
      });
      if (!vm || vm.provider !== "kaggle") {
        return NextResponse.json(
          { error: `Kaggle slot '${target}' not found.` },
          { status: 404 }
        );
      }

      const verifiedRunner = await verifyRunnerToken(
        KAGGLE_RUNNER_PROVIDER,
        vm.sessionGroup,
        runnerToken
      );
      if (!verifiedRunner || verifiedRunner.userId !== vm.userId) {
        return NextResponse.json(
          { error: "Kaggle permanent runner token was rotated or revoked. Copy a fresh Permanent Cell from Scriptoria." },
          { status: 401 }
        );
      }

      const groupVms = await prisma.vmInstance.findMany({
        where: { userId: vm.userId, sessionGroup: vm.sessionGroup },
      });
      const runtimeVmSecret = generateVmSecret();
      const armedAt = Date.now();

      await Promise.all(
        groupVms.map((row) => {
          const cleanMeta = parseBootMetadata(markBootMetadataOffline(row.bootMetadataJson)) || {};
          return prisma.vmInstance.update({
            where: { id: row.id },
            data: {
              status: "STARTING",
              stepProgress: 2,
              vmSecret: runtimeVmSecret,
              publicUrl: "",
              vramUsedGb: 0,
              latencyMs: null,
              onlineSince: null,
              lastHeartbeat: new Date(),
              lastError: null,
              bootMetadataJson: JSON.stringify({
                ...cleanMeta,
                draftMode: true,
                draftArmedAt: armedAt,
              }),
            },
          });
        })
      );

      const assembled = await assembleWorkerRuntimePayload({
        userId: vm.userId,
        vm,
        groupVms,
        req,
        runtimeVmSecret,
        workerMode: "headless_safe",
      });

      await appendSystemLog({
        userId: vm.userId,
        vmInstanceId: vm.id,
        category: "KAGGLE",
        level: "SUCCESS",
        message: `Kaggle Interactive runner '${vm.target}' (${vm.accountAlias} / ${assembled.groupTargets.join("+")}) connected cleanly via permanent key.`,
      });

      return NextResponse.json({
        ok: true,
        target: vm.target,
        accountAlias: vm.accountAlias,
        pythonCode: assembled.pythonCode,
      });
    }

    // Mode B: Legacy Batch SaveKernel single-use claim token
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

    // Clear Interactive draftMode marker now that a live container has claimed the session
    const prevMeta = parseBootMetadata(vm.bootMetadataJson);
    if (prevMeta?.draftMode) {
      await prisma.vmInstance.updateMany({
        where: { userId: verified.userId, sessionGroup: verified.sessionGroup },
        data: {
          bootMetadataJson: JSON.stringify({ ...prevMeta, draftMode: false }),
        },
      });
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
