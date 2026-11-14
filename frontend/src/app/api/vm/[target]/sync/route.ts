import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
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
          const kernelSlug = isTpu
            ? `kaggle-tpu-runner-${vm.accountAlias}`
            : `kaggle-dual-gpu-runner-${vm.accountAlias}`;
          const kStatus = await KaggleOrchestrator.getKernelStatus(
            {
              username: kaggleCred.username,
              key: kaggleCred.secret,
              authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
            },
            kernelSlug
          );
          kaggleState = kStatus.status;

          // If Kaggle says running or queued, reflect in stepProgress if starting
          if (kStatus.status === "queued" && vm.status === "STARTING") {
            await prisma.vmInstance.updateMany({
              where: { userId: user.userId, sessionGroup: vm.sessionGroup },
              data: { stepProgress: 1 },
            });
          } else if (kStatus.status === "running" && vm.status === "STARTING" && vm.stepProgress < 2) {
            await prisma.vmInstance.updateMany({
              where: { userId: user.userId, sessionGroup: vm.sessionGroup },
              data: { stepProgress: 2 },
            });
          }
        }
      } catch (e: any) {
        kaggleState = `error: ${e.message}`;
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
  }
}
