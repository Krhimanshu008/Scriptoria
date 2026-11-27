import crypto from "node:crypto";

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
  gpuProfiles?: string[]; // Per-slot workerProfile list aligned with gpuTargets
  accountAlias: string;
  workerProfile?: string;
  customNodes?: CustomNodeBootstrapItem[];
  idleTimeoutSeconds?: number;
  enableOfflineDatasetScan?: boolean;
  prewarmModels?: PrewarmModelItem[];
  headlessMode?: boolean;
  quietStdout?: boolean;
  llmTopologyMode?: string;
}

/**
 * Shared Python helper block for multi-mirror downloads (HuggingFace -> Civitai -> Direct URL)
 * using aria2c (or urllib fallback) with SHA-256 verification per mirror attempt.
 */
export function buildPythonMirrorDownloadHelper(): string {
  return `
def _verify_download(path, expected_sha, expected_size=0):
    size = os.path.getsize(path)
    if size == 0 or (expected_size and size != expected_size):
        raise ValueError("File size does not match catalog")
    if expected_sha:
        digest = hashlib.sha256()
        with open(path, "rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest().lower() != expected_sha.lower():
            raise ValueError("File SHA-256 does not match catalog")
    return size

def _download_with_mirrors(mirrors, tmp_dl, default_sha="", default_size=0, progress_cb=None):
    errors = []
    valid_mirrors = [m for m in (mirrors or []) if isinstance(m, dict) and str(m.get("url") or "").strip()]
    for idx, m in enumerate(valid_mirrors):
        url = str(m.get("url") or "").strip()
        auth_hdr = str(m.get("authHeader") or "").strip()
        exp_sz = int(m.get("expectedSizeBytes") or 0)
        sha_exp = str(m.get("sha256") or default_sha or "").strip().lower()
        src_kind = str(m.get("sourceKind") or "direct")
        if os.path.exists(tmp_dl):
            try:
                os.remove(tmp_dl)
            except Exception:
                pass
        try:
            t0 = time.time()
            used_aria2 = False
            eff_dl_sz = exp_sz or int(default_size or 0)
            win_samples = deque(maxlen=6)

            def _emit_prog(done_b, total_b):
                nonlocal win_samples
                if not progress_cb:
                    return
                now_t = time.time()
                win_samples.append((now_t, done_b))
                if len(win_samples) >= 2 and (now_t - win_samples[0][0]) >= 0.4:
                    inst_spd = (done_b - win_samples[0][1]) / max(0.1, now_t - win_samples[0][0])
                else:
                    inst_spd = done_b / max(0.1, now_t - t0)
                progress_cb(done_b, total_b, inst_spd)

            if not auth_hdr and shutil.which("aria2c"):
                cmd = [
                    "aria2c", "-x", "8", "-s", "8", "-k", "4M",
                    "--file-allocation=none", "--allow-overwrite=true",
                    "--auto-file-renaming=false", "--summary-interval=1",
                    "-d", os.path.dirname(tmp_dl), "-o", os.path.basename(tmp_dl),
                ]
                cmd.append(url)
                proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                while proc.poll() is None:
                    if progress_cb and os.path.exists(tmp_dl):
                        done = os.path.getsize(tmp_dl)
                        _emit_prog(done, eff_dl_sz)
                    time.sleep(0.5)
                if proc.returncode == 0 and os.path.exists(tmp_dl):
                    used_aria2 = True

            if not used_aria2:
                headers = {"User-Agent": "Scriptoria-Fetcher/3.0"}
                req = urllib.request.Request(url, headers=headers)
                if auth_hdr:
                    # Signed CDN redirects do not need the provider's bearer credential.
                    req.add_unredirected_header("Authorization", auth_hdr)
                with urllib.request.urlopen(req, timeout=90) as resp:
                    hdr_len = int(resp.headers.get("Content-Length") or 0)
                    tot = eff_dl_sz or hdr_len
                    done = 0
                    with open(tmp_dl, "wb") as out:
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            out.write(chunk)
                            done += len(chunk)
                            _emit_prog(done, tot)

            _verify_download(tmp_dl, sha_exp, exp_sz if not sha_exp else 0)
            return {"sourceKind": src_kind, "url": url, "elapsed": round(time.time() - t0, 1)}
        except Exception as merr:
            errors.append(f"[{idx+1}:{src_kind}] {merr}")
            if os.path.exists(tmp_dl):
                try:
                    os.remove(tmp_dl)
                except Exception:
                    pass
    raise RuntimeError(" ; ".join(errors) if errors else "No valid download mirrors supplied")
`;
}

/**
 * Shared Python helper block for parsing Rclone OAuth JSON, writing `/tmp/rclone.conf`,
 * refreshing Google OAuth access tokens before 1h expiry, and hot-updating running `rclone rcd`.
 */
function buildPythonRcloneHelpers(): string {
  return `
def _parse_expiry_epoch(expiry_str):
    if not expiry_str:
        return 0.0
    try:
        import datetime as _dt
        s = str(expiry_str).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        s = re.sub(r"\\.(\\d+)", lambda m: "." + m.group(1)[:6], s)
        return _dt.datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0

def _init_gdrive_state(raw_token_str):
    global GDRIVE_CFG, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_TOKEN_EXPIRY_EPOCH
    try:
        cfg = json.loads(raw_token_str or "{}")
        if not isinstance(cfg, dict):
            cfg = {}
    except Exception:
        cfg = {}
    GDRIVE_CLIENT_ID = str(cfg.pop("client_id", "") or "").strip()
    GDRIVE_CLIENT_SECRET = str(cfg.pop("client_secret", "") or "").strip()
    GDRIVE_CFG = cfg
    GDRIVE_TOKEN_EXPIRY_EPOCH = _parse_expiry_epoch(cfg.get("expiry"))

def _write_rclone_conf_unlocked(push_rc=True):
    if not GDRIVE_CFG and not GDRIVE_CLIENT_ID:
        return False
    rclone_lines = ["[gdrive]", "type = drive", "scope = drive"]
    if GDRIVE_CLIENT_ID:
        rclone_lines.append(f"client_id = {GDRIVE_CLIENT_ID}")
    if GDRIVE_CLIENT_SECRET:
        rclone_lines.append(f"client_secret = {GDRIVE_CLIENT_SECRET}")
    rclone_lines.append(f"token = {json.dumps(GDRIVE_CFG)}")
    tmp_conf = "/tmp/rclone.conf.tmp"
    with open(tmp_conf, "w", encoding="utf-8") as f:
        f.write("\\n".join(rclone_lines) + "\\n")
    os.replace(tmp_conf, "/tmp/rclone.conf")
    if push_rc and globals().get("RCLONE_READY") and callable(globals().get("rc_post")):
        try:
            rc_params = {"token": json.dumps(GDRIVE_CFG)}
            if GDRIVE_CLIENT_ID:
                rc_params["client_id"] = GDRIVE_CLIENT_ID
            if GDRIVE_CLIENT_SECRET:
                rc_params["client_secret"] = GDRIVE_CLIENT_SECRET
            rc_post("config/update", {"name": "gdrive", "parameters": rc_params}, timeout=5)
        except Exception:
            pass
    return True

def refresh_gdrive_oauth_in_vm(force=False):
    global GDRIVE_TOKEN_EXPIRY_EPOCH, NEEDS_GDRIVE_SYNC
    with RCLONE_LOCK:
        rtok = str(GDRIVE_CFG.get("refresh_token") or "").strip()
        if not rtok or not GDRIVE_CLIENT_ID or not GDRIVE_CLIENT_SECRET:
            return False
        if not force and GDRIVE_TOKEN_EXPIRY_EPOCH > 0 and time.time() < (GDRIVE_TOKEN_EXPIRY_EPOCH - 600):
            return True
        if not force and GDRIVE_CFG.get("access_token") and GDRIVE_TOKEN_EXPIRY_EPOCH == 0:
            pass
        try:
            token_req_data = urllib.parse.urlencode({
                "client_id": GDRIVE_CLIENT_ID,
                "client_secret": GDRIVE_CLIENT_SECRET,
                "refresh_token": rtok,
                "grant_type": "refresh_token",
            }).encode("utf-8")
            req = urllib.request.Request("https://oauth2.googleapis.com/token", data=token_req_data, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                if res_json.get("access_token"):
                    expires_in = int(res_json.get("expires_in") or 3599)
                    GDRIVE_CFG["access_token"] = res_json["access_token"]
                    GDRIVE_CFG.setdefault("token_type", "Bearer")
                    GDRIVE_CFG["expiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + max(60, expires_in - 60)))
                    GDRIVE_TOKEN_EXPIRY_EPOCH = time.time() + max(60, expires_in - 60)
                    NEEDS_GDRIVE_SYNC = False
                    _write_rclone_conf_unlocked(push_rc=True)
                    return True
        except urllib.error.HTTPError as he:
            err_body = ""
            try:
                err_body = he.read().decode("utf-8", errors="ignore")
            except Exception:
                pass
            if "invalid_grant" in err_body.lower():
                NEEDS_GDRIVE_SYNC = True
            log_event(f"OAuth refresh notice (HTTP {he.code}): {err_body[:160] or he.reason}", category="RCLONE", level="WARN")
        except Exception as e:
            log_event(f"OAuth refresh notice: {e}", category="RCLONE", level="WARN")
        return False

def apply_synced_gdrive_token(payload_dict, updated_at_ms=None):
    global GDRIVE_CFG, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_TOKEN_EXPIRY_EPOCH, GDRIVE_SYNCED_AT_MS, NEEDS_GDRIVE_SYNC
    if not isinstance(payload_dict, dict):
        return False
    with RCLONE_LOCK:
        cfg = dict(payload_dict)
        cid = str(cfg.pop("client_id", "") or GDRIVE_CLIENT_ID or "").strip()
        csec = str(cfg.pop("client_secret", "") or GDRIVE_CLIENT_SECRET or "").strip()
        if cid:
            GDRIVE_CLIENT_ID = cid
        if csec:
            GDRIVE_CLIENT_SECRET = csec
        GDRIVE_CFG = cfg
        GDRIVE_TOKEN_EXPIRY_EPOCH = _parse_expiry_epoch(cfg.get("expiry"))
        NEEDS_GDRIVE_SYNC = False
        if updated_at_ms:
            try:
                GDRIVE_SYNCED_AT_MS = max(GDRIVE_SYNCED_AT_MS, int(updated_at_ms))
            except Exception:
                pass
        _write_rclone_conf_unlocked(push_rc=True)
        log_event("Hot-reloaded Google Drive OAuth token from Scriptoria Vault without VM restart.", category="RCLONE", level="SUCCESS")
        return True
`;
}

export interface KaggleThinStubConfig {
  appWebhookUrl: string;
  target: string;
  claimToken: string;
}

/**
 * Generates a clean ~22-line Kaggle claim stub so static SaveKernel payloads contain
 * zero ComfyUI code, model lists, or Vault credentials.
 */
