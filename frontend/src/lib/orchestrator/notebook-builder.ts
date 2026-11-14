export interface PrewarmModelItem {
  category: string;
  filename: string;
}

export interface CustomNodeBootstrapItem {
  name: string;
  repoUrl: string;
}

export interface NotebookBuildConfig {
  provider: "kaggle" | "colab";
  appWebhookUrl: string;
  registrationJwt: string;
  vmSecret: string;
  gdriveTokenJson: string;
  gdriveBaseFolder: string;
  gpuTargets: string[]; // ["gpu0", "gpu1"] for Kaggle Dual-T4, ["gcgpu"] for Colab
  accountAlias: string;
  workerProfile?: string;
  customNodes?: CustomNodeBootstrapItem[];
  idleTimeoutSeconds?: number;
  enableOfflineDatasetScan?: boolean;
  prewarmModels?: PrewarmModelItem[];
}

export interface CpuMirrorModelItem {
  slug: string;
  category: string;
  subdir?: string;
  filename: string;
  url: string;
  authHeader?: string;
  expectedSizeBytes?: number;
  sha256?: string;
}

export interface CpuMirrorConfig {
  appWebhookUrl: string;
  registrationJwt: string;
  gdriveTokenJson: string;
  gdriveBaseFolder: string;
  models: CpuMirrorModelItem[];
}

/**
 * Generates an executable Python bootstrapper for either Kaggle Dual-T4 or Colab Single-T4.
 * Runs:
 *  - Rclone RC daemon (:5572) streaming via HTTP/1.1 multi-thread from Google Drive into /tmp/models
 *  - ComfyUI instance(s) bound via CUDA_VISIBLE_DEVICES (:8188 and :8189)
 *  - In-band Sidecar (:9999) for /vm-kill, /sync-output -> GDrive, /storage, /save-workflow, /health
 *  - Caddy reverse proxy (:8000) enforcing X-VM-Secret / cookie handshake & X-Target-Port
 *  - 1 Route-less Cloudflare Quick Tunnel -> Heartbeat loop back to Next.js
 */
