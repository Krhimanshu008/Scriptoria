import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { GDriveModelStreamer } from "@/lib/orchestrator/rclone-client";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const category = String(body.category || "checkpoints");
    const name = String(body.name || "").trim();

    if (!name) {
      return NextResponse.json({ error: "Model filename is required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `VM ${target} is not online.` }, { status: 400 });
    }

    const gdriveCred = await getUserGDriveCredential(user.userId);
    if (!gdriveCred) {
      return NextResponse.json({ error: "Missing Google Drive credential." }, { status: 400 });
    }

    const res = await GDriveModelStreamer.startModelStream(
      vm,
      gdriveCred.baseFolder,
      category,
      name
    );

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "RCLONE",
      level: "INFO",
      message: `Streaming ${name} (${category}) from GDrive -> /tmp/models/${category} on ${target}.`,
    });

    return NextResponse.json({
      status: "started",
      jobid: res.jobid ?? null,
      file: name,
      target,
      category,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start model stream";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

