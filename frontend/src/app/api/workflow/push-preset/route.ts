import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { getPresetById } from "@/lib/orchestrator/workflow-presets";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const presetId = body.presetId ? String(body.presetId) : null;
    const customName = body.workflowName ? String(body.workflowName) : null;
    const customGraph =
      body.customWorkflowJson && typeof body.customWorkflowJson === "object"
        ? (body.customWorkflowJson as Record<string, unknown>)
        : null;

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `GPU ${target} is not online.` }, { status: 400 });
    }

    const client = new ComfyClient(vm);
    let graphToPush: Record<string, unknown>;
    let workflowName: string;

    if (customGraph) {
      graphToPush = customGraph;
      workflowName = customName || `scriptoria_custom_${target}`;
    } else {
      const preset = getPresetById(presetId);
      if (!preset) {
        return NextResponse.json({ error: "Unknown preset or workflow JSON." }, { status: 400 });
      }
      const catalog = await client.getCatalog(target);
      const ckpts = catalog.models.checkpoints;
      const ckpt = ckpts.includes(preset.recommendedCheckpoint)
        ? preset.recommendedCheckpoint
        : ckpts[0] || preset.recommendedCheckpoint;

      graphToPush = ComfyClient.buildStandardPromptGraph({
        prompt: String(body.prompt || preset.defaultPrompt),
        negativePrompt: String(body.negativePrompt || preset.defaultNegativePrompt),
        checkpoint: String(body.checkpoint || ckpt),
        width: Number(body.width) || preset.width,
        height: Number(body.height) || preset.height,
        steps: Number(body.steps) || preset.steps,
        cfg: Number(body.cfg) || preset.cfg,
        samplerName: String(body.samplerName || preset.samplerName),
        scheduler: String(body.scheduler || preset.scheduler),
        hiresPass: preset.hiresPass,
        seed: Number(body.seed) || 424242,
        target,
      });
      workflowName = customName || `scriptoria_${preset.id}`;
    }

    const result = await client.pushWorkflowToWebUi(workflowName, graphToPush);

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "COMFYUI",
      level: "SUCCESS",
      message: `Injected workflow ${result.savedPath} directly into ${target} ComfyUI WebUI sidebar.`,
    });

    return NextResponse.json({ ok: true, target, savedPath: result.savedPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to push workflow preset";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

