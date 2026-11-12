import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { GDriveModelStreamer } from "@/lib/orchestrator/rclone-client";

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
    const jobIdParam = req.nextUrl.searchParams.get("jobId");
    const fileParam = req.nextUrl.searchParams.get("file");

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({
        status: "offline",
        active: false,
        completed: false,
        transferring: [],
      });
    }

    const jobIdNum = jobIdParam ? Number(jobIdParam) : NaN;
    const [stats, jobStatus] = await Promise.all([
      GDriveModelStreamer.getStreamStats(vm),
      !Number.isNaN(jobIdNum) && jobIdNum > 0
        ? GDriveModelStreamer.getJobStatus(vm, jobIdNum)
        : Promise.resolve(null),
    ]);

    const transferring = stats.transferring || [];
    const activeItem =
      (fileParam ? transferring.find((t) => t.name === fileParam) : null) || transferring[0] || null;

    if (activeItem) {
      const totalBytes = activeItem.size || 0;
      const bytesDone = activeItem.bytes || 0;
      const pct =
        typeof activeItem.percentage === "number" && activeItem.percentage > 0
          ? activeItem.percentage
          : totalBytes > 0
          ? Math.min(99, Math.round((bytesDone / totalBytes) * 100))
          : 0;
      const rawSpeed = activeItem.speed || activeItem.speedAvg || stats.speed || 0;
      const speedMbps = Number((rawSpeed / 1024 ** 2).toFixed(1));
      const etaSeconds =
        activeItem.eta != null
          ? activeItem.eta
          : rawSpeed > 0 && totalBytes > bytesDone
          ? Math.max(1, Math.round((totalBytes - bytesDone) / rawSpeed))
          : null;

      return NextResponse.json({
        status: "transferring",
        active: true,
        completed: false,
        failed: false,
        filename: activeItem.name,
        bytesDone,
        totalBytes,
        percentage: pct,
        speedMbps,
        etaSeconds,
        transferring,
      });
    }

    if (jobStatus?.finished) {
      return NextResponse.json({
        status: jobStatus.success ? "completed" : "failed",
        active: false,
        completed: Boolean(jobStatus.success),
        failed: !jobStatus.success,
        error: jobStatus.error || null,
        filename: fileParam || null,
        percentage: jobStatus.success ? 100 : 0,
        speedMbps: 0,
        etaSeconds: 0,
        bytes: stats.bytes ?? 0,
        transferring: [],
      });
    }

    // Fallback completion heuristic if jobId was omitted on an older client call
    const completedHeuristic = !jobIdParam && (stats.bytes ?? 0) > 0 && transferring.length === 0;
    return NextResponse.json({
      status: completedHeuristic ? "completed" : "idle",
      active: false,
      completed: completedHeuristic,
      failed: false,
      percentage: completedHeuristic ? 100 : 0,
      speedMbps: 0,
      etaSeconds: null,
      bytes: stats.bytes ?? 0,
      transferring: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query Rclone stats";
    return NextResponse.json({ status: "error", error: message, transferring: [] }, { status: 502 });
  }
}
