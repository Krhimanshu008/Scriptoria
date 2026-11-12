/**
 * Scriptoria TPU v5e-8 Unified Notebook Builder
 *
 * Generates an end-to-end Python script that runs inside a Kaggle TPU v5e-8 container.
 * Serves unquantized Qwen3.8-27B BF16 with Vision and MTP speculative decoding (~130 tok/s)
 * via vllm-tpu on 8 TPU chips (128 GB HBM), exposed through Cloudflare tunnel.
 */

export interface BuildTpuNotebookOptions {
  appWebhookUrl: string;
  registrationJwt: string;
  vmSecret: string;
  accountAlias: string;
  gpuTargets: string[];
  idleTimeoutSeconds?: number;
}

export function buildTpuNotebookPythonCode(opts: BuildTpuNotebookOptions): string {
  const idleSeconds = Math.max(300, opts.idleTimeoutSeconds ?? 900); // default 15m
  const targets = opts.gpuTargets.length > 0 ? opts.gpuTargets : ["gpu0", "gpu1"];

  return `import os, sys, re, time, json, secrets, shutil, subprocess, threading, urllib.request, urllib.error
from collections import deque
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

APP_URL = ${JSON.stringify(opts.appWebhookUrl.replace(/\/$/, ""))}
REG_JWT = ${JSON.stringify(opts.registrationJwt)}
VM_SECRET = ${JSON.stringify(opts.vmSecret)}
ACCOUNT_ALIAS = ${JSON.stringify(opts.accountAlias)}
TARGETS = ${JSON.stringify(targets)}
IDLE_TIMEOUT_SEC = ${idleSeconds}

LAST_ACTIVE = time.time()
BOOT_LOGS = deque(maxlen=200)
LOG_LOCK = threading.Lock()
PENDING_LOGS = []
TUNNEL_URL = None
CURRENT_STEP = 1
T_BOOT_START = time.time()
STEP_START = time.time()
STEP_DURATIONS = {}
PORT = 8000
VLLM_INTERNAL_PORT = 8002
VENV = "/tmp/venv"
PY = f"{VENV}/bin/python"
XLA_CACHE = "/tmp/xla_cache"
CLOUDFLARED = Path("/tmp/cloudflared")
WEIGHTS_DATASET = "rahim3/qwen3-8-27b-bf16"
ENV_DATASET = "rahim3/qwen38-tpu-env-v5e8"

# Gzip + base64 of MTP rollback patch (prevents speculative decode output corruption on GDN layers)
MTP_PATCH_B64 = "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"

def log_event(msg, category="SYSTEM", level="INFO"):
    line = f"[{category}] {msg}"
    print(line, flush=True)
    with LOG_LOCK:
        entry = {"category": category, "level": level, "message": msg}
        BOOT_LOGS.append(entry)
        PENDING_LOGS.append(entry)

def post_heartbeat(step, status="STARTING", telemetry=None):
    global CURRENT_STEP, STEP_START, STEP_DURATIONS
    now = time.time()
    if step > CURRENT_STEP:
        prev_step = CURRENT_STEP
        STEP_DURATIONS[str(prev_step)] = round(now - STEP_START, 1)
        CURRENT_STEP = step
        STEP_START = now
    elif step == 5 and CURRENT_STEP == 5 and "5" not in STEP_DURATIONS:
        STEP_DURATIONS["5"] = round(now - STEP_START, 1)

    with LOG_LOCK:
        logs_batch = PENDING_LOGS[:]
        PENDING_LOGS.clear()

    telem = dict(telemetry or {})
    telem["stepDurations"] = dict(STEP_DURATIONS)
    telem["currentStepElapsed"] = round(now - STEP_START, 1)
    telem["totalBootElapsed"] = round(now - T_BOOT_START, 1)
    telem["accelerator"] = "TPU_V5E_8"

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
            headers={"Content-Type": "application/json", "User-Agent": "Scriptoria-TPU/3.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.HTTPError as he:
        if he.code == 410:
            print("[HEARTBEAT] Session cancelled (410). Shutting down TPU container cleanly.", flush=True)
            os._exit(0)
        print(f"[HEARTBEAT] HTTP {he.code}: {he.reason}", flush=True)
    except Exception as e:
        print(f"[HEARTBEAT] Warning: {e}", flush=True)

def find_input(*patterns):
    import glob
    for pat in patterns:
        hits = glob.glob(f"/kaggle/input/{pat}") + glob.glob(f"/kaggle/input/datasets/*/{pat}")
        if hits:
            return hits[0]
    return None

class IngressProxyHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self._proxy_request("POST")

    def do_GET(self):
        self._proxy_request("GET")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _proxy_request(self, method):
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()
        url = f"http://127.0.0.1:{VLLM_INTERNAL_PORT}{self.path}"
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else None

        req = urllib.request.Request(url, data=body, method=method)
        for k, v in self.headers.items():
            if k.lower() not in ("host", "content-length"):
                req.add_header(k, v)

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.send_response(resp.status)
                for hk, hv in resp.getheaders():
                    if hk.lower() not in ("transfer-encoding", "content-length"):
                        self.send_header(hk, hv)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as he:
            self.send_response(he.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(he.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

    def log_message(self, format, *args):
        pass

def start_ingress_server():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), IngressProxyHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server

def idle_watchdog_loop():
    while True:
        time.sleep(30)
        idle_duration = time.time() - LAST_ACTIVE
        if idle_duration > IDLE_TIMEOUT_SEC:
            log_event(f"Idle watchdog: No requests for {int(idle_duration // 60)}m. Stopping TPU to save weekly quota.", "WATCHDOG", "WARN")
            post_heartbeat(5, status="OFFLINE")
            time.sleep(2)
            os._exit(0)

def heartbeat_sender_loop():
    while True:
        time.sleep(15)
        post_heartbeat(CURRENT_STEP, status="ONLINE" if TUNNEL_URL else "STARTING")

print("=" * 70, flush=True)
print(f" FastBoot starting KAGGLE TPU worker ({ACCOUNT_ALIAS}, targets={TARGETS})", flush=True)
print("=" * 70, flush=True)

# -------------------------------------------------------------
# STEP 1: Topology & Device Verification
# -------------------------------------------------------------
log_event("Step 1/5: Verifying Kaggle TPU v5e-8 hardware topology...", "SYSTEM", "INFO")
post_heartbeat(1, status="STARTING")

try:
    import jax
    devices = jax.devices()
    n_chips = len(devices)
    platform = devices[0].platform if n_chips > 0 else "none"
    if n_chips != 8 or platform != "tpu":
        err_msg = f"Ghost TPU detected! Found {n_chips} {platform} devices, expected 8 TPU chips. Ensure Kaggle phone verification is completed in Kaggle -> Settings."
        log_event(err_msg, "ERROR", "ERROR")
        post_heartbeat(1, status="ERROR", telemetry={"lastError": err_msg})
        time.sleep(2)
        os._exit(1)
    log_event(f"Hardware verified: 8 TPU v5e chips detected in mesh.", "SYSTEM", "SUCCESS")
except Exception as e:
    err_msg = f"Failed to check JAX TPU devices: {e}"
    log_event(err_msg, "ERROR", "ERROR")
    post_heartbeat(1, status="ERROR", telemetry={"lastError": err_msg})
    os._exit(1)

# -------------------------------------------------------------
# STEP 2: Python Environment & MTP Speculative Rollback Patch
# -------------------------------------------------------------
log_event("Step 2/5: Building optimized TPU runtime environment with uv...", "RUNTIME", "INFO")
post_heartbeat(2, status="STARTING")

shutil.rmtree(VENV, ignore_errors=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "uv"], check=False)
subprocess.run([sys.executable, "-m", "uv", "venv", VENV, "--python", sys.executable, "-q"], check=True)
rc = subprocess.run([
    sys.executable, "-m", "uv", "pip", "install", "--python", PY,
    "--torch-backend=cpu", "vllm-tpu==0.28.0"
], check=False).returncode

if rc != 0:
    log_event("uv install failed; falling back to pip...", "RUNTIME", "WARN")
    subprocess.run([sys.executable, "-m", "pip", "--python", PY, "install", "-q",
                    "--extra-index-url", "https://download.pytorch.org/whl/cpu", "vllm-tpu==0.28.0"], check=True)

# Apply MTP state-rollback patch
try:
    import gzip, base64
    patch_content = gzip.decompress(base64.b64decode(MTP_PATCH_B64)).decode("utf-8")
    Path("/tmp/mtpfix.diff").write_text(patch_content)
    tpu_origin = subprocess.check_output(
        [PY, "-c", "import importlib.util as u; print(u.find_spec('tpu_inference').origin)"],
        text=True
    ).strip()
    pkg_root = os.path.dirname(os.path.dirname(tpu_origin))
    patch_res = subprocess.run(["patch", "-p1", "-d", pkg_root, "-i", "/tmp/mtpfix.diff", "--no-backup-if-mismatch", "-N"],
                               capture_output=True, text=True)
    if patch_res.returncode == 0 or "previously applied" in patch_res.stdout:
        log_event("MTP speculative decoding state-rollback patch applied successfully.", "RUNTIME", "SUCCESS")
    else:
        log_event(f"MTP patch warning: {patch_res.stderr[:200]}", "RUNTIME", "WARN")
except Exception as e:
    log_event(f"MTP patch could not be applied: {e}", "RUNTIME", "WARN")

# -------------------------------------------------------------
# STEP 3: Datasets Mount & XLA Cache Restore
# -------------------------------------------------------------
log_event("Step 3/5: Locating weights dataset and restoring precompiled XLA cache...", "DATASET", "INFO")
post_heartbeat(3, status="STARTING")

weights_dir = find_input("qwen3-8-27b-bf16", "rahim3/qwen3-8-27b-bf16")
if not weights_dir:
    weights_dir = find_input("*qwen*27b*")

if not weights_dir or not Path(weights_dir).is_dir():
    err_msg = "Model weights not found in /kaggle/input! Ensure 'rahim3/qwen3-8-27b-bf16' is attached."
    log_event(err_msg, "ERROR", "ERROR")
    post_heartbeat(3, status="ERROR", telemetry={"lastError": err_msg})
    os._exit(1)

log_event(f"Model weights verified at: {weights_dir}", "DATASET", "SUCCESS")

# Restore XLA compile cache if attached
env_dir = find_input("qwen38-tpu-env-v5e8", "rahim3/qwen38-tpu-env-v5e8")
os.makedirs(XLA_CACHE, exist_ok=True)
if env_dir:
    import tarfile
    cache_archives = list(Path(env_dir).glob("*.tar.gz")) + list(Path(env_dir).glob("*.tgz"))
    if cache_archives:
        log_event(f"Unpacking pre-compiled XLA cache from {cache_archives[0].name}...", "DATASET", "INFO")
        with tarfile.open(cache_archives[0], "r:gz") as tar:
            tar.extractall(path=XLA_CACHE)
        log_event("XLA cache restored: FastBoot ready in ~4-6 min.", "DATASET", "SUCCESS")

# -------------------------------------------------------------
# STEP 4: Start vLLM Engine
# -------------------------------------------------------------
log_event("Step 4/5: Launching vLLM on 8 TPU chips (128 GB HBM)...", "ENGINE", "INFO")
post_heartbeat(4, status="STARTING")

os.environ["VLLM_XLA_CACHE_PATH"] = XLA_CACHE
os.environ["SKIP_JAX_PRECOMPILE"] = "1"  # FastBoot: Compile shapes on demand with warm cache
os.environ["HF_HOME"] = "/tmp/hf"
os.environ.pop("TPU_LIBRARY_PATH", None)

vllm_cmd = [
    PY, "-m", "vllm.entrypoints.openai.api_server",
    "--model", str(weights_dir),
    "--host", "127.0.0.1",
    "--port", str(VLLM_INTERNAL_PORT),
    "--max-model-len", "262144",
    "--max-num-seqs", "4",
    "--speculative-model", "[MTP]",
    "--served-model-name", "qwen3.8-27b",
    "--disable-log-requests",
]

vllm_proc = subprocess.Popen(vllm_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

# Stream and monitor vLLM startup
startup_start = time.time()
server_ready = False

def monitor_vllm_logs():
    for line in vllm_proc.stdout:
        line_clean = line.rstrip()
        if not line_clean:
            continue
        if "Application startup complete" in line_clean or "Uvicorn running on" in line_clean:
            log_event("vLLM engine startup complete! API is ready to serve.", "ENGINE", "SUCCESS")
        elif "ERROR" in line_clean or "CRITICAL" in line_clean:
            log_event(line_clean[:250], "ENGINE", "WARN")

t_mon = threading.Thread(target=monitor_vllm_logs, daemon=True)
t_mon.start()

# Poll health check
while time.time() - startup_start < 480:  # 8 min max
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{VLLM_INTERNAL_PORT}/health", timeout=2) as r:
            if r.status == 200:
                server_ready = True
                break
    except Exception:
        pass
    if vllm_proc.poll() is not None:
        break
    time.sleep(2)

if not server_ready:
    err_msg = "vLLM failed to start within timeout. Check logs for details."
    log_event(err_msg, "ERROR", "ERROR")
    post_heartbeat(4, status="ERROR", telemetry={"lastError": err_msg})
    os._exit(1)

log_event(f"vLLM is ONLINE on internal port {VLLM_INTERNAL_PORT} in {round(time.time() - startup_start, 1)}s.", "ENGINE", "SUCCESS")

# -------------------------------------------------------------
# STEP 5: Start Ingress Proxy & Cloudflare Tunnel
# -------------------------------------------------------------
log_event("Step 5/5: Starting HTTP ingress and Cloudflare Quick Tunnel...", "NETWORK", "INFO")
post_heartbeat(5, status="STARTING")

start_ingress_server()
log_event(f"Ingress reverse proxy active on port {PORT}.", "NETWORK", "SUCCESS")

# Fetch cloudflared if not present
if not CLOUDFLARED.exists():
    urllib.request.urlretrieve(
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
        CLOUDFLARED
    )
    CLOUDFLARED.chmod(0o755)

cf_proc = subprocess.Popen(
    [str(CLOUDFLARED), "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--no-autoupdate"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

tunnel_start = time.time()
while time.time() - tunnel_start < 60:
    line = cf_proc.stdout.readline()
    if not line:
        continue
    m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", line)
    if m:
        TUNNEL_URL = m.group(0)
        break

if not TUNNEL_URL:
    err_msg = "Cloudflare tunnel failed to establish."
    log_event(err_msg, "ERROR", "ERROR")
    post_heartbeat(5, status="ERROR", telemetry={"lastError": err_msg})
    os._exit(1)

log_event(f"TPU v5e-8 Endpoint live: {TUNNEL_URL}", "NETWORK", "SUCCESS")
post_heartbeat(5, status="ONLINE", telemetry={"publicUrl": TUNNEL_URL})

# Start daemon threads for watchdog and heartbeat
threading.Thread(target=idle_watchdog_loop, daemon=True).start()
threading.Thread(target=heartbeat_sender_loop, daemon=True).start()

log_event("Cluster worker is fully armed and listening for inference requests.", "SYSTEM", "SUCCESS")

# Keep main thread alive
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    log_event("Manual termination requested.", "SYSTEM", "INFO")
    post_heartbeat(5, status="OFFLINE")
`;
}

