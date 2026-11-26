import { prisma } from "@/lib/db/prisma";
import type { VmInstance } from "@prisma/client";

export interface HeadlessStudioEnqueueInput {
  userId: string;
  vm: VmInstance;
  title?: string;
  prompt: string;
  negativePrompt?: string | null;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: string;
  workerProfile?: string;
  requiredModels?: Array<{ category: string; filename: string; slug?: string }>;
  graph: Record<string, unknown>;
}

/**
 * Enqueues a single-task BatchJob linked to a Job row so headless Kaggle VMs
 * (without inbound Cloudflare/Caddy proxies) can claim and complete Studio runs safely.
 */
export async function enqueueHeadlessBatchJobForStudio(
  input: HeadlessStudioEnqueueInput
): Promise<{ jobId: string; batchId: string; taskId: string }> {
  const job = await prisma.job.create({
    data: {
      userId: input.userId,
      vmInstanceId: input.vm.id,
      target: input.vm.target,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      checkpoint: input.checkpoint,
      width: input.width,
      height: input.height,
      steps: input.steps,
      cfg: input.cfg,
      seed: input.seed,
      status: "PROCESSING",
    },
  });

  const batch = await prisma.batchJob.create({
    data: {
      userId: input.userId,
      title: input.title || `Studio Safe Run (${input.vm.target.toUpperCase()})`,
      sourceApp: "studio-headless",
      status: "QUEUED",
      totalTasks: 1,
    },
  });

  const task = await prisma.batchTask.create({
    data: {
      batchId: batch.id,
      sequenceIndex: 0,
      sceneKey: "scene-1",
      trackType: "VISUAL",
      workerProfile: input.workerProfile || input.vm.workerProfile || "IMAGE_CORE",
      baseCheckpoint: input.checkpoint,
      requiredModelsJson: input.requiredModels ? JSON.stringify(input.requiredModels) : null,
      compiledGraphJson: JSON.stringify(input.graph),
      inputParamsJson: JSON.stringify({
        studioJobId: job.id,
        preferredTarget: input.vm.target,
      }),
      jobId: job.id,
      status: "PENDING",
    },
  });

  return { jobId: job.id, batchId: batch.id, taskId: task.id };
}
