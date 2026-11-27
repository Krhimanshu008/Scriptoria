import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import {
  DualT4TopologyMode,
  parseBootMetadata,
  sanitizeVmForClient,
  sortVmsByCanonicalTarget,
} from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

const VALID_TOPOLOGIES = new Set<DualT4TopologyMode>([
  "dual_parallel",
  "dual_pipeline",
  "dual_split",
  "copilot_split",
  "single",
]);

function nextProfileForTopology(currentProfile: string, mode: DualT4TopologyMode): string {
  if (mode === "dual_split") {
    return "IMAGE_DIT_DUAL_T4";
  }
  if (currentProfile === "IMAGE_DIT_DUAL_T4" || currentProfile === "BASE_COMFY") {
    return "IMAGE_CORE";
  }
  return currentProfile;
}

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
    const mode = String(body.mode || "").trim() as DualT4TopologyMode;

    if (!VALID_TOPOLOGIES.has(mode)) {
      return NextResponse.json(
        { error: `Invalid topology mode '${mode}'. Allowed: dual_parallel, dual_pipeline, dual_split, copilot_split, single.` },
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
      where: {
        userId: user.userId,
        provider: vm.provider,
        sessionGroup: vm.sessionGroup,
      },
    });
    const peers = groupVms.length > 0 ? groupVms : [vm];

    // Queue requestedTopologyMode across all GPUs in the same pod/notebook group
    for (const peer of peers) {
      const existingMeta = parseBootMetadata(peer.bootMetadataJson) || {};
      const nextMeta = {
        ...existingMeta,
        requestedTopologyMode: mode,
      };
      const nextProfile = nextProfileForTopology(peer.workerProfile, mode);
      await prisma.vmInstance.update({
        where: { id: peer.id },
        data: {
          workerProfile: nextProfile,
          bootMetadataJson: JSON.stringify(nextMeta),
        },
      });
    }

    // If VM has an active tunnel + Caddy/Sidecar, push immediate switch command
    let immediateResult: Record<string, unknown> | null = null;
    if (vm.status === "ONLINE" && vm.publicUrl && vm.useRouteLess) {
      try {
        immediateResult = await VmGateway.callJson<Record<string, unknown>>(vm, "/comfy/switch-mode", {
          method: "POST",
          targetPort: 9999,
          timeoutMs: 12000,
          body: JSON.stringify({ mode }),
        });
      } catch (err) {
        // Sidecar unreachable -> heartbeat switchTopology fallback remains active
        console.warn("[vm/topology] Sidecar direct switch fallback:", err);
      }
    }

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "SYSTEM",
      level: "INFO",
      message: `Requested Dual-T4 topology '${mode}' for ${peers.map((p) => p.target).join("+")}${
        immediateResult ? " (pushed via sidecar)" : " (queued for next worker heartbeat)"
      }.`,
    });

    const refreshed = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
    });

    return NextResponse.json({
      ok: true,
      mode,
      dispatchedVia: immediateResult ? "sidecar" : "heartbeat",
      immediateResult,
      vms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to switch topology mode";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