export function buildUnifiedNotebookPythonCode(cfg: NotebookBuildConfig): string {
  const isKaggle = cfg.provider === "kaggle";
  const workDir = isKaggle ? "/kaggle/working" : "/content";
  const idleSeconds = cfg.idleTimeoutSeconds ?? 900;
  const ports = isKaggle && cfg.gpuTargets.length > 1 ? [8188, 8189] : [8188];
  const rcloneStreams = isKaggle ? "8" : "10";
  const rcloneBuffer = isKaggle ? "16M" : "8M";
  const rcloneTransfers = isKaggle ? "2" : "1";
  const prewarmModels = cfg.prewarmModels ?? [];
  const profileId = (cfg.workerProfile || "IMAGE_CORE").replace(/[^a-zA-Z0-9_-]/g, "_");
  const customNodes = cfg.customNodes ?? [];

  return `import os, sys, re, time, json, uuid, hashlib, shutil, zipfile, tarfile, sysconfig, subprocess, threading, urllib.request, urllib.parse, urllib.error
from collections import deque
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP_URL = ${JSON.stringify(cfg.appWebhookUrl.replace(/\/$/, ""))}
REG_JWT = ${JSON.stringify(cfg.registrationJwt)}
VM_SECRET = ${JSON.stringify(cfg.vmSecret)}
PROVIDER = ${JSON.stringify(cfg.provider)}
ACCOUNT_ALIAS = ${JSON.stringify(cfg.accountAlias)}
PROFILE_ID = ${JSON.stringify(profileId)}
CUSTOM_NODES = ${JSON.stringify(customNodes)}
TARGETS = ${JSON.stringify(cfg.gpuTargets)}
PORTS = ${JSON.stringify(ports)}
WORK_DIR = ${JSON.stringify(workDir)}
GDRIVE_BASE = ${JSON.stringify(cfg.gdriveBaseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria")}
GDRIVE_TOKEN_RAW = ${JSON.stringify(cfg.gdriveTokenJson)}
IDLE_TIMEOUT_SEC = ${idleSeconds}
ENABLE_OFFLINE_SCAN = ${cfg.enableOfflineDatasetScan ? "True" : "False"}
PREWARM_MODELS = ${JSON.stringify(prewarmModels)}

LAST_ACTIVE = time.time()
BOOT_LOGS = deque(maxlen=150)
LOG_LOCK = threading.Lock()
PENDING_LOGS = []
FETCH_JOBS = {}
FETCH_LOCK = threading.Lock()
RCLONE_READY = False
TUNNEL_URL = None
CURRENT_STEP = 1
T_BOOT_START = time.time()
STEP_START = time.time()
STEP_DURATIONS = {}
EVER_CONNECTED = False
HEARTBEAT_FAIL_STREAK = 0
LAST_HB_SENT = 0.0
COMFY_DIR = "/tmp/ComfyUI"
FASTBOOT_SITE = "/tmp/sc_site_packages"
PY_VER_TAG = f"{sys.version_info.major}{sys.version_info.minor}"
FASTBOOT_REMOTE = f"{GDRIVE_BASE}/cache/fastboot_{PROVIDER}_{PROFILE_ID}_py{PY_VER_TAG}_v2.tar.gz"

def log_event(msg, category="SYSTEM", level="INFO"):
    line = f"[{category}] {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        entry = {"category": category, "level": level, "message": msg}
        BOOT_LOGS.append(entry)
        PENDING_LOGS.append(entry)

def has_pending_logs():
    with LOG_LOCK:
        return len(PENDING_LOGS) > 0

def post_heartbeat(step, status="STARTING", telemetry=None):
    global CURRENT_STEP, EVER_CONNECTED, HEARTBEAT_FAIL_STREAK, LAST_HB_SENT, STEP_START, STEP_DURATIONS
    now = time.time()
    if step > CURRENT_STEP:
        prev_step = CURRENT_STEP
        STEP_DURATIONS[str(prev_step)] = round(now - STEP_START, 1)
        CURRENT_STEP = step
        STEP_START = now
    elif step == 5 and CURRENT_STEP == 5 and "5" not in STEP_DURATIONS:
        STEP_DURATIONS["5"] = round(now - STEP_START, 1)
    LAST_HB_SENT = now
    with LOG_LOCK:
        logs_batch = PENDING_LOGS[:]
        PENDING_LOGS.clear()
    telem = dict(telemetry or {})
    telem["stepDurations"] = dict(STEP_DURATIONS)
    telem["currentStepElapsed"] = round(now - STEP_START, 1)
    telem["totalBootElapsed"] = round(now - T_BOOT_START, 1)
    payload = {
        "token": REG_JWT,
        "tunnelUrl": TUNNEL_URL or "",
        "targets": TARGETS,
        "stepProgress": step,
        "status": status,
        "telemetry": telem,
        "logs": logs_batch,
    }
    try:
        req = urllib.request.Request(
            f"{APP_URL}/api/vm/heartbeat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-VM/3.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        EVER_CONNECTED = True
        HEARTBEAT_FAIL_STREAK = 0
    except urllib.error.HTTPError as he:
        if he.code == 410:
            print("[HEARTBEAT] Session cancelled (410). Exiting to save quota.", flush=True)
            if PROVIDER == "colab":
                try:
                    from google.colab import runtime
                    runtime.unassign()
                except Exception:
                    pass
            os._exit(0)
        HEARTBEAT_FAIL_STREAK += 1
        print(f"[HEARTBEAT] HTTP {he.code}: {he.reason}", flush=True)
    except Exception as e:
        HEARTBEAT_FAIL_STREAK += 1
        print(f"[HEARTBEAT] Warning: {e}", flush=True)

def _crash_hook(exc_type, exc_val, exc_tb):
    import traceback
    tb = "".join(traceback.format_exception(exc_type, exc_val, exc_tb))
    log_event(f"Worker crashed: {exc_val}\\n{tb[-500:]}", category="ERROR", level="ERROR")
    post_heartbeat(0, "ERROR", {})
    sys.__excepthook__(exc_type, exc_val, exc_tb)

sys.excepthook = _crash_hook

os.makedirs(WORK_DIR, exist_ok=True)
os.chdir(WORK_DIR)
t_boot_start = time.time()
log_event(f"FastBoot starting {PROVIDER.upper()} worker ({ACCOUNT_ALIAS}, targets={TARGETS})...", category=PROVIDER.upper())
post_heartbeat(2, "STARTING")

# -------------------------------------------------------------
# 1. Verify /tmp Disk Overlay & Prepare Model / Output Dirs
# -------------------------------------------------------------
CATEGORIES = [
    "checkpoints", "loras", "vae", "unet", "clip",
    "clip_vision", "controlnet", "ipadapter", "text_encoders",
    "upscale_models", "diffusion_models", "ultralytics", "sams",
    "tts", "audio_sfx", "audio_bgm", "lipsync"
]

try:
    tmp_fs = subprocess.run(["stat", "-f", "-c", "%T", "/tmp"], capture_output=True, text=True).stdout.strip()
    if tmp_fs == "tmpfs":
        fallback_root = "/kaggle/tmp_models" if PROVIDER == "kaggle" else os.path.join(WORK_DIR, "tmp_models")
        os.makedirs(fallback_root, exist_ok=True)
        if not os.path.islink("/tmp/models") and not os.path.exists("/tmp/models"):
            os.symlink(fallback_root, "/tmp/models")
        log_event(f"/tmp is tmpfs; redirected /tmp/models -> {fallback_root}", category="SYSTEM", level="WARN")
    else:
        log_event(f"Storage topology verified: /tmp is {tmp_fs or 'disk-backed'}.", category="SYSTEM")
except Exception as e:
    log_event(f"Storage check notice: {e}", category="SYSTEM")

if PROVIDER == "colab":
    subprocess.run(["sysctl", "-w", "vm.dirty_ratio=35", "vm.dirty_background_ratio=10"], capture_output=True, check=False)

for d in CATEGORIES:
    os.makedirs(f"/tmp/models/{d}", exist_ok=True)
os.makedirs("/tmp/outputs", exist_ok=True)
os.makedirs(FASTBOOT_SITE, exist_ok=True)

with open("/tmp/extra_model_paths.yaml", "w", encoding="utf-8") as f:
    f.write("""scriptoria_tmp:
    base_path: /tmp/models/
    checkpoints: checkpoints/
    loras: loras/
    vae: vae/
    unet: unet/
    clip: clip/
    clip_vision: clip_vision/
    controlnet: controlnet/
    ipadapter: ipadapter/
    text_encoders: text_encoders/
    upscale_models: upscale_models/
    diffusion_models: diffusion_models/
    ultralytics: ultralytics/
    sams: sams/
    tts: tts/
    audio_sfx: audio_sfx/
    audio_bgm: audio_bgm/
    lipsync: lipsync/
""")

def rc_post(action, payload, timeout=60):
    req = urllib.request.Request(
        f"http://127.0.0.1:5572/{action}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def rc_copy_async(payload, max_wait=240, label="transfer"):
    job = rc_post("operations/copyfile", {**payload, "_async": True}, timeout=15)
    jobid = job.get("jobid")
    if not jobid:
        return
    deadline = time.time() + max_wait
    while time.time() < deadline:
        st = rc_post("job/status", {"jobid": jobid}, timeout=10)
        if st.get("finished"):
            if st.get("success"):
                return
            raise RuntimeError(st.get("error") or f"{label} failed")
        time.sleep(0.5)
    raise TimeoutError(f"{label} timed out after {max_wait}s")

def _safe_model_target(category, filename, subdir=""):
    clean_cat = os.path.basename(str(category or "checkpoints").strip())
    if clean_cat not in CATEGORIES:
        clean_cat = "checkpoints"
    base_real = os.path.realpath("/tmp/models")
    rel_parts = [p for p in str(subdir or "").replace("\\\\", "/").split("/") if p and p not in (".", "..")]
    clean_name = os.path.basename(str(filename or "").strip())
    target_path = os.path.realpath(os.path.join(base_real, clean_cat, *rel_parts, clean_name))
    if not clean_name or not target_path.startswith(base_real + os.sep):
        return None, None, None
    rel_sub = "/".join(rel_parts)
    return clean_cat, rel_sub, target_path

def _evict_lru_models_if_needed(required_bytes=0, min_free_gb=6.0):
    try:
        du = shutil.disk_usage("/tmp/models")
        min_keep = max(int(min_free_gb * (1024 ** 3)), int(required_bytes or 0) + (2 * (1024 ** 3)))
        if du.free >= min_keep:
            return
        candidates = []
        for root, _, files in os.walk("/tmp/models"):
            for fname in files:
                fpath = os.path.join(root, fname)
                if os.path.isfile(fpath) and not os.path.islink(fpath):
                    try:
                        st = os.stat(fpath)
                        candidates.append((st.st_atime or st.st_mtime, st.st_size, fpath))
                    except Exception:
                        pass
        candidates.sort(key=lambda x: x[0])
        for _, sz, fpath in candidates:
            du = shutil.disk_usage("/tmp/models")
            if du.free >= min_keep:
                break
            try:
                os.remove(fpath)
                log_event(f"LRU evicted {os.path.basename(fpath)} ({round(sz / (1024**3), 2)} GB) to keep /tmp free.", category="SYSTEM", level="WARN")
            except Exception:
                pass
    except Exception:
        pass

def _post_backup_callback(slug, status, gdrive_path="", gdrive_file_id="", size_bytes=None, error_msg=""):
    if not slug:
        return
    try:
        payload = {
            "token": REG_JWT,
            "slug": slug,
            "status": status,
            "gdrivePath": gdrive_path,
            "gdriveFileId": gdrive_file_id,
            "sizeBytes": size_bytes,
            "error": error_msg,
        }
        req = urllib.request.Request(
            f"{APP_URL}/api/catalog/backup-callback",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-VM/3.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception:
        pass

def _run_fetch_job(job_id, url, category, subdir, filename, target_path, expected_size, sha256_hex, auth_header, backup_to_gdrive, asset_slug):
    def _upd(**kw):
        with FETCH_LOCK:
            if job_id in FETCH_JOBS:
                FETCH_JOBS[job_id].update(kw)

    tmp_dl = target_path + ".part"
    try:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        _evict_lru_models_if_needed(expected_size or 0)
        _upd(status="downloading", startedAt=time.time())
        t0 = time.time()

        used_aria2 = False
        if shutil.which("aria2c"):
            cmd = [
                "aria2c", "-x", "16", "-s", "16", "-k", "4M",
                "--file-allocation=none", "--allow-overwrite=true",
                "--auto-file-renaming=false", "--summary-interval=1",
                "-d", os.path.dirname(tmp_dl), "-o", os.path.basename(tmp_dl),
            ]
            if auth_header:
                cmd.extend(["--header", f"Authorization: {auth_header}"])
            cmd.append(url)
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            while proc.poll() is None:
                if os.path.exists(tmp_dl):
                    done = os.path.getsize(tmp_dl)
                    elapsed = max(0.1, time.time() - t0)
                    spd = done / elapsed
                    pct = min(99, round((done / expected_size) * 100)) if expected_size else 0
                    eta = max(1, round((expected_size - done) / spd)) if (expected_size and spd > 0 and expected_size > done) else None
                    _upd(bytesDone=done, totalBytes=expected_size or 0, percentage=pct, speedMbps=round(spd / (1024 ** 2), 1), etaSeconds=eta)
                time.sleep(0.7)
            if proc.returncode == 0 and os.path.exists(tmp_dl):
                used_aria2 = True

        if not used_aria2:
            headers = {"User-Agent": "Scriptoria-Fetcher/3.0"}
            if auth_header:
                headers["Authorization"] = auth_header
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                hdr_len = int(resp.headers.get("Content-Length") or 0)
                tot = expected_size or hdr_len
                done = 0
                with open(tmp_dl, "wb") as out:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        done += len(chunk)
                        elapsed = max(0.1, time.time() - t0)
                        spd = done / elapsed
                        pct = min(99, round((done / tot) * 100)) if tot else 0
                        eta = max(1, round((tot - done) / spd)) if (tot and spd > 0 and tot > done) else None
                        _upd(bytesDone=done, totalBytes=tot, percentage=pct, speedMbps=round(spd / (1024 ** 2), 1), etaSeconds=eta)

        if sha256_hex:
            h = hashlib.sha256()
            with open(tmp_dl, "rb") as hf:
                while True:
                    b = hf.read(4 * 1024 * 1024)
                    if not b:
                        break
                    h.update(b)
            actual_hash = h.hexdigest().lower()
            if actual_hash != sha256_hex.lower():
                raise RuntimeError(f"SHA256 mismatch (expected {sha256_hex[:12]}..., got {actual_hash[:12]}...)")

        os.replace(tmp_dl, target_path)
        final_size = os.path.getsize(target_path)
        _upd(status="completed", bytesDone=final_size, totalBytes=final_size, percentage=100, speedMbps=0, etaSeconds=0)
        log_event(f"Direct fetch complete: {filename} ({round(final_size / (1024**3), 2)} GB) in {round(time.time() - t0, 1)}s", category="RCLONE", level="SUCCESS")

        if backup_to_gdrive and RCLONE_READY:
            def _bg_backup():
                remote_dir = f"{GDRIVE_BASE}/models/{category}" + (f"/{subdir}" if subdir else "")
                remote_path = f"{remote_dir}/{filename}"
                try:
                    _upd(backupStatus="BACKING_UP")
                    try:
                        rc_post("operations/mkdir", {"fs": "gdrive:", "remote": remote_dir})
                    except Exception:
                        pass
                    rc_copy_async({
                        "srcFs": os.path.dirname(target_path),
                        "srcRemote": filename,
                        "dstFs": f"gdrive:{remote_dir}",
                        "dstRemote": filename,
                    }, max_wait=600, label=f"Drive backup {filename}")
                    stat = rc_post("operations/stat", {"fs": f"gdrive:{remote_dir}", "remote": filename}, timeout=15)
                    fid = (stat.get("item") or {}).get("ID", "")
                    _upd(backupStatus="BACKED_UP")
                    log_event(f"Backed up {filename} -> gdrive:{remote_path}", category="RCLONE", level="SUCCESS")
                    _post_backup_callback(asset_slug, "BACKED_UP", remote_path, fid, final_size)
                except Exception as be:
                    _upd(backupStatus="FAILED")
                    log_event(f"Drive backup warning ({filename}): {be}", category="RCLONE", level="WARN")
                    _post_backup_callback(asset_slug, "FAILED", remote_path, "", final_size, str(be))
            threading.Thread(target=_bg_backup, daemon=True).start()
    except Exception as fe:
        try:
            if os.path.exists(tmp_dl):
                os.remove(tmp_dl)
        except Exception:
            pass
        _upd(status="failed", error=str(fe))
        log_event(f"Direct fetch failed ({filename}): {fe}", category="ERROR", level="ERROR")

# -------------------------------------------------------------
# 2. Start Sidecar (:9999) Immediately + Prepare Rclone / Caddy Config
# -------------------------------------------------------------
class SidecarHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _authorized(self):
        return self.headers.get("X-VM-Secret") == VM_SECRET

    def do_GET(self):
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()
        if not self._authorized():
            self.send_response(403); self.end_headers(); return
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "targets": TARGETS, "ports": PORTS}).encode())
        elif self.path == "/logs":
            with LOG_LOCK:
                snapshot = list(BOOT_LOGS)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"logs": snapshot}).encode())
        elif self.path.startswith("/storage"):
            du = shutil.disk_usage("/tmp")
            files = []
            base_models = "/tmp/models"
            for root, _, fnames in os.walk(base_models):
                rel_root = os.path.relpath(root, base_models)
                if rel_root == ".":
                    continue
                parts = rel_root.replace("\\\\", "/").split("/")
                cat = parts[0]
                sub = "/".join(parts[1:])
                for fname in fnames:
                    if fname.endswith(".part"):
                        continue
                    fpath = os.path.join(root, fname)
                    if os.path.isfile(fpath) or os.path.islink(fpath):
                        try:
                            st = os.stat(fpath)
                            files.append({
                                "category": cat,
                                "name": f"{sub}/{fname}" if sub else fname,
                                "sizeBytes": st.st_size,
                                "modifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
                            })
                        except Exception:
                            pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "disk": {
                    "totalGb": round(du.total / (1024 ** 3), 2),
                    "usedGb": round(du.used / (1024 ** 3), 2),
                    "freeGb": round(du.free / (1024 ** 3), 2),
                },
                "files": files,
            }).encode())
        elif self.path.startswith("/fetch-status"):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            jid = (qs.get("jobId") or [""])[0]
            with FETCH_LOCK:
                info = dict(FETCH_JOBS.get(jid) or {}) if jid else {"jobs": list(FETCH_JOBS.values())}
            if jid and not info:
                self.send_response(404); self.end_headers(); return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(info).encode())
        else:
            self.send_response(404); self.end_headers()

    def do_DELETE(self):
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()
        if not self._authorized():
            self.send_response(403); self.end_headers(); return
        if self.path.startswith("/storage"):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            cat = os.path.basename((qs.get("category") or [""])[0])
            raw_name = str((qs.get("name") or [""])[0]).replace("\\\\", "/").lstrip("/")
            rel_parts = [p for p in raw_name.split("/") if p and p not in (".", "..")]
            base_real = os.path.realpath("/tmp/models")
            target_real = os.path.realpath(os.path.join(base_real, cat, *rel_parts))
            if not cat or not rel_parts or not target_real.startswith(base_real + os.sep) or not os.path.exists(target_real):
                self.send_response(404); self.end_headers(); return
            os.remove(target_real)
            log_event(f"Deleted cached model /tmp/models/{cat}/{'/'.join(rel_parts)}", category="SYSTEM")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_response(404); self.end_headers()

    def do_POST(self):
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()
        if not self._authorized():
            self.send_response(403); self.end_headers(); return

        if self.path == "/vm-kill":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"TERMINATING"}')
            def terminate_vm():
                time.sleep(0.8)
                if PROVIDER == "colab":
                    try:
                        from google.colab import runtime
                        runtime.unassign()
                    except Exception:
                        pass
                os._exit(0)
            threading.Thread(target=terminate_vm, daemon=False).start()
            return

        if self.path == "/save-workflow":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            fname = os.path.basename(str(body.get("filename") or "scriptoria_workflow.json"))
            if not fname.endswith(".json"):
                fname += ".json"
            wf_data = body.get("workflow")
            if wf_data is None:
                self.send_response(400); self.end_headers(); return
            wf_dir = os.path.join(COMFY_DIR, "user", "default", "workflows")
            os.makedirs(wf_dir, exist_ok=True)
            wf_path = os.path.join(wf_dir, fname)
            with open(wf_path, "w", encoding="utf-8") as wf:
                json.dump(wf_data, wf, indent=2)
            log_event(f"Saved workflow to {wf_path}", category="COMFYUI", level="SUCCESS")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "path": f"workflows/{fname}"}).encode())
            return

        if self.path == "/fetch-url":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            url = str(body.get("url") or "").strip()
            raw_cat = str(body.get("category") or "checkpoints")
            subdir = str(body.get("subdir") or "")
            filename = str(body.get("filename") or "").strip()
            expected_size = int(body.get("expectedSizeBytes") or 0)
            sha256_hex = str(body.get("sha256") or "").strip()
            auth_header = str(body.get("authHeader") or "").strip()
            backup_to_gdrive = bool(body.get("backupToGdrive", True))
            asset_slug = str(body.get("assetSlug") or "").strip()

            clean_cat, rel_sub, target_path = _safe_model_target(raw_cat, filename, subdir)
            if not url or not target_path:
                self.send_response(400); self.end_headers(); return

            if os.path.exists(target_path):
                sz = os.path.getsize(target_path)
                if sz > 0 and (expected_size == 0 or sz == expected_size):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "status": "skipped",
                        "alreadyCached": True,
                        "sizeBytes": sz,
                        "path": target_path,
                    }).encode())
                    return

            job_id = str(uuid.uuid4())[:12]
            with FETCH_LOCK:
                FETCH_JOBS[job_id] = {
                    "jobId": job_id,
                    "filename": filename,
                    "category": clean_cat,
                    "status": "queued",
                    "bytesDone": 0,
                    "totalBytes": expected_size,
                    "percentage": 1,
                    "speedMbps": 0,
                    "etaSeconds": None,
                    "backupStatus": "PENDING" if backup_to_gdrive else "NONE",
                    "error": None,
                }
            threading.Thread(
                target=_run_fetch_job,
                args=(job_id, url, clean_cat, rel_sub, filename, target_path, expected_size, sha256_hex, auth_header, backup_to_gdrive, asset_slug),
                daemon=True,
            ).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "started", "jobId": job_id, "filename": filename, "category": clean_cat}).encode())
            return

        if self.path == "/sync-output":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            filename = body.get("filename", "")
            subfolder = body.get("subfolder", "").strip("/")
            if not filename:
                self.send_response(400); self.end_headers(); return

            src_dir = f"/tmp/outputs/{subfolder}" if subfolder else "/tmp/outputs"
            date_dir = time.strftime("%Y-%m-%d")
            remote_dir = f"{GDRIVE_BASE}/outputs/{date_dir}"
            try:
                rc_post("operations/mkdir", {"fs": "gdrive:", "remote": remote_dir})
            except Exception:
                pass
            rc_post("operations/copyfile", {
                "srcFs": src_dir,
                "srcRemote": filename,
                "dstFs": f"gdrive:{remote_dir}",
                "dstRemote": filename,
            })
            stat = rc_post("operations/stat", {"fs": f"gdrive:{remote_dir}", "remote": filename})
            file_id = (stat.get("item") or {}).get("ID", "")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "gdriveFileId": file_id,
                "gdrivePath": f"{remote_dir}/{filename}"
            }).encode())
            return

        self.send_response(404); self.end_headers()

threading.Thread(target=lambda: ThreadingHTTPServer(("127.0.0.1", 9999), SidecarHandler).serve_forever(), daemon=True).start()

try:
    gdrive_cfg = json.loads(GDRIVE_TOKEN_RAW)
except Exception:
    gdrive_cfg = {}

client_id = gdrive_cfg.pop("client_id", "")
client_secret = gdrive_cfg.pop("client_secret", "")
refresh_token = gdrive_cfg.get("refresh_token", "")

if refresh_token and client_id and client_secret:
    try:
        token_req_data = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode("utf-8")
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=token_req_data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            if res_json.get("access_token"):
                gdrive_cfg["access_token"] = res_json["access_token"]
                gdrive_cfg.setdefault("token_type", "Bearer")
                gdrive_cfg["expiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3300))
    except Exception as e:
        log_event(f"OAuth refresh notice: {e}", category="RCLONE", level="WARN")

rclone_lines = ["[gdrive]", "type = drive", "scope = drive"]
if client_id:
    rclone_lines.append(f"client_id = {client_id}")
if client_secret:
    rclone_lines.append(f"client_secret = {client_secret}")
rclone_lines.append(f"token = {json.dumps(gdrive_cfg)}")
with open("/tmp/rclone.conf", "w", encoding="utf-8") as f:
    f.write("\\n".join(rclone_lines) + "\\n")

with open("/tmp/Caddyfile", "w", encoding="utf-8") as f:
    f.write(f"""(sc_dispatch) {{
    @has_header header X-Target-Port *
    handle @has_header {{
        @badport not header_regexp X-Target-Port ^(8188|8189|8190|8191|8192|8193|8194|5572|9999)$
        handle @badport {{
            respond "Invalid Target Port" 400
        }}
        handle {{
            reverse_proxy 127.0.0.1:{{http.request.header.X-Target-Port}} {{
                header_up Host 127.0.0.1
                flush_interval -1
            }}
        }}
    }}
    @want8189 header_regexp Cookie (^|;\\\\s*)sc_vm_port=8189(;|$)
    handle @want8189 {{
        reverse_proxy 127.0.0.1:8189 {{
            header_up Host 127.0.0.1
            flush_interval -1
        }}
    }}
    handle {{
        reverse_proxy 127.0.0.1:8188 {{
            header_up Host 127.0.0.1
            flush_interval -1
        }}
    }}
}}

:8000 {{
    @auth_url {{
        path /scriptoria-auth
        query token={VM_SECRET}
    }}
    handle @auth_url {{
        @port8189 query port=8189
        @port8188 query port=8188
        route {{
            header +Set-Cookie "sc_vm_auth={VM_SECRET}; Path=/; HttpOnly; SameSite=Lax; Secure"
            header @port8189 +Set-Cookie "sc_vm_port=8189; Path=/; HttpOnly; SameSite=Lax; Secure"
            header @port8188 +Set-Cookie "sc_vm_port=8188; Path=/; HttpOnly; SameSite=Lax; Secure"
            redir / 302
        }}
    }}
    @has_secret header X-VM-Secret "{VM_SECRET}"
    handle @has_secret {{
        import sc_dispatch
    }}
    @has_bearer header Authorization "Bearer {VM_SECRET}"
    handle @has_bearer {{
        import sc_dispatch
    }}
    @has_cookie header_regexp Cookie (^|;\\\\s*)sc_vm_auth={VM_SECRET}(;|$)
    handle @has_cookie {{
        import sc_dispatch
    }}
    handle {{
        respond "Unauthorized" 403
    }}
}}
""")

# -------------------------------------------------------------
# 3. Parallel Stage: Rclone + Caddy + Cloudflared + uv Binary
# -------------------------------------------------------------
def setup_rclone():
    global RCLONE_READY
    if not gdrive_cfg:
        log_event("Google Drive token omitted; skipping Rclone Drive cache.", category="RCLONE", level="WARN")
        return False
    t0 = time.time()
    try:
        if not os.path.exists("/usr/local/bin/rclone"):
            subprocess.run(["curl", "-sSLf", "https://downloads.rclone.org/rclone-current-linux-amd64.zip", "-o", "/tmp/rclone.zip"], check=True)
            with zipfile.ZipFile("/tmp/rclone.zip", "r") as zf:
                for member in zf.namelist():
                    if member.endswith("/rclone"):
                        with zf.open(member) as src, open("/usr/local/bin/rclone", "wb") as dst:
                            dst.write(src.read())
                        break
            os.chmod("/usr/local/bin/rclone", 0o755)
            try:
                os.remove("/tmp/rclone.zip")
            except Exception:
                pass
    except Exception as re_err:
        log_event(f"Rclone binary setup failed: {re_err}", category="RCLONE", level="ERROR")
        return False

    rclone_log = open("/tmp/rclone.log", "w")
    subprocess.Popen([
        "/usr/local/bin/rclone", "rcd",
        "--config", "/tmp/rclone.conf",
        "--rc-addr", "127.0.0.1:5572",
        "--rc-no-auth",
        "--rc-job-expire-duration", "30m",
        "--rc-job-expire-interval", "5m",
        "--drive-disable-http2=true",
        "--disable-http2",
        "--multi-thread-cutoff", "64M",
        "--multi-thread-chunk-size", "128M",
        "--multi-thread-streams", "${rcloneStreams}",
        "--multi-thread-write-buffer-size", "1M",
        "--buffer-size", "${rcloneBuffer}",
        "--transfers", "${rcloneTransfers}",
        "--checkers", "4",
        "--tpslimit", "12",
        "--tpslimit-burst", "24",
        "--drive-pacer-min-sleep", "10ms",
        "--drive-pacer-burst", "100",
        "--timeout", "5m",
        "--contimeout", "30s",
        "--low-level-retries", "10",
        "--retries", "3"
    ], stdout=rclone_log, stderr=rclone_log)

    for _ in range(40):
        try:
            rc_post("rc/noop", {}, timeout=2)
            RCLONE_READY = True
            log_event(f"Rclone RC (:5572) ready in {round(time.time() - t0, 1)}s (HTTP/1.1 multi-thread)", category="RCLONE", level="SUCCESS")
            for pw in PREWARM_MODELS:
                pw_cat = pw.get("category", "checkpoints")
                pw_file = pw.get("filename", "")
                if pw_file:
                    try:
                        rc_post("operations/copyfile", {
                            "srcFs": f"gdrive:{GDRIVE_BASE}/models/{pw_cat}",
                            "srcRemote": pw_file,
                            "dstFs": f"/tmp/models/{pw_cat}",
                            "dstRemote": pw_file,
                            "_async": True,
                            "_config": {
                                "SizeOnly": True, "Inplace": False,
                                "MultiThreadCutoff": "64M", "MultiThreadChunkSize": "128M",
                                "MultiThreadStreams": ${rcloneStreams}, "MultiThreadWriteBufferSize": "1M",
                                "BufferSize": "${rcloneBuffer}", "DisableHTTP2": True,
                            },
                        }, timeout=5)
                        log_event(f"Pre-warming {pw_file} while ComfyUI boots...", category="RCLONE")
                    except Exception:
                        pass
            return True
        except Exception:
            time.sleep(0.2)
    log_event("Rclone RC readiness check timed out", category="RCLONE", level="WARN")
    return False

def setup_caddy():
    t0 = time.time()
    try:
        if not os.path.exists("/tmp/caddy"):
            try:
                os.makedirs("/tmp/caddy_dl", exist_ok=True)
                subprocess.run([
                    "curl", "-sSLf",
                    "https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_linux_amd64.tar.gz",
                    "-o", "/tmp/caddy.tar.gz"
                ], check=True)
                subprocess.run(["tar", "-xzf", "/tmp/caddy.tar.gz", "-C", "/tmp/caddy_dl"], check=True)
                shutil.move("/tmp/caddy_dl/caddy", "/tmp/caddy")
                shutil.rmtree("/tmp/caddy_dl", ignore_errors=True)
                try:
                    os.remove("/tmp/caddy.tar.gz")
                except Exception:
                    pass
            except Exception:
                shutil.rmtree("/tmp/caddy_dl", ignore_errors=True)
                subprocess.run(["curl", "-sSLf", "https://caddyserver.com/api/download?os=linux&arch=amd64", "-o", "/tmp/caddy"], check=True)
            os.chmod("/tmp/caddy", 0o755)
        caddy_log = open("/tmp/caddy.log", "w")
        subprocess.Popen(["/tmp/caddy", "run", "--config", "/tmp/Caddyfile"], stdout=caddy_log, stderr=caddy_log)
        for _ in range(40):
            if is_caddy_ready():
                log_event(f"Caddy ingress (:8000) ready in {round(time.time() - t0, 1)}s", category="NETWORK", level="SUCCESS")
                return True
            time.sleep(0.25)
        log_event("Caddy did not bind :8000 within 10s", category="NETWORK", level="WARN")
    except Exception as ce:
        log_event(f"Caddy setup failed: {ce}", category="ERROR", level="ERROR")
    return False

def is_caddy_ready():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1.5) as resp:
            return resp.status > 0
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False

def setup_cloudflared():
    global TUNNEL_URL
    try:
        if not os.path.exists("/tmp/cloudflared"):
            subprocess.run(["curl", "-sSLf", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", "-o", "/tmp/cloudflared"], check=True)
            os.chmod("/tmp/cloudflared", 0o755)
    except Exception as ce:
        log_event(f"cloudflared download failed: {ce}", category="ERROR", level="ERROR")
        return None

    for attempt in range(1, 4):
        cf_proc = None
        try:
            with open("/tmp/cf.log", "w") as out:
                cf_proc = subprocess.Popen(
                    ["/tmp/cloudflared", "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"],
                    stdout=out,
                    stderr=subprocess.STDOUT,
                )
            for _ in range(35):
                time.sleep(1)
                if cf_proc.poll() is not None:
                    break
                if os.path.exists("/tmp/cf.log"):
                    content = open("/tmp/cf.log", "r", errors="ignore").read()
                    m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", content)
                    if m:
                        TUNNEL_URL = m.group(0)
                        log_event(f"Route-less Quick Tunnel live in {round(time.time() - t_boot_start, 1)}s: {TUNNEL_URL}", category="NETWORK", level="SUCCESS")
                        post_heartbeat(CURRENT_STEP, "STARTING")
                        return TUNNEL_URL
            log_event(f"Quick Tunnel attempt {attempt}/3 timed out; retrying...", category="NETWORK", level="WARN")
        except Exception as te:
            log_event(f"Quick Tunnel attempt {attempt}/3 failed: {te}", category="NETWORK", level="WARN")
        if cf_proc and cf_proc.poll() is None:
            try:
                cf_proc.terminate()
            except Exception:
                pass
        time.sleep(1)
    log_event("Unable to obtain Cloudflare Quick Tunnel after 3 attempts.", category="ERROR", level="ERROR")
    return None

def setup_uv():
    if not os.path.exists("/tmp/uv"):
        try:
            subprocess.run(["curl", "-sSLf", "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz", "-o", "/tmp/uv.tar.gz"], check=True)
            subprocess.run(["tar", "-xzf", "/tmp/uv.tar.gz", "-C", "/tmp", "--strip-components=1"], check=True)
            os.chmod("/tmp/uv", 0o755)
            os.remove("/tmp/uv.tar.gz")
        except Exception as ue:
            log_event(f"uv binary download failed ({ue}); will fall back to pip if needed", category="COMFYUI", level="WARN")

def setup_aria2():
    if shutil.which("aria2c") is None:
        try:
            subprocess.run(["bash", "-lc", "apt-get update -qq && apt-get install -y -qq aria2 >/dev/null 2>&1"], check=False, timeout=45)
        except Exception:
            pass

threading.Thread(target=setup_caddy, daemon=True).start()
threading.Thread(target=setup_cloudflared, daemon=True).start()
threading.Thread(target=setup_aria2, daemon=True).start()
uv_thread = threading.Thread(target=setup_uv, daemon=True)
uv_thread.start()
rclone_ok = setup_rclone()

# -------------------------------------------------------------
# 3B. Dedicated LLM Nodes (LLM_QWEN_VLM, LLM_QWEN_TEXT_TURBO, LLM_QWEN_MOE_35B & LLM_QWEN_FAST_8B on Dual-T4)
# -------------------------------------------------------------
if PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B", "LLM_LIGHTWEIGHT_SWARM"):
    import http.client as _hc
    from http.server import ThreadingHTTPServer as _THS, BaseHTTPRequestHandler as _BHRH
    from pathlib import Path

    if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
        LLM_MODEL_REPO = "unsloth/Qwen3.5-9B-GGUF"
        MODEL_SUBDIR = "qwen35_swarm"
    elif PROFILE_ID == "LLM_QWEN_FAST_8B":
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3-VL-8B-Instruct-GGUF")
        MODEL_SUBDIR = "qwen3_vl_8b"
    elif PROFILE_ID == "LLM_QWEN_MOE_35B":
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3.6-35B-A3B-GGUF")
        MODEL_SUBDIR = "qwen36_35b_moe"
    elif PROFILE_ID == "LLM_QWEN_TEXT_TURBO":
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3.8-27B-GGUF")
        MODEL_SUBDIR = "qwen38_27b_turbo"
    else:
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3.8-27B-GGUF")
        MODEL_SUBDIR = "qwen38_27b"

    LOCAL_LLM_DIR = f"/tmp/models/llm/{MODEL_SUBDIR}"
    REMOTE_LLM_DIR = f"{GDRIVE_BASE}/models/llm/{MODEL_SUBDIR}"
    os.makedirs(LOCAL_LLM_DIR, exist_ok=True)
    os.makedirs("/tmp/llama_bin", exist_ok=True)

    def _resolve_llama_bin():
        for cand in Path("/kaggle/input").rglob("llama-server") if os.path.exists("/kaggle/input") else []:
            if cand.is_file():
                dst = "/tmp/llama_bin/llama-server"
                shutil.copy2(str(cand), dst)
                os.chmod(dst, 0o755)
                for so in cand.parent.glob("*.so*"):
                    shutil.copy2(str(so), f"/tmp/llama_bin/{so.name}")
                return dst

        if rclone_ok:
            try:
                st = rc_post("operations/stat", {"fs": f"gdrive:{GDRIVE_BASE}/fastboot", "remote": "llama_server_t4_v1.tar.gz"}, timeout=10)
                if (st.get("item") or {}).get("Size", 0) > 100000:
                    log_event("Restoring cached llama-server binary from Google Drive...", category="SYSTEM", level="SUCCESS")
                    rc_copy_async({
                        "srcFs": f"gdrive:{GDRIVE_BASE}/fastboot", "srcRemote": "llama_server_t4_v1.tar.gz",
                        "dstFs": "/tmp", "dstRemote": "llama_bin.tar.gz",
                    }, max_wait=120, label="llama-server restore")
                    subprocess.run(["tar", "-xzf", "/tmp/llama_bin.tar.gz", "-C", "/tmp/llama_bin"], check=True)
                    bpath = "/tmp/llama_bin/llama-server"
                    if os.path.exists(bpath):
                        os.chmod(bpath, 0o755)
                        return bpath
            except Exception as re_err:
                log_event(f"Drive llama-server lookup: {re_err}", category="SYSTEM")

        try:
            log_event("Fetching official ggml-org/llama.cpp Ubuntu CUDA release...", category="SYSTEM")
            rel_req = urllib.request.Request(
                "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=8",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "Scriptoria"},
            )
            with urllib.request.urlopen(rel_req, timeout=20) as rel_resp:
                releases = json.loads(rel_resp.read().decode("utf-8"))
            bin_url = None
            cudart_url = None
            for rel in releases:
                assets = rel.get("assets", []) or []
                b_hit = next((a["browser_download_url"] for a in assets if "bin-ubuntu-cuda-12" in a.get("name", "") and a.get("name", "").startswith("llama-") and a.get("name", "").endswith("-x64.tar.gz")), None)
                c_hit = next((a["browser_download_url"] for a in assets if "bin-ubuntu-cuda-12" in a.get("name", "") and a.get("name", "").startswith("cudart-llama-") and a.get("name", "").endswith("-x64.tar.gz")), None)
                if b_hit:
                    bin_url = b_hit
                    cudart_url = c_hit
                    break
            if not bin_url:
                raise RuntimeError("No Ubuntu CUDA-12 release tarball found in ggml-org/llama.cpp")

            def _dl_fast_bin(url, out_path):
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                if shutil.which("aria2c"):
                    subprocess.run([
                        "aria2c", "-x", "16", "-s", "16", "-k", "1M",
                        "--file-allocation=none", "--allow-overwrite=true",
                        "--auto-file-renaming=false",
                        "-d", os.path.dirname(out_path), "-o", os.path.basename(out_path),
                        url
                    ], check=True, stdout=subprocess.DEVNULL)
                else:
                    subprocess.run(["curl", "-sSL", url, "-o", out_path], check=True)

            _dl_fast_bin(bin_url, "/tmp/llama_cuda.tar.gz")
            subprocess.run(["tar", "-xzf", "/tmp/llama_cuda.tar.gz", "-C", "/tmp/llama_bin"], check=True)
            if cudart_url:
                _dl_fast_bin(cudart_url, "/tmp/llama_cudart.tar.gz")
                subprocess.run(["tar", "-xzf", "/tmp/llama_cudart.tar.gz", "-C", "/tmp/llama_bin"], check=True)
            for root, _, files in os.walk("/tmp/llama_bin"):
                for fname in files:
                    if fname == "llama-server" or ".so" in fname:
                        src_p = os.path.join(root, fname)
                        dst_p = os.path.join("/tmp/llama_bin", fname)
                        if src_p != dst_p and not os.path.exists(dst_p):
                            shutil.copy2(src_p, dst_p)
            dst_srv = "/tmp/llama_bin/llama-server"
            if os.path.exists(dst_srv):
                os.chmod(dst_srv, 0o755)
                chk_env = os.environ.copy()
                chk_env["LD_LIBRARY_PATH"] = f"/tmp/llama_bin:{chk_env.get('LD_LIBRARY_PATH', '')}"
                chk = subprocess.run([dst_srv, "--version"], env=chk_env, capture_output=True, text=True, timeout=15)
                if chk.returncode == 0:
                    log_event(f"Prebuilt llama-server ready: {(chk.stdout or chk.stderr).strip()[:100]}", category="SYSTEM", level="SUCCESS")
                    if rclone_ok:
                        def _pack_and_save_bin():
                            try:
                                subprocess.run(["tar", "-czf", "/tmp/llama_server_t4_v1.tar.gz", "-C", "/tmp/llama_bin", "."], check=True)
                                rc_copy_async({"srcFs": "/tmp", "srcRemote": "llama_server_t4_v1.tar.gz", "dstFs": f"gdrive:{GDRIVE_BASE}/fastboot", "dstRemote": "llama_server_t4_v1.tar.gz"}, max_wait=120, label="Cache llama-server")
                            except Exception:
                                pass
                        threading.Thread(target=_pack_and_save_bin, daemon=True).start()
                    return dst_srv
                raise RuntimeError(f"llama-server --version failed ({chk.returncode}): {(chk.stderr or chk.stdout)[-240:]}")
        except Exception as pe:
            log_event(f"Prebuilt llama-server failed ({pe}); compiling sm_75 once...", category="SYSTEM", level="WARN")

        def _run_logged(cmd_list, step_label):
            res = subprocess.run(cmd_list, capture_output=True, text=True)
            if res.returncode != 0:
                tail = (res.stderr or res.stdout or "")[-400:]
                log_event(f"{step_label} failed (rc={res.returncode}): {tail}", category="ERROR", level="ERROR")
                raise RuntimeError(f"{step_label} failed (rc={res.returncode}): {tail}")

        _run_logged(["bash", "-lc", "which cmake >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq cmake build-essential)"], "apt cmake")
        if not os.path.exists("/tmp/llama_src"):
            _run_logged(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp.git", "/tmp/llama_src"], "git clone llama.cpp")
        _run_logged(["cmake", "-B", "/tmp/llama_src/build", "-S", "/tmp/llama_src", "-DGGML_CUDA=ON", "-DCMAKE_CUDA_ARCHITECTURES=75", "-DLLAMA_CURL=OFF"], "cmake configure")
        _run_logged(["cmake", "--build", "/tmp/llama_src/build", "--config", "Release", "--target", "llama-server", "-j", "4"], "cmake build")
        shutil.copy2("/tmp/llama_src/build/bin/llama-server", "/tmp/llama_bin/llama-server")
        for f_so in os.listdir("/tmp/llama_src/build/bin"):
            if ".so" in f_so:
                shutil.copy2(os.path.join("/tmp/llama_src/build/bin", f_so), os.path.join("/tmp/llama_bin", f_so))
        os.chmod("/tmp/llama_bin/llama-server", 0o755)
        return "/tmp/llama_bin/llama-server"

    def _fast_download_hf(repo_id, filename, dst_dir=LOCAL_LLM_DIR, label="Model"):
        os.makedirs(dst_dir, exist_ok=True)
        final_path = os.path.join(dst_dir, filename)
        if os.path.exists(final_path) and os.path.getsize(final_path) > 1000000:
            log_event(f"Local cache hit for {filename} ({round(os.path.getsize(final_path)/(1024**3), 2)}GB)", category="SYSTEM", level="SUCCESS")
            return final_path
        hf_url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
        part_path = final_path + ".part"
        t0 = time.time()
        last_log = time.time()
        log_event(f"Fast-downloading {filename} from Hugging Face CDN (16 parallel streams)...", category="DOWNLOAD")
        if shutil.which("aria2c"):
            cmd = [
                "aria2c", "-x", "16", "-s", "16", "-k", "4M",
                "--file-allocation=none", "--allow-overwrite=true",
                "--auto-file-renaming=false", "--summary-interval=1",
                "-d", dst_dir, "-o", os.path.basename(part_path),
                hf_url
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            while proc.poll() is None:
                if os.path.exists(part_path):
                    sz = os.path.getsize(part_path)
                    now = time.time()
                    if now - last_log >= 5:
                        spd = sz / max(0.1, now - t0)
                        spd_mb = round(spd / (1024 * 1024), 1)
                        log_event(f"[{label}] Transferred {round(sz/(1024**3), 2)}GB @ {spd_mb} MB/s", category="DOWNLOAD")
                        last_log = now
                time.sleep(1)
            if proc.returncode == 0 and os.path.exists(part_path):
                os.replace(part_path, final_path)
                dur = round(time.time() - t0, 1)
                spd_mb = round(os.path.getsize(final_path) / (max(0.1, dur) * 1024 * 1024), 1)
                log_event(f"[{label}] {filename} ready in {dur}s ({spd_mb} MB/s)!", category="DOWNLOAD", level="SUCCESS")
                return final_path
        uv_thread.join(timeout=30)
        from huggingface_hub import hf_hub_download
        return hf_hub_download(repo_id=repo_id, filename=filename, local_dir=dst_dir)

    def _resolve_qwen_ggufs():
        from pathlib import Path as _P
        if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
            log_event("Resolving 5-Model Swarm weights (9B QC, 4B Extractor, MiniCPM-V 1B)...", category="SYSTEM")
            q9_dir = f"{LOCAL_LLM_DIR}/qwen9b"
            q4_dir = f"{LOCAL_LLM_DIR}/qwen4b"
            cpm_dir = f"{LOCAL_LLM_DIR}/cpm1b"
            os.makedirs(q9_dir, exist_ok=True)
            os.makedirs(q4_dir, exist_ok=True)
            os.makedirs(cpm_dir, exist_ok=True)
            m9 = _fast_download_hf("unsloth/Qwen3.5-9B-GGUF", "Qwen3.5-9B-Q4_K_M.gguf", q9_dir, label="Qwen 9B QC")
            mm9 = _fast_download_hf("unsloth/Qwen3.5-9B-GGUF", "mmproj-F16.gguf", q9_dir, label="Qwen 9B mmproj")
            _fast_download_hf("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf", q4_dir, label="Qwen 4B Extractor")
            _fast_download_hf("openbmb/MiniCPM-V-4.7-1B-gguf", "MiniCPM-V-4_7-1B-Q4_K_M.gguf", cpm_dir, label="MiniCPM-V 1B")
            return m9, mm9, True

        needs_vision = (PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B"))
        is_moe_35b = (PROFILE_ID == "LLM_QWEN_MOE_35B")
        is_fast_8b = (PROFILE_ID == "LLM_QWEN_FAST_8B")
        target_token = "8b" if is_fast_8b else ("35b" if is_moe_35b else "27b")
        m, mm = None, None

        def _is_match(fname, token):
            fn = fname.lower()
            return token in fn and "mmproj" not in fn and "dflash" not in fn

        # 1. Local Kaggle dataset mount (/kaggle/input) -> Instant NVMe (0s)
        if os.path.exists("/kaggle/input"):
            ggufs = list(_P("/kaggle/input").rglob("*.gguf"))
            m = next((str(p) for p in ggufs if _is_match(p.name, target_token)), None)
            if needs_vision:
                mm = next((str(p) for p in ggufs if "mmproj" in p.name.lower() and (target_token in p.name.lower() or "qwen" in p.name.lower())), None)
            if m:
                log_event(f"Mounted Kaggle Dataset Qwen weights: {os.path.basename(m)}", category="SYSTEM", level="SUCCESS")
                return m, mm, False

        # 2. Local isolated cache: /tmp/models/llm/{MODEL_SUBDIR}
        if os.path.exists(LOCAL_LLM_DIR):
            local_files = [str(p) for p in _P(LOCAL_LLM_DIR).glob("*.gguf")]
            m = next((p for p in local_files if _is_match(os.path.basename(p), target_token)), None)
            if needs_vision:
                mm = next((p for p in local_files if "mmproj" in os.path.basename(p).lower()), None)
            if m:
                log_event(f"Reusing cached Qwen weights in {MODEL_SUBDIR}: {os.path.basename(m)}", category="SYSTEM", level="SUCCESS")
                return m, mm, False

        # 3. FastBoot: Check persistent Google Drive isolated mirror: gdrive:{REMOTE_LLM_DIR}
        if rclone_ok:
            try:
                ls = rc_post("operations/list", {"fs": f"gdrive:{REMOTE_LLM_DIR}", "remote": ""}, timeout=15)
                items = ls.get("list", []) or []
                gg_item = next((x for x in items if x.get("Name", "").lower().endswith(".gguf") and _is_match(x.get("Name", ""), target_token)), None)
                mm_item = next((x for x in items if x.get("Name", "").lower().endswith(".gguf") and "mmproj" in x.get("Name", "").lower()), None) if needs_vision else None
                if gg_item:
                    log_event(f"FastBoot cache hit! Streaming {gg_item['Name']} from Drive mirror...", category="RCLONE", level="SUCCESS")
                    rc_copy_async({"srcFs": f"gdrive:{REMOTE_LLM_DIR}", "srcRemote": gg_item["Name"], "dstFs": LOCAL_LLM_DIR, "dstRemote": gg_item["Name"], "_config": {"MultiThreadStreams": 8, "DisableHTTP2": True}}, max_wait=600, label="Qwen GGUF stream")
                    m_local = f"{LOCAL_LLM_DIR}/{gg_item['Name']}"
                    mm_local = None
                    if mm_item:
                        rc_copy_async({"srcFs": f"gdrive:{REMOTE_LLM_DIR}", "srcRemote": mm_item["Name"], "dstFs": LOCAL_LLM_DIR, "dstRemote": mm_item["Name"]}, max_wait=180, label="mmproj stream")
                        mm_local = f"{LOCAL_LLM_DIR}/{mm_item['Name']}"
                    return m_local, mm_local, False
            except Exception as de:
                log_event(f"Drive LLM weights check: {de}", category="RCLONE")

        # 4. Hugging Face CDN (16 parallel streams)
        try:
            uv_thread.join(timeout=30)
            from huggingface_hub import list_repo_files
            files = list_repo_files(LLM_MODEL_REPO)
            ggufs = [f for f in files if f.lower().endswith(".gguf") and "mmproj" not in f.lower() and not f.lower().startswith("mtp/")]
            chosen_gguf = None
            for pat in ["UD-Q4_K_M", "Q4_K_M", "UD-Q4_K_XL", "Q4_K_S", "Q4_0"]:
                hit = [f for f in ggufs if pat.lower() in f.lower() and "-00002-of-" not in f.lower()]
                if hit:
                    chosen_gguf = hit[0]
                    break
            if not chosen_gguf:
                chosen_gguf = ggufs[0] if ggufs else None

            if chosen_gguf:
                lbl = (
                    "Qwen 8B Fast" if is_fast_8b
                    else ("Qwen 35B MoE" if is_moe_35b else "Qwen 27B")
                )
                m = _fast_download_hf(LLM_MODEL_REPO, chosen_gguf, LOCAL_LLM_DIR, label=lbl)

            if needs_vision:
                mms = [f for f in files if f.lower().endswith(".gguf") and "mmproj" in f.lower()]
                chosen_mm = next((f for f in mms if "mmproj-f16" in f.lower()), next((f for f in mms if "f16" in f.lower() or "bf16" in f.lower()), mms[0] if mms else None))
                if chosen_mm:
                    mm = _fast_download_hf(LLM_MODEL_REPO, chosen_mm, LOCAL_LLM_DIR, label="mmproj Vision")

            if m and os.path.exists(m):
                return m, mm, True
        except Exception as hf_err:
            log_event(f"Hugging Face download failed: {hf_err}", category="SYSTEM", level="WARN")

        raise RuntimeError(f"Failed to resolve Qwen weights for {LLM_MODEL_REPO} from Kaggle dataset, Google Drive, or Hugging Face.")

    llama_bin = _resolve_llama_bin()
    model_gguf, mmproj_gguf, downloaded_fresh = _resolve_qwen_ggufs()
    post_heartbeat(3, "STARTING")

    dflash_gguf = None
    if PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO"):
        try:
            if os.path.exists(LOCAL_LLM_DIR):
                dflash_gguf = next((str(p) for p in Path(LOCAL_LLM_DIR).glob("*.gguf") if "dflash" in p.name.lower()), None)
            if not dflash_gguf and rclone_ok:
                try:
                    ls = rc_post("operations/list", {"fs": f"gdrive:{REMOTE_LLM_DIR}", "remote": ""}, timeout=10)
                    df_item = next((x for x in ls.get("list", []) or [] if "dflash" in x.get("Name", "").lower()), None)
                    if df_item:
                        rc_copy_async({"srcFs": f"gdrive:{REMOTE_LLM_DIR}", "srcRemote": df_item["Name"], "dstFs": LOCAL_LLM_DIR, "dstRemote": df_item["Name"]}, max_wait=300, label="DFlash2 stream")
                        dflash_gguf = f"{LOCAL_LLM_DIR}/{df_item['Name']}"
                except Exception:
                    pass
            if not dflash_gguf:
                try:
                    dflash_gguf = _fast_download_hf("z-lab/Qwen3.8-27B-DFlash2-GGUF", "Qwen3.8-27B-DFlash2-Q4_K_M.gguf", LOCAL_LLM_DIR, label="DFlash2 Drafter")
                except Exception:
                    try:
                        dflash_gguf = _fast_download_hf("Akicou/Qwen3.8-27B-DFlash2-GGUF", "Qwen3.8-27B-DFlash2-Q4_K_M.gguf", LOCAL_LLM_DIR, label="DFlash2 Drafter")
                    except Exception:
                        pass
        except Exception as dfe:
            log_event(f"DFlash2 lookup: {dfe}", category="SYSTEM")

    if rclone_ok and downloaded_fresh:
        def _backup_llm_to_drive():
            try:
                rc_post("operations/mkdir", {"fs": "gdrive:", "remote": REMOTE_LLM_DIR})
                rc_copy_async({"srcFs": LOCAL_LLM_DIR, "srcRemote": os.path.basename(model_gguf), "dstFs": f"gdrive:{REMOTE_LLM_DIR}", "dstRemote": os.path.basename(model_gguf)}, max_wait=900, label="Backup Qwen GGUF")
                if mmproj_gguf:
                    rc_copy_async({"srcFs": LOCAL_LLM_DIR, "srcRemote": os.path.basename(mmproj_gguf), "dstFs": f"gdrive:{REMOTE_LLM_DIR}", "dstRemote": os.path.basename(mmproj_gguf)}, max_wait=300, label="Backup mmproj")
                if dflash_gguf and os.path.exists(dflash_gguf):
                    rc_copy_async({"srcFs": LOCAL_LLM_DIR, "srcRemote": os.path.basename(dflash_gguf), "dstFs": f"gdrive:{REMOTE_LLM_DIR}", "dstRemote": os.path.basename(dflash_gguf)}, max_wait=300, label="Backup DFlash2")
                log_event(f"Cached {MODEL_SUBDIR} weights to Google Drive backup in background!", category="RCLONE", level="SUCCESS")
            except Exception as be:
                log_event(f"Drive LLM backup skipped: {be}", category="RCLONE", level="WARN")
        threading.Thread(target=_backup_llm_to_drive, daemon=True).start()

    ll_env = os.environ.copy()
    ll_env["LD_LIBRARY_PATH"] = f"/tmp/llama_bin:{ll_env.get('LD_LIBRARY_PATH', '')}"

    is_moe_35b = (PROFILE_ID == "LLM_QWEN_MOE_35B")
    is_fast_8b = (PROFILE_ID == "LLM_QWEN_FAST_8B")
    is_vlm_27b = (PROFILE_ID == "LLM_QWEN_VLM")

    if is_fast_8b:
        t_split = "50,50"
        ctx_size = "16384"
    elif is_moe_35b:
        t_split = "52,48"
        ctx_size = "16384"
    elif is_vlm_27b:
        t_split = "55,45"
        ctx_size = "8192"
    else:
        t_split = "50,50"
        ctx_size = "16384"

    if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
        q4_dir = f"{LOCAL_LLM_DIR}/qwen4b"
        cpm_dir = f"{LOCAL_LLM_DIR}/cpm1b"
        m4_path = f"{q4_dir}/Qwen3.5-4B-Q4_K_M.gguf"
        cpm_path = f"{cpm_dir}/MiniCPM-V-4_7-1B-Q4_K_M.gguf"

        # 1. Qwen3.5-9B on CUDA 0 (:8190)
        cmd_9b = [
            llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", "8190",
            "-ngl", "99", "--flash-attn", "on", "-c", "16384",
            "-ctk", "f16", "-ctv", "f16",
            "--batch-size", "512", "--ubatch-size", "256",
            "--parallel", "1", "--jinja",
        ]
        if mmproj_gguf:
            cmd_9b.extend(["--mmproj", mmproj_gguf])
        env_9b = ll_env.copy()
        env_9b["CUDA_VISIBLE_DEVICES"] = "0"
        ll_proc = subprocess.Popen(cmd_9b, env=env_9b, stdout=open("/tmp/llama_server.log", "w"), stderr=subprocess.STDOUT)
        log_event("Launched Qwen3.5-9B QC VLM -> CUDA:0 (:8190)", category="SYSTEM", level="SUCCESS")

        # 2. Qwen3.5-4B on CUDA 1 (:8191) - Fast Text Extractor
        cmd_4b = [
            llama_bin, "-m", m4_path, "--host", "127.0.0.1", "--port", "8191",
            "-ngl", "99", "--flash-attn", "on", "-c", "8192",
            "-ctk", "f16", "-ctv", "f16",
            "--batch-size", "512", "--ubatch-size", "256",
            "--parallel", "1", "--jinja",
        ]
        env_4b = ll_env.copy()
        env_4b["CUDA_VISIBLE_DEVICES"] = "1"
        proc_4b = subprocess.Popen(cmd_4b, env=env_4b, stdout=open("/tmp/llama_4b.log", "w"), stderr=subprocess.STDOUT)
        log_event("Launched Qwen3.5-4B Fast Extractor -> CUDA:1 (:8191)", category="SYSTEM", level="SUCCESS")

        # 3. MiniCPM-V 4.7-1B on CUDA 1 (:8192)
        cmd_cpm = [
            llama_bin, "-m", cpm_path, "--host", "127.0.0.1", "--port", "8192",
            "-ngl", "99", "--flash-attn", "on", "-c", "4096",
            "--batch-size", "256", "--ubatch-size", "128",
            "--parallel", "1",
        ]
        env_cpm = ll_env.copy()
        env_cpm["CUDA_VISIBLE_DEVICES"] = "1"
        proc_cpm = subprocess.Popen(cmd_cpm, env=env_cpm, stdout=open("/tmp/llama_cpm.log", "w"), stderr=subprocess.STDOUT)
        log_event("Launched MiniCPM-V 4.7-1B Tagger -> CUDA:1 (:8192)", category="SYSTEM", level="SUCCESS")
    else:
        ll_cmd = [
            llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", "8190",
            "-ngl", "999",
            "-dev", "CUDA0,CUDA1",
            "--split-mode", "layer",
            "--tensor-split", t_split,
            "--fit", "off",
            "--flash-attn", "on",
            "--ctx-size", ctx_size,
            "-ctk", "q8_0", "-ctv", "q8_0",
            "--batch-size", "512",
            "--ubatch-size", "256",
            "--parallel", "1",
            "--kv-unified",
            "--jinja",
            "--chat-template-kwargs", '{"enable_thinking":false}',
        ]

        # DFlash2 Speculative Decoding (per MO updated.md)
        if dflash_gguf and os.path.exists(dflash_gguf):
            ll_cmd.extend([
                "-md", dflash_gguf,
                "--spec-type", "draft-dflash",
                "--spec-draft-n-max", "5",
                "-ngld", "99",
                "-devd", "CUDA1",
                "-ctkd", "q8_0", "-ctvd", "q8_0",
            ])
            log_event(f"DFlash2 speculative drafter ACTIVE on CUDA1: {os.path.basename(dflash_gguf)} (n_max=5, -ngld 99)", category="LLAMA", level="SUCCESS")
        elif PROFILE_ID in ("LLM_QWEN_TEXT_TURBO", "LLM_QWEN_VLM") and not mmproj_gguf:
            ll_cmd.extend(["--spec-type", "draft-mtp", "--spec-draft-n-max", "2"])
            log_event("Embedded MTP speculative decoding ACTIVE (--spec-type draft-mtp, n=2)", category="SYSTEM", level="SUCCESS")

        if mmproj_gguf and PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B"):
            ll_cmd.extend(["--mmproj", mmproj_gguf])
            log_event(f"Multimodal vision ACTIVE on CUDA1: {os.path.basename(mmproj_gguf)}", category="SYSTEM", level="SUCCESS")
        ll_log = open("/tmp/llama_server.log", "w")
        ll_proc = subprocess.Popen(ll_cmd, env=ll_env, stdout=ll_log, stderr=ll_log)
        mode_label = (
            "Qwen 8B Fast Vision (~45-60 tok/s)" if is_fast_8b
            else ("Qwen 35B-A3B Vision MoE (~35-55 tok/s)" if is_moe_35b
            else (("Vision + DFlash2 (~35-45 tok/s)" if dflash_gguf else "Vision + LLM (~16 tok/s)") if is_vlm_27b else "Ultra Text Turbo"))
        )
        log_event(f"Launched llama-server ({mode_label}, 2x T4 split) -> 127.0.0.1:8190 ({os.path.basename(model_gguf)})", category="SYSTEM")

    def _tail_llama_log(log_path, label):
        time.sleep(2)
        try:
            with open(log_path, "r") as lf:
                while True:
                    line = lf.readline()
                    if line:
                        stripped = line.strip()
                        if stripped and any(k in stripped.lower() for k in ["error", "fail", "listening", "loaded", "eval time", "tokens", "http"]):
                            log_event(f"[{label}] {stripped[:120]}", category="LLAMA", level="INFO")
                    else:
                        time.sleep(0.5)
        except Exception:
            pass

    threading.Thread(target=_tail_llama_log, args=("/tmp/llama_server.log", "9B"), daemon=True).start()
    if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
        threading.Thread(target=_tail_llama_log, args=("/tmp/llama_4b.log", "4B"), daemon=True).start()
        threading.Thread(target=_tail_llama_log, args=("/tmp/llama_cpm.log", "CPM"), daemon=True).start()

    def _query_nvidia_smi():
        try:
            out = subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"], text=True, timeout=3)
            devs = []
            for ln in out.strip().splitlines():
                parts = [p.strip() for p in ln.split(",")]
                if len(parts) >= 3:
                    tot_b = int(float(parts[1]) * 1024 * 1024)
                    used_b = int(float(parts[2]) * 1024 * 1024)
                    model_tag = (
                        "Qwen 8B Fast" if PROFILE_ID == "LLM_QWEN_FAST_8B"
                        else ("Qwen 35B MoE" if PROFILE_ID == "LLM_QWEN_MOE_35B" else "Qwen 27B")
                    )
                    devs.append({"name": f"{parts[0]} ({model_tag})", "vram_total": tot_b, "vram_free": max(0, tot_b - used_b)})
            return devs
        except Exception:
            return []

    class _LlmBridgeHandler(_BHRH):
        def _proxy(self, method):
            global LAST_ACTIVE
            LAST_ACTIVE = time.time()
            if self.path == "/system_stats":
                body = json.dumps({"devices": _query_nvidia_smi()}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/object_info/CheckpointLoaderSimple"):
                body = json.dumps({"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [[os.path.basename(model_gguf)]]}}}}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path in ("/v1/swarm/health", "/v1/swarm/status"):
                status_dict = {}
                for sp, sn in [(8190, "qc_9b"), (8191, "extract_4b"), (8192, "tag_1b")]:
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{sp}/health", timeout=1) as hr:
                            status_dict[sn] = (hr.status == 200)
                    except Exception:
                        status_dict[sn] = False
                body = json.dumps({"status": "ok", "services": status_dict, "devices": _query_nvidia_smi()}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            req_body = self.rfile.read(length) if length > 0 else None
            fwd_hdrs = {k: v for k, v in self.headers.items() if k.lower() not in {"host", "content-length"}}
            if req_body is not None:
                fwd_hdrs["Content-Length"] = str(len(req_body))

            target_port = 8190
            target_path = self.path
            hdr_svc = (self.headers.get("X-Target-Service") or "").lower().strip()
            if hdr_svc == "extract" or self.path.startswith("/v1/extract"):
                target_port = 8191
                if self.path.startswith("/v1/extract"):
                    target_path = "/v1" + self.path[len("/v1/extract"):]
            elif hdr_svc == "tag" or self.path.startswith("/v1/tag"):
                target_port = 8192
                if self.path.startswith("/v1/tag"):
                    target_path = "/v1" + self.path[len("/v1/tag"):]
            elif hdr_svc == "qc" or self.path.startswith("/v1/qc"):
                target_port = 8190
                if self.path.startswith("/v1/qc"):
                    target_path = "/v1" + self.path[len("/v1/qc"):]
            elif hdr_svc == "rag" or self.path.startswith("/v1/rag"):
                target_port = 8193
                if self.path.startswith("/v1/rag"):
                    target_path = self.path[len("/v1/rag"):]

            conn = _hc.HTTPConnection("127.0.0.1", target_port, timeout=300)
            try:
                conn.request(method, target_path, body=req_body, headers=fwd_hdrs)
                resp = conn.getresponse()
                self.send_response(resp.status)
                ctype = resp.getheader("Content-Type", "")
                is_sse = "text/event-stream" in ctype.lower()
                content_len = resp.getheader("Content-Length")

                for hk, hv in resp.getheaders():
                    if hk.lower() not in {"transfer-encoding", "connection", "content-length"}:
                        self.send_header(hk, hv)

                if content_len is not None and not is_sse:
                    self.send_header("Content-Length", content_len)
                    self.end_headers()
                    shutil.copyfileobj(resp, self.wfile)
                else:
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    self.wfile.flush()
                    while True:
                        line = resp.readline()
                        if not line:
                            break
                        chunk_hdr = hex(len(line))[2:].encode("ascii") + b"\\r\\n"
                        self.wfile.write(chunk_hdr + line + b"\\r\\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\\r\\n\\r\\n")
                    self.wfile.flush()
            except Exception as pe:
                err = json.dumps({"error": str(pe)}).encode("utf-8")
                try:
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(err)))
                    self.end_headers()
                    self.wfile.write(err)
                except Exception:
                    pass
            finally:
                conn.close()
        def do_GET(self):
            self._proxy("GET")
        def do_POST(self):
            self._proxy("POST")
        def log_message(self, format, *args):
            return

    _bridge_srv = _THS(("127.0.0.1", 8188), _LlmBridgeHandler)
    threading.Thread(target=_bridge_srv.serve_forever, daemon=True).start()

    _llm_last_step = -1
    _llm_t0 = time.time()
    while True:
        llm_ok = False
        try:
            if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
                with urllib.request.urlopen("http://127.0.0.1:8190/health", timeout=2) as hr0:
                    with urllib.request.urlopen("http://127.0.0.1:8191/health", timeout=2) as hr1:
                        llm_ok = (hr0.status == 200 and hr1.status == 200)
            else:
                with urllib.request.urlopen("http://127.0.0.1:8190/health", timeout=2) as hr:
                    llm_ok = hr.status == 200
        except Exception:
            llm_ok = False

        devs = _query_nvidia_smi()
        telem = {}
        for idx_t, t_name in enumerate(TARGETS):
            d = devs[min(idx_t, len(devs) - 1)] if devs else {}
            vt = round(d.get("vram_total", 16 * (1024**3)) / (1024**3), 2)
            vf = round(d.get("vram_free", 0) / (1024**3), 2)
            telem[t_name] = {
                "ready": bool(llm_ok and TUNNEL_URL and is_caddy_ready()),
                "gpuName": d.get("name", "NVIDIA T4 (Qwen 27B)"),
                "vramTotalGb": vt,
                "vramUsedGb": round(max(0.0, vt - vf), 2),
            }

        all_ready = bool(TUNNEL_URL) and is_caddy_ready() and llm_ok
        next_step = 5 if all_ready else (4 if (TUNNEL_URL and is_caddy_ready()) else 3)
        next_status = "ONLINE" if all_ready else "STARTING"

        dead_proc = None
        if ll_proc.poll() is not None:
            dead_proc = f"llama-server 9B (code={ll_proc.returncode})"
        elif 'proc_4b' in locals() and proc_4b.poll() is not None:
            dead_proc = f"llama-server 4B (code={proc_4b.returncode})"
        elif 'proc_cpm' in locals() and proc_cpm.poll() is not None:
            dead_proc = f"llama-server CPM (code={proc_cpm.returncode})"

        if dead_proc:
            log_event(f"llama process exited unexpectedly: {dead_proc}", category="ERROR", level="ERROR")
            post_heartbeat(0, "ERROR", telem)
            break

        if all_ready and CURRENT_STEP < 5:
            lbl = "Qwen Swarm (4B Extractor + 9B QC + MiniCPM-V 1B)" if PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM" else f"{mode_label}"
            log_event(f"{lbl} ONLINE in {round(time.time() - t_boot_start, 1)}s -> {TUNNEL_URL}", category="SYSTEM", level="SUCCESS")

        hb_int = 20 if all_ready else 8
        if next_step != _llm_last_step or has_pending_logs() or (time.time() - LAST_HB_SENT) >= hb_int:
            post_heartbeat(next_step, next_status, telem)
            _llm_last_step = next_step

        if not EVER_CONNECTED and (time.time() - _llm_t0) > 90 and HEARTBEAT_FAIL_STREAK >= 3:
            break
        if IDLE_TIMEOUT_SEC > 0 and (time.time() - LAST_ACTIVE > IDLE_TIMEOUT_SEC):
            log_event("LLM idle timeout reached. Stopping to preserve Kaggle quota.", category="ACTION", level="WARN")
            post_heartbeat(0, "OFFLINE", {})
            break
        time.sleep(15 if all_ready else 3)

    ll_proc.terminate()
    if 'proc_4b' in locals():
        try:
            proc_4b.terminate()
        except Exception:
            pass
    if 'proc_cpm' in locals():
        try:
            proc_cpm.terminate()
        except Exception:
            pass
    sys.exit(0)

# -------------------------------------------------------------
# 4. FastBoot GDrive Cache Hit OR Parallel ComfyUI Clone + uv Delta
# -------------------------------------------------------------
should_upload_cache = False
snapshot_meta = None
if not os.path.exists(os.path.join(COMFY_DIR, "main.py")):
    cache_restored = False
    if rclone_ok:
        candidate_remotes = [FASTBOOT_REMOTE]
        if PROFILE_ID == "BASE_COMFY":
            candidate_remotes.append(f"{GDRIVE_BASE}/cache/fastboot_{PROVIDER}_py{PY_VER_TAG}_v1.tar.gz")
        for remote_candidate in candidate_remotes:
            try:
                cache_dir_remote, cache_file_remote = remote_candidate.rsplit("/", 1)
                st = rc_post("operations/stat", {"fs": f"gdrive:{cache_dir_remote}", "remote": cache_file_remote}, timeout=10)
                if (st.get("item") or {}).get("Size", 0) > 100000:
                    t_fb = time.time()
                    log_event(f"FastBoot cache HIT! Streaming {cache_file_remote} from Google Drive...", category="COMFYUI", level="SUCCESS")
                    rc_copy_async({
                        "srcFs": f"gdrive:{cache_dir_remote}",
                        "srcRemote": cache_file_remote,
                        "dstFs": "/tmp",
                        "dstRemote": "fastboot.tar.gz",
                        "_config": {
                            "MultiThreadCutoff": "32M", "MultiThreadChunkSize": "64M",
                            "MultiThreadStreams": 8, "DisableHTTP2": True,
                        },
                    }, max_wait=180, label="FastBoot restore")
                    subprocess.run(["tar", "-xzf", "/tmp/fastboot.tar.gz", "-C", "/tmp"], check=True)
                    try:
                        os.remove("/tmp/fastboot.tar.gz")
                    except Exception:
                        pass
                    if os.path.exists(os.path.join(COMFY_DIR, "main.py")):
                        cache_restored = True
                        log_event(f"Extracted FastBoot ComfyUI cache in {round(time.time() - t_fb, 1)}s!", category="COMFYUI", level="SUCCESS")
                        break
            except Exception as ce:
                try:
                    if os.path.exists("/tmp/fastboot.tar.gz"):
                        os.remove("/tmp/fastboot.tar.gz")
                except Exception:
                    pass
                log_event(f"FastBoot lookup ({remote_candidate.rsplit('/', 1)[1]}): {ce}", category="COMFYUI")

    if not cache_restored:
        t_cold = time.time()
        log_event(f"Cloning ComfyUI (shallow) & installing {PROFILE_ID} delta packages via uv...", category="COMFYUI")
        subprocess.run(["git", "clone", "--depth", "1", "--single-branch", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR], check=True)

        if CUSTOM_NODES:
            nodes_dir = os.path.join(COMFY_DIR, "custom_nodes")
            os.makedirs(nodes_dir, exist_ok=True)
            def _clone_node(cn):
                cn_name = cn.get("name", "")
                cn_url = cn.get("repoUrl", "")
                if not cn_name or not cn_url:
                    return
                cn_dst = os.path.join(nodes_dir, cn_name)
                try:
                    if not os.path.exists(cn_dst):
                        subprocess.run(["git", "clone", "--depth", "1", "--single-branch", cn_url, cn_dst], check=True, timeout=60)
                    log_event(f"Cloned custom node: {cn_name}", category="COMFYUI")
                except Exception as cne:
                    log_event(f"Custom node clone notice ({cn_name}): {cne}", category="COMFYUI", level="WARN")
            clone_threads = [threading.Thread(target=_clone_node, args=(cn,), daemon=True) for cn in CUSTOM_NODES]
            for ct in clone_threads:
                ct.start()
            for ct in clone_threads:
                ct.join(timeout=65)

        req_sources = [os.path.join(COMFY_DIR, "requirements.txt")]
        if CUSTOM_NODES:
            for cn in CUSTOM_NODES:
                cn_req = os.path.join(COMFY_DIR, "custom_nodes", cn.get("name", ""), "requirements.txt")
                if os.path.exists(cn_req):
                    req_sources.append(cn_req)

        filtered_reqs = "/tmp/comfy_reqs_delta.txt"
        skip_pkgs = {"torch", "torchvision", "torchaudio"}
        seen_lines = set()
        with open(filtered_reqs, "w", encoding="utf-8") as wf:
            for rsrc in req_sources:
                if not os.path.exists(rsrc):
                    continue
                with open(rsrc, "r", encoding="utf-8", errors="ignore") as rf:
                    for line in rf:
                        clean = line.strip()
                        if not clean or clean.startswith("#") or clean.startswith("-r "):
                            continue
                        pkg = re.split(r"[=<>!~;\\s\\[]", clean)[0].lower().replace("_", "-")
                        if pkg in skip_pkgs or clean in seen_lines:
                            continue
                        seen_lines.add(clean)
                        wf.write(clean + "\\n")
            if any("Impact-Pack" in cn.get("name", "") for cn in CUSTOM_NODES):
                for extra_pkg in ("ultralytics", "segment-anything", "piexif", "scikit-image", "opencv-python-headless"):
                    if extra_pkg not in seen_lines:
                        wf.write(extra_pkg + "\\n")

        def _snap_site_dirs(dirs):
            snap = {}
            for sd in dirs:
                entries = {}
                if os.path.isdir(sd):
                    for entry in os.listdir(sd):
                        try:
                            entries[entry] = os.lstat(os.path.join(sd, entry)).st_mtime_ns
                        except Exception:
                            entries[entry] = 0
                snap[sd] = entries
            return snap

        def _uv_or_pip_install(req_path, check_err=True):
            if os.path.exists("/tmp/uv"):
                res = subprocess.run(["/tmp/uv", "pip", "install", "--system", "--break-system-packages", "--no-cache", "--quiet", "-r", req_path])
                if res.returncode != 0:
                    res = subprocess.run(["/tmp/uv", "pip", "install", "--system", "--no-cache", "--quiet", "-r", req_path])
                if res.returncode == 0:
                    return True
                log_event(f"/tmp/uv exited with {res.returncode}; falling back to pip...", category="COMFYUI", level="WARN")
            res_pip = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_path], check=check_err)
            return res_pip.returncode == 0

        site_dirs = list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
        before_snap = _snap_site_dirs(site_dirs)
        uv_thread.join(timeout=45)
        log_event("Installing ComfyUI + profile delta packages in single pass...", category="COMFYUI")
        _uv_or_pip_install(filtered_reqs, check_err=True)

        log_event(f"ComfyUI ({PROFILE_ID}) + dependencies ready in {round(time.time() - t_cold, 1)}s", category="COMFYUI", level="SUCCESS")
        snapshot_meta = (site_dirs, before_snap)
        should_upload_cache = True

if ENABLE_OFFLINE_SCAN and os.path.exists("/kaggle/input"):
    for root, _, files in os.walk("/kaggle/input"):
        for fname in files:
            if fname.endswith((".safetensors", ".pth", ".gguf")):
                for cat in CATEGORIES:
                    if cat in root:
                        dst = f"/tmp/models/{cat}/{fname}"
                        if not os.path.exists(dst):
                            try:
                                os.symlink(os.path.join(root, fname), dst)
                            except Exception:
                                pass

post_heartbeat(3, "STARTING")

# -------------------------------------------------------------
# 5. Boot ComfyUI Subprocess(es) with Strict CUDA Isolation
# -------------------------------------------------------------
try:
    import torch
    gpu_count = torch.cuda.device_count() if torch.cuda.is_available() else 1
except Exception:
    gpu_count = 1

active_ports = PORTS[:max(1, gpu_count)] if PROVIDER == "kaggle" else PORTS[:1]
COMFY_PROCS = {}
COMFY_LOG_OFFSETS = {}

def _tail_comfy_logs(max_lines=8):
    for p in active_ports:
        lpath = f"/tmp/comfy_{p}.log"
        if not os.path.exists(lpath):
            continue
        try:
            pos = COMFY_LOG_OFFSETS.get(p, 0)
            with open(lpath, "r", encoding="utf-8", errors="ignore") as lf:
                lf.seek(pos)
                chunk = lf.read()
                COMFY_LOG_OFFSETS[p] = lf.tell()
            if chunk:
                lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
                for ln in lines[-max_lines:]:
                    if any(k in ln.lower() for k in ("error", "traceback", "exception", "starting server", "import times", "cuda")):
                        log_event(f"[:{p}] {ln[:180]}", category="COMFYUI", level="WARN" if "error" in ln.lower() else "INFO")
        except Exception:
            pass

for idx, port in enumerate(active_ports):
    if idx > 0:
        # Stagger GPU1 startup until GPU0 binds (or max 30s if custom nodes are present) to avoid Dual-T4 RAM OOM spike
        stagger_wait = 30 if CUSTOM_NODES else 4
        t_stg = time.time()
        while (time.time() - t_stg) < stagger_wait:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{active_ports[0]}/system_stats", timeout=1.5) as r:
                    if r.status == 200:
                        break
            except Exception:
                pass
            _tail_comfy_logs(4)
            time.sleep(1.5)
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = str(idx)
    env["PYTHONUNBUFFERED"] = "1"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    if os.path.isdir(FASTBOOT_SITE):
        prev_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{FASTBOOT_SITE}:{prev_pp}" if prev_pp else FASTBOOT_SITE
    c_log = open(f"/tmp/comfy_{port}.log", "w")
    proc = subprocess.Popen([
        sys.executable, os.path.join(COMFY_DIR, "main.py"),
        "--listen", "127.0.0.1",
        "--port", str(port),
        "--extra-model-paths-config", "/tmp/extra_model_paths.yaml",
        "--output-directory", "/tmp/outputs",
        "--enable-cors-header",
        "--preview-method", "auto"
    ], cwd=COMFY_DIR, env=env, stdout=c_log, stderr=c_log)
    COMFY_PROCS[port] = proc
    log_event(f"Launched ComfyUI on CUDA:{idx} -> 127.0.0.1:{port}", category="COMFYUI")

def _upload_fastboot_snapshot():
    try:
        log_event("Packing FastBoot cache snapshot to Google Drive in background...", category="RCLONE")
        if snapshot_meta:
            s_dirs, b_snap = snapshot_meta
            for sd in s_dirs:
                if not os.path.isdir(sd):
                    continue
                prev = b_snap.get(sd, {})
                for entry in os.listdir(sd):
                    if entry.lower().startswith(("torch", "__pycache__", "pip", "wheel", "setuptools")):
                        continue
                    src_p = os.path.join(sd, entry)
                    try:
                        mtime = os.lstat(src_p).st_mtime_ns
                    except Exception:
                        mtime = 0
                    if entry in prev and prev[entry] == mtime:
                        continue
                    dst_p = os.path.join(FASTBOOT_SITE, entry)
                    try:
                        if os.path.isdir(src_p):
                            shutil.copytree(src_p, dst_p, dirs_exist_ok=True)
                        else:
                            shutil.copy2(src_p, dst_p)
                    except Exception:
                        pass

        cache_dir_remote, cache_file_remote = FASTBOOT_REMOTE.rsplit("/", 1)
        try:
            rc_post("operations/mkdir", {"fs": "gdrive:", "remote": cache_dir_remote})
        except Exception:
            pass
        tar_env = os.environ.copy()
        tar_env["GZIP"] = "-1"
        tar_res = subprocess.run([
            "tar", "--warning=no-file-changed", "--ignore-failed-read",
            "--exclude=*.git*", "--exclude=*__pycache__*",
            "--exclude=ComfyUI/user/*", "--exclude=ComfyUI/output/*", "--exclude=ComfyUI/input/*",
            "-czf", "/tmp/fastboot_pkg.tar.gz", "-C", "/tmp", "ComfyUI", "sc_site_packages"
        ], env=tar_env, check=False)
        if tar_res.returncode not in (0, 1):
            raise RuntimeError(f"tar exited with status {tar_res.returncode}")
        rc_copy_async({
            "srcFs": "/tmp", "srcRemote": "fastboot_pkg.tar.gz",
            "dstFs": f"gdrive:{cache_dir_remote}", "dstRemote": cache_file_remote,
        }, max_wait=300, label="FastBoot snapshot upload")
        log_event(f"Saved FastBoot cache ({cache_file_remote}) to Drive for rapid next boot!", category="RCLONE", level="SUCCESS")
    except Exception as ue:
        log_event(f"FastBoot cache upload skipped: {ue}", category="RCLONE", level="WARN")
    finally:
        try:
            if os.path.exists("/tmp/fastboot_pkg.tar.gz"):
                os.remove("/tmp/fastboot_pkg.tar.gz")
        except Exception:
            pass

# -------------------------------------------------------------
# 6. Wait for Tunnel + ComfyUI Readiness & Run Heartbeat Loop
# -------------------------------------------------------------
def probe_comfy_stats():
    stats = {}
    for t_name, port in zip(TARGETS, active_ports):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                devs = data.get("devices", [])
                if devs:
                    vram_total = round(devs[0].get("vram_total", 16 * (1024**3)) / (1024**3), 2)
                    vram_free = round(devs[0].get("vram_free", 0) / (1024**3), 2)
                    stats[t_name] = {
                        "ready": True,
                        "gpuName": devs[0].get("name", "NVIDIA T4"),
                        "vramTotalGb": vram_total,
                        "vramUsedGb": round(max(0.0, vram_total - vram_free), 2),
                    }
        except Exception:
            stats[t_name] = {"ready": False}
    return stats

t_loop_start = time.time()
last_step_sent = -1
last_ready_count = -1
upload_started = False

while True:
    telem = probe_comfy_stats()
    ready_count = sum(1 for v in telem.values() if v.get("ready"))
    any_ready = ready_count > 0
    caddy_ok = is_caddy_ready()
    all_ready = bool(TUNNEL_URL) and caddy_ok and len(telem) > 0 and all(v.get("ready") for v in telem.values())
    next_step = 5 if all_ready else (4 if (TUNNEL_URL and caddy_ok) else 3)
    next_status = "ONLINE" if all_ready else "STARTING"

    if not all_ready:
        _tail_comfy_logs(6)
        dead_ports = [p for p, pr in COMFY_PROCS.items() if pr.poll() is not None]
        if len(dead_ports) == len(COMFY_PROCS) and len(COMFY_PROCS) > 0:
            _tail_comfy_logs(15)
            log_event(f"All ComfyUI processes exited unexpectedly (ports={dead_ports}).", category="ERROR", level="ERROR")
            post_heartbeat(0, "ERROR", telem)
            break

    if all_ready and CURRENT_STEP < 5:
        log_event(f"ComfyUI ONLINE in {round(time.time() - t_boot_start, 1)}s!", category="COMFYUI", level="SUCCESS")

    if (any_ready or (time.time() - t_loop_start) > 45) and should_upload_cache and rclone_ok and not upload_started:
        upload_started = True
        threading.Thread(target=_upload_fastboot_snapshot, daemon=True).start()

    steady_poll = all_ready or (any_ready and (time.time() - t_loop_start) > 90)
    hb_interval = 20 if steady_poll else 8
    if (
        next_step != last_step_sent
        or ready_count != last_ready_count
        or has_pending_logs()
        or (time.time() - LAST_HB_SENT) >= hb_interval
    ):
        post_heartbeat(next_step, next_status, telem)
        last_step_sent = next_step
        last_ready_count = ready_count

    if not EVER_CONNECTED and (time.time() - t_loop_start) > 90 and HEARTBEAT_FAIL_STREAK >= 3:
        log_event(f"Zero heartbeats reached {APP_URL} after {round(time.time() - t_boot_start, 1)}s. Stopping cleanly to save GPU quota.", category="ERROR", level="ERROR")
        for pat in ("ComfyUI/main.py", "/tmp/caddy", "/tmp/cloudflared", "/usr/local/bin/rclone"):
            subprocess.run(["pkill", "-f", pat], check=False)
        break

    if IDLE_TIMEOUT_SEC > 0 and (time.time() - LAST_ACTIVE > IDLE_TIMEOUT_SEC):
        log_event("Idle watchdog timeout reached. Shutting down to save quota.", category="ACTION", level="WARN")
        post_heartbeat(0, "OFFLINE", {})
        for pat in ("ComfyUI/main.py", "/tmp/caddy", "/tmp/cloudflared", "/usr/local/bin/rclone"):
            subprocess.run(["pkill", "-f", pat], check=False)
        if PROVIDER == "colab":
            try:
                from google.colab import runtime
                runtime.unassign()
            except Exception:
                pass
        break
    time.sleep(15 if steady_poll else 2)
`;
}

