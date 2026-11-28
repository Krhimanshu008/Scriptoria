import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { parseBootMetadata } from "@/lib/orchestrator/vm-helpers";
import { resolveRequestOrigin } from "@/lib/gdrive/oauth-config";

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
        workerProfile: {
          in: [
            "LLM_QWEN_VLM",
            "LLM_QWEN_TEXT_TURBO",
            "LLM_QWEN_MOE_35B",
            "LLM_QWEN_FAST_8B",
            "LLM_LIGHTWEIGHT_SWARM",
            "TPU_QWEN27B_V5E",
          ],
        },
      },
      orderBy: { lastHeartbeat: "desc" },
    });

    const onlineVm = llmVms.find((v) => v.status === "ONLINE");
    if (!onlineVm) {
      return NextResponse.json({
        online: false,
        status: llmVms[0]?.status || "OFFLINE",
        target: llmVms[0]?.target || null,
        workerProfile: llmVms[0]?.workerProfile || null,
        baseUrl: null,
        relayEndpoint: "/api/v1/chat/completions",
        apiKey: null,
      });
    }

    const meta = parseBootMetadata(onlineVm.bootMetadataJson);
    const hasPublicUrl = Boolean(onlineVm.publicUrl);
    const origin = resolveRequestOrigin(req);

    return NextResponse.json({
      online: true,
      headless: !hasPublicUrl,
      status: onlineVm.status,
      target: onlineVm.target,
      accountAlias: onlineVm.accountAlias,
      workerProfile: onlineVm.workerProfile,
      llmTopologyMode: meta?.llmTopologyMode || "llm_layer_split",
      llmEndpoints: meta?.llmEndpoints || [],
      baseUrl: hasPublicUrl
        ? `${onlineVm.publicUrl.replace(/\/$/, "")}/v1`
        : `${origin}/api/v1`,
      relayEndpoint: `${origin}/api/v1/chat/completions`,
      services:
        hasPublicUrl && onlineVm.workerProfile === "LLM_LIGHTWEIGHT_SWARM"
          ? {
              extract: `${onlineVm.publicUrl.replace(/\/$/, "")}/v1/extract`,
              tag: `${onlineVm.publicUrl.replace(/\/$/, "")}/v1/tag`,
              qc: `${onlineVm.publicUrl.replace(/\/$/, "")}/v1/qc`,
              rag: `${onlineVm.publicUrl.replace(/\/$/, "")}/v1/rag`,
            }
          : null,
      apiKey: hasPublicUrl ? onlineVm.vmSecret || "EMPTY" : "USE_YOUR_SK_SCRIPTORIA_KEY",
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
