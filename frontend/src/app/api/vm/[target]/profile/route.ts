import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { isValidWorkerProfile, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { sanitizeVmForClient, sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const body = await req.json();
    const workerProfile = String(body.workerProfile || "").trim();
    const applyToGroup = body.applyToGroup !== false;

    if (!isValidWorkerProfile(workerProfile)) {
      return NextResponse.json(
        { error: `Invalid workerProfile '${workerProfile}'.` },
        { status: 400 }
      );
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    if (applyToGroup) {
      await prisma.vmInstance.updateMany({
        where: { userId: user.userId, sessionGroup: vm.sessionGroup },
        data: { workerProfile },
      });
    } else {
      await prisma.vmInstance.update({
        where: { id: vm.id },
        data: { workerProfile },
      });
    }

    const profile = getWorkerProfile(workerProfile);
    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "ACTION",
      level: "INFO",
      message: `Updated ${applyToGroup ? vm.sessionGroup : target} worker profile to ${profile.label} (${workerProfile}).`,
    });

    const refreshed = await prisma.vmInstance.findMany({
      where: { userId: user.userId, sessionGroup: vm.sessionGroup },
    });

    return NextResponse.json({
      ok: true,
      workerProfile,
      groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update worker profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

