import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { compileResourceAwareWorkflow, type WorkflowBuildSpec } from "@/lib/workflow/compiler";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { appendSystemLog } from "@/lib/logs/logger";
import type { ScriptoriaSceneSpecV1, BatchTrackKind } from "@/lib/batch/ingestion-spec";
import type { VmInstance, BatchTask } from "@prisma/client";

export interface GpuAffinityScore {
  target: string;
  provider: string;
  workerProfile: string;
  score: number;
  reasons: string[];
}

export interface BatchCoalesceSummary {
  totalTasks: number;
  coalescedGroups: Array<{
    workerProfile: string;
    baseCheckpoint: string;
    taskCount: number;
  }>;
  estimatedSavingsNote: string;
}

/**
 * Expands a normalized `ScriptoriaSceneSpec v1` into coalesced DAG-ordered BatchTask records
 * grouped by `(workerProfile, baseCheckpoint)` to minimize GPU model swaps.
 */
export async function createBatchFromSpec(params: {
  userId: string;
  spec: ScriptoriaSceneSpecV1;
  dryRun?: boolean;
}): Promise<{
  batchId?: string;
  reusedExisting?: boolean;
  coalesceSummary: BatchCoalesceSummary;
  plannedTasks: Array<{
    sceneKey: string;
    trackType: BatchTrackKind;
    workerProfile: string;
    baseCheckpoint: string;
    dependsOn: string[];
    vramEstimateGb: number;
  }>;
}> {
  const { userId, spec, dryRun = false } = params;
  await ensureDbSchemaReady();

  if (!dryRun && spec.idempotencyKey) {
    const existing = await prisma.batchJob.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: spec.idempotencyKey } },
      include: { tasks: { orderBy: { sequenceIndex: "asc" } } },
    });
    if (existing) {
      return {
        batchId: existing.id,
        reusedExisting: true,
        coalesceSummary: existing.strategyJson
          ? (JSON.parse(existing.strategyJson) as BatchCoalesceSummary)
          : { totalTasks: existing.totalTasks, coalescedGroups: [], estimatedSavingsNote: "Reused existing idempotent batch." },
        plannedTasks: existing.tasks.map((t) => ({
          sceneKey: t.sceneKey,
          trackType: t.trackType as BatchTrackKind,
          workerProfile: t.workerProfile,
          baseCheckpoint: t.baseCheckpoint,
          dependsOn: [],
          vramEstimateGb: 7.5,
        })),
      };
    }
  }

  interface DraftTask {
    tempKey: string;
    sceneKey: string;
    trackType: BatchTrackKind;
    dependsOnTempKeys: string[];
    spec: WorkflowBuildSpec;
    workerProfile: string;
    baseCheckpoint: string;
    requiredModels: Array<{ category: string; filename: string; slug?: string }>;
    compiledGraph: Record<string, unknown>;
    vramEstimateGb: number;
  }

  const drafts: DraftTask[] = [];

  for (const scene of spec.scenes) {
    const visualKey = `${scene.sceneKey}::VISUAL`;
    const ttsKey = `${scene.sceneKey}::AUDIO_TTS`;

    if (scene.tracks.visual) {
      const vSpec: WorkflowBuildSpec = {
        pipeline: scene.tracks.visual.pipeline || "sdxl_txt2img",
        baseModel: scene.tracks.visual.baseModel || spec.defaults?.baseModel || "waiNSFWIllustrious_v110.safetensors",
        loras: scene.tracks.visual.loras,
        prompt: scene.tracks.visual.prompt,
        negativePrompt: scene.tracks.visual.negativePrompt,
        width: scene.tracks.visual.width || spec.defaults?.width || 1024,
        height: scene.tracks.visual.height || spec.defaults?.height || 1024,
        steps: scene.tracks.visual.steps,
        cfg: scene.tracks.visual.cfg,
      };
      const compiled = await compileResourceAwareWorkflow(userId, vSpec);
      drafts.push({
        tempKey: visualKey,
        sceneKey: scene.sceneKey,
        trackType: "VISUAL",
        dependsOnTempKeys: [],
        spec: vSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: vSpec.baseModel || "",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }

    if (scene.tracks.audio_tts) {
      const aSpec: WorkflowBuildSpec = {
        pipeline: scene.tracks.audio_tts.pipeline || "audio_kokoro",
        dialogueText: scene.tracks.audio_tts.text,
        voice: scene.tracks.audio_tts.voice || "af_heart",
        speed: scene.tracks.audio_tts.speed,
        refAudioPath: scene.tracks.audio_tts.refAudioPath,
      };
      const compiled = await compileResourceAwareWorkflow(userId, aSpec);
      drafts.push({
        tempKey: ttsKey,
        sceneKey: scene.sceneKey,
        trackType: "AUDIO_TTS",
        dependsOnTempKeys: [],
        spec: aSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: "kokoro-v1.0.onnx",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }

    if (scene.tracks.audio_sfx) {
      const sSpec: WorkflowBuildSpec = {
        pipeline: "audio_mmaudio",
        sfxPrompt: scene.tracks.audio_sfx.prompt,
        durationSec: scene.tracks.audio_sfx.durationSec || 8,
      };
      const compiled = await compileResourceAwareWorkflow(userId, sSpec);
      drafts.push({
        tempKey: `${scene.sceneKey}::AUDIO_SFX`,
        sceneKey: scene.sceneKey,
        trackType: "AUDIO_SFX",
        dependsOnTempKeys: [],
        spec: sSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: "mmaudio_small_16k_v2.safetensors",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }

    if (scene.tracks.audio_bgm) {
      const bSpec: WorkflowBuildSpec = {
        pipeline: "audio_stable",
        bgmMood: scene.tracks.audio_bgm.mood,
        durationSec: scene.tracks.audio_bgm.durationSec || 30,
      };
      const compiled = await compileResourceAwareWorkflow(userId, bSpec);
      drafts.push({
        tempKey: `${scene.sceneKey}::AUDIO_BGM`,
        sceneKey: scene.sceneKey,
        trackType: "AUDIO_BGM",
        dependsOnTempKeys: [],
        spec: bSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: "stable-audio-open-small.safetensors",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }

    if (scene.tracks.video_i2v) {
      const vidSpec: WorkflowBuildSpec = {
        pipeline: "video_ltx",
        prompt: scene.tracks.video_i2v.motionPrompt,
        numFrames: scene.tracks.video_i2v.numFrames || 97,
      };
      const compiled = await compileResourceAwareWorkflow(userId, vidSpec);
      const deps =
        scene.tracks.video_i2v.dependsOnVisual !== false && scene.tracks.visual ? [visualKey] : [];
      drafts.push({
        tempKey: `${scene.sceneKey}::VIDEO_I2V`,
        sceneKey: scene.sceneKey,
        trackType: "VIDEO_I2V",
        dependsOnTempKeys: deps,
        spec: vidSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: "ltx-video-2b-v0.9.5-fp8.safetensors",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }

    if (scene.tracks.lipsync) {
      const lsSpec: WorkflowBuildSpec = { pipeline: "video_latentsync" };
      const compiled = await compileResourceAwareWorkflow(userId, lsSpec);
      const deps: string[] = [];
      if (scene.tracks.lipsync.dependsOnVisual !== false && scene.tracks.visual) deps.push(visualKey);
      if (scene.tracks.lipsync.dependsOnTts !== false && scene.tracks.audio_tts) deps.push(ttsKey);
      drafts.push({
        tempKey: `${scene.sceneKey}::LIPSYNC`,
        sceneKey: scene.sceneKey,
        trackType: "LIPSYNC",
        dependsOnTempKeys: deps,
        spec: lsSpec,
        workerProfile: compiled.recommendedProfile,
        baseCheckpoint: "latentsync_unet.pt",
        requiredModels: compiled.requiredModels,
        compiledGraph: compiled.graph,
        vramEstimateGb: compiled.vramEstimateGb,
      });
    }
  }

  // Coalesce order: root tasks sorted by (workerProfile, baseCheckpoint) so GPUs avoid swapping models, followed by dependent tasks
  drafts.sort((a, b) => {
    const depDiff = a.dependsOnTempKeys.length - b.dependsOnTempKeys.length;
    if (depDiff !== 0) return depDiff;
    const pCmp = a.workerProfile.localeCompare(b.workerProfile);
    if (pCmp !== 0) return pCmp;
    return a.baseCheckpoint.localeCompare(b.baseCheckpoint);
  });

  const groupCounts = new Map<string, { workerProfile: string; baseCheckpoint: string; taskCount: number }>();
  for (const d of drafts) {
    const key = `${d.workerProfile}::${d.baseCheckpoint}`;
    const cur = groupCounts.get(key) || {
      workerProfile: d.workerProfile,
      baseCheckpoint: d.baseCheckpoint,
      taskCount: 0,
    };
    cur.taskCount++;
    groupCounts.set(key, cur);
  }

  const coalesceSummary: BatchCoalesceSummary = {
    totalTasks: drafts.length,
    coalescedGroups: Array.from(groupCounts.values()),
    estimatedSavingsNote: `Coalesced ${drafts.length} task(s) across ${groupCounts.size} (Profile, Model) bin(s) to minimize /tmp/models swaps & stream parallel Visual+Audio tracks across Kaggle + Colab.`,
  };

  if (dryRun) {
    return {
      coalesceSummary,
      plannedTasks: drafts.map((d) => ({
        sceneKey: d.sceneKey,
        trackType: d.trackType,
        workerProfile: d.workerProfile,
        baseCheckpoint: d.baseCheckpoint,
        dependsOn: d.dependsOnTempKeys,
        vramEstimateGb: d.vramEstimateGb,
      })),
    };
  }

  const batch = await prisma.batchJob.create({
    data: {
      userId,
      title: spec.title,
      sourceApp: spec.sourceApp,
      idempotencyKey: spec.idempotencyKey || null,
      webhookUrl: spec.webhookCallbackUrl || null,
      rawPayloadJson: JSON.stringify(spec),
      strategyJson: JSON.stringify(coalesceSummary),
      status: drafts.length > 0 ? "QUEUED" : "COMPLETED",
      totalTasks: drafts.length,
    },
  });

  const tempKeyToId = new Map<string, string>();
  const createdRows: BatchTask[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const row = await prisma.batchTask.create({
      data: {
        batchId: batch.id,
        sequenceIndex: i,
        sceneKey: d.sceneKey,
        trackType: d.trackType,
        dependsOnTaskIdsJson: "[]",
        workerProfile: d.workerProfile,
        baseCheckpoint: d.baseCheckpoint,
        requiredModelsJson: JSON.stringify(d.requiredModels),
        inputParamsJson: JSON.stringify(d.spec),
        compiledGraphJson: JSON.stringify(d.compiledGraph),
        status: "PENDING",
      },
    });
    tempKeyToId.set(d.tempKey, row.id);
    createdRows.push(row);
  }

  // Second pass: resolve actual BatchTask IDs for DAG dependencies
  for (let i = 0; i < drafts.length; i++) {
    const depIds = drafts[i].dependsOnTempKeys
      .map((k) => tempKeyToId.get(k))
      .filter((id): id is string => Boolean(id));
    if (depIds.length > 0) {
      await prisma.batchTask.update({
        where: { id: createdRows[i].id },
        data: { dependsOnTaskIdsJson: JSON.stringify(depIds) },
      });
    }
  }

  await appendSystemLog({
    userId,
    category: "ACTION",
    level: "SUCCESS",
    message: `Created Batch "${spec.title}" (${batch.id}) from ${spec.sourceApp}: ${drafts.length} task(s), ${groupCounts.size} coalesced model bin(s).`,
  });

  return {
    batchId: batch.id,
    reusedExisting: false,
    coalesceSummary,
    plannedTasks: drafts.map((d) => ({
      sceneKey: d.sceneKey,
      trackType: d.trackType,
      workerProfile: d.workerProfile,
      baseCheckpoint: d.baseCheckpoint,
      dependsOn: d.dependsOnTempKeys,
      vramEstimateGb: d.vramEstimateGb,
    })),
  };
}

/**
 * Scores every ONLINE GPU for a specific BatchTask using Locality-First Affinity:
 * +50 checkpoint already cached in `/tmp/models`
 * +30 matching WorkerProfile (or BASE_COMFY for standard SDXL)
 * +25 Colab bonus for audio/lipsync tasks
 * +15 headroom free VRAM
 */
export async function rankOnlineGpusForTask(
  vms: VmInstance[],
  task: BatchTask
): Promise<GpuAffinityScore[]> {
  const online = vms.filter((v) => v.status === "ONLINE" && v.publicUrl);
  const scores: GpuAffinityScore[] = [];

  for (const vm of online) {
    let score = 0;
    const reasons: string[] = [];

    if (vm.workerProfile === task.workerProfile) {
      score += 30;
      reasons.push(`Profile match (${vm.workerProfile})`);
    } else if (vm.workerProfile === "BASE_COMFY" && task.workerProfile === "BASE_COMFY") {
      score += 30;
      reasons.push("Fast Base ComfyUI match");
    } else if (vm.workerProfile === "BASE_COMFY" && task.trackType === "VISUAL") {
      score += 10;
      reasons.push("Compatible Base SDXL runtime");
    } else {
      score -= 25;
      reasons.push(`Profile mismatch (${vm.workerProfile} != ${task.workerProfile})`);
    }

    if (
      vm.provider === "colab" &&
      (task.trackType === "AUDIO_TTS" ||
        task.trackType === "AUDIO_SFX" ||
        task.trackType === "AUDIO_BGM" ||
        task.trackType === "LIPSYNC")
    ) {
      score += 25;
      reasons.push("Prefers free Colab slot for Audio/LipSync");
    }

    const freeVram = (vm.vramTotalGb ?? 16) - (vm.vramUsedGb ?? 0);
    if (freeVram >= 10) {
      score += 15;
      reasons.push(`${freeVram.toFixed(1)} GB free VRAM`);
    }

    try {
      const client = new ComfyClient(vm);
      const [cat, q] = await Promise.all([
        client.getCatalog(vm.target).catch(() => null),
        client.getQueueSummary().catch(() => ({ runningCount: 0, pendingCount: 0 })),
      ]);

      if (q.runningCount + q.pendingCount >= 2) {
        score -= 40;
        reasons.push(`Busy queue (${q.runningCount} running, ${q.pendingCount} pending)`);
      }

      if (
        cat &&
        task.baseCheckpoint &&
        cat.models.checkpoints.some((c) => c.toLowerCase() === task.baseCheckpoint.toLowerCase())
      ) {
        score += 50;
        reasons.push(`Warm cache hit: ${task.baseCheckpoint}`);
      }
    } catch {
      score -= 10;
    }

    scores.push({
      target: vm.target,
      provider: vm.provider,
      workerProfile: vm.workerProfile,
      score,
      reasons,
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Advances a BatchJob one scheduler tick:
 * 1) Polls currently PROCESSING tasks & syncs finished outputs to Drive
 * 2) Dispatches ready PENDING tasks (whose DAG dependencies are COMPLETED) to top-ranked idle ONLINE GPUs
 * 3) Fires signed webhook callback to `batch.webhookUrl` upon completion
 */
export async function tickBatchScheduler(userId: string, batchId: string) {
  await ensureDbSchemaReady();

  const batch = await prisma.batchJob.findFirst({
    where: { id: batchId, userId },
    include: { tasks: { orderBy: { sequenceIndex: "asc" } } },
  });
  if (!batch) {
    throw new Error("Batch job not found.");
  }

  const vms = await prisma.vmInstance.findMany({ where: { userId } });
  const vmByTarget = new Map(vms.map((v) => [v.target, v]));
  const busyTargets = new Set<string>();

  // 1. Poll active tasks
  for (const task of batch.tasks) {
    if (task.status !== "PROCESSING" || !task.jobId) continue;
    const job = await prisma.job.findUnique({ where: { id: task.jobId } });
    if (!job) continue;

    if (job.status === "COMPLETED") {
      await prisma.batchTask.update({
        where: { id: task.id },
        data: { status: "COMPLETED", outputFilesJson: job.outputFiles || "[]" },
      });
      continue;
    }

    if (job.status === "FAILED") {
      await prisma.batchTask.update({
        where: { id: task.id },
        data: { status: "FAILED", errorMessage: job.errorMessage || "Render failed" },
      });
      continue;
    }

    // Check live ComfyUI history
    const vm = task.assignedTarget ? vmByTarget.get(task.assignedTarget) : null;
    if (vm && vm.status === "ONLINE" && vm.publicUrl && job.promptId) {
      busyTargets.add(vm.target);
      try {
        const client = new ComfyClient(vm);
        const check = await client.checkPromptHistory(job.promptId);
        if (check.error) {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "FAILED", errorMessage: check.error, completedAt: new Date() },
          });
          await prisma.batchTask.update({
            where: { id: task.id },
            data: { status: "FAILED", errorMessage: check.error },
          });
          busyTargets.delete(vm.target);
        } else if (check.finished && check.images.length > 0) {
          const syncedOutputs = [];
          for (const img of check.images) {
            const synced = await client.syncOutputToGDrive(img.filename, img.subfolder);
            syncedOutputs.push({
              filename: img.filename,
              gdriveFileId: synced.gdriveFileId,
              gdrivePath: synced.gdrivePath,
              previewUrl: synced.gdriveFileId ? `/api/outputs/${synced.gdriveFileId}` : "",
            });
          }
          const outputsStr = JSON.stringify(syncedOutputs);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              status: "COMPLETED",
              outputFiles: outputsStr,
              executionTimeMs: Date.now() - job.createdAt.getTime(),
              completedAt: new Date(),
            },
          });
          await prisma.batchTask.update({
            where: { id: task.id },
            data: { status: "COMPLETED", outputFilesJson: outputsStr },
          });
          busyTargets.delete(vm.target);
        }
      } catch {
        // Keep waiting if transient tunnel error
      }
    }
  }

  // Reload updated tasks to evaluate DAG readiness
  const freshTasks = await prisma.batchTask.findMany({
    where: { batchId: batch.id },
    orderBy: { sequenceIndex: "asc" },
  });
  const taskStatusMap = new Map(freshTasks.map((t) => [t.id, t.status]));

  // 2. Dispatch ready PENDING tasks across available idle ONLINE GPUs
  const availableVms = vms.filter(
    (v) => v.status === "ONLINE" && v.publicUrl && !busyTargets.has(v.target)
  );
  const dispatched: Array<{ taskId: string; target: string; score: number; reasons: string[] }> = [];

  for (const task of freshTasks) {
    if (task.status !== "PENDING") continue;
    if (availableVms.length === 0) break;

    let depIds: string[] = [];
    try {
      depIds = JSON.parse(task.dependsOnTaskIdsJson || "[]") as string[];
    } catch {
      depIds = [];
    }

    if (depIds.some((id) => taskStatusMap.get(id) === "FAILED")) {
      await prisma.batchTask.update({
        where: { id: task.id },
        data: { status: "BLOCKED", errorMessage: "Upstream scene dependency failed." },
      });
      continue;
    }

    const depsReady = depIds.every((id) => taskStatusMap.get(id) === "COMPLETED");
    if (!depsReady) continue;

    const ranked = await rankOnlineGpusForTask(availableVms, task);
    const best = ranked[0];
    if (!best) break;

    const vmIdx = availableVms.findIndex((v) => v.target === best.target);
    const chosenVm = availableVms[vmIdx];
    if (!chosenVm) continue;

    try {
      // Ensure required models on chosen VM first
      const reqModels = JSON.parse(task.requiredModelsJson || "[]") as Array<{
        category: string;
        filename: string;
        slug?: string;
      }>;
      let waitingTransfer = false;
      for (const m of reqModels) {
        const res = await ensureModelReadyOnVm({
          userId,
          vm: chosenVm,
          slug: m.slug,
          filename: m.filename,
          category: m.category,
        });
        if (res.status === "started") waitingTransfer = true;
      }

      if (waitingTransfer) {
        // Reserve this GPU while model streams in background
        availableVms.splice(vmIdx, 1);
        continue;
      }

      const graph = JSON.parse(task.compiledGraphJson || "{}") as Record<string, unknown>;
      const inputParams = JSON.parse(task.inputParamsJson || "{}") as WorkflowBuildSpec;

      const job = await prisma.job.create({
        data: {
          userId,
          vmInstanceId: chosenVm.id,
          target: chosenVm.target,
          prompt: inputParams.prompt || inputParams.dialogueText || `[Batch] ${task.sceneKey}`,
          negativePrompt: inputParams.negativePrompt || null,
          checkpoint: task.baseCheckpoint || task.trackType,
          width: inputParams.width || 1024,
          height: inputParams.height || 1024,
          steps: inputParams.steps || 20,
          cfg: inputParams.cfg || 6.0,
          seed: String(inputParams.seed || Math.floor(Math.random() * 1_000_000_000)),
          status: "PROCESSING",
        },
      });

      const { prompt_id } = await new ComfyClient(chosenVm).queuePrompt(graph, job.id);
      await prisma.job.update({ where: { id: job.id }, data: { promptId: prompt_id } });
      await prisma.batchTask.update({
        where: { id: task.id },
        data: {
          status: "PROCESSING",
          assignedTarget: chosenVm.target,
          jobId: job.id,
          attempts: task.attempts + 1,
        },
      });

      availableVms.splice(vmIdx, 1);
      dispatched.push({
        taskId: task.id,
        target: chosenVm.target,
        score: best.score,
        reasons: best.reasons,
      });
    } catch (err) {
      await prisma.batchTask.update({
        where: { id: task.id },
        data: {
          status: task.attempts >= 2 ? "FAILED" : "PENDING",
          errorMessage: err instanceof Error ? err.message : "Dispatch failed",
          attempts: task.attempts + 1,
        },
      });
    }
  }

  // 3. Recompute final aggregate BatchJob status & emit Webhook if terminal
  const latestTasks = await prisma.batchTask.findMany({
    where: { batchId: batch.id },
    orderBy: { sequenceIndex: "asc" },
  });
  const completedCount = latestTasks.filter((t) => t.status === "COMPLETED").length;
  const failedCount = latestTasks.filter((t) => t.status === "FAILED" || t.status === "BLOCKED").length;
  const anyActive = latestTasks.some((t) => t.status === "PENDING" || t.status === "PROCESSING");

  const nextBatchStatus = anyActive
    ? "RUNNING"
    : failedCount === 0
    ? "COMPLETED"
    : completedCount > 0
    ? "PARTIAL"
    : "FAILED";

  const updatedBatch = await prisma.batchJob.update({
    where: { id: batch.id },
    data: {
      status: nextBatchStatus,
      completedTasks: completedCount,
      failedTasks: failedCount,
    },
    include: { tasks: { orderBy: { sequenceIndex: "asc" } } },
  });

  if (!anyActive && batch.status !== nextBatchStatus && batch.webhookUrl) {
    try {
      const payload = JSON.stringify({
        event: "batch.completed",
        batchId: updatedBatch.id,
        idempotencyKey: updatedBatch.idempotencyKey,
        status: updatedBatch.status,
        completedTasks: updatedBatch.completedTasks,
        failedTasks: updatedBatch.failedTasks,
        tasks: updatedBatch.tasks.map((t) => ({
          sceneKey: t.sceneKey,
          trackType: t.trackType,
          status: t.status,
          assignedTarget: t.assignedTarget,
          outputs: t.outputFilesJson ? JSON.parse(t.outputFilesJson) : [],
          errorMessage: t.errorMessage,
        })),
      });

      const sig = crypto
        .createHmac("sha256", process.env.JWT_SECRET || "scriptoria-webhook")
        .update(payload)
        .digest("hex");

      await fetch(batch.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Scriptoria-Signature": `sha256=${sig}`,
        },
        body: payload,
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
    } catch {
      // Non-fatal webhook delivery failure
    }
  }

  return { batch: updatedBatch, dispatched };
}

