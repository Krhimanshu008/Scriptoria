import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";

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

    if (!vm || !vm.publicUrl || vm.status === "OFFLINE") {
      return NextResponse.json({ error: `VM ${target} is offline.` }, { status: 400 });
    }

    if (isLlmWorkerProfile(vm.workerProfile)) {
      const isTurbo = vm.workerProfile === "LLM_QWEN_TEXT_TURBO";
      return NextResponse.json({
        target,
        totalNodesAvailable: 0,
        models: {
          checkpoints: [isTurbo ? "Qwen3.8-27B-EXL3-4.00bpw" : "Qwen3.8-27B-UD-Q4_K_M.gguf"],
          loras: [],
          vaes: [],
          controlnets: [],
          ipadapters: [],
          clip_visions: isTurbo ? [] : ["mmproj-F16.gguf"],
          upscale_models: [],
        },
      });
    }

    const catalog = await new ComfyClient(vm).getCatalog(target);
    return NextResponse.json(catalog);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch catalog";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

