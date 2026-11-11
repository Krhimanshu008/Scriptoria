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
}

/**
 * Generates an executable Python bootstrapper for either Kaggle Dual-T4 or Colab Single-T4.
 * Runs:
 *  - Rclone RC daemon (:5572) streaming from Google Drive into /tmp/models
 *  - ComfyUI instance(s) bound via CUDA_VISIBLE_DEVICES (:8188 and :8189)
 *  - In-band Sidecar (:9999) for /vm-kill, /sync-output -> GDrive, /health
 *  - Caddy reverse proxy (:8000) enforcing X-VM-Secret & X-Target-Port
 *  - 1 Route-less Cloudflare Quick Tunnel -> Heartbeat loop back to Next.js
 */
export function buildUnifiedNotebookPythonCode(cfg: NotebookBuildConfig): string {
  const isKaggle = cfg.provider === "kaggle";
  const workDir = isKaggle ? "/kaggle/working" : "/content";
  const idleSeconds = cfg.idleTimeoutSeconds ?? 900;
  const ports = isKaggle && cfg.gpuTargets.length > 1 ? [8188, 8189] : [8188];

  return `import os, sys, re, time, json, zipfile, tarfile, subprocess, threading, urllib.request, urllib.parse, urllib.error
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

LAST_ACTIVE = time.time()
BOOT_LOGS = deque(maxlen=150)
LOG_LOCK = threading.Lock()
PENDING_LOGS = []
TUNNEL_URL = None
CURRENT_STEP = 1

def log_event(msg, category="SYSTEM", level="INFO"):
    line = f"[{category}] {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        entry = {"category": category, "level": level, "message": msg}
        BOOT_LOGS.append(entry)
        PENDING_LOGS.append(entry)

def post_heartbeat(step, status="STARTING", telemetry=None):
    global CURRENT_STEP
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
            headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-VM/2.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
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
log_event(f"Booting Scriptoria {PROVIDER.upper()} worker ({ACCOUNT_ALIAS}, targets={TARGETS})...", category=PROVIDER.upper())
post_heartbeat(2, "STARTING")

# -------------------------------------------------------------
# 1. Create /tmp directories for Model Streaming & Outputs
# -------------------------------------------------------------
CATEGORIES = [
    "checkpoints", "loras", "vae", "unet", "clip",
    "clip_vision", "controlnet", "ipadapter", "text_encoders", "upscale_models", "diffusion_models"
]
for d in CATEGORIES:
    os.makedirs(f"/tmp/models/{d}", exist_ok=True)
os.makedirs("/tmp/outputs", exist_ok=True)

# -------------------------------------------------------------
# 2. Configure Rclone & Refresh OAuth Access Token if Needed
# -------------------------------------------------------------
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
                log_event("Minted fresh Google Drive OAuth access token.", category="RCLONE", level="SUCCESS")
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

if not os.path.exists("/usr/local/bin/rclone"):
    log_event("Installing Rclone binary...", category="RCLONE")
    subprocess.run(["curl", "-sSLf", "https://downloads.rclone.org/rclone-current-linux-amd64.zip", "-o", "/tmp/rclone.zip"], check=True)
    with zipfile.ZipFile("/tmp/rclone.zip", "r") as zf:
        for member in zf.namelist():
            if member.endswith("/rclone"):
                with zf.open(member) as src, open("/usr/local/bin/rclone", "wb") as dst:
                    dst.write(src.read())
                break
    os.chmod("/usr/local/bin/rclone", 0o755)

rclone_log = open("/tmp/rclone.log", "w")
subprocess.Popen([
    "/usr/local/bin/rclone", "rcd",
    "--config", "/tmp/rclone.conf",
    "--rc-addr", "127.0.0.1:5572",
    "--rc-no-auth",
    "--drive-chunk-size", "128M",
    "--buffer-size", "64M",
    "--multi-thread-cutoff", "64M",
    "--multi-thread-streams", "8",
    "--transfers", "8",
    "--checkers", "16",
    "--drive-pacer-min-sleep", "10ms",
    "--drive-pacer-burst", "200"
], stdout=rclone_log, stderr=rclone_log)
log_event("Rclone RC daemon listening on 127.0.0.1:5572", category="RCLONE", level="SUCCESS")

# -------------------------------------------------------------
# 3. Install ComfyUI, Custom Nodes & Extra Model Paths
# -------------------------------------------------------------
comfy_dir = os.path.join(WORK_DIR, "ComfyUI")
if not os.path.exists(comfy_dir):
    log_event("Cloning ComfyUI & installing dependencies...", category="COMFYUI")
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", comfy_dir], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", os.path.join(comfy_dir, "requirements.txt")], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "httpx", "timm", "einops", "transformers", "aiohttp"], check=False)

nodes_dir = os.path.join(comfy_dir, "custom_nodes")
os.makedirs(nodes_dir, exist_ok=True)
CUSTOM_NODES = {
    "ComfyUI_IPAdapter_plus": "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git",
    "ComfyUI-Florence2": "https://github.com/kijai/ComfyUI-Florence2.git",
}
for n_name, n_url in CUSTOM_NODES.items():
    n_dst = os.path.join(nodes_dir, n_name)
    if not os.path.exists(n_dst):
        subprocess.run(["git", "clone", "--depth", "1", n_url, n_dst], check=False)
        n_req = os.path.join(n_dst, "requirements.txt")
        if os.path.exists(n_req):
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", n_req], check=False)

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

post_heartbeat(3, "STARTING")

# -------------------------------------------------------------
# 4. Boot ComfyUI Subprocess(es) with Strict CUDA Isolation
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
    c_log = open(f"/tmp/comfy_{port}.log", "w")
    subprocess.Popen([
        sys.executable, os.path.join(comfy_dir, "main.py"),
        "--listen", "127.0.0.1",
        "--port", str(port),
        "--extra-model-paths-config", "/tmp/extra_model_paths.yaml",
        "--output-directory", "/tmp/outputs",
        "--enable-cors-header",
        "--preview-method", "auto"
    ], cwd=comfy_dir, env=env, stdout=c_log, stderr=c_log)
    log_event(f"Launched ComfyUI on CUDA:{idx} -> 127.0.0.1:{port}", category="COMFYUI")

# -------------------------------------------------------------
# 5. In-Band Control Sidecar (Port 9999)
# -------------------------------------------------------------
def rc_post(action, payload):
    req = urllib.request.Request(
        f"http://127.0.0.1:5572/{action}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))

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
        else:
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
log_event("Sidecar HTTP control server listening on 127.0.0.1:9999", category="SYSTEM")

# -------------------------------------------------------------
# 6. Start Caddy Port Multiplexer on Port 8000
# -------------------------------------------------------------
if not os.path.exists("/tmp/caddy"):
    log_event("Downloading Caddy reverse proxy...", category="NETWORK")
    subprocess.run(["curl", "-sSLf", "https://caddyserver.com/api/download?os=linux&arch=amd64", "-o", "/tmp/caddy"], check=True)
    os.chmod("/tmp/caddy", 0o755)

with open("/tmp/Caddyfile", "w", encoding="utf-8") as f:
    f.write(f""":8000 {{
    @unauth not header X-VM-Secret "{VM_SECRET}"
    handle @unauth {{
        respond "Unauthorized" 403
    }}
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
""")

caddy_log = open("/tmp/caddy.log", "w")
subprocess.Popen(["/tmp/caddy", "run", "--config", "/tmp/Caddyfile"], stdout=caddy_log, stderr=caddy_log)

# -------------------------------------------------------------
# 7. Start 1 Route-less Cloudflare Tunnel on Port 8000
# -------------------------------------------------------------
if not os.path.exists("/tmp/cloudflared"):
    log_event("Downloading cloudflared binary...", category="NETWORK")
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
            break

if TUNNEL_URL:
    log_event(f"Route-less Quick Tunnel live: {TUNNEL_URL}", category="NETWORK", level="SUCCESS")
    post_heartbeat(4, "STARTING")
else:
    log_event("Failed to extract trycloudflare.com tunnel URL", category="ERROR", level="ERROR")

# -------------------------------------------------------------
# 8. Wait for ComfyUI Readiness & Run Heartbeat + Idle Watchdog
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
        log_event("ComfyUI ready & registered via Caddy multiplexer!", category="COMFYUI", level="SUCCESS")
    post_heartbeat(5 if all_ready else 4, "ONLINE" if all_ready else "STARTING", telem)

    if IDLE_TIMEOUT_SEC > 0 and (time.time() - LAST_ACTIVE > IDLE_TIMEOUT_SEC):
        log_event("Idle watchdog timeout reached. Shutting down to save quota.", category="ACTION", level="WARN")
        post_heartbeat(0, "OFFLINE", {})
        if PROVIDER == "colab":
            try:
                from google.colab import runtime
                runtime.unassign()
            except Exception:
                pass
        os._exit(0)
    time.sleep(20)
`;
}

/**
 * Wraps the unified Colab Python bootstrap inside a ready-to-run .ipynb notebook.
 */
export function buildColabNotebookJson(cfg: NotebookBuildConfig) {
  const pyCode = buildUnifiedNotebookPythonCode({ ...cfg, provider: "colab" });
  return {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          `# Scriptoria Colab GPU Worker (${cfg.gpuTargets[0] || "gcgpu"})\n`,
          "Click **Runtime ➔ Run all** to boot ComfyUI, Rclone GDrive streaming, and Caddy ingress.\n",
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

