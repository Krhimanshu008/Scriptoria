import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";

test("Drive-free catalog downloads and renames use session and file identity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scriptoria-model-test-"));
  process.env.DATABASE_URL = "file:" + path.join(dir, "isolated.db").replaceAll("\\", "/");
  process.env.TURSO_DATABASE_URL = "";
  process.env.JWT_SECRET = "isolated-test-jwt";
  process.env.ENCRYPTION_KEY = "isolated-test-vault";
  const { prisma } = await import("../src/lib/db/prisma");
  const { ensureDbSchemaReady } = await import("../src/lib/db/ensure-schema");
  const { signSessionToken, signVmRegistrationToken, ensureUserVmSlots } = await import("../src/lib/auth/session");
  const { POST: catalog } = await import("../src/app/api/catalog/route");
  const { POST: ensure } = await import("../src/app/api/catalog/ensure/route");
  const { POST: poll } = await import("../src/app/api/vm/model-fetch/route");
  const { GET: status } = await import("../src/app/api/catalog/ensure-status/[target]/route");
  const { POST: claim } = await import("../src/app/api/v1/workers/claim/route");
  const { POST: heartbeat } = await import("../src/app/api/v1/workers/heartbeat/route");
  const { checkKaggleConnection } = await import("../src/lib/orchestrator/kaggle-connection");
  const { POST: projects } = await import("../src/app/api/projects/route");
  const { PATCH: vault } = await import("../src/app/api/vault/route");
  const { saveUserCredential } = await import("../src/lib/crypto/credentials");
  const { getKaggleKernelSlug } = await import("../src/lib/orchestrator/vm-helpers");
  const originalFetch = globalThis.fetch;
  try {
    await ensureDbSchemaReady();
    const user = await prisma.user.create({ data: { email: "tester@example.test", passwordHash: "test" } });
    await ensureUserVmSlots(user.id);
    const user2 = await prisma.user.create({ data: { email: "other@example.test", passwordHash: "test" } });
    const slot = await prisma.vmInstance.findFirstOrThrow({ where: { userId: user.id, target: "gpu0" } });
    assert.equal(slot.accountAlias, "personal");
    const vm = await prisma.vmInstance.update({ where: { id: slot.id }, data: {
      status: "ONLINE", vmSecret: "local-session", lastHeartbeat: new Date(), publicUrl: "", bootMetadataJson: '{"modelFetch":true}',
    } });
    const sign = (owner: typeof user) => "scriptoria_session=" + signSessionToken({ userId: owner.id, email: owner.email, role: owner.role });
    const cookie = sign(user);
    const token = signVmRegistrationToken({ userId: user.id, sessionGroup: vm.sessionGroup, targets: [vm.target], vmSecret: vm.vmSecret! });
    const req = (body: unknown, headers: Record<string, string> = { cookie }, method = "POST") =>
      new NextRequest("http://localhost/test", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const worker = { authorization: "VmToken " + token };
    const sha = createHash("sha256").update("fixture").digest("hex");
    const rev = "a".repeat(40);
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("https://huggingface.co/fixture/test/resolve/")) {
        return new Response(null, { status: 302, headers: { "x-linked-etag": sha, "x-repo-commit": rev, "x-linked-size": "7" } });
      }
      if (url === "https://civitai.com/api/v1/model-versions/42") {
        return Response.json({ files: [{ name: "cv.pt", downloadUrl: "https://civitai.com/api/download/models/42", hashes: { SHA256: sha } }] });
      }
      throw new Error("Unexpected external request in isolated test");
    };
    for (const [slug, source] of [
      ["hf", { hfRepoId: "fixture/test", hfFilePath: "hf.pt" }],
      ["cv", { civitaiVersionId: "42" }],
    ] as const) {
      const asset = await prisma.modelAsset.create({ data: { userId: user.id, slug, displayName: slug,
        filename: slug + ".pt", modality: "IMAGE", category: "vae", ...source } });
      assert.ok(!(await ensure(req({ target: vm.target, slug }))).ok);
      const preview = await (await catalog(req({ action: "review_file", modelId: asset.id }))).json();
      assert.equal(preview.sha256, sha);
      assert.equal((await catalog(req({ action: "confirm_review", modelId: asset.id, sha256: sha }))).status, 200);
      const receipt = await (await ensure(req({ target: vm.target, slug }))).json();
      assert.match(receipt.fetchJobId, /^worker-/);
      const { command } = await (await poll(req({ driveReady: false }, worker))).json();
      assert.equal(command.id, receipt.fetchJobId.slice(7));
      assert.equal(command.request.sha256, sha);
      assert.equal(command.request.backupToGdrive, false);
      assert.equal(command.request.allowGdriveFallback, false);
      assert.equal(command.request.mirrors[0].sourceKind, slug === "cv" ? "civitai" : "huggingface");
      if (slug === "hf") assert.ok(command.request.mirrors[0].url.includes(rev));
      assert.equal((await poll(req({}, { authorization: "VmToken bad" }))).status, 401);
      await poll(req({ reports: [{ id: command.id, status: "completed", percentage: 100 }] }, worker));
      const result = await status(new NextRequest("http://localhost/status?fetchJobId=" + receipt.fetchJobId, { headers: { cookie } }),
        { params: Promise.resolve({ target: vm.target }) });
      assert.equal((await result.json()).completed, true);
    }
    const inspected = await (await catalog(req({ action: "inspect_url", url: "https://huggingface.co/fixture/test/blob/" + rev + "/hf.pt" }))).json();
    assert.equal(inspected.metadata.directUrl, "https://huggingface.co/fixture/test/resolve/" + rev + "/hf.pt");
    const unavailable = await catalog(req({ action: "inspect_url", url: "https://civitai.com/api/download/models/42?format=Other" }));
    assert.match((await unavailable.json()).error, /requested Civitai file variant/);
    const batch = await prisma.batchJob.create({ data: { userId: user.id, title: "Targeted smoke test", status: "QUEUED" } });
    const queued = await prisma.batchTask.create({ data: { batchId: batch.id, sceneKey: "targeted", assignedTarget: "gpu1",
      inputParamsJson: JSON.stringify({ preferredTarget: "gpu1" }) } });
    assert.equal((await (await claim(req({ workerId: vm.target }, worker))).json()).task, null);
    await prisma.batchTask.update({ where: { id: queued.id }, data: { assignedTarget: null } });
    assert.equal((await (await claim(req({ workerId: vm.target }, worker))).json()).task, null);
    await prisma.batchTask.update({ where: { id: queued.id }, data: { inputParamsJson: JSON.stringify({ preferredTarget: vm.target }) } });
    assert.equal((await (await claim(req({ workerId: vm.target }, worker))).json()).task.id, queued.id);
    assert.equal((await heartbeat(req({ workerId: vm.target, taskId: queued.id }, worker))).status, 200);
    assert.equal((await heartbeat(req({ workerId: "gpu1", taskId: queued.id }, worker))).status, 403);
    const project = await prisma.project.create({ data: { userId: user.id, title: "Original" } });
    const rename = { action: "rename_project", projectId: project.id, title: "Chapter Art" };
    assert.equal((await projects(req(rename, { cookie: sign(user2) }))).status, 404);
    assert.equal((await projects(req(rename))).status, 200);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).title, "Chapter Art");
    const old = await saveUserCredential(user.id, { provider: "kaggle", accountAlias: "acc1", username: "owner", rawSecret: "fixture" });
    const slug = getKaggleKernelSlug(old.accountAlias);
    assert.equal((await vault(req({ provider: "kaggle", accountAlias: old.accountAlias, metadata: { displayName: "Illustration tests" } }, { cookie }, "PATCH"))).status, 200);
    const renamed = await prisma.credential.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(JSON.parse(renamed.metadataJson!).displayName, "Illustration tests");
    assert.equal(getKaggleKernelSlug(renamed.accountAlias), slug);
    assert.equal(renamed.encryptedKey, old.encryptedKey);
    assert.equal(await checkKaggleConnection(user.id, old.accountAlias, "owner"), null);
    assert.ok(await checkKaggleConnection(user.id, "second", "other"));
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated downloader checks bytes, propagates provider errors and keeps bearer credentials on the origin", async () => {
  const { buildPythonMirrorDownloadHelper } = await import("../src/lib/orchestrator/notebook-builder");
  const bytes = Buffer.from("tiny local model fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const dir = await mkdtemp(path.join(tmpdir(), "scriptoria-weights-"));
  const headers: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/file") {
      headers.push(req.headers.authorization);
      res.end(bytes);
    } else if (req.url === "/denied") {
      res.writeHead(403).end();
    } else {
      headers.push(req.headers.authorization);
      res.writeHead(302, { location: "/file" }).end();
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const driver = [
      "import hashlib, os, shutil, subprocess, sys, time, urllib.request",
      buildPythonMirrorDownloadHelper(),
      "base, folder, sha = sys.argv[1:]",
      "for name in ['huggingface', 'civitai']:",
      "    path = os.path.join(folder, name)",
      "    source = dict(sourceKind=name, url=base + '/provider', authHeader='Bearer fixture', sha256=sha)",
      "    result = _download_with_mirrors([source], path)",
      "    assert result['sourceKind'] == name",
      "    assert _verify_download(path, sha) > 0",
      "    for changed, expected in [(dict(sha256='0'*64), 'SHA-256'), (dict(url=base+'/denied'), '403')]:",
      "        try: _download_with_mirrors([{**source, **changed}], path+'.part')",
      "        except RuntimeError as err: assert expected in str(err)",
      "        else: raise AssertionError('bad model accepted')",
      "        assert not os.path.exists(path+'.part')",
    ].join("\n");
    const child = spawn(process.env.PYTHON || "python", ["-I", "-", "http://127.0.0.1:" + address.port, dir, digest],
      { stdio: ["pipe", "ignore", "pipe"], windowsHide: true, timeout: 30000 });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
    const finished = once(child, "close");
    child.stdin.end(driver);
    assert.equal((await finished)[0], 0, errors);
    assert.deepEqual(headers, Array.from({ length: 4 }).flatMap(() => ["Bearer fixture", undefined]));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