export interface ColabLauncherConfig {
  appWebhookUrl: string;
  target: string;
  runnerToken: string;
}

/**
 * Generates a self-renewing ~25-line Colab cell that claims a fresh session ID and
 * fetches the latest ComfyUI + Rclone + Caddy worker script on every run without stale 410 errors.
 */
export function buildColabSelfUpdatingLauncherCode(cfg: ColabLauncherConfig): string {
  const cleanUrl = cfg.appWebhookUrl.replace(/\/$/, "");
  return `import json, urllib.request, urllib.error

APP_URL = ${JSON.stringify(cleanUrl)}
TARGET = ${JSON.stringify(cfg.target)}
RUNNER_TOKEN = ${JSON.stringify(cfg.runnerToken)}

print(f"[SCRIPTORIA] Claiming fresh session ID for '{TARGET}' from {APP_URL}...", flush=True)
req = urllib.request.Request(
    f"{APP_URL}/api/vm/colab/claim",
    data=json.dumps({"target": TARGET, "runnerToken": RUNNER_TOKEN}).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-Colab-Launcher/3.0"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as err:
    body = err.read().decode("utf-8", errors="ignore")
    raise RuntimeError(f"Session claim rejected ({err.code}): {body}")

print(f"[SCRIPTORIA] Fresh session claimed ({payload.get('accountAlias', 'acc1')}). Booting GPU worker...", flush=True)
exec(compile(payload["pythonCode"], f"scriptoria_{TARGET}_worker.py", "exec"), {"__name__": "__main__"})
`;
}

