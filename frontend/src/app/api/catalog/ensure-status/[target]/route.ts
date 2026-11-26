import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { fetchSessionKey } from "@/lib/catalog/worker-model";
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
    const fetchJobId = req.nextUrl.searchParams.get("fetchJobId");
    if (!fetchJobId) {
      return NextResponse.json({ error: "fetchJobId is required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (vm && fetchJobId.startsWith("worker-")) {
      const job = await prisma.modelFetch.findFirst({ where: { id: fetchJobId.slice(7), vmId: vm.id } });
      if (!job) return NextResponse.json({ error: "Unknown model download." }, { status: 404 });
      const progress = JSON.parse(job.progressJson || "{}");
      const ended = !vm.vmSecret || job.sessionKey !== fetchSessionKey(vm.vmSecret) || vm.status === "OFFLINE"
        || !vm.lastHeartbeat || Date.now() - vm.lastHeartbeat.getTime() > 120_000;
      const completed = job.status === "completed";
      const failed = job.status === "failed" || (!completed && ended);
      return NextResponse.json({ ...progress, status: failed ? "failed" : job.status, completed, failed,
        active: !completed && !failed, error: progress.error || (failed ? "Worker session ended." : null) });
    }
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ status: "offline", active: false, completed: false });
    }

    const st = await VmGateway.callJson<{
      jobId: string;
      status: string;
      filename: string;
      bytesDone: number;
      totalBytes: number;
      percentage: number;
      speedMbps: number;
      etaSeconds: number | null;
      backupStatus?: string;
      error?: string | null;
    }>(vm, `/fetch-status?jobId=${encodeURIComponent(fetchJobId)}`, {
      method: "GET",
      targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
      timeoutMs: 5000,
    });

    const active = st.status === "queued" || st.status === "downloading";
    return NextResponse.json({
      ...st,
      active,
      completed: st.status === "completed",
      failed: st.status === "failed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query fetch status";
    return NextResponse.json({ status: "error", error: message }, { status: 502 });
  }
}

