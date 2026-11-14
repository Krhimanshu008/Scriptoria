import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { verifyVmRegistrationToken } from "@/lib/auth/session";
import { appendSystemLog } from "@/lib/logs/logger";

interface HeartbeatTelemetryEntry {
  ready?: boolean;
  gpuName?: string;
  vramTotalGb?: number;
  vramUsedGb?: number;
}

interface HeartbeatLogEntry {
  category?: string;
  level?: string;
  message?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = String(body.token || "");
    const payload = verifyVmRegistrationToken(token);

    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired VM registration token" }, { status: 401 });
    }

    await ensureDbSchemaReady();

    const tunnelUrl = typeof body.tunnelUrl === "string" ? body.tunnelUrl.trim().replace(/\/$/, "") : "";
    const targets: string[] = Array.isArray(body.targets) ? body.targets : payload.targets;
    const requestedStatus = typeof body.status === "string" ? body.status : "ONLINE";
    const requestedStep = typeof body.stepProgress === "number" ? body.stepProgress : 5;
    const rawTelem = (body.telemetry || {}) as Record<string, unknown>;
    const telemetry = rawTelem as Record<string, HeartbeatTelemetryEntry>;
    const logs = (Array.isArray(body.logs) ? body.logs : []) as HeartbeatLogEntry[];

    const bootMeta =
      rawTelem.stepDurations || rawTelem.currentStepElapsed || rawTelem.totalBootElapsed
        ? {
            stepDurations: rawTelem.stepDurations,
            currentStepElapsed: rawTelem.currentStepElapsed,
            totalBootElapsed: rawTelem.totalBootElapsed,
          }
        : null;

    const vms = await prisma.vmInstance.findMany({
      where: {
        userId: payload.userId,
        target: { in: targets },
      },
    });

    const now = new Date();
    const updatedTargets: string[] = [];
    for (const vm of vms) {
      // Allow runner auto-adoption: If the runner token is cryptographically valid for this user/target
      // and the runner is active (STARTING or ONLINE), adopt this runner session.
      // This seamlessly supports manual interactive runs in Kaggle or Colab notebooks without 410 session mismatch kills!
      const isRunnerActive = requestedStatus === "STARTING" || requestedStatus === "ONLINE";
      const isMismatch = Boolean(vm.vmSecret && payload.vmSecret && vm.vmSecret !== payload.vmSecret);

      // Only reject if the VM was marked OFFLINE and the runner is not actively checking in
      if (!isRunnerActive && vm.status === "OFFLINE") {
        continue;
      }

      const adoptedSecret = payload.vmSecret || vm.vmSecret;
      updatedTargets.push(vm.target);

      const tStats = telemetry[vm.target];
      const nextStatus =
        requestedStatus === "OFFLINE"
          ? "OFFLINE"
          : requestedStatus === "ERROR"
          ? "ERROR"
          : tStats?.ready && tunnelUrl
          ? "ONLINE"
          : requestedStatus === "ONLINE" && tunnelUrl
          ? "ONLINE"
          : "STARTING";

      const nextStep =
        nextStatus === "OFFLINE" || nextStatus === "ERROR"
          ? 0
          : nextStatus === "ONLINE"
          ? 5
          : requestedStep;

      await prisma.vmInstance.update({
        where: { id: vm.id },
        data: {
          publicUrl: nextStatus === "OFFLINE" ? "" : tunnelUrl || vm.publicUrl,
          status: nextStatus,
          stepProgress: nextStep,
          vmSecret: adoptedSecret,
          lastHeartbeat: now,
          onlineSince: nextStatus === "ONLINE" ? vm.onlineSince ?? now : null,
          gpuName: tStats?.gpuName ?? vm.gpuName,
          vramTotalGb: tStats?.vramTotalGb ?? vm.vramTotalGb,
          vramUsedGb: nextStatus === "OFFLINE" ? 0 : tStats?.vramUsedGb ?? vm.vramUsedGb,
          lastError: null,
          bootMetadataJson: bootMeta ? JSON.stringify(bootMeta) : vm.bootMetadataJson,
        },
      });
    }

    for (const entry of logs) {
      if (entry?.message) {
        await appendSystemLog({
          userId: payload.userId,
          vmInstanceId: vms[0]?.id ?? null,
          category: entry.category || "SYSTEM",
          level: entry.level || "INFO",
          message: entry.message,
        });
      }
    }

    if (updatedTargets.length === 0) {
      return NextResponse.json(
        { kill: true, reason: "Session cancelled or superseded" },
        { status: 410 }
      );
    }

    return NextResponse.json({ ok: true, updatedTargets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heartbeat error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