/**
 * Wraps Python bootstrap code inside a ready-to-run Colab T4 .ipynb document.
 */
function wrapColabNotebookDocument(target: string, pyCode: string) {
  return {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          `# Scriptoria Colab GPU Worker (${target})\n`,
          "Click **Runtime ➔ Run all** (`Ctrl+F9`). Automatically renews your Scriptoria session ID, mounts Rclone GDrive streaming, and starts ComfyUI + Caddy ingress.\n",
        ],
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: pyCode.split("\n").map((line) => `${line}\n`),
      },
    ],
    metadata: {
      accelerator: "GPU",
      colab: { gpuType: "T4", provenance: [] },
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.10.12" },
    },
    nbformat: 4,
    nbformat_minor: 4,
  };
}

export function buildColabLauncherNotebookJson(cfg: ColabLauncherConfig) {
  return wrapColabNotebookDocument(cfg.target, buildColabSelfUpdatingLauncherCode(cfg));
}

/**
 * Wraps the full standalone Colab Python bootstrap inside an .ipynb notebook.
 */
export function buildColabNotebookJson(cfg: NotebookBuildConfig) {
  const pyCode = buildUnifiedNotebookPythonCode({ ...cfg, provider: "colab" });
  return wrapColabNotebookDocument(cfg.gpuTargets[0] || "gcgpu", pyCode);
}

