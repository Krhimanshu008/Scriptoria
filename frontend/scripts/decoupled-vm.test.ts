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
  const {
    buildUnifiedNotebookPythonCode,
    buildKagglePermanentLauncherCode,
    buildKaggleLauncherNotebookJson,
  } = await import("../src/lib/orchestrator/notebook-builder");
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
  assert.match(llmIdlePy, /Setup-Only Boot ready/);
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
  assert.match(llmAutoPy, /def _bg_autoload_llm\(/);
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
  assert.match(comfyIdlePy, /def _worker_auth_headers\(/);
  assert.match(comfyIdlePy, /def _get_active_transfer\(/);
  assert.match(comfyIdlePy, /GDRIVE_AUTH_BROKEN = False/);
  assert.match(comfyIdlePy, /ACTIVE_LLM_TRANSFER = None/);
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

  const permStaticPy = buildKagglePermanentLauncherCode({
    target: "gpu2",
    runnerToken: "user-1.abcdef0123456789",
    primaryUrl: "https://scriptoria.example.test",
    beaconUrl: null,
  });
  assert.match(permStaticPy, /RUNNER_TOKEN = "user-1\.abcdef0123456789"/);
  assert.match(permStaticPy, /\/api\/vm\/kaggle\/claim/);
  await compilePythonCode(permStaticPy, "kaggle_perm_static");

  const permBeaconPy = buildKagglePermanentLauncherCode({
    target: "gpu2",
    runnerToken: "user-1.abcdef0123456789",
    primaryUrl: "https://old-tunnel.trycloudflare.com",
    beaconUrl: "https://drive.google.com/uc?export=download&id=fakeBeacon123",
  });
  assert.match(permBeaconPy, /BEACON_URL = "https:\/\/drive\.google\.com\/uc\?export=download&id=fakeBeacon123"/);
  await compilePythonCode(permBeaconPy, "kaggle_perm_beacon");

  const gpuNb = buildKaggleLauncherNotebookJson({
    target: "gpu2",
    runnerToken: "user-1.abcdef",
    primaryUrl: "https://scriptoria.example.test",
  });
  assert.equal(gpuNb.cells.length, 2);
  assert.equal(gpuNb.metadata.accelerator, "GPU");
  const tpuNb = buildKaggleLauncherNotebookJson({
    target: "tpu0",
    runnerToken: "user-1.abcdef",
    primaryUrl: "https://scriptoria.example.test",
  });
  assert.equal(tpuNb.metadata.accelerator, "TPU");
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

    // 5. Heartbeat telemetry propagates activeTransfer, recentLog, and driveNeedsReconnect
    const hb3 = await heartbeat(
      new NextRequest("http://localhost/api/vm/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: regToken,
          targets: ["gpu0", "gpu1"],
          stepProgress: 5,
          status: "ONLINE",
          telemetry: {
            gpu0: { ready: true, vramTotalGb: 15, vramUsedGb: 0.2 },
            driveNeedsReconnect: true,
            recentLog: "[DOWNLOAD] Qwen 2.1 Turbo 42%",
            activeTransfer: {
              filename: "qwen-image-2.1-turbo.safetensors",
              category: "unet",
              percentage: 42,
              speedMbps: 118.4,
              bytesDone: 5_000_000_000,
              totalBytes: 12_000_000_000,
              queueCount: 3,
              source: "huggingface",
            },
          },
        }),
      })
    );
    assert.equal(hb3.status, 200);
    const updatedAfterTx = await prisma.vmInstance.findUniqueOrThrow({ where: { id: vm.id } });
    const parsedTxMeta = JSON.parse(updatedAfterTx.bootMetadataJson!);
    assert.equal(parsedTxMeta.driveNeedsReconnect, true);
    assert.equal(parsedTxMeta.recentLog, "[DOWNLOAD] Qwen 2.1 Turbo 42%");
    assert.equal(parsedTxMeta.activeTransfer.percentage, 42);
    assert.equal(parsedTxMeta.activeTransfer.queueCount, 3);

    // 6. Image Model Pack staging (stage_image_pack) queues missing models via ModelFetch DB queue + low-disk guard
    await prisma.vmInstance.updateMany({
      where: { userId: user.id, sessionGroup: vm.sessionGroup },
      data: {
        status: "ONLINE",
        workerProfile: "IMAGE_DIT_DUAL_T4",
        publicUrl: "",
        vmSecret: "sec-img",
        lastHeartbeat: new Date(),
        bootMetadataJson: JSON.stringify({
          modelFetch: true,
          runtimeMode: "comfy_ready",
          disk: { totalGb: 40, usedGb: 5, freeGb: 35 },
        }),
      },
    });
    const packOkRes = await modelControl(
      new NextRequest("http://localhost/api/vm/gpu0/model-control", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action: "stage_image_pack", packId: "qwen21-turbo-pack" }),
      }),
      { params: Promise.resolve({ target: "gpu0" }) }
    );
    assert.equal(packOkRes.status, 200);
    const packOkJson = await packOkRes.json();
    assert.equal(packOkJson.packId, "qwen21-turbo-pack");
    assert.equal(packOkJson.summary.total, 3);
    assert.equal(packOkJson.summary.started, 3);
    const queuedFetches = await prisma.modelFetch.findMany({ where: { vmId: vm.id } });
    assert.equal(queuedFetches.length, 3);

    await prisma.vmInstance.update({
      where: { id: vm.id },
      data: {
        bootMetadataJson: JSON.stringify({
          modelFetch: true,
          runtimeMode: "comfy_ready",
          disk: { totalGb: 30, usedGb: 26, freeGb: 4.0 },
        }),
      },
    });
    const packLowDiskRes = await modelControl(
      new NextRequest("http://localhost/api/vm/gpu0/model-control", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action: "stage_image_pack", packId: "qwen-edit-2511-pack" }),
      }),
      { params: Promise.resolve({ target: "gpu0" }) }
    );
    assert.equal(packLowDiskRes.status, 409);

    // 7. Stale headless ONLINE VM automatically transitions to OFFLINE & clears activeTransfer on GET /api/vm/status
    const { GET: vmStatus } = await import("../src/app/api/vm/status/route");
    await prisma.vmInstance.updateMany({
      where: { userId: user.id, target: { in: ["gpu0", "gpu1"] } },
      data: {
        status: "ONLINE",
        stepProgress: 5,
        publicUrl: "",
        vramUsedGb: 0.1,
        lastHeartbeat: new Date(Date.now() - 300_000),
        bootMetadataJson: JSON.stringify({
          runtimeMode: "loading_model",
          activeModelName: "unsloth/Qwen3.8-27B-GGUF",
          activeTransfer: {
            filename: "Qwen3.8-27B-UD-Q4_K_M.gguf",
            percentage: 0,
            queueCount: 1,
          },
          driveNeedsReconnect: true,
        }),
      },
    });
    const staleStatusRes = await vmStatus(
      new NextRequest("http://localhost/api/vm/status", {
        headers: { cookie },
      })
    );
    assert.equal(staleStatusRes.status, 200);
    const staleStatusJson = await staleStatusRes.json();
    const staleGpu0 = staleStatusJson.vms.find((v: { target: string }) => v.target === "gpu0");
    assert.equal(staleGpu0.status, "OFFLINE");
    assert.equal(staleGpu0.bootMetadata.runtimeMode, "offline");
    assert.equal(staleGpu0.bootMetadata.activeTransfer, null);
    assert.equal(staleGpu0.bootMetadata.driveNeedsReconnect, false);

    // 8. Permanent Kaggle runner token auto-adopts from OFFLINE & re-claims seamlessly across ONLINE runs
    const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    try {
      const { GET: getKaggleNotebook } = await import("../src/app/api/vm/kaggle/[target]/notebook/route");
      const { POST: postKaggleClaim } = await import("../src/app/api/vm/kaggle/claim/route");
      const { POST: postKaggleConfig } = await import("../src/app/api/vm/kaggle/[target]/config/route");

      const nbRes1 = await getKaggleNotebook(
        new NextRequest("http://localhost/api/vm/kaggle/gpu0/notebook?format=python", {
          headers: { cookie },
        }),
        { params: Promise.resolve({ target: "gpu0" }) }
      );
      assert.equal(nbRes1.status, 200);
      const nbJson1 = await nbRes1.json();
      assert.match(nbJson1.pythonCode, /RUNNER_TOKEN = "([^"]+)"/);
      const tokenMatch1 = nbJson1.pythonCode.match(/RUNNER_TOKEN = "([^"]+)"/);
      const runnerToken1 = tokenMatch1![1];

      // Auto-adopt while OFFLINE
      const claimRes1 = await postKaggleClaim(
        new NextRequest("https://example.test/api/vm/kaggle/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "gpu0", runnerToken: runnerToken1 }),
        })
      );
      assert.equal(claimRes1.status, 200);
      const claimJson1 = await claimRes1.json();
      assert.equal(claimJson1.ok, true);
      assert.match(claimJson1.pythonCode, /REG_JWT = "/);
      assert.match(claimJson1.pythonCode, /VM_SECRET = "/);

      const claimedRow1 = await prisma.vmInstance.findUniqueOrThrow({
        where: { userId_target: { userId: user.id, target: "gpu0" } },
      });
      assert.equal(claimedRow1.status, "STARTING");
      assert.equal(claimedRow1.stepProgress, 2);
      assert.ok(claimedRow1.vmSecret && claimedRow1.vmSecret.length > 10);
      const claimedMeta1 = JSON.parse(claimedRow1.bootMetadataJson || "{}");
      assert.equal(claimedMeta1.draftMode, true);
      assert.equal(claimedMeta1.activeTransfer, null);

      // Simulate container heartbeat -> ONLINE for >15m (status route must still keep interactive session alive)
      await prisma.vmInstance.updateMany({
        where: { userId: user.id, sessionGroup: vm.sessionGroup },
        data: {
          status: "ONLINE",
          stepProgress: 5,
          publicUrl: "",
          lastHeartbeat: new Date(Date.now() - 10_000),
          bootMetadataJson: JSON.stringify({
            draftMode: true,
            draftArmedAt: Date.now() - 25 * 60_000,
            runtimeMode: "idle_empty",
          }),
        },
      });
      const liveStatusRes = await vmStatus(
        new NextRequest("http://localhost/api/vm/status", { headers: { cookie } })
      );
      assert.equal(liveStatusRes.status, 200);
      const liveStatusJson = await liveStatusRes.json();
      const liveGpu0 = liveStatusJson.vms.find((v: { target: string }) => v.target === "gpu0");
      assert.equal(liveGpu0.status, "ONLINE");

      // Re-claim using the exact same permanent token while previously ONLINE
      const claimRes2 = await postKaggleClaim(
        new NextRequest("https://example.test/api/vm/kaggle/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "gpu0", runnerToken: runnerToken1 }),
        })
      );
      assert.equal(claimRes2.status, 200);
      const claimedRow2 = await prisma.vmInstance.findUniqueOrThrow({
        where: { userId_target: { userId: user.id, target: "gpu0" } },
      });
      assert.equal(claimedRow2.status, "STARTING");
      assert.notEqual(claimedRow2.vmSecret, claimedRow1.vmSecret);

      // 9. Rotating key immediately blocks old permanent cells (401) and mints a working replacement
      const rotRes = await postKaggleConfig(
        new NextRequest("http://localhost/api/vm/kaggle/gpu0/config", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ action: "rotate_key" }),
        }),
        { params: Promise.resolve({ target: "gpu0" }) }
      );
      assert.equal(rotRes.status, 200);

      const oldClaimRes = await postKaggleClaim(
        new NextRequest("https://example.test/api/vm/kaggle/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "gpu0", runnerToken: runnerToken1 }),
        })
      );
      assert.equal(oldClaimRes.status, 401);

      const nbRes2 = await getKaggleNotebook(
        new NextRequest("http://localhost/api/vm/kaggle/gpu0/notebook?format=python", {
          headers: { cookie },
        }),
        { params: Promise.resolve({ target: "gpu0" }) }
      );
      assert.equal(nbRes2.status, 200);
      const nbJson2 = await nbRes2.json();
      const tokenMatch2 = nbJson2.pythonCode.match(/RUNNER_TOKEN = "([^"]+)"/);
      const runnerToken2 = tokenMatch2![1];
      assert.notEqual(runnerToken2, runnerToken1);

      const newClaimRes = await postKaggleClaim(
        new NextRequest("https://example.test/api/vm/kaggle/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "gpu0", runnerToken: runnerToken2 }),
        })
      );
      assert.equal(newClaimRes.status, 200);
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
    }
  } finally {
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Profile-matched image packs and Setup-Only Boot config omit implicit Qwen dataset auto-attach", async () => {
  const { readFile } = await import("node:fs/promises");
  const { getImagePacksForProfile, resolveImagePackById } = await import("../src/lib/catalog/image-model-packs");

  const ditPacks = getImagePacksForProfile("IMAGE_DIT_DUAL_T4").map((p) => p.id);
  assert.ok(ditPacks.includes("qwen21-turbo-pack"));
  assert.ok(ditPacks.includes("qwen-edit-2511-pack"));
  assert.ok(!ditPacks.includes("audio-sfx-pack"));

  const corePacks = getImagePacksForProfile("IMAGE_CORE").map((p) => p.id);
  assert.ok(corePacks.includes("noobai-vpred-pack"));
  assert.ok(!corePacks.includes("qwen21-turbo-pack"));
  assert.equal(resolveImagePackById("nonexistent-pack"), null);

  const toggleSource = await readFile(
    path.join(process.cwd(), "src/app/api/vm/[target]/toggle/route.ts"),
    "utf8"
  );
  assert.equal(toggleSource.includes("swift15/qwen38-27b-q4km-gguf"), false);
});

