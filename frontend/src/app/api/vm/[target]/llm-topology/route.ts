import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import {
  type LlmTopologyMode,
  parseBootMetadata,
  sanitizeVmForClient,
  sortVmsByCanonicalTarget,
} from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

const VALID_LLM_TOPOLOGIES = new Set<LlmTopologyMode>([
  "llm_layer_split",
  "llm_dual_replica",
  "llm_ab_arena",
  "llm_swarm_multi",
]);

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
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "").trim() as LlmTopologyMode;

    if (!VALID_LLM_TOPOLOGIES.has(mode)) {
      return NextResponse.json(
        {
          error: `Invalid LLM topology '${mode}'. Allowed: llm_layer_split, llm_dual_replica, llm_ab_arena, llm_swarm_multi.`,
        },
        { status: 400 }
      );
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    const groupVms = await prisma.vmInstance.findMany({
      where: { userId: user.userId, provider: vm.provider, sessionGroup: vm.sessionGroup },
    });
    const peers = groupVms.length > 0 ? groupVms : [vm];

    for (const peer of peers) {
      const existingMeta = parseBootMetadata(peer.bootMetadataJson) || {};
      await prisma.vmInstance.update({
        where: { id: peer.id },
        data: {
          bootMetadataJson: JSON.stringify({
            ...existingMeta,
            requestedLlmTopology: mode,
          }),
        },
      });
    }

    let dispatchedVia: "direct" | "heartbeat" = "heartbeat";
    if (vm.status === "ONLINE" && vm.publicUrl) {
      try {
        await VmGateway.callJson(vm, "/v1/llm/switch-topology", {
          method: "POST",
          targetPort: 8188,
          timeoutMs: 12000,
          body: JSON.stringify({ mode }),
        });
        dispatchedVia = "direct";
      } catch (err) {
        console.warn("[vm/llm-topology] Direct switch fallback to heartbeat:", err);
      }
    }

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "SYSTEM",
      level: "INFO",
      message: `Requested Dual-T4 LLM topology '${mode}' for ${peers.map((p) => p.target).join("+")} (via ${dispatchedVia}).`,
    });

    const refreshed = await prisma.vmInstance.findMany({ where: { userId: user.userId } });
    return NextResponse.json({
      ok: true,
      mode,
      dispatchedVia,
      vms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to switch LLM topology";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