export function buildKaggleThinClaimStubCode(cfg: KaggleThinStubConfig): string {
  const cleanUrl = cfg.appWebhookUrl.replace(/\/$/, "");
  return `import json, sys, urllib.request, urllib.error

APP_URL = ${JSON.stringify(cleanUrl)}
TARGET = ${JSON.stringify(cfg.target)}
CLAIM_TOKEN = ${JSON.stringify(cfg.claimToken)}

print("Claiming compute session...", flush=True)
req = urllib.request.Request(
    f"{APP_URL}/api/vm/kaggle/claim",
    data=json.dumps({"target": TARGET, "claimToken": CLAIM_TOKEN}).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-Worker/1.0"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as err:
    if err.code in (401, 410):
        print(f"Session inactive ({err.code}); exiting cleanly.", flush=True)
        sys.exit(0)
    raise RuntimeError(f"Session claim error ({err.code})")

print("Runtime active.", flush=True)
exec(compile(payload["pythonCode"], "runtime_worker.py", "exec"), {"__name__": "__main__"})
`;
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
  const rcloneStreams = isKaggle ? "8" : "10";
  const rcloneBuffer = isKaggle ? "16M" : "8M";
  const rcloneTransfers = isKaggle ? "2" : "1";
  const prewarmModels = cfg.prewarmModels ?? [];
  const profileId = (cfg.workerProfile || "IMAGE_CORE").replace(/[^a-zA-Z0-9_-]/g, "_");
  const gpuProfiles = (cfg.gpuProfiles?.length ? cfg.gpuProfiles : cfg.gpuTargets.map(() => profileId)).map((p) =>
    p.replace(/[^a-zA-Z0-9_-]/g, "_")
  );
  const singleDualGpu =
    isKaggle &&
    cfg.gpuTargets.length > 1 &&
    !profileId.startsWith("LLM_") &&
    (profileId === "IMAGE_DIT_DUAL_T4" || gpuProfiles.includes("IMAGE_DIT_DUAL_T4"));
  const ports = isKaggle && cfg.gpuTargets.length > 1 && !singleDualGpu ? [8188, 8189] : [8188];
  const uniqueNonLlm = Array.from(new Set(gpuProfiles.filter((p) => !p.startsWith("LLM_"))));
  const effectiveCacheProfile =
    !profileId.startsWith("LLM_") && uniqueNonLlm.length > 1
      ? [...uniqueNonLlm].sort().join("__")
      : profileId;
  const customNodes = cfg.customNodes ?? [];
  const nodesHash =
    customNodes.length > 0
      ? crypto
          .createHash("sha256")
          .update(
            JSON.stringify(
              [...customNodes]
                .map((n) => [n.name, n.repoUrl])
                .sort((a, b) => a[0].localeCompare(b[0]))
            )
          )
          .digest("hex")
          .slice(0, 8)
      : "";
  const fastbootCacheKey = nodesHash ? `${effectiveCacheProfile}_cn${nodesHash}` : effectiveCacheProfile;

  return `import os, sys, re, time, json, uuid, hashlib, shutil, zipfile, tarfile, sysconfig, subprocess, threading, urllib.request, urllib.parse, urllib.error
from collections import deque
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP_URL = ${JSON.stringify(cfg.appWebhookUrl.replace(/\/$/, ""))}
REG_JWT = ${JSON.stringify(cfg.registrationJwt)}
VM_SECRET = ${JSON.stringify(cfg.vmSecret)}
PROVIDER = ${JSON.stringify(cfg.provider)}
ACCOUNT_ALIAS = ${JSON.stringify(cfg.accountAlias)}
PROFILE_ID = ${JSON.stringify(profileId)}
GPU_PROFILES = ${JSON.stringify(gpuProfiles)}
SINGLE_DUAL_GPU = ${singleDualGpu ? "True" : "False"}
FASTBOOT_CACHE_KEY = ${JSON.stringify(fastbootCacheKey)}
CUSTOM_NODES = ${JSON.stringify(customNodes)}
TARGETS = ${JSON.stringify(cfg.gpuTargets)}
PORTS = ${JSON.stringify(ports)}
WORK_DIR = ${JSON.stringify(workDir)}
GDRIVE_BASE = ${JSON.stringify(cfg.gdriveBaseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria")}
GDRIVE_TOKEN_RAW = ${JSON.stringify(cfg.gdriveTokenJson)}
IDLE_TIMEOUT_SEC = ${idleSeconds}
ENABLE_OFFLINE_SCAN = ${cfg.enableOfflineDatasetScan ? "True" : "False"}
PREWARM_MODELS = json.loads(${JSON.stringify(JSON.stringify(prewarmModels))})
HEADLESS_MODE = ${cfg.headlessMode ? "True" : "False"}
QUIET_STDOUT = ${cfg.quietStdout ? "True" : "False"}
LLM_TOPO_MODE = ${JSON.stringify(cfg.llmTopologyMode || (cfg.workerProfile === "LLM_LIGHTWEIGHT_SWARM" ? "llm_swarm_multi" : "llm_layer_split"))}
LLM_ACTIVE_ENDPOINTS = []

LAST_ACTIVE = time.time()
BOOT_LOGS = deque(maxlen=150)
LOG_LOCK = threading.Lock()
PENDING_LOGS = []
FETCH_JOBS = {}
FETCH_LOCK = threading.Lock()
RCLONE_READY = False
GDRIVE_HEALTHY = False
RCLONE_LOCK = threading.Lock()
GDRIVE_CFG = {}
GDRIVE_CLIENT_ID = ""
GDRIVE_CLIENT_SECRET = ""
GDRIVE_TOKEN_EXPIRY_EPOCH = 0.0
GDRIVE_SYNCED_AT_MS = int(time.time() * 1000)
NEEDS_GDRIVE_SYNC = False
TUNNEL_URL = None
CURRENT_STEP = 1
T_BOOT_START = time.time()
STEP_START = time.time()
STEP_DURATIONS = {}
BOOT_ONLINE_AT = None
EVER_CONNECTED = False
HEARTBEAT_FAIL_STREAK = 0
STALE_410_STREAK = 0
LAST_HB_SENT = 0.0
COMFY_DIR = "/tmp/ComfyUI"
FASTBOOT_SITE = "/tmp/sc_site_packages"
PY_VER_TAG = f"{sys.version_info.major}{sys.version_info.minor}"
FASTBOOT_REMOTE = f"{GDRIVE_BASE}/cache/fastboot_{PROVIDER}_{FASTBOOT_CACHE_KEY}_py{PY_VER_TAG}_v2.tar.gz"
TOPOLOGY_MODE = "dual_split" if SINGLE_DUAL_GPU else ("dual_parallel" if PROVIDER == "kaggle" and len(TARGETS) > 1 else "single")
TOPOLOGY_LOCK = threading.RLock()
TOPOLOGY_SWITCHING = threading.Event()
HOT_MODELS_BY_PORT = {}
MODEL_SCAN_DIRTY = True
MODEL_SCAN_CACHE = {"ts": 0.0, "data": None, "hash": "", "sentHash": ""}

try:
    with open("/tmp/scriptoria_worker.env", "w", encoding="utf-8") as _ef:
        _ef.write(f"SCRIPTORIA_URL={APP_URL}\\nSIDECAR_URL=http://127.0.0.1:9999\\nVM_SECRET={VM_SECRET}\\nWORKER_TARGET={TARGETS[0] if TARGETS else ''}\\n")
    os.chmod("/tmp/scriptoria_worker.env", 0o600)
except Exception:
    pass

def log_event(msg, category="SYSTEM", level="INFO"):
    line = f"[{category}] {msg}"
    try:
        with open("/tmp/scriptoria_worker.log", "a", encoding="utf-8") as _wl:
            _wl.write(line + "\\n")
    except Exception:
        pass
    if not QUIET_STDOUT:
        print(line, flush=True)
    with LOG_LOCK:
        entry = {"category": category, "level": level, "message": msg}
        BOOT_LOGS.append(entry)
        PENDING_LOGS.append(entry)

def has_pending_logs():
    with LOG_LOCK:
        return len(PENDING_LOGS) > 0

${buildPythonRcloneHelpers()}

def _terminate_worker_and_exit(reason="Session cancelled or superseded"):
    if not QUIET_STDOUT:
        print(f"[SHUTDOWN] {reason}. Terminating container cleanly.", flush=True)
    for pat in ("ComfyUI/main.py", "/tmp/caddy", "/tmp/cloudflared", "/usr/local/bin/rclone", "llama-server"):
        try:
            subprocess.run(["pkill", "-f", pat], check=False)
        except Exception:
            pass
    if PROVIDER == "colab":
        try:
            from google.colab import runtime
            runtime.unassign()
        except Exception:
            pass
    os._exit(0)

def _scan_local_models_cached(force=False):
    global MODEL_SCAN_DIRTY
    now = time.time()
    if not force and not MODEL_SCAN_DIRTY and MODEL_SCAN_CACHE["data"] is not None and (now - MODEL_SCAN_CACHE["ts"]) < 12.0:
        return MODEL_SCAN_CACHE["data"], MODEL_SCAN_CACHE["hash"]
    cat_map = {
        "checkpoints": "checkpoints",
        "loras": "loras",
        "vae": "vaes",
        "controlnet": "controlnets",
        "ipadapter": "ipadapters",
        "clip_vision": "clip_vision",
        "upscale_models": "upscale_models",
        "diffusion_models": "diffusion_models",
        "unet": "unet",
        "text_encoders": "text_encoders",
        "ultralytics": "ultralytics",
        "sams": "sams",
        "lbm": "lbm",
    }
    models_by_key = {v: [] for v in set(cat_map.values())}
    storage_files = []
    hash_entries = []
    base_models = "/tmp/models"
    if os.path.isdir(base_models):
        for root, _, fnames in os.walk(base_models):
            rel_root = os.path.relpath(root, base_models)
            if rel_root == ".":
                continue
            parts = rel_root.replace("\\\\", "/").split("/")
            raw_cat = parts[0]
            sub = "/".join(parts[1:])
            ui_key = cat_map.get(raw_cat)
            for fname in sorted(fnames):
                if fname.endswith(".part"):
                    continue
                fpath = os.path.join(root, fname)
                if os.path.isfile(fpath) or os.path.islink(fpath):
                    try:
                        sz = os.path.getsize(fpath)
                    except Exception:
                        sz = 0
                    rel_name = f"{sub}/{fname}" if sub else fname
                    if ui_key:
                        models_by_key[ui_key].append(fname)
                    if len(storage_files) < 160:
                        storage_files.append({"category": raw_cat, "name": rel_name, "sizeBytes": sz})
                    hash_entries.append(f"{raw_cat}/{rel_name}:{sz}")
    disk_info = None
    try:
        du = shutil.disk_usage("/tmp")
        disk_info = {
            "totalGb": round(du.total / (1024 ** 3), 2),
            "usedGb": round(du.used / (1024 ** 3), 2),
            "freeGb": round(du.free / (1024 ** 3), 2),
        }
    except Exception:
        pass
    digest = hashlib.sha1("|".join(sorted(hash_entries)).encode("utf-8")).hexdigest()[:12]
    data = {"models": models_by_key, "storageFiles": storage_files, "disk": disk_info}
    MODEL_SCAN_CACHE["ts"] = now
    MODEL_SCAN_CACHE["data"] = data
    MODEL_SCAN_CACHE["hash"] = digest
    MODEL_SCAN_DIRTY = False
    return data, digest

def _get_cached_filenames_flat():
    scan, _ = _scan_local_models_cached()
    out = []
    for arr in (scan.get("models") or {}).values():
        out.extend(arr)
    return list(dict.fromkeys(out))

def post_heartbeat(step, status="STARTING", telemetry=None):
    global CURRENT_STEP, EVER_CONNECTED, HEARTBEAT_FAIL_STREAK, STALE_410_STREAK, LAST_HB_SENT, STEP_START, STEP_DURATIONS, BOOT_ONLINE_AT
    now = time.time()
    if step > CURRENT_STEP:
        prev_step = CURRENT_STEP
        STEP_DURATIONS[str(prev_step)] = round(now - STEP_START, 1)
        CURRENT_STEP = step
        STEP_START = now
        if step == 5:
            STEP_DURATIONS.setdefault("5", 0.0)
            if BOOT_ONLINE_AT is None:
                BOOT_ONLINE_AT = round(now - T_BOOT_START, 1)
    LAST_HB_SENT = now
    with LOG_LOCK:
        logs_batch = PENDING_LOGS[:]
        PENDING_LOGS.clear()
    telem = dict(telemetry or {})
    telem["stepDurations"] = dict(STEP_DURATIONS)
    telem["currentStepElapsed"] = 0.0 if CURRENT_STEP >= 5 else round(now - STEP_START, 1)
    telem["totalBootElapsed"] = BOOT_ONLINE_AT if BOOT_ONLINE_AT is not None else round(now - T_BOOT_START, 1)
    telem["needsGdriveSync"] = bool(NEEDS_GDRIVE_SYNC)
    telem["gdriveSyncedAtMs"] = GDRIVE_SYNCED_AT_MS
    telem["driveHealthy"] = bool(GDRIVE_HEALTHY)
    telem["headlessMode"] = bool(HEADLESS_MODE)
    telem["modelFetch"] = bool(HEADLESS_MODE)
    telem["topologyMode"] = TOPOLOGY_MODE
    telem["hotModels"] = {str(k): list(v) for k, v in HOT_MODELS_BY_PORT.items()}
    if PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B", "LLM_LIGHTWEIGHT_SWARM"):
        telem["llmTopologyMode"] = LLM_TOPO_MODE
        telem["llmEndpoints"] = list(LLM_ACTIVE_ENDPOINTS)
    try:
        scan_data, scan_hash = _scan_local_models_cached()
        if scan_data.get("disk"):
            telem["disk"] = scan_data["disk"]
        if scan_hash != MODEL_SCAN_CACHE.get("sentHash") or step == 5:
            telem["cachedModels"] = scan_data["models"]
            telem["storageFiles"] = scan_data["storageFiles"]
            MODEL_SCAN_CACHE["sentHash"] = scan_hash
    except Exception:
        pass
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
            hb_raw = resp.read().decode("utf-8", errors="ignore")
            try:
                hb_json = json.loads(hb_raw or "{}")
                if isinstance(hb_json, dict):
                    if hb_json.get("kill") is True:
                        _terminate_worker_and_exit(hb_json.get("reason") or "Server kill signal")
                    if hb_json.get("gdriveTokenPayload"):
                        apply_synced_gdrive_token(hb_json.get("gdriveTokenPayload"), hb_json.get("gdriveUpdatedAtMs"))
                    req_topo = hb_json.get("switchTopology")
                    if req_topo and req_topo != TOPOLOGY_MODE and callable(globals().get("switch_comfy_topology")):
                        threading.Thread(target=globals()["switch_comfy_topology"], args=(req_topo, "server_command"), daemon=True).start()
                    req_llm_topo = hb_json.get("switchLlmTopology")
                    if req_llm_topo and req_llm_topo != LLM_TOPO_MODE and callable(globals().get("start_llm_workers")):
                        threading.Thread(target=globals()["start_llm_workers"], kwargs={"topo_mode": req_llm_topo}, daemon=True).start()
            except Exception:
                pass
        EVER_CONNECTED = True
        HEARTBEAT_FAIL_STREAK = 0
        STALE_410_STREAK = 0
    except urllib.error.HTTPError as he:
        if he.code == 410:
            STALE_410_STREAK += 1
            if EVER_CONNECTED or STALE_410_STREAK >= 2:
                _terminate_worker_and_exit("Session stopped or superseded (HTTP 410)")
            time.sleep(2)
        else:
            HEARTBEAT_FAIL_STREAK += 1
            if not QUIET_STDOUT:
                print(f"[HEARTBEAT] HTTP {he.code}: {he.reason}", flush=True)
    except Exception as e:
        HEARTBEAT_FAIL_STREAK += 1
        if not QUIET_STDOUT:
            print(f"[HEARTBEAT] Warning: {e}", flush=True)

def _worker_api_post(path, body_dict, timeout=20):
    req = urllib.request.Request(
        f"{APP_URL}{path}",
        data=json.dumps(body_dict).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"VmToken {REG_JWT}",
            "User-Agent": "Scriptoria-HeadlessWorker/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")

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
    "upscale_models", "diffusion_models", "model_patches", "lbm",
    "ultralytics", "sams",
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
os.makedirs("/tmp/models/ultralytics/bbox", exist_ok=True)
os.makedirs("/tmp/models/ultralytics/segm", exist_ok=True)
os.makedirs("/tmp/outputs", exist_ok=True)
os.makedirs(FASTBOOT_SITE, exist_ok=True)

with open("/tmp/extra_model_paths.yaml", "w", encoding="utf-8") as f:
    f.write("""scriptoria_tmp:
    base_path: /tmp/models/
    checkpoints: checkpoints/
    loras: loras/
    vae: vae/
    unet: |
        unet/
        diffusion_models/
    clip: |
        clip/
        text_encoders/
    clip_vision: clip_vision/
    controlnet: controlnet/
    ipadapter: ipadapter/
    text_encoders: |
        text_encoders/
        clip/
    upscale_models: upscale_models/
    diffusion_models: |
        diffusion_models/
        unet/
    model_patches: model_patches/
    lbm: lbm/
    ultralytics: ultralytics/
    ultralytics_bbox: ultralytics/bbox/
    ultralytics_segm: ultralytics/segm/
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
    try:
        refresh_gdrive_oauth_in_vm(force=False)
    except Exception:
        pass
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
    raw_cat = os.path.basename(str(category or "checkpoints").strip()).lower()
    clean_cat = {"kokoro": "tts", "mmaudio": "audio_sfx"}.get(raw_cat, raw_cat)
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

def _upload_local_output_backup(task_id, worker_target, fn, src_file):
    try:
        file_sz = os.path.getsize(src_file)
        if file_sz <= 0 or file_sz > 50 * 1024 * 1024:
            return None
        with open(src_file, "rb") as _lf:
            raw_data = _lf.read()
        req = urllib.request.Request(
            f"{APP_URL}/api/v1/workers/upload-output",
            data=raw_data,
            headers={
                "Content-Type": "application/octet-stream",
                "Authorization": f"VmToken {REG_JWT}",
                "X-Task-Id": str(task_id),
                "X-Worker-Id": str(worker_target),
                "X-Filename": urllib.parse.quote(str(fn)),
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            res = json.loads(resp.read().decode("utf-8") or "{}")
        if res.get("ok") and res.get("previewUrl"):
            return res
    except Exception as _uerr:
        log_event(f"[{worker_target}] Local vault backup warning ({fn}): {str(_uerr)[:100]}", category="RCLONE", level="WARN")
    return None

${buildPythonMirrorDownloadHelper()}

FETCH_SEMAPHORE = threading.Semaphore(2)
FETCH_PATH_LOCKS = {}
ACTIVE_FETCH_BY_PATH = {}
VERIFIED_FILES = {}

def _file_stamp(path):
    try:
        stat = os.stat(path)
        return (stat.st_ino, stat.st_size, stat.st_mtime_ns)
    except OSError:
        return None

def _run_fetch_job(job_id, mirrors, category, subdir, filename, target_path, expected_size, sha256_hex, backup_to_gdrive, asset_slug, allow_gdrive_fallback=True, source_error=""):
    def _upd(**kw):
        with FETCH_LOCK:
            if job_id in FETCH_JOBS:
                FETCH_JOBS[job_id].update(kw)

    tmp_dl = target_path + "." + job_id + ".part"
    with FETCH_LOCK:
        path_lock = FETCH_PATH_LOCKS.setdefault(target_path, threading.Lock())
    with path_lock, FETCH_SEMAPHORE:
        try:
            globals()["LAST_ACTIVE"] = time.time()
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            if os.path.isfile(target_path):
                try:
                    size = _verify_download(target_path, sha256_hex, expected_size if not sha256_hex else 0)
                    with FETCH_LOCK:
                        VERIFIED_FILES[(target_path, sha256_hex, expected_size)] = _file_stamp(target_path)
                    _upd(status="completed", percentage=100, bytesDone=size, totalBytes=size, source="cache")
                    return
                except ValueError:
                    pass
            _evict_lru_models_if_needed(expected_size or 0)
            _upd(status="downloading", startedAt=time.time())
            t0 = time.time()

            def _on_progress(done, tot, spd):
                globals()["LAST_ACTIVE"] = time.time()
                eff_tot = tot or expected_size or 0
                pct = min(99, round((done / eff_tot) * 100)) if eff_tot else 0
                eta = max(1, round((eff_tot - done) / spd)) if (eff_tot and spd > 0 and eff_tot > done) else None
                _upd(bytesDone=done, totalBytes=eff_tot, percentage=pct, speedMbps=round(max(0.0, spd) / (1024 ** 2), 1), etaSeconds=eta)

            fetched_from = "http"
            try:
                if not mirrors:
                    raise RuntimeError(source_error or "No eligible download source")
                res_info = _download_with_mirrors(mirrors, tmp_dl, default_sha=sha256_hex, default_size=expected_size, progress_cb=_on_progress)
                fetched_from = res_info.get("sourceKind", "http")
            except Exception as mirror_err:
                if allow_gdrive_fallback and GDRIVE_HEALTHY:
                    log_event(f"Direct mirrors failed for {filename} ({mirror_err}); trying 5 TB Drive fallback...", category="RCLONE", level="WARN")
                    remote_dir = f"{GDRIVE_BASE}/models/{category}" + (f"/{subdir}" if subdir else "")
                    rc_copy_async({
                        "srcFs": f"gdrive:{remote_dir}",
                        "srcRemote": filename,
                        "dstFs": os.path.dirname(target_path),
                        "dstRemote": os.path.basename(tmp_dl),
                    }, max_wait=600, label=f"Drive fallback {filename}")
                    _verify_download(tmp_dl, sha256_hex, expected_size if not sha256_hex else 0)
                    fetched_from = "gdrive"
                else:
                    if allow_gdrive_fallback and RCLONE_READY and not GDRIVE_HEALTHY:
                        raise RuntimeError(f"{mirror_err} (Google Drive API unavailable for fallback)")
                    raise

            os.replace(tmp_dl, target_path)
            globals()["MODEL_SCAN_DIRTY"] = True
            globals()["LAST_ACTIVE"] = time.time()
            final_size = os.path.getsize(target_path)
            with FETCH_LOCK:
                VERIFIED_FILES[(target_path, sha256_hex, expected_size)] = _file_stamp(target_path)
            _upd(status="completed", bytesDone=final_size, totalBytes=final_size, percentage=100, speedMbps=0, etaSeconds=0, source=fetched_from)
            log_event(f"Fetch complete ({fetched_from}): {filename} ({round(final_size / (1024**3), 2)} GB) in {round(time.time() - t0, 1)}s", category="RCLONE", level="SUCCESS")

            if backup_to_gdrive and fetched_from != "gdrive" and GDRIVE_HEALTHY:
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
            _upd(status="failed", error=str(fe), speedMbps=0)
            log_event(f"Direct fetch failed ({filename}): {fe}", category="ERROR", level="ERROR")
        finally:
            with FETCH_LOCK:
                if ACTIVE_FETCH_BY_PATH.get(target_path) == job_id:
                    ACTIVE_FETCH_BY_PATH.pop(target_path, None)

# -------------------------------------------------------------
# 2. Start Sidecar (:9999) Immediately + Prepare Rclone / Caddy Config
# -------------------------------------------------------------
def start_model_fetch(body, job_id=None):
    category, subdir, dest = _safe_model_target(body.get("category"), body.get("filename"), body.get("subdir"))
    if not dest:
        raise ValueError("Invalid catalog destination")
    filename = os.path.basename(dest)
    mirrors = list(body.get("mirrors") or [])
    if not mirrors and body.get("url"):
        mirrors = [dict(body, sourceKind="direct")]
    explicit_id = bool(job_id)
    job_id = job_id or str(uuid.uuid4())
    with FETCH_LOCK:
        if job_id in FETCH_JOBS:
            return job_id
        active_id = ACTIVE_FETCH_BY_PATH.get(dest)
        if not explicit_id and active_id and active_id in FETCH_JOBS:
            st = FETCH_JOBS[active_id].get("status")
            if st in ("queued", "downloading"):
                return active_id
        key = (dest, body.get("sha256") or "", int(body.get("expectedSizeBytes") or 0))
        stamp = _file_stamp(dest)
        if stamp and VERIFIED_FILES.get(key) == stamp:
            FETCH_JOBS[job_id] = dict(jobId=job_id, filename=filename, category=category, status="completed",
                bytesDone=stamp[1], totalBytes=stamp[1], percentage=100, speedMbps=0, source="cache")
            return job_id
        ACTIVE_FETCH_BY_PATH[dest] = job_id
        FETCH_JOBS[job_id] = dict(jobId=job_id, filename=filename, category=category, status="queued",
            bytesDone=0, totalBytes=body.get("expectedSizeBytes") or 0, percentage=0, speedMbps=0, error=None)
    threading.Thread(target=_run_fetch_job, args=(job_id, mirrors, category, subdir, filename, dest,
        int(body.get("expectedSizeBytes") or 0), body.get("sha256") or "",
        bool(body.get("backupToGdrive") and RCLONE_READY), body.get("assetSlug") or "",
        bool(body.get("allowGdriveFallback")), body.get("sourceError") or ""), daemon=True).start()
    return job_id

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
            self.wfile.write(json.dumps({
                "status": "ok",
                "targets": TARGETS,
                "ports": PORTS,
                "profiles": GPU_PROFILES,
                "topologyMode": TOPOLOGY_MODE,
                "hotModels": {str(k): list(v) for k, v in HOT_MODELS_BY_PORT.items()},
            }).encode())
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
            globals()["MODEL_SCAN_DIRTY"] = True
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

        if self.path == "/comfy/switch-mode":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}") if length > 0 else {}
            new_mode = str(body.get("mode") or "dual_parallel").strip()
            if new_mode not in ("dual_parallel", "dual_pipeline", "dual_split", "copilot_split", "single"):
                self.send_response(400); self.end_headers(); return
            if callable(globals().get("switch_comfy_topology")):
                res = globals()["switch_comfy_topology"](new_mode, "sidecar_api")
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps(res).encode())
                return
            self.send_response(503); self.end_headers(); return

        if self.path == "/copilot/eval":
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            try:
                creq = urllib.request.Request(
                    "http://127.0.0.1:8190/v1/chat/completions",
                    data=raw_body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(creq, timeout=90) as cresp:
                    out_bytes = cresp.read()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(out_bytes)
            except Exception as ce:
                self.send_response(502); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps({"error": str(ce)}).encode())
            return

        if self.path in ("/worker/restart", "/worker/stop", "/worker/start"):
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}") if length > 0 else {}
            new_profile = body.get("profile")

            if self.path == "/worker/stop":
                if "stop_llm_workers" in globals():
                    stop_llm_workers()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"ok":true,"status":"STOPPED"}')
                return
            elif self.path == "/worker/start":
                if "start_llm_workers" in globals():
                    start_llm_workers(new_profile)
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"ok":true,"status":"STARTING"}')
                return
            elif self.path == "/worker/restart":
                t_rst = time.time()
                if "start_llm_workers" in globals():
                    start_llm_workers(new_profile)
                dur_ms = round((time.time() - t_rst) * 1000, 1)
                log_event(f"Hot-reloaded LLM workers in {dur_ms}ms (cache hit - 0s download)!", category="SYSTEM", level="SUCCESS")
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "status": "RESTARTING", "elapsedMs": dur_ms}).encode())
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
            try:
                job_id = start_model_fetch(body)
            except ValueError as err:
                self.send_error(400, str(err))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            with FETCH_LOCK:
                cached = FETCH_JOBS[job_id].get("source") == "cache"
            self.wfile.write(json.dumps({"status": "skipped" if cached else "started",
                "alreadyCached": cached, "jobId": job_id}).encode())
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
            file_id = ""
            out_path = ""
            if GDRIVE_HEALTHY:
                try:
                    refresh_gdrive_oauth_in_vm(force=False)
                    try:
                        rc_post("operations/mkdir", {"fs": "gdrive:", "remote": remote_dir})
                    except Exception:
                        pass
                    rc_copy_async({
                        "srcFs": src_dir,
                        "srcRemote": filename,
                        "dstFs": f"gdrive:{remote_dir}",
                        "dstRemote": filename,
                    }, max_wait=240, label=f"Sync output {filename}")
                    stat = rc_post("operations/stat", {"fs": f"gdrive:{remote_dir}", "remote": filename})
                    file_id = (stat.get("item") or {}).get("ID", "")
                    out_path = f"{remote_dir}/{filename}"
                except Exception as _g_err:
                    log_event(f"Drive sync fallback for {filename}: {str(_g_err)[:100]}", category="RCLONE", level="WARN")
            if not file_id:
                local_res = _upload_local_output_backup("interactive", TARGETS[0] if TARGETS else "vm", filename, os.path.join(src_dir, filename))
                if local_res:
                    file_id = local_res.get("localFileId", "")
                    out_path = local_res.get("localPath", "")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "gdriveFileId": file_id,
                "gdrivePath": out_path
            }).encode())
            return

        self.send_response(404); self.end_headers()

threading.Thread(target=lambda: ThreadingHTTPServer(("127.0.0.1", 9999), SidecarHandler).serve_forever(), daemon=True).start()

_init_gdrive_state(GDRIVE_TOKEN_RAW)
refresh_gdrive_oauth_in_vm(force=True)
with RCLONE_LOCK:
    _write_rclone_conf_unlocked(push_rc=False)
    gdrive_cfg = GDRIVE_CFG

def _write_caddy_config(is_dual_split=False):
    split_block = """@is_8189_single header X-Target-Port 8189
    handle @is_8189_single {
        reverse_proxy 127.0.0.1:8188 {
            header_up Host 127.0.0.1
            flush_interval -1
        }
    }
    """ if is_dual_split else ""
    port_8189_dst = "8188" if is_dual_split else "8189"
    with open("/tmp/Caddyfile", "w", encoding="utf-8") as f:
        f.write(f"""(sc_dispatch) {{
    {split_block}@has_header header X-Target-Port *
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
        reverse_proxy 127.0.0.1:{port_8189_dst} {{
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

_write_caddy_config(SINGLE_DUAL_GPU)

# -------------------------------------------------------------
# 3. Parallel Stage: Rclone + Caddy + Cloudflared + uv Binary
# -------------------------------------------------------------
rclone_ok = False

def setup_rclone():
    global RCLONE_READY, GDRIVE_HEALTHY, rclone_ok
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
            try:
                rc_post("operations/about", {"fs": "gdrive:"}, timeout=6)
                GDRIVE_HEALTHY = True
                rclone_ok = True
                log_event(f"Rclone RC (:5572) + Drive verified in {round(time.time() - t0, 1)}s", category="RCLONE", level="SUCCESS")
            except Exception as g_err:
                GDRIVE_HEALTHY = False
                rclone_ok = False
                log_event(f"Google Drive API unavailable ({str(g_err)[:100]}); using HuggingFace/Direct/Local fallback backups.", category="RCLONE", level="WARN")
            return GDRIVE_HEALTHY
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

aria2_started = False
if not HEADLESS_MODE:
    threading.Thread(target=setup_caddy, daemon=True).start()
    threading.Thread(target=setup_cloudflared, daemon=True).start()
else:
    log_event("Safe Headless Mode active (tunnel/proxy disabled; outbound worker polling enabled).", category="NETWORK", level="INFO")
if PREWARM_MODELS:
    aria2_started = True
    threading.Thread(target=setup_aria2, daemon=True).start()
uv_thread = threading.Thread(target=setup_uv, daemon=True)
uv_thread.start()
rclone_thread = threading.Thread(target=setup_rclone, daemon=True)
rclone_thread.start()
if PREWARM_MODELS:
    rclone_thread.join(timeout=8)
    for startup_model in PREWARM_MODELS:
        start_model_fetch(startup_model)

def _resolve_llama_bin():
    from pathlib import Path as _P
    os.makedirs("/tmp/llama_bin", exist_ok=True)
    if os.path.exists("/tmp/llama_bin/llama-server"):
        return "/tmp/llama_bin/llama-server"
    for cand in _P("/kaggle/input").rglob("llama-server") if os.path.exists("/kaggle/input") else []:
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

def _fast_download_hf(repo_id, filename, dst_dir="/tmp/models/llm/qwen3_vl_8b", label="Model"):
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

# -------------------------------------------------------------
# 3B. Dedicated LLM Nodes (LLM_QWEN_VLM, LLM_QWEN_TEXT_TURBO, LLM_QWEN_MOE_35B & LLM_QWEN_FAST_8B on Dual-T4)
# -------------------------------------------------------------
if PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B", "LLM_LIGHTWEIGHT_SWARM"):
    if rclone_thread.is_alive():
        rclone_thread.join(timeout=8)
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

    WORKER_PROCS = {}
    WORKER_LOCK = threading.RLock()
    WORKER_STATE = {"status": "STARTING", "profile": PROFILE_ID}

    def _stop_llm_workers_unlocked():
        for k, p in list(WORKER_PROCS.items()):
            try:
                p.terminate()
                p.wait(timeout=2)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        WORKER_PROCS.clear()
        # Mutual process eviction: kill both llama-server and any running ComfyUI instances
        subprocess.run(["pkill", "-9", "-f", "llama-server"], check=False)
        subprocess.run(["pkill", "-9", "-f", "ComfyUI/main.py"], check=False)
        subprocess.run(["pkill", "-9", "-f", "main.py --listen"], check=False)
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
        time.sleep(0.5)
        WORKER_STATE["status"] = "STOPPED"
        log_event("Worker processes evicted & GPU VRAM cleared.", category="SYSTEM", level="WARN")

    def stop_llm_workers():
        with WORKER_LOCK:
            _stop_llm_workers_unlocked()

    def start_llm_workers(target_profile=None, topo_mode=None):
        global PROFILE_ID, LLM_TOPO_MODE, LLM_ACTIVE_ENDPOINTS, is_moe_35b, is_fast_8b, is_vlm_27b, model_gguf, mmproj_gguf, mode_label
        with WORKER_LOCK:
            _stop_llm_workers_unlocked()
            if target_profile:
                PROFILE_ID = target_profile
                WORKER_STATE["profile"] = target_profile
            if topo_mode:
                LLM_TOPO_MODE = topo_mode
            is_moe_35b = (PROFILE_ID == "LLM_QWEN_MOE_35B")
            is_fast_8b = (PROFILE_ID == "LLM_QWEN_FAST_8B")
            is_vlm_27b = (PROFILE_ID == "LLM_QWEN_VLM")

            WORKER_STATE["status"] = "STARTING"
            model_gguf, mmproj_gguf, is_swarm = _resolve_qwen_ggufs()
            q4_dir = f"{LOCAL_LLM_DIR}/qwen4b"
            m4_path = f"{q4_dir}/Qwen3.5-4B-Q4_K_M.gguf"
            model_gb = round(os.path.getsize(model_gguf) / (1024**3), 2) if (model_gguf and os.path.exists(model_gguf)) else 0.0
            active_topo = "llm_swarm_multi" if (PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM" or LLM_TOPO_MODE == "llm_swarm_multi") else LLM_TOPO_MODE
            if active_topo in ("llm_dual_replica", "llm_ab_arena") and model_gb > 13.0:
                log_event(f"Model ({os.path.basename(model_gguf)}, {model_gb}GB) exceeds 16GB single-T4 limit; using Dual-T4 layer split instead of {active_topo}.", category="SYSTEM", level="WARN")
                active_topo = "llm_layer_split"
                LLM_TOPO_MODE = active_topo

            LLM_ACTIVE_ENDPOINTS = []

            if active_topo == "llm_swarm_multi":
                if not os.path.exists(m4_path):
                    os.makedirs(q4_dir, exist_ok=True)
                    _fast_download_hf("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf", q4_dir, label="Qwen 4B Extractor")
                cpm_dir = f"{LOCAL_LLM_DIR}/cpm1b"
                cpm_path = f"{cpm_dir}/MiniCPM-V-4_7-1B-Q4_K_M.gguf"
                if not os.path.exists(cpm_path):
                    os.makedirs(cpm_dir, exist_ok=True)
                    _fast_download_hf("openbmb/MiniCPM-V-4_7-1B-gguf", "MiniCPM-V-4_7-1B-Q4_K_M.gguf", cpm_dir, label="MiniCPM-V 1B")

                # 1. Primary Qwen on CUDA 0 (:8190)
                cmd_9b = [
                    llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", "8190",
                    "-ngl", "99", "-c", "16384",
                    "--flash-attn", "off",
                    "--batch-size", "256", "--ubatch-size", "128",
                    "--parallel", "1",
                ]
                if mmproj_gguf:
                    cmd_9b.extend(["--mmproj", mmproj_gguf])
                env_9b = ll_env.copy()
                env_9b["CUDA_VISIBLE_DEVICES"] = "0"
                WORKER_PROCS["9b"] = subprocess.Popen(cmd_9b, env=env_9b, stdout=open("/tmp/llama_server.log", "w"), stderr=subprocess.STDOUT)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8190, "gpu": "GPU0", "model": os.path.basename(model_gguf), "service": "default", "ready": True})
                log_event(f"Launched {os.path.basename(model_gguf)} QC VLM -> CUDA:0 (:8190)", category="SYSTEM", level="SUCCESS")

                # 2. Qwen3.5-4B on CUDA 1 (:8191)
                cmd_4b = [
                    llama_bin, "-m", m4_path, "--host", "127.0.0.1", "--port", "8191",
                    "-ngl", "99", "-c", "8192",
                    "--flash-attn", "off",
                    "--batch-size", "256", "--ubatch-size", "128",
                    "--parallel", "1",
                ]
                env_4b = ll_env.copy()
                env_4b["CUDA_VISIBLE_DEVICES"] = "1"
                WORKER_PROCS["4b"] = subprocess.Popen(cmd_4b, env=env_4b, stdout=open("/tmp/llama_4b.log", "w"), stderr=subprocess.STDOUT)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8191, "gpu": "GPU1", "model": "Qwen3.5-4B-Q4_K_M.gguf", "service": "extract", "ready": True})
                log_event("Launched Qwen3.5-4B Fast Extractor -> CUDA:1 (:8191)", category="SYSTEM", level="SUCCESS")

                # 3. MiniCPM-V 4.7-1B on CUDA 1 (:8192)
                cmd_cpm = [
                    llama_bin, "-m", cpm_path, "--host", "127.0.0.1", "--port", "8192",
                    "-ngl", "99", "-c", "4096",
                    "--batch-size", "256", "--ubatch-size", "128",
                    "--parallel", "1",
                ]
                env_cpm = ll_env.copy()
                env_cpm["CUDA_VISIBLE_DEVICES"] = "1"
                WORKER_PROCS["cpm"] = subprocess.Popen(cmd_cpm, env=env_cpm, stdout=open("/tmp/llama_cpm.log", "w"), stderr=subprocess.STDOUT)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8192, "gpu": "GPU1", "model": "MiniCPM-V-4_7-1B-Q4_K_M.gguf", "service": "tag", "ready": True})
                mode_label = "Multi-Model Swarm (GPU0:8190 + GPU1:8191/8192)"
                log_event("Launched MiniCPM-V 4.7-1B Vision/OCR -> CUDA:1 (:8192)", category="SYSTEM", level="SUCCESS")
            elif active_topo == "llm_dual_replica":
                # Run 2 independent replicas across GPU0 (:8190) and GPU1 (:8191) for 2x parallel eval/chat throughput
                for r_idx, r_port in [(0, 8190), (1, 8191)]:
                    cmd_rep = [
                        llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", str(r_port),
                        "-ngl", "99", "-c", "16384",
                        "--flash-attn", "on",
                        "--batch-size", "512", "--ubatch-size", "256",
                        "--parallel", "1", "--jinja",
                    ]
                    if mmproj_gguf and PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B"):
                        cmd_rep.extend(["--mmproj", mmproj_gguf])
                    env_rep = ll_env.copy()
                    env_rep["CUDA_VISIBLE_DEVICES"] = str(r_idx)
                    log_p = "/tmp/llama_server.log" if r_idx == 0 else "/tmp/llama_replica1.log"
                    WORKER_PROCS[f"rep{r_idx}"] = subprocess.Popen(cmd_rep, env=env_rep, stdout=open(log_p, "w"), stderr=subprocess.STDOUT)
                    LLM_ACTIVE_ENDPOINTS.append({"port": r_port, "gpu": f"GPU{r_idx}", "model": os.path.basename(model_gguf), "service": f"replica{r_idx}", "ready": True})
                mode_label = f"2x Dual-T4 Replica ({os.path.basename(model_gguf)})"
                log_event(f"Launched 2x Dual-T4 Replicas -> GPU0:8190 + GPU1:8191 ({os.path.basename(model_gguf)})", category="SYSTEM", level="SUCCESS")
            elif active_topo == "llm_ab_arena":
                if not os.path.exists(m4_path):
                    os.makedirs(q4_dir, exist_ok=True)
                    _fast_download_hf("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf", q4_dir, label="Qwen 4B Model B")
                cmd_a = [
                    llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", "8190",
                    "-ngl", "99", "-c", "16384", "--flash-attn", "on", "--parallel", "1", "--jinja",
                ]
                if mmproj_gguf:
                    cmd_a.extend(["--mmproj", mmproj_gguf])
                env_a = ll_env.copy()
                env_a["CUDA_VISIBLE_DEVICES"] = "0"
                WORKER_PROCS["model_a"] = subprocess.Popen(cmd_a, env=env_a, stdout=open("/tmp/llama_server.log", "w"), stderr=subprocess.STDOUT)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8190, "gpu": "GPU0", "model": os.path.basename(model_gguf), "service": "model_a", "ready": True})

                cmd_b = [
                    llama_bin, "-m", m4_path, "--host", "127.0.0.1", "--port", "8191",
                    "-ngl", "99", "-c", "16384", "--flash-attn", "on", "--parallel", "1", "--jinja",
                ]
                env_b = ll_env.copy()
                env_b["CUDA_VISIBLE_DEVICES"] = "1"
                WORKER_PROCS["model_b"] = subprocess.Popen(cmd_b, env=env_b, stdout=open("/tmp/llama_model_b.log", "w"), stderr=subprocess.STDOUT)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8191, "gpu": "GPU1", "model": "Qwen3.5-4B-Q4_K_M.gguf", "service": "model_b", "ready": True})
                mode_label = f"A/B Arena (GPU0: {os.path.basename(model_gguf)} vs GPU1: Qwen3.5-4B)"
                log_event(f"Launched A/B Arena -> GPU0:8190 ({os.path.basename(model_gguf)}) vs GPU1:8191 (Qwen3.5-4B)", category="SYSTEM", level="SUCCESS")
            else:
                has_dflash = bool(dflash_gguf and os.path.exists(dflash_gguf))
                t_split = "52,48" if is_moe_35b else ("55,45" if is_vlm_27b else "50,50")
                ctx_size = "16384"
                ubatch = "128" if (is_vlm_27b and has_dflash) else "256"
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
                    "--ubatch-size", ubatch,
                    "--parallel", "1",
                    "--kv-unified",
                    "--jinja",
                    "--chat-template-kwargs", '{"enable_thinking":false}',
                ]
                if mmproj_gguf and PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B"):
                    ll_cmd.extend(["--mmproj", mmproj_gguf])
                if is_vlm_27b and has_dflash:
                    ll_cmd.extend([
                        "-md", dflash_gguf,
                        "--spec-type", "draft-dflash",
                        "--spec-draft-n-max", "5",
                        "-ngld", "99",
                        "-devd", "CUDA1",
                        "-ctkd", "q8_0",
                        "-ctvd", "q8_0",
                    ])
                ll_log = open("/tmp/llama_server.log", "w")
                WORKER_PROCS["main"] = subprocess.Popen(ll_cmd, env=ll_env, stdout=ll_log, stderr=ll_log)
                LLM_ACTIVE_ENDPOINTS.append({"port": 8190, "gpu": "GPU0+GPU1", "model": os.path.basename(model_gguf), "service": "default", "ready": True})
                mode_label = (
                    "Qwen 8B Fast Vision (~45-60 tok/s)" if is_fast_8b
                    else ("Qwen 35B-A3B Vision MoE (~35-55 tok/s)" if is_moe_35b
                    else (("Vision + DFlash2 (~35-45 tok/s)" if dflash_gguf else "Vision + LLM (~16 tok/s)") if is_vlm_27b else "Ultra Text Turbo"))
                )
                log_event(f"Launched llama-server ({mode_label}, 2x T4 split) -> 127.0.0.1:8190 ({os.path.basename(model_gguf)})", category="SYSTEM")

    start_llm_workers()

    def _tail_llama_log(log_path, label):
        t0 = time.time()
        while time.time() - t0 < 30 and not os.path.exists(log_path):
            time.sleep(0.5)
        if not os.path.exists(log_path):
            return
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as lf:
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
            if self.path == "/v1/llm/switch-topology":
                length = int(self.headers.get("Content-Length", "0") or 0)
                raw_sw = self.rfile.read(length) if length > 0 else b"{}"
                sw_data = json.loads(raw_sw.decode("utf-8", "ignore") or "{}")
                req_mode = str(sw_data.get("mode") or "llm_layer_split")
                threading.Thread(target=start_llm_workers, kwargs={"topo_mode": req_mode}, daemon=True).start()
                body = json.dumps({"ok": True, "mode": req_mode}).encode("utf-8")
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
            if hdr_svc in ("extract", "replica1", "model_b") or self.path.startswith("/v1/extract") or self.path.startswith("/v1/model_b"):
                target_port = 8191
                if self.path.startswith("/v1/extract"):
                    target_path = "/v1" + self.path[len("/v1/extract"):]
                elif self.path.startswith("/v1/model_b"):
                    target_path = "/v1" + self.path[len("/v1/model_b"):]
            elif hdr_svc in ("replica0", "model_a") or self.path.startswith("/v1/model_a"):
                target_port = 8190
                if self.path.startswith("/v1/model_a"):
                    target_path = "/v1" + self.path[len("/v1/model_a"):]
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

    def _resolve_svc_port(svc):
        s = (svc or "default").lower().strip()
        if s in ("extract", "replica1", "model_b") and any(e.get("port") == 8191 for e in LLM_ACTIVE_ENDPOINTS):
            return 8191
        if s == "tag" and any(e.get("port") == 8192 for e in LLM_ACTIVE_ENDPOINTS):
            return 8192
        if s == "rag" and any(e.get("port") == 8193 for e in LLM_ACTIVE_ENDPOINTS):
            return 8193
        return 8190

    def _llm_outbound_relay_loop(lane_id):
        while True:
            try:
                poll_res = _worker_api_post("/api/v1/workers/llm-poll", {"workerId": TARGETS[0]}, timeout=20)
                req_obj = poll_res.get("request")
                if not req_obj:
                    time.sleep(0.6)
                    continue
                globals()["LAST_ACTIVE"] = time.time()
                rid = req_obj["id"]
                svc_port = _resolve_svc_port(req_obj.get("targetService"))
                t0_req = time.time()
                try:
                    c_req = urllib.request.Request(
                        f"http://127.0.0.1:{svc_port}/v1/chat/completions",
                        data=json.dumps(req_obj["requestPayload"]).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(c_req, timeout=180) as cr:
                        c_res = json.loads(cr.read().decode("utf-8") or "{}")
                    _worker_api_post("/api/v1/workers/llm-complete", {
                        "requestId": rid,
                        "workerId": TARGETS[0],
                        "response": c_res,
                        "latencyMs": int((time.time() - t0_req) * 1000),
                    }, timeout=20)
                except Exception as llm_err:
                    _worker_api_post("/api/v1/workers/llm-complete", {
                        "requestId": rid,
                        "workerId": TARGETS[0],
                        "errorMessage": str(llm_err)[:400],
                        "latencyMs": int((time.time() - t0_req) * 1000),
                    }, timeout=15)
            except urllib.error.HTTPError as he:
                if he.code in (401, 410):
                    return
                time.sleep(3)
            except Exception:
                time.sleep(2)

    if HEADLESS_MODE:
        for _lane in range(2 if len(TARGETS) >= 2 else 1):
            threading.Thread(target=_llm_outbound_relay_loop, args=(_lane,), daemon=True).start()

    _llm_last_step = -1
    _llm_t0 = time.time()
    while True:
        llm_ok = False
        try:
            if LLM_TOPO_MODE == "llm_swarm_multi" or PROFILE_ID == "LLM_LIGHTWEIGHT_SWARM":
                with urllib.request.urlopen("http://127.0.0.1:8190/health", timeout=2) as hr0:
                    with urllib.request.urlopen("http://127.0.0.1:8191/health", timeout=2) as hr1:
                        llm_ok = (hr0.status == 200 and hr1.status == 200)
            else:
                with urllib.request.urlopen("http://127.0.0.1:8190/health", timeout=2) as hr:
                    llm_ok = hr.status == 200
        except Exception:
            llm_ok = False

        llm_tunnel_ok = True if HEADLESS_MODE else (bool(TUNNEL_URL) and is_caddy_ready())
        devs = _query_nvidia_smi()
        telem = {}
        for idx_t, t_name in enumerate(TARGETS):
            d = devs[min(idx_t, len(devs) - 1)] if devs else {}
            vt = round(d.get("vram_total", 16 * (1024**3)) / (1024**3), 2)
            vf = round(d.get("vram_free", 0) / (1024**3), 2)
            telem[t_name] = {
                "ready": bool(llm_ok and llm_tunnel_ok),
                "gpuName": d.get("name", "NVIDIA T4 (LLM)"),
                "vramTotalGb": vt,
                "vramUsedGb": round(max(0.0, vt - vf), 2),
            }

        all_ready = llm_tunnel_ok and llm_ok
        next_step = 5 if all_ready else (4 if llm_tunnel_ok else 3)
        next_status = "ONLINE" if all_ready else "STARTING"

        dead_proc = None
        with WORKER_LOCK:
            for wname, wproc in list(WORKER_PROCS.items()):
                if wproc.poll() is not None:
                    dead_proc = f"Worker {wname} (code={wproc.returncode})"
                    break

        if dead_proc and WORKER_STATE.get("status") not in ("STOPPED", "STARTING"):
            log_event(f"Worker process died: {dead_proc}. Container daemon remains active for hot-reload.", category="ERROR", level="ERROR")
            WORKER_STATE["status"] = "ERROR"
            post_heartbeat(4, "ERROR", telem)

        if all_ready and CURRENT_STEP < 5:
            lbl = f"{mode_label} ({'Safe Headless Relay' if HEADLESS_MODE else TUNNEL_URL})"
            log_event(f"{lbl} ONLINE in {round(time.time() - t_boot_start, 1)}s!", category="SYSTEM", level="SUCCESS")

        if RCLONE_READY:
            refresh_gdrive_oauth_in_vm(force=False)
        hb_int = 20 if all_ready else 8
        if next_step != _llm_last_step or has_pending_logs() or (time.time() - LAST_HB_SENT) >= hb_int:
            post_heartbeat(next_step, next_status, telem)
            _llm_last_step = next_step

        if not EVER_CONNECTED and (time.time() - _llm_t0) > 90 and HEARTBEAT_FAIL_STREAK >= 3:
            break
        if IDLE_TIMEOUT_SEC > 0:
            try:
                with urllib.request.urlopen("http://127.0.0.1:8190/slots", timeout=1.5) as sr:
                    slots = json.loads(sr.read().decode("utf-8"))
                    if isinstance(slots, list) and any(s.get("is_processing") or s.get("state", 0) != 0 for s in slots if isinstance(s, dict)):
                        LAST_ACTIVE = time.time()
            except Exception:
                pass
        if IDLE_TIMEOUT_SEC > 0 and (time.time() - LAST_ACTIVE > IDLE_TIMEOUT_SEC):
            log_event("LLM idle timeout reached. Stopping to preserve Kaggle quota.", category="ACTION", level="WARN")
            post_heartbeat(0, "OFFLINE", {})
            break
        time.sleep(15 if all_ready else 3)

    stop_llm_workers()
    sys.exit(0)

# -------------------------------------------------------------
# 4. FastBoot GDrive Cache Hit OR Parallel ComfyUI Clone + uv Delta
# -------------------------------------------------------------
should_upload_cache = False
snapshot_meta = None
if not os.path.exists(os.path.join(COMFY_DIR, "main.py")):
    cache_restored = False
    if os.path.exists("/kaggle/input"):
        from pathlib import Path as _Path
        _ds_candidates = (
            f"comfy_env_{PROFILE_ID}.pak",
            "comfy_env.pak",
            f"comfy_env_{PROFILE_ID}.tar.gz",
            "comfy_env.tar.gz",
            f"comfy_env_{PROFILE_ID}.tar",
            "comfy_env.tar",
        )
        for _ds_name in _ds_candidates:
            for _ds_arc in _Path("/kaggle/input").rglob(_ds_name):
                if _ds_arc.is_file() and _ds_arc.stat().st_size > 100000:
                    try:
                        _t_ds = time.time()
                        log_event(f"Pre-built Kaggle Dataset HIT ({_ds_arc.name})! Extracting to /tmp...", category="COMFYUI", level="SUCCESS")
                        _tar_flag = "-xf" if str(_ds_arc).endswith(".tar") else "-xzf"
                        subprocess.run(["tar", _tar_flag, str(_ds_arc), "-C", "/tmp"], check=True)
                        if os.path.exists(os.path.join(COMFY_DIR, "main.py")):
                            cache_restored = True
                            log_event(f"Dataset ComfyUI restored in {round(time.time() - _t_ds, 1)}s!", category="COMFYUI", level="SUCCESS")
                            break
                    except Exception as _ds_err:
                        log_event(f"Dataset restore failed ({_ds_err}); falling back.", category="COMFYUI", level="WARN")
            if cache_restored:
                break
        if not cache_restored:
            for _main_py in _Path("/kaggle/input").rglob("ComfyUI/main.py"):
                try:
                    _t_ds = time.time()
                    _src_comfy = _main_py.parent
                    log_event(f"Unpacked Kaggle Dataset HIT ({_src_comfy})! Copying to /tmp...", category="COMFYUI", level="SUCCESS")
                    subprocess.run(["cp", "-a", str(_src_comfy), COMFY_DIR], check=True)
                    _src_site = _src_comfy.parent / "sc_site_packages"
                    if _src_site.is_dir():
                        subprocess.run(["cp", "-a", f"{_src_site}/.", FASTBOOT_SITE], check=True)
                    if os.path.exists(os.path.join(COMFY_DIR, "main.py")):
                        cache_restored = True
                        log_event(f"Unpacked dataset restored in {round(time.time() - _t_ds, 1)}s!", category="COMFYUI", level="SUCCESS")
                        break
                except Exception as _cp_err:
                    log_event(f"Unpacked dataset copy notice: {_cp_err}", category="COMFYUI", level="WARN")
    if not cache_restored and gdrive_cfg and rclone_thread.is_alive():
        rclone_thread.join(timeout=6)
    if not cache_restored and rclone_ok:
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

    if cache_restored and not any(
        os.path.exists(os.path.join(_sd, "torchsde"))
        for _sd in [FASTBOOT_SITE] + list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
    ):
        log_event("Restoring missing torchsde onto FastBoot environment...", category="COMFYUI", level="WARN")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "torchsde"], check=False)

    missing_nodes = [
        cn for cn in (CUSTOM_NODES or [])
        if cn.get("name") and not os.path.exists(os.path.join(COMFY_DIR, "custom_nodes", cn["name"]))
    ]
    if not cache_restored or missing_nodes:
        t_cold = time.time()
        nodes_to_install = list(CUSTOM_NODES or []) if not cache_restored else missing_nodes
        if not cache_restored:
            log_event(f"Cloning ComfyUI (shallow) & installing {PROFILE_ID} delta packages via uv...", category="COMFYUI")
            subprocess.run(["git", "clone", "--depth", "1", "--single-branch", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR], check=True)
        else:
            log_event(f"Syncing {len(nodes_to_install)} missing delta node(s) onto FastBoot cache...", category="COMFYUI")

        if nodes_to_install:
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
            clone_threads = [threading.Thread(target=_clone_node, args=(cn,), daemon=True) for cn in nodes_to_install]
            for ct in clone_threads:
                ct.start()
            for ct in clone_threads:
                ct.join(timeout=65)

        req_sources = [] if cache_restored else [os.path.join(COMFY_DIR, "requirements.txt")]
        for cn in nodes_to_install:
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
            if any("Impact-Pack" in cn.get("name", "") for cn in nodes_to_install):
                for extra_pkg in ("ultralytics", "segment-anything", "piexif", "scikit-image", "opencv-python-headless"):
                    if extra_pkg not in seen_lines:
                        seen_lines.add(extra_pkg)
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

        if seen_lines:
            site_dirs = list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
            before_snap = _snap_site_dirs(site_dirs)
            uv_thread.join(timeout=45)
            log_event("Installing ComfyUI + profile delta packages in single pass...", category="COMFYUI")
            _uv_or_pip_install(filtered_reqs, check_err=True)
            if not cache_restored:
                snapshot_meta = (site_dirs, before_snap)
                should_upload_cache = True

        log_event(f"ComfyUI ({PROFILE_ID}) + dependencies ready in {round(time.time() - t_cold, 1)}s", category="COMFYUI", level="SUCCESS")

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

def _query_comfy_nvidia_smi():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
            text=True,
            timeout=3,
        )
        devs = []
        for ln in out.strip().splitlines():
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) >= 3:
                tot_b = int(float(parts[1]) * 1024 * 1024)
                used_b = int(float(parts[2]) * 1024 * 1024)
                devs.append({
                    "name": parts[0],
                    "vram_total": tot_b,
                    "vram_free": max(0, tot_b - used_b),
                })
        return devs
    except Exception:
        return []

post_heartbeat(3, "STARTING")

# -------------------------------------------------------------
# 5. Dynamic 4-Mode Dual-T4 ComfyUI Supervisor & Strict CUDA Isolation
# -------------------------------------------------------------
gpu_count = len(_query_comfy_nvidia_smi()) or 1
COMFY_PROCS = {}
COPILOT_LLM_PROC = None
COMFY_LOG_OFFSETS = {}
active_ports = [8188] if (SINGLE_DUAL_GPU or PROVIDER != "kaggle" or gpu_count < 2) else [8188, 8189]

_comfy_models_dir = os.path.join(COMFY_DIR, "models")
if os.path.isdir(_comfy_models_dir):
    for _mcat in ("ultralytics", "sams", "lbm"):
        _dst_m = os.path.join(_comfy_models_dir, _mcat)
        _src_m = f"/tmp/models/{_mcat}"
        try:
            if not os.path.exists(_dst_m) and not os.path.islink(_dst_m):
                os.symlink(_src_m, _dst_m)
        except Exception:
            pass

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

def _capabilities_for_profile(prof):
    caps = [prof]
    if prof in ("IMAGE_CORE", "IMAGE_GGUF_EDIT"):
        caps.append("BASE_COMFY")
    elif prof == "IMAGE_DIT_DUAL_T4":
        caps.extend(["IMAGE_GGUF_EDIT", "IMAGE_CORE", "BASE_COMFY"])
    return list(dict.fromkeys(caps))

def _ensure_nodes_for_mode(mode):
    if mode not in ("dual_split", "dual_pipeline"):
        return
    extra_nodes = [
        ("ComfyUI-GGUF", "https://github.com/city96/ComfyUI-GGUF.git"),
        ("ComfyUI-MultiGPU", "https://github.com/pollockjj/ComfyUI-MultiGPU.git"),
        ("ComfyUI-KJNodes", "https://github.com/kijai/ComfyUI-KJNodes.git"),
        ("ComfyUI-LBM", "https://github.com/1038lab/ComfyUI-LBM.git"),
    ]
    nodes_dir = os.path.join(COMFY_DIR, "custom_nodes")
    os.makedirs(nodes_dir, exist_ok=True)
    missing = [(n, u) for n, u in extra_nodes if not os.path.exists(os.path.join(nodes_dir, n))]
    if not missing:
        return
    log_event(f"Syncing {len(missing)} node pack(s) for {mode}...", category="COMFYUI")
    reqs = []
    for n, u in missing:
        dst = os.path.join(nodes_dir, n)
        try:
            subprocess.run(["git", "clone", "--depth", "1", "--single-branch", u, dst], check=True, timeout=60)
            req_f = os.path.join(dst, "requirements.txt")
            if os.path.exists(req_f):
                reqs.append(req_f)
        except Exception as ne:
            log_event(f"Node delta notice ({n}): {ne}", category="COMFYUI", level="WARN")
    for rf in reqs:
        try:
            if os.path.exists("/tmp/uv"):
                subprocess.run(["/tmp/uv", "pip", "install", "--system", "-q", "-r", rf], check=False, timeout=90)
            else:
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", rf], check=False, timeout=120)
        except Exception:
            pass

def _stop_all_compute_procs():
    global COPILOT_LLM_PROC
    for port, proc in list(COMFY_PROCS.items()):
        try:
            proc.terminate()
            proc.wait(timeout=4)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    COMFY_PROCS.clear()
    if COPILOT_LLM_PROC is not None:
        try:
            COPILOT_LLM_PROC.terminate()
            COPILOT_LLM_PROC.wait(timeout=3)
        except Exception:
            try:
                COPILOT_LLM_PROC.kill()
            except Exception:
                pass
        COPILOT_LLM_PROC = None
    subprocess.run(["pkill", "-9", "-f", "ComfyUI/main.py"], check=False)
    subprocess.run(["pkill", "-9", "-f", "llama-server"], check=False)
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass
    time.sleep(0.5)

def _launch_copilot_llm_on_gpu1():
    global COPILOT_LLM_PROC
    try:
        llama_bin = _resolve_llama_bin()
        llm_dir = "/tmp/models/llm/qwen3_vl_8b"
        os.makedirs(llm_dir, exist_ok=True)
        model_path = _fast_download_hf("unsloth/Qwen3-VL-8B-Instruct-GGUF", "Qwen3-VL-8B-Instruct-Q4_K_M.gguf", llm_dir, label="Co-Pilot 8B")
        mm_path = None
        try:
            mm_path = _fast_download_hf("unsloth/Qwen3-VL-8B-Instruct-GGUF", "mmproj-F16.gguf", llm_dir, label="Co-Pilot mmproj")
        except Exception:
            pass
        ll_env = os.environ.copy()
        ll_env["CUDA_VISIBLE_DEVICES"] = "1"
        ll_env["LD_LIBRARY_PATH"] = f"/tmp/llama_bin:{ll_env.get('LD_LIBRARY_PATH', '')}"
        cmd = [
            llama_bin, "-m", model_path, "--host", "127.0.0.1", "--port", "8190",
            "-ngl", "99", "-c", "8192", "--flash-attn", "on", "--parallel", "1",
        ]
        if mm_path and os.path.exists(mm_path):
            cmd.extend(["--mmproj", mm_path])
        COPILOT_LLM_PROC = subprocess.Popen(cmd, env=ll_env, stdout=open("/tmp/copilot_llm.log", "w"), stderr=subprocess.STDOUT)
        log_event("Co-Pilot Qwen3-VL-8B started on GPU1 -> 127.0.0.1:8190", category="SYSTEM", level="SUCCESS")
    except Exception as ce:
        log_event(f"Co-Pilot GPU1 start warning: {ce}", category="SYSTEM", level="WARN")

def _start_topology_procs(mode):
    global active_ports, SINGLE_DUAL_GPU, TOPOLOGY_MODE
    TOPOLOGY_MODE = mode
    SINGLE_DUAL_GPU = (mode == "dual_split")
    if mode in ("dual_split", "copilot_split") or PROVIDER != "kaggle" or gpu_count < 2:
        active_ports = [8188]
    else:
        active_ports = [8188, 8189]
    COMFY_LOG_OFFSETS.clear()
    for idx, port in enumerate(active_ports):
        if idx > 0:
            stagger_wait = 5 if CUSTOM_NODES else 2
            t_stg = time.time()
            while (time.time() - t_stg) < stagger_wait:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{active_ports[0]}/system_stats", timeout=1.0) as r:
                        if r.status == 200:
                            break
                except Exception:
                    pass
                time.sleep(1.0)
        env = os.environ.copy()
        cuda_vis = ",".join(str(i) for i in range(max(1, gpu_count))) if mode == "dual_split" else str(idx)
        env["CUDA_VISIBLE_DEVICES"] = cuda_vis
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
        log_event(f"Launched ComfyUI ({mode}) on CUDA:{cuda_vis} -> 127.0.0.1:{port}", category="COMFYUI")
    if mode == "copilot_split" and gpu_count >= 2:
        threading.Thread(target=_launch_copilot_llm_on_gpu1, daemon=True).start()
    _write_caddy_config(mode == "dual_split")
    if not HEADLESS_MODE and os.path.exists("/tmp/caddy"):
        try:
            subprocess.run(["/tmp/caddy", "reload", "--config", "/tmp/Caddyfile"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

def switch_comfy_topology(new_mode, reason="requested"):
    if new_mode == TOPOLOGY_MODE:
        return {"ok": True, "mode": TOPOLOGY_MODE, "unchanged": True}
    with TOPOLOGY_LOCK:
        if new_mode == TOPOLOGY_MODE:
            return {"ok": True, "mode": TOPOLOGY_MODE, "unchanged": True}
        TOPOLOGY_SWITCHING.set()
        try:
            t_sw = time.time()
            log_event(f"Switching Dual-T4 topology {TOPOLOGY_MODE} -> {new_mode} ({reason})...", category="COMFYUI", level="WARN")
            _stop_all_compute_procs()
            _ensure_nodes_for_mode(new_mode)
            _start_topology_procs(new_mode)
            return {"ok": True, "mode": TOPOLOGY_MODE, "elapsedSec": round(time.time() - t_sw, 1)}
        finally:
            TOPOLOGY_SWITCHING.clear()

_stop_all_compute_procs()
_start_topology_procs(TOPOLOGY_MODE)

if not aria2_started:
    aria2_started = True
    threading.Thread(target=setup_aria2, daemon=True).start()
post_heartbeat(4, "STARTING")

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
                    _low_e = entry.lower()
                    if (
                        _low_e in ("torch", "torchvision", "torchaudio", "torchgen", "functorch", "triton", "pip", "wheel", "setuptools", "__pycache__", "pkg_resources", "_distutils_hack")
                        or _low_e.startswith(("torch-", "torchvision-", "torchaudio-", "torchgen-", "functorch-", "nvidia", "triton-", "pip-", "wheel-", "setuptools-"))
                    ):
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
    global LAST_ACTIVE
    stats = {}
    if TOPOLOGY_MODE == "dual_split" and active_ports:
        port = active_ports[0]
        comfy_ok = False
        devs = []
        q_running = 0
        q_pending = 0
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                devs = data.get("devices", [])
                comfy_ok = bool(devs)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/queue", timeout=1.5) as qresp:
                    qdata = json.loads(qresp.read().decode("utf-8"))
                    q_running = len(qdata.get("queue_running") or [])
                    q_pending = len(qdata.get("queue_pending") or [])
                    if q_running > 0 or q_pending > 0:
                        LAST_ACTIVE = time.time()
            except Exception:
                pass
        except Exception:
            comfy_ok = False
        smi_devs = _query_comfy_nvidia_smi()
        for idx_t, t_name in enumerate(TARGETS):
            if not comfy_ok:
                stats[t_name] = {"ready": False}
                continue
            d = smi_devs[min(idx_t, len(smi_devs) - 1)] if smi_devs else (devs[min(idx_t, len(devs) - 1)] if devs else {})
            vt = round(d.get("vram_total", 16 * (1024**3)) / (1024**3), 2)
            vf = round(d.get("vram_free", 0) / (1024**3), 2)
            role_tag = "DiT gpu:0" if idx_t == 0 else "TE gpu:1"
            stats[t_name] = {
                "ready": True,
                "gpuName": f"{d.get('name', 'NVIDIA T4')} ({role_tag})",
                "vramTotalGb": vt,
                "vramUsedGb": round(max(0.0, vt - vf), 2),
                "queueRunning": q_running,
                "queuePending": q_pending,
                "topologyMode": TOPOLOGY_MODE,
            }
        return stats
    if TOPOLOGY_MODE == "copilot_split" and active_ports:
        smi_devs = _query_comfy_nvidia_smi()
        comfy_ok = False
        q_running = 0
        q_pending = 0
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{active_ports[0]}/system_stats", timeout=2) as resp:
                comfy_ok = bool(json.loads(resp.read().decode("utf-8")).get("devices"))
        except Exception:
            pass
        llm_ok = False
        try:
            with urllib.request.urlopen("http://127.0.0.1:8190/health", timeout=1.5) as hr:
                llm_ok = hr.status == 200
        except Exception:
            pass
        for idx_t, t_name in enumerate(TARGETS):
            d = smi_devs[min(idx_t, len(smi_devs) - 1)] if smi_devs else {}
            vt = round(d.get("vram_total", 16 * (1024**3)) / (1024**3), 2)
            vf = round(d.get("vram_free", 0) / (1024**3), 2)
            stats[t_name] = {
                "ready": bool(comfy_ok) if idx_t == 0 else bool(llm_ok),
                "gpuName": f"{d.get('name', 'NVIDIA T4')} ({'ComfyUI' if idx_t == 0 else 'Qwen3-VL-8B QA'})",
                "vramTotalGb": vt,
                "vramUsedGb": round(max(0.0, vt - vf), 2),
                "queueRunning": q_running if idx_t == 0 else 0,
                "queuePending": q_pending if idx_t == 0 else 0,
                "topologyMode": TOPOLOGY_MODE,
            }
        return stats
    for idx_t, (t_name, port) in enumerate(zip(TARGETS, active_ports)):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                devs = data.get("devices", [])
                if devs:
                    vram_total = round(devs[0].get("vram_total", 16 * (1024**3)) / (1024**3), 2)
                    vram_free = round(devs[0].get("vram_free", 0) / (1024**3), 2)
                    q_running = 0
                    q_pending = 0
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/queue", timeout=1.5) as qresp:
                            qdata = json.loads(qresp.read().decode("utf-8"))
                            q_running = len(qdata.get("queue_running") or [])
                            q_pending = len(qdata.get("queue_pending") or [])
                            if q_running > 0 or q_pending > 0:
                                LAST_ACTIVE = time.time()
                    except Exception:
                        pass
                    role_lbl = "Stage1 Base" if TOPOLOGY_MODE == "dual_pipeline" and idx_t == 0 else ("Stage2 Detail/Up" if TOPOLOGY_MODE == "dual_pipeline" and idx_t == 1 else "")
                    base_gpu = devs[0].get("name", "NVIDIA T4")
                    stats[t_name] = {
                        "ready": True,
                        "gpuName": f"{base_gpu} ({role_lbl})" if role_lbl else base_gpu,
                        "vramTotalGb": vram_total,
                        "vramUsedGb": round(max(0.0, vram_total - vram_free), 2),
                        "queueRunning": q_running,
                        "queuePending": q_pending,
                        "topologyMode": TOPOLOGY_MODE,
                    }
        except Exception:
            stats[t_name] = {"ready": False}
    return stats

def poll_model_downloads():
    tracked = set()
    while True:
        just_started = False
        try:
            with FETCH_LOCK:
                reports = [dict(FETCH_JOBS[job_id], id=job_id) for job_id in tracked]
            for report in reports:
                if report["status"] == "queued":
                    report["status"] = "downloading"
            reply = _worker_api_post("/api/vm/model-fetch", {"reports": reports, "driveReady": bool(GDRIVE_HEALTHY)}, timeout=30)
            tracked.difference_update(reply.get("acknowledged", []))
            command = reply.get("command")
            if command:
                tracked.add(start_model_fetch(command["request"], command["id"]))
                just_started = True
        except urllib.error.HTTPError as err:
            if err.code in (401, 410):
                return
        except (OSError, ValueError, KeyError) as err:
            log_event(f"Model download poll interrupted: {type(err).__name__}", category="NETWORK", level="WARN")
        time.sleep(0.5 if just_started else (1.5 if tracked else 5))

def _extract_graph_models(graph, req_models):
    items = []
    seen = set()
    for m in (req_models or []):
        cat = str(m.get("category") or "checkpoints")
        fn = str(m.get("filename") or "").strip()
        if fn and (cat, fn) not in seen:
            seen.add((cat, fn))
            items.append((cat, fn))
    field_map = {
        "ckpt_name": "checkpoints",
        "vae_name": "vae",
        "lora_name": "loras",
        "control_net_name": "controlnet",
        "ipadapter_file": "ipadapter",
        "clip_name": "clip_vision",
        "unet_name": "unet",
        "clip_name1": "text_encoders",
        "clip_name2": "text_encoders",
        "upscale_model": "upscale_models",
    }
    if isinstance(graph, dict):
        for node in graph.values():
            if not isinstance(node, dict):
                continue
            ct = str(node.get("class_type") or "")
            inp = node.get("inputs") or {}
            if not isinstance(inp, dict):
                continue
            if ct == "UNETLoader" and inp.get("unet_name"):
                pair = ("diffusion_models", str(inp["unet_name"]))
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            if ct == "CLIPLoader" and inp.get("clip_name"):
                pair = ("text_encoders", str(inp["clip_name"]))
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            if ct == "UltralyticsDetectorProvider" and inp.get("model_name"):
                fn = os.path.basename(str(inp["model_name"]))
                pair = ("ultralytics", fn)
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            if ct == "SAMLoader" and inp.get("model_name"):
                pair = ("sams", str(inp["model_name"]))
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            if ct == "LBMModelLoader" and inp.get("model_name"):
                pair = ("lbm", str(inp["model_name"]))
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            if ct == "UpscaleModelLoader" and inp.get("model_name"):
                pair = ("upscale_models", str(inp["model_name"]))
                if pair not in seen:
                    seen.add(pair); items.append(pair)
                continue
            for k, cat in field_map.items():
                v = inp.get(k)
                if isinstance(v, str) and v.strip():
                    pair = (cat, v.strip())
                    if pair not in seen:
                        seen.add(pair); items.append(pair)
    return items

def renew_task_lease(worker_target, task_id, done):
    while not done.wait(60):
        try:
            _worker_api_post("/api/v1/workers/heartbeat", {"workerId": worker_target, "taskId": task_id}, timeout=15)
        except Exception:
            pass

def _headless_worker_loop(slot_idx, worker_target):
    import base64
    log_event(f"Headless polling worker ready for {worker_target} (slot={slot_idx})", category="COMFYUI")

    while True:
        if TOPOLOGY_SWITCHING.is_set():
            time.sleep(1.5)
            continue
        if TOPOLOGY_MODE in ("dual_split", "copilot_split") and slot_idx > 0:
            time.sleep(2.5)
            continue
        port = 8188 if (slot_idx == 0 or TOPOLOGY_MODE in ("dual_split", "copilot_split", "single")) else 8189
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2) as r:
                if r.status != 200:
                    time.sleep(2)
                    continue
        except Exception:
            time.sleep(2)
            continue

        slot_prof = "IMAGE_DIT_DUAL_T4" if TOPOLOGY_MODE == "dual_split" else (GPU_PROFILES[slot_idx] if slot_idx < len(GPU_PROFILES) else PROFILE_ID)
        caps = _capabilities_for_profile(slot_prof)
        stage_pref = "stage1_preferred" if (TOPOLOGY_MODE == "dual_pipeline" and slot_idx == 0) else ("stage2_preferred" if (TOPOLOGY_MODE == "dual_pipeline" and slot_idx == 1) else "any")
        task = None
        next_prefetch = []
        try:
            res = _worker_api_post("/api/v1/workers/claim", {
                "workerId": worker_target,
                "capabilities": caps,
                "topologyMode": TOPOLOGY_MODE,
                "stagePreference": stage_pref,
                "hotCheckpoints": list(HOT_MODELS_BY_PORT.get(port, [])),
                "cachedFilenames": _get_cached_filenames_flat(),
                "driveReady": bool(GDRIVE_HEALTHY),
            }, timeout=45)
            task = res.get("task")
            next_prefetch = res.get("nextPrefetchModels") or []
        except urllib.error.HTTPError as claim_http_err:
            if claim_http_err.code in (401, 410):
                _terminate_worker_and_exit(f"Worker claim session ended ({claim_http_err.code})")
            time.sleep(5)
            continue
        except Exception:
            time.sleep(5)
            continue

        if next_prefetch and isinstance(next_prefetch, list):
            for _pm in next_prefetch[:3]:
                if isinstance(_pm, dict) and _pm.get("filename"):
                    try:
                        start_model_fetch(_pm)
                    except Exception:
                        pass

        if not task:
            time.sleep(3)
            continue

        task_id = task["id"]
        t_task_start = time.time()
        done = threading.Event()
        threading.Thread(target=renew_task_lease, args=(worker_target, task_id, done), daemon=True).start()
        globals()["LAST_ACTIVE"] = time.time()
        try:
            if task.get("modelPreparationError"):
                raise RuntimeError(task["modelPreparationError"])
            graph = task.get("compiledGraph")
            if not isinstance(graph, dict):
                raise RuntimeError("Claimed task missing compiledGraph JSON")

            catalog = {(m["category"], m["filename"]): m for m in (task.get("requiredModels") or [])
                       if isinstance(m, dict) and m.get("filename")}
            staged = set()
            for cat, name in _extract_graph_models(graph, task.get("requiredModels")):
                filename = os.path.basename(name)
                item = catalog.get((cat, filename))
                if not item:
                    # Some Comfy loaders alias unet and diffusion_models.
                    item = next((m for m in catalog.values() if m["filename"] == filename
                        and {cat, m["category"]} <= {"unet", "diffusion_models"}), None)
                if not item:
                    raise RuntimeError(f"Add {cat}/{name} to the task's catalog dependencies.")
                key = (item["category"], item.get("subdir", ""), filename)
                if key in staged:
                    continue
                staged.add(key)
                job_id = start_model_fetch(item)
                _last_dl_log = 0.0
                while True:
                    with FETCH_LOCK:
                        job = dict(FETCH_JOBS[job_id])
                    if job["status"] == "completed":
                        break
                    if job["status"] == "failed":
                        raise RuntimeError(job.get("error") or f"Model download failed: {name}")
                    if job.get("status") == "downloading" and (time.time() - _last_dl_log) >= 5.0:
                        _last_dl_log = time.time()
                        log_event(f"[{worker_target}] Downloading {filename}: {job.get('percentage', 0)}% ({job.get('speedMbps', 0)} MB/s)", category="RCLONE")
                    time.sleep(1)

            # Stage parent task dependency outputs (e.g. Dual-T4 Pipeline Stage 1 -> Stage 2) and inline base64 LoadImage inputs into COMFY_DIR/input
            in_dir = os.path.join(COMFY_DIR, "input")
            os.makedirs(in_dir, exist_ok=True)
            for dep_out in (task.get("dependsOnOutputs") or []):
                if not isinstance(dep_out, dict):
                    continue
                dep_fn = dep_out.get("filename")
                if not dep_fn:
                    continue
                dst_in = os.path.join(in_dir, dep_fn)
                if not os.path.exists(dst_in):
                    local_out = os.path.join("/tmp/outputs", dep_fn)
                    if os.path.exists(local_out):
                        shutil.copy2(local_out, dst_in)
                    elif dep_out.get("gdrivePath") and GDRIVE_HEALTHY:
                        try:
                            rc_copy_async({
                                "srcFs": "gdrive:",
                                "srcRemote": dep_out["gdrivePath"],
                                "dstFs": in_dir,
                                "dstRemote": dep_fn,
                            }, max_wait=120, label=f"Stage input {dep_fn}")
                        except Exception:
                            pass
            for nid, node in graph.items():
                if isinstance(node, dict) and node.get("class_type") == "LoadImage":
                    img_val = str((node.get("inputs") or {}).get("image") or "")
                    if img_val.startswith("data:image/") and ";base64," in img_val:
                        header, b64_data = img_val.split(";base64,", 1)
                        ext = "jpg" if "jpeg" in header else "png"
                        fname = f"sc_{task_id}_{nid}.{ext}"
                        with open(os.path.join(in_dir, fname), "wb") as f_out:
                            f_out.write(base64.b64decode(b64_data))
                        node["inputs"]["image"] = fname

            q_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/prompt",
                data=json.dumps({"prompt": graph, "client_id": task_id}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(q_req, timeout=20) as qr:
                    q_res = json.loads(qr.read().decode("utf-8"))
            except urllib.error.HTTPError as prompt_http_err:
                err_body = ""
                try:
                    err_body = prompt_http_err.read().decode("utf-8", "ignore")
                except Exception:
                    pass
                raise RuntimeError(f"ComfyUI /prompt HTTP {prompt_http_err.code}: {err_body[:600] or prompt_http_err}")
            prompt_id = q_res["prompt_id"]
            HOT_MODELS_BY_PORT[port] = [os.path.basename(k[2]) for k in staged if k[0] in ("checkpoints", "diffusion_models", "unet")][:3]

            outputs_uploaded = []
            t_wait = time.time()
            while (time.time() - t_wait) < 900:
                globals()["LAST_ACTIVE"] = time.time()
                time.sleep(1.5)
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/history/{prompt_id}", timeout=10) as hr:
                    h_data = json.loads(hr.read().decode("utf-8") or "{}")
                item = h_data.get(prompt_id)
                if item and (item.get("outputs") or item.get("status", {}).get("status_str") == "error"):
                    if item.get("status", {}).get("status_str") == "error":
                        raise RuntimeError(f"ComfyUI execution error: {item.get('status')}")
                    date_dir = time.strftime("%Y-%m-%d")
                    remote_out = f"{GDRIVE_BASE}/outputs/{date_dir}"
                    if GDRIVE_HEALTHY:
                        try:
                            rc_post("operations/mkdir", {"fs": "gdrive:", "remote": remote_out})
                        except Exception:
                            pass
                    for node_out in (item.get("outputs") or {}).values():
                        for img_info in (node_out.get("images") or []):
                            fn = img_info.get("filename")
                            sub = (img_info.get("subfolder") or "").strip("/")
                            if not fn:
                                continue
                            src_dir = f"/tmp/outputs/{sub}" if sub else "/tmp/outputs"
                            file_id = ""
                            local_bk = None
                            b64_preview = ""
                            if GDRIVE_HEALTHY:
                                try:
                                    rc_copy_async({
                                        "srcFs": src_dir, "srcRemote": fn,
                                        "dstFs": f"gdrive:{remote_out}", "dstRemote": fn,
                                    }, max_wait=240, label=f"Upload {fn}")
                                    stat = rc_post("operations/stat", {"fs": f"gdrive:{remote_out}", "remote": fn}, timeout=15)
                                    file_id = (stat.get("item") or {}).get("ID", "")
                                except Exception as up_err:
                                    log_event(f"[{worker_target}] Drive upload failed ({str(up_err)[:120]}); backing up to Local Vault.", category="RCLONE", level="WARN")
                            if not file_id:
                                src_file = os.path.join(src_dir, fn)
                                if os.path.exists(src_file):
                                    local_bk = _upload_local_output_backup(task_id, worker_target, fn, src_file)
                                    if not local_bk:
                                        try:
                                            from PIL import Image as _PILImage
                                            import io as _io
                                            _im = _PILImage.open(src_file).convert("RGB")
                                            _im.thumbnail((896, 896))
                                            _buf = _io.BytesIO()
                                            _im.save(_buf, format="JPEG", quality=84)
                                            b64_preview = "data:image/jpeg;base64," + base64.b64encode(_buf.getvalue()).decode("ascii")
                                        except Exception:
                                            with open(src_file, "rb") as _rf:
                                                _raw_b = _rf.read()
                                            if len(_raw_b) <= 190000:
                                                b64_preview = "data:image/png;base64," + base64.b64encode(_raw_b).decode("ascii")
                            outputs_uploaded.append({
                                "filename": fn,
                                "gdriveFileId": file_id,
                                "gdrivePath": (f"{remote_out}/{fn}" if file_id else (local_bk.get("localPath", "") if local_bk else "")),
                                "storageUri": (f"gdrive://{remote_out}/{fn}" if file_id else (local_bk.get("storageUri", "") if local_bk else "")),
                                "previewUrl": (f"/api/outputs/{file_id}" if file_id else (local_bk.get("previewUrl", "") if local_bk else b64_preview)),
                            })
                    log_event(f"[{worker_target}] Workflow executed ({TOPOLOGY_MODE}) with staged models: {', '.join(k[2] for k in sorted(staged))}", category="COMFYUI", level="SUCCESS")
                    break
            else:
                raise RuntimeError("Timed out waiting for ComfyUI workflow completion.")

            _worker_api_post("/api/v1/workers/complete", {
                "taskId": task_id,
                "workerId": worker_target,
                "outputFiles": outputs_uploaded,
                "metrics": {"durationMs": int((time.time() - t_task_start) * 1000)},
            }, timeout=20)
            log_event(f"[{worker_target}] Completed headless task {task_id} ({len(outputs_uploaded)} file(s))", category="COMFYUI", level="SUCCESS")
        except Exception as w_err:
            log_event(f"[{worker_target}] Task {task_id} failed: {w_err}", category="ERROR", level="ERROR")
            try:
                _worker_api_post("/api/v1/workers/fail", {
                    "taskId": task_id,
                    "workerId": worker_target,
                    "errorMessage": str(w_err),
                }, timeout=15)
            except Exception:
                pass
        finally:
            done.set()

if HEADLESS_MODE:
    threading.Thread(target=poll_model_downloads, daemon=True).start()
    _worker_count = len(TARGETS) if PROVIDER == "kaggle" else 1
    for _w_idx, _w_target in enumerate(TARGETS[:_worker_count]):
        threading.Thread(target=_headless_worker_loop, args=(_w_idx, _w_target), daemon=True).start()

t_loop_start = time.time()
last_step_sent = -1
last_ready_count = -1
upload_started = False

while True:
    telem = probe_comfy_stats()
    ready_count = sum(1 for v in telem.values() if isinstance(v, dict) and v.get("ready"))
    any_ready = ready_count > 0
    caddy_ok = True if HEADLESS_MODE else is_caddy_ready()
    is_switching = TOPOLOGY_SWITCHING.is_set()
    all_ready = (not is_switching) and (True if HEADLESS_MODE else (bool(TUNNEL_URL) and caddy_ok)) and len(telem) > 0 and all(isinstance(v, dict) and v.get("ready") for v in telem.values())
    next_step = 5 if all_ready else (4 if (not is_switching and (HEADLESS_MODE or (TUNNEL_URL and caddy_ok))) else 3)
    next_status = "ONLINE" if all_ready else "STARTING"

    if not all_ready and not is_switching:
        _tail_comfy_logs(6)
        dead_ports = [p for p, pr in list(COMFY_PROCS.items()) if pr.poll() is not None]
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

    if RCLONE_READY:
        refresh_gdrive_oauth_in_vm(force=False)

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
