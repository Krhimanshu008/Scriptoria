import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { GDriveModelStreamer, sanitizeModelCategory } from "@/lib/orchestrator/rclone-client";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const category = sanitizeModelCategory(String(body.category || "checkpoints"));
    const name = String(body.name || "").trim();
    const force = Boolean(body.force);
    const expectedSizeBytes =
      body.expectedSizeBytes != null && Number(body.expectedSizeBytes) > 0
        ? Number(body.expectedSizeBytes)
        : undefined;

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

    // Singleflight deduplication + OOM concurrency guard (1 on Colab T4 12.7GB, 2 on Kaggle Dual T4)
    const stats = await GDriveModelStreamer.getStreamStats(vm).catch(() => null);
    const transferring = stats?.transferring || [];
    const alreadyActive = transferring.find((t) => t.name === name);
    if (alreadyActive) {
      return NextResponse.json({
        status: "already_transferring",
        file: name,
        target,
        category,
      });
    }

    const maxConcurrent = vm.provider === "colab" ? 1 : 2;
    if (transferring.length >= maxConcurrent) {
      return NextResponse.json(
        {
          error: `${vm.provider === "colab" ? "Colab T4 (12.7GB RAM)" : "Kaggle"} caps concurrent model downloads at ${maxConcurrent} to prevent OOM. Wait for ${transferring[0].name} to finish.`,
        },
        { status: 409 }
      );
    }

    // Fast SizeOnly local stat check (< 30ms) unless force=true
    if (!force) {
      const localStat = await GDriveModelStreamer.statVmModel(vm, category, name);
      if (
        localStat.exists &&
        (expectedSizeBytes === undefined || localStat.sizeBytes === expectedSizeBytes)
      ) {
        return NextResponse.json({
          status: "skipped",
          alreadyCached: true,
          sizeBytes: localStat.sizeBytes,
          file: name,
          target,
          category,
        });
      }
    }

    const res = await GDriveModelStreamer.startModelStream(
      vm,
      gdriveCred.baseFolder,
      category,
      name,
      { provider: vm.provider }
    );

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "RCLONE",
      level: "INFO",
      message: `Streaming ${name} (${category}) via HTTP/1.1 multi-thread -> /tmp/models/${category} on ${target}.`,
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
