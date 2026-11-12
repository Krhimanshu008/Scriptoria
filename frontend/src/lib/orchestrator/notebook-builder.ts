export interface PrewarmModelItem {
  category: string;
  filename: string;
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
  idleTimeoutSeconds?: number;
  enableOfflineDatasetScan?: boolean;
  prewarmModels?: PrewarmModelItem[];
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

  return `import os, sys, re, time, json, shutil, zipfile, tarfile, sysconfig, subprocess, threading, urllib.request, urllib.parse, urllib.error
from collections import deque
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP_URL = ${JSON.stringify(cfg.appWebhookUrl.replace(/\/$/, ""))}
REG_JWT = ${JSON.stringify(cfg.registrationJwt)}
VM_SECRET = ${JSON.stringify(cfg.vmSecret)}
PROVIDER = ${JSON.stringify(cfg.provider)}
ACCOUNT_ALIAS = ${JSON.stringify(cfg.accountAlias)}
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
TUNNEL_URL = None
CURRENT_STEP = 1
EVER_CONNECTED = False
COMFY_DIR = "/tmp/ComfyUI"
FASTBOOT_SITE = "/tmp/sc_site_packages"
PY_VER_TAG = f"{sys.version_info.major}{sys.version_info.minor}"
FASTBOOT_REMOTE = f"{GDRIVE_BASE}/cache/fastboot_{PROVIDER}_py{PY_VER_TAG}_v1.tar.gz"

def log_event(msg, category="SYSTEM", level="INFO"):
    line = f"[{category}] {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        entry = {"category": category, "level": level, "message": msg}
        BOOT_LOGS.append(entry)
        PENDING_LOGS.append(entry)

def post_heartbeat(step, status="STARTING", telemetry=None):
    global CURRENT_STEP, EVER_CONNECTED
    CURRENT_STEP = step
    with LOG_LOCK:
        logs_batch = PENDING_LOGS[:]
        PENDING_LOGS.clear()
    payload = {
        "token": REG_JWT,
        "tunnelUrl": TUNNEL_URL or "",
        "targets": TARGETS,
        "stepProgress": step,
        "status": status,
        "telemetry": telemetry or {},
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
        print(f"[HEARTBEAT] HTTP {he.code}: {he.reason}", flush=True)
    except Exception as e:
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
    "clip_vision", "controlnet", "ipadapter", "text_encoders", "upscale_models", "diffusion_models"
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
            for cat in os.listdir("/tmp/models"):
                cat_dir = os.path.join("/tmp/models", cat)
                if not os.path.isdir(cat_dir):
                    continue
                for fname in os.listdir(cat_dir):
                    fpath = os.path.join(cat_dir, fname)
                    if os.path.isfile(fpath) or os.path.islink(fpath):
                        try:
                            st = os.stat(fpath)
                            files.append({
                                "category": cat,
                                "name": fname,
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
            name = os.path.basename((qs.get("name") or [""])[0])
            base_real = os.path.realpath("/tmp/models")
            target_real = os.path.realpath(os.path.join("/tmp/models", cat, name))
            if not cat or not name or not target_real.startswith(base_real + os.sep) or not os.path.exists(target_real):
                self.send_response(404); self.end_headers(); return
            os.remove(target_real)
            log_event(f"Deleted cached model /tmp/models/{cat}/{name}", category="SYSTEM")
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
        @badport not header_regexp X-Target-Port ^(8188|8189|5572|9999)$
        handle @badport {{
            respond "Invalid Target Port" 400
        }}
        handle {{
            reverse_proxy 127.0.0.1:{{http.request.header.X-Target-Port}} {{
                header_up Host 127.0.0.1
            }}
        }}
    }}
    @want8189 header_regexp Cookie (^|;\\\\s*)sc_vm_port=8189(;|$)
    handle @want8189 {{
        reverse_proxy 127.0.0.1:8189 {{
            header_up Host 127.0.0.1
        }}
    }}
    handle {{
        reverse_proxy 127.0.0.1:8188 {{
            header_up Host 127.0.0.1
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

    for _ in range(30):
        try:
            rc_post("rc/noop", {}, timeout=2)
            log_event("Rclone RC (:5572) ready (HTTP/1.1 multi-thread)", category="RCLONE", level="SUCCESS")
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
    return False

def setup_caddy():
    if not os.path.exists("/tmp/caddy"):
        subprocess.run(["curl", "-sSLf", "https://caddyserver.com/api/download?os=linux&arch=amd64", "-o", "/tmp/caddy"], check=True)
        os.chmod("/tmp/caddy", 0o755)
    caddy_log = open("/tmp/caddy.log", "w")
    subprocess.Popen(["/tmp/caddy", "run", "--config", "/tmp/Caddyfile"], stdout=caddy_log, stderr=caddy_log)

def setup_cloudflared():
    global TUNNEL_URL
    if not os.path.exists("/tmp/cloudflared"):
        subprocess.run(["curl", "-sSLf", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", "-o", "/tmp/cloudflared"], check=True)
        os.chmod("/tmp/cloudflared", 0o755)
    with open("/tmp/cf.log", "w") as out:
        subprocess.Popen(["/tmp/cloudflared", "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"], stdout=out, stderr=subprocess.STDOUT)
    for _ in range(45):
        time.sleep(1)
        if os.path.exists("/tmp/cf.log"):
            content = open("/tmp/cf.log", "r", errors="ignore").read()
            m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", content)
            if m:
                TUNNEL_URL = m.group(0)
                log_event(f"Route-less Quick Tunnel live in {round(time.time() - t_boot_start, 1)}s: {TUNNEL_URL}", category="NETWORK", level="SUCCESS")
                post_heartbeat(4, "STARTING")
                return TUNNEL_URL
    return None

def setup_uv():
    if not os.path.exists("/tmp/uv"):
        try:
            subprocess.run(["curl", "-sSLf", "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz", "-o", "/tmp/uv.tar.gz"], check=True)
            subprocess.run(["tar", "-xzf", "/tmp/uv.tar.gz", "-C", "/tmp", "--strip-components=1"], check=True)
            os.chmod("/tmp/uv", 0o755)
            os.remove("/tmp/uv.tar.gz")
        except Exception:
            pass

threading.Thread(target=setup_caddy, daemon=True).start()
threading.Thread(target=setup_cloudflared, daemon=True).start()
uv_thread = threading.Thread(target=setup_uv, daemon=True)
uv_thread.start()
rclone_ok = setup_rclone()

# -------------------------------------------------------------
# 4. FastBoot GDrive Cache Hit OR Parallel ComfyUI Clone + uv Delta
# -------------------------------------------------------------
should_upload_cache = False
if not os.path.exists(os.path.join(COMFY_DIR, "main.py")):
    cache_restored = False
    if rclone_ok:
        try:
            st = rc_post("operations/stat", {"fs": f"gdrive:{FASTBOOT_REMOTE.rsplit('/', 1)[0]}", "remote": FASTBOOT_REMOTE.rsplit("/", 1)[1]}, timeout=8)
            if (st.get("item") or {}).get("Size", 0) > 100000:
                log_event(f"FastBoot cache HIT! Streaming {FASTBOOT_REMOTE.rsplit('/', 1)[1]} from Google Drive...", category="COMFYUI", level="SUCCESS")
                rc_post("operations/copyfile", {
                    "srcFs": f"gdrive:{FASTBOOT_REMOTE.rsplit('/', 1)[0]}",
                    "srcRemote": FASTBOOT_REMOTE.rsplit("/", 1)[1],
                    "dstFs": "/tmp",
                    "dstRemote": "fastboot.tar.gz",
                    "_config": {
                        "MultiThreadCutoff": "32M", "MultiThreadChunkSize": "64M",
                        "MultiThreadStreams": 8, "DisableHTTP2": True,
                    },
                }, timeout=120)
                subprocess.run(["tar", "-xzf", "/tmp/fastboot.tar.gz", "-C", "/tmp"], check=True)
                os.remove("/tmp/fastboot.tar.gz")
                if os.path.exists(os.path.join(COMFY_DIR, "main.py")):
                    cache_restored = True
                    log_event(f"Extracted FastBoot ComfyUI cache in {round(time.time() - t_boot_start, 1)}s!", category="COMFYUI", level="SUCCESS")
        except Exception as ce:
            log_event(f"FastBoot cache miss ({ce}); running fresh uv install...", category="COMFYUI")

    if not cache_restored:
        log_event("Cloning ComfyUI (shallow) & installing delta packages via uv (no custom nodes)...", category="COMFYUI")
        subprocess.run(["git", "clone", "--depth", "1", "--single-branch", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR], check=True)
        req_file = os.path.join(COMFY_DIR, "requirements.txt")
        filtered_reqs = "/tmp/comfy_reqs_delta.txt"
        skip_pkgs = {"torch", "torchvision", "torchaudio"}
        with open(req_file, "r", encoding="utf-8") as rf, open(filtered_reqs, "w", encoding="utf-8") as wf:
            for line in rf:
                clean = line.strip()
                if not clean or clean.startswith("#"):
                    continue
                pkg = re.split(r"[=<>!~;\\s\\[]", clean)[0].lower().replace("_", "-")
                if pkg not in skip_pkgs:
                    wf.write(clean + "\\n")

        site_dirs = list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
        before_snap = {sd: (set(os.listdir(sd)) if os.path.isdir(sd) else set()) for sd in site_dirs}
        uv_thread.join(timeout=15)
        if os.path.exists("/tmp/uv"):
            log_event("Installing ComfyUI delta packages using /tmp/uv...", category="COMFYUI")
            uv_res = subprocess.run(["/tmp/uv", "pip", "install", "--system", "--no-cache", "--quiet", "-r", filtered_reqs])
            if uv_res.returncode != 0:
                log_event(f"/tmp/uv exited with {uv_res.returncode}; falling back to pip...", category="COMFYUI", level="WARN")
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", filtered_reqs], check=True)
        else:
            log_event("/tmp/uv unavailable; using pip installer...", category="COMFYUI", level="WARN")
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", filtered_reqs], check=True)

        # Save newly added site-packages delta for future FastBoot Drive snapshot
        for sd in site_dirs:
            if os.path.isdir(sd):
                for entry in (set(os.listdir(sd)) - before_snap.get(sd, set())):
                    src_p = os.path.join(sd, entry)
                    dst_p = os.path.join(FASTBOOT_SITE, entry)
                    try:
                        if os.path.isdir(src_p):
                            shutil.copytree(src_p, dst_p, dirs_exist_ok=True)
                        else:
                            shutil.copy2(src_p, dst_p)
                    except Exception:
                        pass
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
for idx, port in enumerate(active_ports):
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = str(idx)
    if os.path.isdir(FASTBOOT_SITE):
        prev_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{FASTBOOT_SITE}:{prev_pp}" if prev_pp else FASTBOOT_SITE
    c_log = open(f"/tmp/comfy_{port}.log", "w")
    subprocess.Popen([
        sys.executable, os.path.join(COMFY_DIR, "main.py"),
        "--listen", "127.0.0.1",
        "--port", str(port),
        "--extra-model-paths-config", "/tmp/extra_model_paths.yaml",
        "--output-directory", "/tmp/outputs",
        "--enable-cors-header",
        "--preview-method", "auto"
    ], cwd=COMFY_DIR, env=env, stdout=c_log, stderr=c_log)
    log_event(f"Launched ComfyUI on CUDA:{idx} -> 127.0.0.1:{port}", category="COMFYUI")

if should_upload_cache and rclone_ok:
    def _upload_fastboot_snapshot():
        try:
            log_event("Packing FastBoot cache snapshot to Google Drive in background...", category="RCLONE")
            cache_dir_remote, cache_file_remote = FASTBOOT_REMOTE.rsplit("/", 1)
            try:
                rc_post("operations/mkdir", {"fs": "gdrive:", "remote": cache_dir_remote})
            except Exception:
                pass
            tar_res = subprocess.run([
                "tar", "--warning=no-file-changed", "--ignore-failed-read",
                "--exclude=*.git*", "--exclude=*__pycache__*", "-czf",
                "/tmp/fastboot_pkg.tar.gz", "-C", "/tmp", "ComfyUI", "sc_site_packages"
            ], check=False)
            if tar_res.returncode not in (0, 1):
                raise RuntimeError(f"tar exited with status {tar_res.returncode}")
            rc_post("operations/copyfile", {
                "srcFs": "/tmp", "srcRemote": "fastboot_pkg.tar.gz",
                "dstFs": f"gdrive:{cache_dir_remote}", "dstRemote": cache_file_remote,
            }, timeout=120)
            os.remove("/tmp/fastboot_pkg.tar.gz")
            log_event(f"Saved FastBoot cache ({cache_file_remote}) to Drive for rapid next boot!", category="RCLONE", level="SUCCESS")
        except Exception as ue:
            log_event(f"FastBoot cache upload skipped: {ue}", category="RCLONE", level="WARN")
    threading.Thread(target=_upload_fastboot_snapshot, daemon=True).start()

# -------------------------------------------------------------
# 6. Wait for Tunnel + ComfyUI Readiness & Run Heartbeat Loop
# -------------------------------------------------------------
def probe_comfy_stats():
    stats = {}
    for t_name, port in zip(TARGETS, active_ports):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=3) as resp:
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

while True:
    telem = probe_comfy_stats()
    all_ready = bool(TUNNEL_URL) and any(v.get("ready") for v in telem.values())
    if all_ready and CURRENT_STEP < 5:
        log_event(f"ComfyUI ONLINE in {round(time.time() - t_boot_start, 1)}s!", category="COMFYUI", level="SUCCESS")
    post_heartbeat(5 if all_ready else 4, "ONLINE" if all_ready else "STARTING", telem)

    if not EVER_CONNECTED and (time.time() - t_boot_start) > 120:
        log_event(f"Zero heartbeats reached {APP_URL} after 120s. Stopping cleanly to save GPU quota.", category="ERROR", level="ERROR")
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
    time.sleep(20)
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

