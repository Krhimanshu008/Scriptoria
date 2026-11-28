import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import {
  KaggleRunnerSetupError,
  prepareKagglePermanentCell,
} from "@/lib/orchestrator/kaggle-runner";

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
    if (!vm || vm.provider !== "kaggle") {
      return NextResponse.json({ error: "Kaggle target not found." }, { status: 404 });
    }

    const prepared = await prepareKagglePermanentCell({
      req,
      userId: user.userId,
      vm,
    });

    const format = req.nextUrl.searchParams.get("format");
    if (format === "python") {
      return NextResponse.json({
        target: vm.target,
        sessionGroup: vm.sessionGroup,
        pythonCode: prepared.pythonCode,
        primaryUrl: prepared.primaryUrl,
        beaconUrl: prepared.beaconUrl,
        notebookUrl: prepared.notebookUrl,
      });
    }

    return new NextResponse(JSON.stringify(prepared.notebookJson, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ipynb+json",
        "Content-Disposition": `attachment; filename="scriptoria-${vm.target}-kaggle.ipynb"`,
      },
    });
  } catch (error) {
    if (error instanceof KaggleRunnerSetupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to build Kaggle notebook";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
