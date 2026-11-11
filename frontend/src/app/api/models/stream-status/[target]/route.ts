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
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ status: "offline", transferring: [] });
    }

    const stats = await GDriveModelStreamer.getStreamStats(vm);
    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query Rclone stats";
    return NextResponse.json({ status: "error", error: message, transferring: [] }, { status: 502 });
  }
}