test("Google Drive OAuth resolves reverse-proxy origins without 0.0.0.0 leakage and formats 403 SERVICE_DISABLED", async () => {
  const {
    resolveRequestOrigin,
    resolveOAuthCallbackOrigin,
    getGoogleOAuthClientConfig,
    formatGoogleDriveApiError,
  } = await import("../src/lib/gdrive/oauth-config");
  const { GET: gdriveStart } = await import("../src/app/api/auth/google/gdrive/start/route");
  const { GET: gdriveCallback } = await import("../src/app/api/auth/google/gdrive/callback/route");
  const { signSessionToken } = await import("../src/lib/auth/session");

  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const prevEnvId = process.env.GDRIVE_CLIENT_ID;
  const prevEnvSecret = process.env.GDRIVE_CLIENT_SECRET;
  const prevJwt = process.env.JWT_SECRET;

  process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-oauth-test-jwt";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.GDRIVE_CLIENT_ID = "env-client-id.apps.googleusercontent.com";
  process.env.GDRIVE_CLIENT_SECRET = "env-client-secret";

  try {
    // 1. Proxied request where container binds 0.0.0.0:3000 behind HTTPS public domain
    const proxiedReq = new NextRequest("https://0.0.0.0:3000/api/auth/google/gdrive/start", {
      headers: {
        "x-forwarded-host": "scriptoria.krhimanshu.in",
        "x-forwarded-proto": "https",
        host: "0.0.0.0:3000",
      },
    });
    assert.equal(resolveRequestOrigin(proxiedReq), "https://scriptoria.krhimanshu.in");
    assert.equal(resolveOAuthCallbackOrigin(proxiedReq), "https://scriptoria.krhimanshu.in");

    // 2. Callback redirect on proxied 0.0.0.0:3000 must stay on public HTTPS host, never 0.0.0.0:3000
    const cbErrReq = new NextRequest(
      "https://0.0.0.0:3000/api/auth/google/gdrive/callback?error=access_denied",
      {
        headers: {
          "x-forwarded-host": "scriptoria.krhimanshu.in",
          "x-forwarded-proto": "https",
        },
      }
    );
    const cbErrRes = await gdriveCallback(cbErrReq);
    assert.equal(cbErrRes.status, 307);
    assert.equal(
      cbErrRes.headers.get("location"),
      "https://scriptoria.krhimanshu.in/settings/vault?gdriveError=access_denied"
    );

    // 3. Unauthenticated redirect uses public origin too (not 0.0.0.0:3000)
    const unauthStartRes = await gdriveStart(proxiedReq);
    assert.equal(unauthStartRes.status, 307);
    assert.equal(
      unauthStartRes.headers.get("location"),
      "https://scriptoria.krhimanshu.in/login"
    );

    // 4. Signed session check: ensure getGoogleOAuthClientConfig never mixes partial Vault ID with Env secret
    const partialMixed = getGoogleOAuthClientConfig({
      client_id: "partial-vault-id-only",
      client_secret: "",
    });
    assert.equal(partialMixed.clientId, "env-client-id.apps.googleusercontent.com");
    assert.equal(partialMixed.clientSecret, "env-client-secret");
    assert.equal(partialMixed.source, "env");

    const fullVault = getGoogleOAuthClientConfig({
      client_id: "vault-id",
      client_secret: "vault-secret",
    });
    assert.equal(fullVault.clientId, "vault-id");
    assert.equal(fullVault.clientSecret, "vault-secret");
    assert.equal(fullVault.source, "vault");

    // 5. 403 SERVICE_DISABLED formatting yields full console enable URL
    const formatted = formatGoogleDriveApiError(
      403,
      JSON.stringify({
        error: {
          code: 403,
          message:
            "Google Drive API has not been used in project 902602502828 before or it is disabled.",
        },
      })
    );
    assert.match(formatted, /902602502828/);
    assert.match(
      formatted,
      /https:\/\/console\.cloud\.google\.com\/apis\/library\/drive\.googleapis\.com\?project=902602502828/
    );

    void signSessionToken;
  } finally {
    process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
    process.env.GDRIVE_CLIENT_ID = prevEnvId;
    process.env.GDRIVE_CLIENT_SECRET = prevEnvSecret;
    process.env.JWT_SECRET = prevJwt;
  }
});
