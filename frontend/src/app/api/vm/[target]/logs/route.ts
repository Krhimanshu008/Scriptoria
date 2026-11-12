import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";

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

    if (!vm) {
      return NextResponse.json({ error: `VM ${target} not found.` }, { status: 404 });
    }

    let containerLogs: Array<{ category: string; level: string; message: string }> = [];
    if (vm.publicUrl && vm.status !== "OFFLINE") {
      try {
        const res = await VmGateway.callJson<{
          logs?: Array<{ category: string; level: string; message: string }>;
        }>(vm, "/logs", {
          method: "GET",
          targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
          timeoutMs: 5000,
        });
        containerLogs = res.logs ?? [];
      } catch {
        // Container may still be starting or closed; fall back to DB logs
      }
    }

    const dbLogs = await prisma.systemLog.findMany({
      where: { userId: user.userId, vmInstanceId: vm.id },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    return NextResponse.json({
      target,
      containerLogs,
      dbLogs: dbLogs.reverse(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch VM logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

