import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";

async function compilePythonCode(code: string, label: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "scriptoria-pycompile-"));
  const filePath = path.join(dir, `${label}.py`);
  try {
    await writeFile(filePath, code, "utf8");
    const child = spawn(process.env.PYTHON || "python", ["-m", "py_compile", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30000,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const [codeExit] = await once(child, "close");
    assert.equal(codeExit, 0, `py_compile failed for ${label}: ${stderr}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Generated Python worker & 0-GPU Qwen LLM dataset scripts compile cleanly with Python AST", async () => {
  const { buildUnifiedNotebookPythonCode } = await import("../src/lib/orchestrator/notebook-builder");
  const { buildLlmDatasetPythonCode } = await import("../src/lib/orchestrator/fastboot-builder");
  const { LLM_MODEL_PRESETS } = await import("../src/lib/llm/llm-model-presets");

  const llmIdlePy = buildUnifiedNotebookPythonCode({
    provider: "kaggle",
    appWebhookUrl: "https://example.test",
    registrationJwt: "jwt-token",
    vmSecret: "vm-secret",
    gdriveTokenJson: "",
    gdriveBaseFolder: "Scriptoria",
    gpuTargets: ["gpu2", "gpu3"],
    gpuProfiles: ["LLM_QWEN_VLM", "LLM_QWEN_VLM"],
    accountAlias: "acc2",
    workerProfile: "LLM_QWEN_VLM",
    headlessMode: true,
    quietStdout: true,
    autoLoadOnBoot: false,
  });
  assert.match(llmIdlePy, /AUTO_LOAD_ON_BOOT = False/);
  assert.match(llmIdlePy, /RUNTIME_MODE = "idle_empty" if PROFILE_ID\.startswith\("LLM_"\) else "comfy_ready"/);
  assert.match(llmIdlePy, /Pure Compute Boot active/);
  await compilePythonCode(llmIdlePy, "llm_idle_empty");

  const llmAutoPy = buildUnifiedNotebookPythonCode({
    provider: "kaggle",
    appWebhookUrl: "https://example.test",
    registrationJwt: "jwt-token",
    vmSecret: "vm-secret",
    gdriveTokenJson: "",
    gdriveBaseFolder: "Scriptoria",
    gpuTargets: ["gpu2", "gpu3"],
    accountAlias: "acc2",
    workerProfile: "LLM_QWEN_FAST_8B",
    autoLoadOnBoot: true,
  });
  assert.match(llmAutoPy, /AUTO_LOAD_ON_BOOT = True/);
  await compilePythonCode(llmAutoPy, "llm_auto_load");

  const comfyIdlePy = buildUnifiedNotebookPythonCode({
    provider: "kaggle",
    appWebhookUrl: "https://example.test",
    registrationJwt: "jwt-token",
    vmSecret: "vm-secret",
    gdriveTokenJson: "",
    gdriveBaseFolder: "Scriptoria",
    gpuTargets: ["gpu0", "gpu1"],
    accountAlias: "acc1",
    workerProfile: "IMAGE_DIT_DUAL_T4",
    prewarmModels: [{ category: "checkpoints", filename: "test.safetensors" }],
    autoLoadOnBoot: false,
  });
  assert.match(comfyIdlePy, /if PREWARM_MODELS and AUTO_LOAD_ON_BOOT:/);
  await compilePythonCode(comfyIdlePy, "comfy_idle_empty");

  for (const preset of LLM_MODEL_PRESETS) {
    const dsPy = buildLlmDatasetPythonCode({
      presetId: preset.id,
      shortLabel: preset.shortLabel,
      primaryRepo: preset.repoId,
      fileHints: preset.preferredFilenames,
      mmprojHints: preset.mmprojHints,
      companions: (preset.companionRepos || []).map((c) => ({
        role: c.role,
        repoId: c.repoId,
        fileHints: c.preferredFilenames,
        mmprojHints: c.mmprojHints,
      })),
    });
    assert.match(dsPy, /scriptoria_llm_manifest\.json/);
    await compilePythonCode(dsPy, `dataset_${preset.id}`);
  }
});

test("Decoupled VmCommand lifecycle, 409 empty-VM guard, and autoLoadOnBoot config behave deterministically", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scriptoria-decoupled-vm-"));
  process.env.DATABASE_URL = "file:" + path.join(dir, "isolated.db").replaceAll("\\", "/");
  process.env.TURSO_DATABASE_URL = "";
  process.env.JWT_SECRET = "isolated-decoupled-jwt";
  process.env.ENCRYPTION_KEY = "isolated-decoupled-vault";

  const { prisma } = await import("../src/lib/db/prisma");
  const { ensureDbSchemaReady } = await import("../src/lib/db/ensure-schema");
  const { signSessionToken, signVmRegistrationToken, ensureUserVmSlots } = await import("../src/lib/auth/session");
  const { POST: modelControl } = await import("../src/app/api/vm/[target]/model-control/route");
  const { PATCH: patchProfile } = await import("../src/app/api/vm/[target]/profile/route");
  const { POST: heartbeat } = await import("../src/app/api/vm/heartbeat/route");
  const { dispatchLlmChat, LlmDispatchError } = await import("../src/lib/llm/dispatch-llm");

  try {
    await ensureDbSchemaReady();
    const user = await prisma.user.create({
      data: { email: "decoupled@example.test", passwordHash: "test" },
    });
    await ensureUserVmSlots(user.id);

    const vm = await prisma.vmInstance.findFirstOrThrow({
      where: { userId: user.id, target: "gpu0" },
    });
    await prisma.vmInstance.updateMany({
      where: { userId: user.id, sessionGroup: vm.sessionGroup },
      data: {
        status: "ONLINE",
        workerProfile: "LLM_QWEN_VLM",
        vmSecret: "sec-123",
        lastHeartbeat: new Date(),
        bootMetadataJson: JSON.stringify({
          runtimeMode: "idle_empty",
          activeModelName: null,
          llmEndpoints: [],
          disk: { totalGb: 30, usedGb: 8, freeGb: 22 },
        }),
      },
    });

    const cookie =
      "scriptoria_session=" +
      signSessionToken({ userId: user.id, email: user.email, role: user.role });
    const regToken = signVmRegistrationToken({
      userId: user.id,
      sessionGroup: vm.sessionGroup,
      targets: ["gpu0", "gpu1"],
      vmSecret: "sec-123",
    });

    // 1. Dispatching chat against an idle_empty VM with fallbackToVault=false returns HTTP 409
    await assert.rejects(
      () =>
        dispatchLlmChat({
          userId: user.id,
          messages: [{ role: "user", content: "Ping" }],
          targetVm: "gpu0",
          fallbackToVault: false,
        }),
      (err: unknown) => err instanceof LlmDispatchError && err.status === 409
    );

    // 2. Toggle autoLoadOnBoot via PATCH /api/vm/gpu0/profile
    const profRes = await patchProfile(
      new NextRequest("http://localhost/api/vm/gpu0/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ autoLoadOnBoot: true }),
      }),
      { params: Promise.resolve({ target: "gpu0" }) }
    );
    assert.equal(profRes.status, 200);
    const updatedGpu0 = await prisma.vmInstance.findUniqueOrThrow({ where: { id: vm.id } });
    assert.equal(JSON.parse(updatedGpu0.bootMetadataJson!).autoLoadOnBoot, true);

    // 3. Low disk guardrail rejects oversized GGUF without dataset or force=true
    await prisma.vmInstance.update({
      where: { id: vm.id },
      data: {
        bootMetadataJson: JSON.stringify({
          runtimeMode: "idle_empty",
          disk: { totalGb: 30, usedGb: 22, freeGb: 8.0 },
        }),
      },
    });
    const lowDiskRes = await modelControl(
      new NextRequest("http://localhost/api/vm/gpu0/model-control", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action: "stage_llm", presetId: "qwen3.8-27b-vlm" }),
      }),
      { params: Promise.resolve({ target: "gpu0" }) }
    );
    assert.equal(lowDiskRes.status, 409);

    // 4. Queue load_llm for 8B model -> delivered in heartbeat -> acked cleanly
    const loadRes = await modelControl(
      new NextRequest("http://localhost/api/vm/gpu0/model-control", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action: "load_llm", presetId: "qwen3-vl-8b" }),
      }),
      { params: Promise.resolve({ target: "gpu0" }) }
    );
    assert.equal(loadRes.status, 200);
    const loadJson = await loadRes.json();
    const cmdId = loadJson.command.id as string;

    const hb1 = await heartbeat(
      new NextRequest("http://localhost/api/vm/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: regToken,
          targets: ["gpu0", "gpu1"],
          stepProgress: 5,
          status: "ONLINE",
          telemetry: {
            gpu0: { ready: true, vramTotalGb: 15, vramUsedGb: 0.1 },
            gpu1: { ready: true, vramTotalGb: 15, vramUsedGb: 0.1 },
            runtimeMode: "loading_model",
          },
        }),
      })
    );
    assert.equal(hb1.status, 200);
    const hb1Json = await hb1.json();
    assert.equal(hb1Json.pendingCommands.length, 1);
    assert.equal(hb1Json.pendingCommands[0].id, cmdId);
    assert.equal(hb1Json.pendingCommands[0].action, "LOAD_LLM");

    // Ack command COMPLETED in next heartbeat
    const hb2 = await heartbeat(
      new NextRequest("http://localhost/api/vm/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: regToken,
          targets: ["gpu0", "gpu1"],
          stepProgress: 5,
          status: "ONLINE",
          commandAcks: [{ id: cmdId, status: "COMPLETED", resultMessage: "Loaded Qwen3-VL 8B" }],
          telemetry: {
            gpu0: { ready: true, vramTotalGb: 15, vramUsedGb: 4.1 },
            runtimeMode: "llm_ready",
            activeModelName: "Qwen3-VL 8B",
            llmEndpoints: [{ port: 8190, gpu: "GPU0+GPU1", model: "Qwen3-VL-8B.gguf", service: "default", ready: true }],
          },
        }),
      })
    );
    assert.equal(hb2.status, 200);
    const hb2Json = await hb2.json();
    assert.equal(hb2Json.pendingCommands, undefined);

    const cmdRow = await prisma.vmCommand.findUniqueOrThrow({ where: { id: cmdId } });
    assert.equal(cmdRow.status, "COMPLETED");
  } finally {
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