/**
 * Generates a zero-GPU-quota CPU Kaggle worker script that fetches catalog models
 * directly from HuggingFace / Civitai / URLs and mirrors them into the user's 5 TB Google Drive.
 */
export function buildCpuMirrorNotebookPythonCode(cfg: CpuMirrorConfig): string {
  return `import os, sys, time, json, hashlib, shutil, zipfile, subprocess, urllib.request, urllib.parse

APP_URL = ${JSON.stringify(cfg.appWebhookUrl.replace(/\/$/, ""))}
REG_JWT = ${JSON.stringify(cfg.registrationJwt)}
GDRIVE_BASE = ${JSON.stringify(cfg.gdriveBaseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria")}
GDRIVE_TOKEN_RAW = ${JSON.stringify(cfg.gdriveTokenJson)}
MODELS = ${JSON.stringify(cfg.models)}

os.makedirs("/tmp/mirror", exist_ok=True)

def post_cb(slug, status, gdrive_path="", gdrive_file_id="", size_bytes=None, error_msg=""):
    try:
        req = urllib.request.Request(
            f"{APP_URL}/api/catalog/backup-callback",
            data=json.dumps({
                "token": REG_JWT,
                "slug": slug,
                "status": status,
                "gdrivePath": gdrive_path,
                "gdriveFileId": gdrive_file_id,
                "sizeBytes": size_bytes,
                "error": error_msg,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-Mirror/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except Exception as e:
        print(f"[CALLBACK] {slug}: {e}", flush=True)

try:
    gdrive_cfg = json.loads(GDRIVE_TOKEN_RAW)
except Exception:
    gdrive_cfg = {}

cid = gdrive_cfg.pop("client_id", "")
csec = gdrive_cfg.pop("client_secret", "")
rtok = gdrive_cfg.get("refresh_token", "")
if rtok and cid and csec:
    data = urllib.parse.urlencode({
        "client_id": cid, "client_secret": csec, "refresh_token": rtok, "grant_type": "refresh_token"
    }).encode("utf-8")
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data, method="POST"), timeout=15) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        if res_json.get("access_token"):
            gdrive_cfg["access_token"] = res_json["access_token"]
            gdrive_cfg.setdefault("token_type", "Bearer")
            gdrive_cfg["expiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3300))

lines = ["[gdrive]", "type = drive", "scope = drive"]
if cid: lines.append(f"client_id = {cid}")
if csec: lines.append(f"client_secret = {csec}")
lines.append(f"token = {json.dumps(gdrive_cfg)}")
with open("/tmp/rclone.conf", "w", encoding="utf-8") as f:
    f.write("\\n".join(lines) + "\\n")

if not os.path.exists("/usr/local/bin/rclone"):
    subprocess.run(["curl", "-sSLf", "https://downloads.rclone.org/rclone-current-linux-amd64.zip", "-o", "/tmp/rclone.zip"], check=True)
    with zipfile.ZipFile("/tmp/rclone.zip", "r") as zf:
        for m in zf.namelist():
            if m.endswith("/rclone"):
                with zf.open(m) as src, open("/usr/local/bin/rclone", "wb") as dst:
                    dst.write(src.read())
                break
    os.chmod("/usr/local/bin/rclone", 0o755)
    os.remove("/tmp/rclone.zip")

subprocess.run(["bash", "-lc", "apt-get update -qq && apt-get install -y -qq aria2 >/dev/null 2>&1"], check=False)

for item in MODELS:
    slug = item["slug"]
    cat = item["category"]
    sub = item.get("subdir") or ""
    fname = item["filename"]
    url = item["url"]
    auth_hdr = item.get("authHeader") or ""
    sha_expected = (item.get("sha256") or "").lower()
    remote_dir = f"{GDRIVE_BASE}/models/{cat}" + (f"/{sub}" if sub else "")
    remote_path = f"{remote_dir}/{fname}"
    local_path = os.path.join("/tmp/mirror", fname)
    try:
        chk = subprocess.run(["/usr/local/bin/rclone", "lsjson", "--config", "/tmp/rclone.conf", f"gdrive:{remote_path}"], capture_output=True, text=True)
        if chk.returncode == 0 and chk.stdout.strip().startswith("[") and len(json.loads(chk.stdout)) > 0:
            info = json.loads(chk.stdout)[0]
            post_cb(slug, "BACKED_UP", remote_path, info.get("ID", ""), info.get("Size"))
            print(f"[MIRROR] Already in Drive: {remote_path}", flush=True)
            continue

        post_cb(slug, "BACKING_UP", remote_path)
        print(f"[MIRROR] Downloading {fname} from {url}...", flush=True)
        if shutil.which("aria2c"):
            cmd = ["aria2c", "-x", "16", "-s", "16", "-k", "4M", "--file-allocation=none", "--allow-overwrite=true", "-d", "/tmp/mirror", "-o", fname]
            if auth_hdr:
                cmd.extend(["--header", f"Authorization: {auth_hdr}"])
            cmd.append(url)
            subprocess.run(cmd, check=True)
        else:
            headers = {"User-Agent": "Scriptoria-Mirror/1.0"}
            if auth_hdr: headers["Authorization"] = auth_hdr
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r, open(local_path, "wb") as out:
                shutil.copyfileobj(r, out, 1024 * 1024)

        if sha_expected:
            h = hashlib.sha256()
            with open(local_path, "rb") as hf:
                for blk in iter(lambda: hf.read(4 * 1024 * 1024), b""):
                    h.update(blk)
            if h.hexdigest().lower() != sha_expected:
                raise RuntimeError("SHA256 mismatch")

        sz = os.path.getsize(local_path)
        subprocess.run(["/usr/local/bin/rclone", "mkdir", "--config", "/tmp/rclone.conf", f"gdrive:{remote_dir}"], check=False)
        subprocess.run(["/usr/local/bin/rclone", "copyto", "--config", "/tmp/rclone.conf", "--disable-http2", "--drive-chunk-size=64M", local_path, f"gdrive:{remote_path}"], check=True)
        ls_res = subprocess.run(["/usr/local/bin/rclone", "lsjson", "--config", "/tmp/rclone.conf", f"gdrive:{remote_path}"], capture_output=True, text=True)
        fid = ""
        if ls_res.returncode == 0 and ls_res.stdout.strip().startswith("["):
            arr = json.loads(ls_res.stdout)
            if arr: fid = arr[0].get("ID", "")
        post_cb(slug, "BACKED_UP", remote_path, fid, sz)
        print(f"[MIRROR] Backed up {fname} -> gdrive:{remote_path}", flush=True)
    except Exception as err:
        post_cb(slug, "FAILED", remote_path, "", None, str(err))
        print(f"[MIRROR] Failed {fname}: {err}", flush=True)
    finally:
        if os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception:
                pass
print("[MIRROR] Batch mirror finished.", flush=True)
`;
}

