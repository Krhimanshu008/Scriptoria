import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const slug = body.slug ? String(body.slug).trim() : "";
    const modelId = body.modelId ? String(body.modelId).trim() : "";
    const backupToGdrive = body.backupToGdrive !== false;
    const rawPrefer = String(body.preferSource || "auto");
    const preferSource =
      rawPrefer === "direct" || rawPrefer === "gdrive" ? rawPrefer : "auto";

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE") {
      return NextResponse.json({ error: `VM ${target} is not online.` }, { status: 400 });
    }

    const result = await ensureModelReadyOnVm({
      userId: user.userId,
      vm,
      slug: slug || undefined,
      modelId: modelId || undefined,
      backupToGdrive,
      preferSource,
    });

    return NextResponse.json({
      ...result,
      jobid: result.rcloneJobId ?? null,
      transport: result.transport === "rclone" ? "rclone-gdrive" : result.transport,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ensure model on VM";
    const status = message.includes("not found") ? 404 : message.includes("not online") || message.includes("missing") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

