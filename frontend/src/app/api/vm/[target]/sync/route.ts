import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { kaggleCustomKernelSlug } from "@/lib/orchestrator/kaggle-connection";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import {
  getKaggleKernelSlug,
  markBootMetadataOffline,
  parseBootMetadata,
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

    let tunnelAlive = false;
    let kaggleState = "unknown";

    // 1. Probe active tunnel if publicUrl is registered
    if (vm.publicUrl) {
      try {
        const health = await VmGateway.callJson<{ status: string }>(
          vm,
          "/health",
          { targetPort: 9999, timeoutMs: 3000 }
        );
        if (health && health.status === "ok") {
          tunnelAlive = true;
          if (vm.status !== "ONLINE") {
            await prisma.vmInstance.updateMany({
              where: { userId: user.userId, sessionGroup: vm.sessionGroup },
              data: {
                status: "ONLINE",
                stepProgress: 5,
                lastHeartbeat: new Date(),
              },
            });
            await appendSystemLog({
              userId: user.userId,
              vmInstanceId: vm.id,
              category: "ACTION",
              level: "SUCCESS",
              message: `Synced status: Verified live VM tunnel at ${vm.publicUrl}`,
            });
          }
        }
      } catch {
        tunnelAlive = false;
      }
    }

    // 2. Query Kaggle API for cloud runner status
    if (vm.provider === "kaggle") {
      try {
        const kaggleCred = await getDecryptedCredential(user.userId, "kaggle", vm.accountAlias);
        if (kaggleCred && kaggleCred.username) {
          const isTpu = vm.target.startsWith("tpu");
          const customSlug = kaggleCustomKernelSlug(kaggleCred.metadata, isTpu);
          const kernelSlug = getKaggleKernelSlug(vm.accountAlias, isTpu, customSlug);
          const kStatus = await KaggleOrchestrator.getKernelStatus(
            {
              username: kaggleCred.username,
              key: kaggleCred.secret,
              authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
            },
            kernelSlug
          );
          kaggleState = kStatus.status;
          const normStatus = String(kStatus.status || "").toLowerCase();
          const bootMeta = parseBootMetadata(vm.bootMetadataJson);
          const lastBeatMs = vm.lastHeartbeat ? vm.lastHeartbeat.getTime() : 0;
          const heartbeatStale = Date.now() - lastBeatMs > 240_000;

          if (normStatus === "queued") {
            await prisma.vmInstance.updateMany({
              where: { userId: user.userId, sessionGroup: vm.sessionGroup },
              data: {
                ...(vm.status === "OFFLINE" ? { status: "STARTING" } : {}),
                stepProgress: Math.max(1, vm.stepProgress),
              },
            });
          } else if (normStatus === "running") {
            if (!tunnelAlive && (vm.status === "ONLINE" || vm.status === "BUSY") && !vm.publicUrl && heartbeatStale) {
              const groupRows = await prisma.vmInstance.findMany({
                where: { userId: user.userId, sessionGroup: vm.sessionGroup },
              });
              for (const row of groupRows) {
                await prisma.vmInstance.update({
                  where: { id: row.id },
                  data: {
                    status: "OFFLINE",
                    stepProgress: 0,
                    vramUsedGb: 0,
                    latencyMs: null,
                    onlineSince: null,
                    publicUrl: "",
                    vmSecret: null,
                    bootMetadataJson: markBootMetadataOffline(row.bootMetadataJson),
                    lastError: "Worker heartbeat stopped (>4m) even though Kaggle runner has not exited yet.",
                  },
                });
              }
            } else {
              await prisma.vmInstance.updateMany({
                where: { userId: user.userId, sessionGroup: vm.sessionGroup },
                data: {
                  ...(vm.status === "OFFLINE"
                    ? {
                        status: "STARTING",
                        lastError: `Kaggle reports '${kernelSlug}' is running (awaiting worker heartbeat).`,
                      }
                    : {}),
                  stepProgress: Math.max(2, vm.stepProgress),
                },
              });
            }
          } else if (
            !tunnelAlive &&
            (normStatus === "cancelacknowledged" || normStatus === "complete" || normStatus === "error") &&
            vm.status !== "OFFLINE" &&
            (!bootMeta?.draftMode || heartbeatStale)
          ) {
            const nextStatus = vm.status === "STARTING" && normStatus === "error" ? "ERROR" : "OFFLINE";
            const groupRows = await prisma.vmInstance.findMany({
              where: { userId: user.userId, sessionGroup: vm.sessionGroup },
            });
            for (const row of groupRows) {
              await prisma.vmInstance.update({
                where: { id: row.id },
                data: {
                  status: nextStatus,
                  stepProgress: 0,
                  vramUsedGb: 0,
                  latencyMs: null,
                  onlineSince: null,
                  publicUrl: "",
                  vmSecret: null,
                  bootMetadataJson: markBootMetadataOffline(row.bootMetadataJson),
                  lastError:
                    nextStatus === "ERROR"
                      ? kStatus.failureMessage || "Kaggle kernel errored."
                      : null,
                },
              });
            }
            await appendSystemLog({
              userId: user.userId,
              vmInstanceId: vm.id,
              category: "ACTION",
              level: nextStatus === "ERROR" ? "ERROR" : "WARN",
              message: `Synced '${target}': Kaggle reported '${kStatus.status}' -> marked ${vm.sessionGroup} ${nextStatus}.`,
            });
          }
        }
      } catch (e: unknown) {
        kaggleState = `error: ${e instanceof Error ? e.message : "unknown"}`;
      }
    }

    const updatedVm = await prisma.vmInstance.findUnique({
      where: { id: vm.id },
    });

    return NextResponse.json({
      ok: true,
      target,
      status: updatedVm?.status,
      stepProgress: updatedVm?.stepProgress,
      publicUrl: updatedVm?.publicUrl,
      tunnelAlive,
      kaggleState,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
