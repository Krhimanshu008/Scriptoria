import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { KAGGLE_RUNNER_PROVIDER } from "@/lib/orchestrator/notebook-builder";
import { getOrCreateRunnerToken } from "@/lib/orchestrator/runner-token";
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
    if (!vm || vm.provider !== "kaggle") {
      return NextResponse.json({ error: "Kaggle target not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "rotate_key") {
      await getOrCreateRunnerToken(KAGGLE_RUNNER_PROVIDER, user.userId, vm.sessionGroup, true);
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "KAGGLE",
        level: "WARN",
        message: `Rotated permanent Kaggle runner key for ${vm.accountAlias} (${vm.sessionGroup}); previous Kaggle cells invalidated.`,
      });
      return NextResponse.json({ ok: true, action, sessionGroup: vm.sessionGroup });
    }

    return NextResponse.json({ error: "Unsupported config action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update Kaggle config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
