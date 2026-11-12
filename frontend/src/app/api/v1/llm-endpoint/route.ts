import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized. Provide a dashboard session or Bearer sk_scriptoria_... API key." },
        { status: 401 }
      );
    }

    const llmVms = await prisma.vmInstance.findMany({
      where: {
        userId: auth.userId,
        workerProfile: "LLM_QWEN_VLM",
      },
      orderBy: { lastHeartbeat: "desc" },
    });

    const onlineVm = llmVms.find((v) => v.status === "ONLINE" && v.publicUrl);
    if (!onlineVm) {
      return NextResponse.json({
        online: false,
        status: llmVms[0]?.status || "OFFLINE",
        target: llmVms[0]?.target || null,
        baseUrl: null,
        apiKey: null,
      });
    }

    return NextResponse.json({
      online: true,
      status: onlineVm.status,
      target: onlineVm.target,
      accountAlias: onlineVm.accountAlias,
      baseUrl: `${onlineVm.publicUrl.replace(/\/$/, "")}/v1`,
      apiKey: onlineVm.vmSecret || "EMPTY",
      gpuName: onlineVm.gpuName,
      vramTotalGb: onlineVm.vramTotalGb,
      vramUsedGb: onlineVm.vramUsedGb,
      lastHeartbeat: onlineVm.lastHeartbeat?.toISOString() || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query LLM endpoint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

