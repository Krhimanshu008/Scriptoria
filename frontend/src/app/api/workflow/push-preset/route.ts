import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient, convertApiGraphToLiteGraph } from "@/lib/orchestrator/comfy-client";
import { parseWorkflowParamsFromBody } from "@/lib/orchestrator/workflow-presets";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const mode = body.mode === "export" ? "export" : "push";
    const parsed = parseWorkflowParamsFromBody(body);
    const customName = body.workflowName ? String(body.workflowName) : null;

    if (!parsed.customWorkflowJson && !parsed.preset && !parsed.prompt) {
      return NextResponse.json({ error: "Unknown preset or empty workflow." }, { status: 400 });
    }

    const fallbackCkpt =
      parsed.requestedCheckpoint ||
      parsed.preset?.recommendedCheckpoint ||
      "Wai_Illustrious_v16.safetensors";

    // Export-only mode works offline without needing an ONLINE GPU
    if (mode === "export") {
      const apiGraph =
        parsed.customWorkflowJson ??
        ComfyClient.buildStandardPromptGraph({
          prompt: parsed.prompt,
          negativePrompt: parsed.negativePrompt,
          checkpoint: fallbackCkpt,
          width: parsed.width,
          height: parsed.height,
          steps: parsed.steps,
          cfg: parsed.cfg,
          samplerName: parsed.samplerName,
          scheduler: parsed.scheduler,
          hiresPass: parsed.hiresPass,
          batchSize: parsed.batchSize,
          loraName: parsed.loraName || undefined,
          loraStrength: parsed.loraStrength,
          seed: parsed.seed,
          target: parsed.target,
        });

      const uiWorkflow = convertApiGraphToLiteGraph(apiGraph);
      const filename =
        (customName || (parsed.preset ? `scriptoria_${parsed.preset.id}` : `scriptoria_${parsed.target}`))
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/\.json$/i, "") + ".json";

      return NextResponse.json({ ok: true, filename, workflowUiJson: uiWorkflow, apiGraph });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target: parsed.target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `GPU ${parsed.target} is not online.` }, { status: 400 });
    }

    const client = new ComfyClient(vm);
    let checkpoint = parsed.requestedCheckpoint;
    if (!parsed.customWorkflowJson && !checkpoint) {
      const catalog = await client.getCatalog(parsed.target).catch(() => null);
      const ckpts = catalog?.models.checkpoints ?? [];
      checkpoint =
        parsed.preset && ckpts.includes(parsed.preset.recommendedCheckpoint)
          ? parsed.preset.recommendedCheckpoint
          : ckpts[0] || fallbackCkpt;
    }

    const graphToPush =
      parsed.customWorkflowJson ??
      ComfyClient.buildStandardPromptGraph({
        prompt: parsed.prompt,
        negativePrompt: parsed.negativePrompt,
        checkpoint,
        width: parsed.width,
        height: parsed.height,
        steps: parsed.steps,
        cfg: parsed.cfg,
        samplerName: parsed.samplerName,
        scheduler: parsed.scheduler,
        hiresPass: parsed.hiresPass,
        batchSize: parsed.batchSize,
        loraName: parsed.loraName || undefined,
        loraStrength: parsed.loraStrength,
        seed: parsed.seed,
        target: parsed.target,
      });

    const workflowName =
      customName ||
      (parsed.preset ? `scriptoria_${parsed.preset.id}` : `scriptoria_custom_${parsed.target}`);

    const result = await client.pushWorkflowToWebUi(workflowName, graphToPush);

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "COMFYUI",
      level: "SUCCESS",
      message: `Injected workflow ${result.savedPath} onto ${parsed.target} (${result.method}).`,
    });

    return NextResponse.json({
      ok: true,
      target: parsed.target,
      savedPath: result.savedPath,
      method: result.method,
      workflowUiJson: result.workflowUiJson,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to push workflow preset";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
