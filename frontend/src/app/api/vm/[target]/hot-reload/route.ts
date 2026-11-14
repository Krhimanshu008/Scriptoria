import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
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

    if (!vm.publicUrl) {
      return NextResponse.json({ error: "VM is not running or has no tunnel URL." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const profile = body.profile || vm.workerProfile;

    const result = await VmGateway.hotReloadWorker(vm, { profile });

    if (!result.ok) {
      return NextResponse.json({ error: result.message || "Failed to hot reload worker." }, { status: 502 });
    }

    await prisma.vmInstance.update({
      where: { id: vm.id },
      data: {
        status: "STARTING",
        stepProgress: 4,
      },
    });

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "ACTION",
      level: "SUCCESS",
      message: `Hot-reloaded worker processes on ${target} (${profile}) without terminating container.`,
    });

    return NextResponse.json({
      ok: true,
      status: "RESTARTING",
      target,
      profile,
      message: "Worker processes hot-reloaded successfully in-place.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
