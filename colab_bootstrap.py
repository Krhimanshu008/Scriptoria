"""
Google Colab Bootstrap Script for ComfyUI & Rclone RC Streaming
Executes on the remote Colab VM (either via `colab exec` or loaded into a notebook).
Integrates:
1. ComfyUI Core on Port 8188 with CUDA acceleration
2. VM Controller Bridge (/fetch-model, /fetch-status, /rclone-rc/*, /vm-kill)
3. Rclone RC Daemon on Port 5572 for 250+ MB/s on-demand model streaming into /tmp
4. Cloudflare Named Tunnel for gcgpu.krhimanshu.in
"""

import os
import sys
import time
import json
import subprocess
import threading
import urllib.request
import urllib.parse

# 1. Configuration & Secrets Injection (Passed dynamically via --env or environment)
CLIENT_ID = os.environ.get("GDRIVE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GDRIVE_CLIENT_SECRET", "")
REFRESH_TOKEN = os.environ.get("GDRIVE_REFRESH_TOKEN", "")
CF_TOKEN_GCGPU = os.environ.get("CF_TOKEN_GCGPU", "")

WORK_DIR = "/content"
COMFY_DIR = os.path.join(WORK_DIR, "ComfyUI")

def log(msg: str):
    print(f"[Colab Bootstrap] {msg}", flush=True)

# -------------------------------------------------------------
# Step 1: System Packages & Rclone Setup
# -------------------------------------------------------------
log("📦 Step 1/5: Installing system packages (rclone, aria2)...")
subprocess.run(["apt-get", "update", "-qq"], check=False)
subprocess.run(["apt-get", "install", "-y", "-qq", "rclone", "aria2"], check=False)

# Mint live Google Drive access token
log("🔑 Minting fresh Google Drive OAuth access token...")
access_token = ""
try:
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
        "grant_type": "refresh_token"
    }).encode("utf-8")
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        access_token = res.get("access_token", "")
        log("✅ OAuth token successfully generated!")
except Exception as e:
    log(f"⚠️ OAuth token refresh notice: {e}")

# Write rclone.conf
token_data = {
    "access_token": access_token,
    "token_type": "Bearer",
    "refresh_token": REFRESH_TOKEN,
    "expiry": "2026-12-31T23:59:59Z"
}
rclone_conf = f"""[gdrive]
type = drive
client_id = {CLIENT_ID}
client_secret = {CLIENT_SECRET}
scope = drive
token = {json.dumps(token_data)}
"""
os.makedirs("/root/.config/rclone", exist_ok=True)
with open("/root/.config/rclone/rclone.conf", "w", encoding="utf-8") as f:
    f.write(rclone_conf)

# Create /tmp/models directory tree
CATEGORIES = [
    "checkpoints", "loras", "vae", "unet", "clip",
    "clip_vision", "controlnet", "ipadapter", "text_encoders", "upscale_models", "sams", "diffusion_models"
]
for cat in CATEGORIES:
    os.makedirs(f"/tmp/models/{cat}", exist_ok=True)

# Start Rclone Remote Control Daemon
log("⚡ Starting Rclone RC daemon on port 5572...")
rclone_log = open("/content/rclone.log", "w")
subprocess.Popen([
    "rclone", "rcd",
    "--config=/root/.config/rclone/rclone.conf",
    "--rc-addr=127.0.0.1:5572",
    "--rc-no-auth",
    "--transfers=4",
    "--drive-chunk-size=128M"
], stdout=rclone_log, stderr=rclone_log, start_new_session=True)

# -------------------------------------------------------------
# Step 2: Clone ComfyUI & Install Dependencies
# -------------------------------------------------------------
log("🚀 Step 2/5: Setting up ComfyUI...")
if not os.path.exists(COMFY_DIR):
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR], check=True)

try:
    import torch
    log(f"⚡ PyTorch already pre-installed: CUDA={torch.cuda.is_available()} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No GPU'})")
except ImportError:
    log("📦 Installing PyTorch with CUDA...")
    subprocess.run([
        sys.executable, "-m", "pip", "install", "-q",
        "torch", "torchvision", "torchaudio",
        "--extra-index-url", "https://download.pytorch.org/whl/cu121"
    ], check=False)

log("📦 Installing ComfyUI dependencies...")
subprocess.run([
    sys.executable, "-m", "pip", "install", "-q", "-r",
    os.path.join(COMFY_DIR, "requirements.txt")
], check=True)

log("📦 Installing runtime extensions (httpx, einops, transformers, aiohttp)...")
subprocess.run([
    sys.executable, "-m", "pip", "install", "-q",
    "httpx", "einops", "transformers", "aiohttp"
], check=True)

# -------------------------------------------------------------
# Step 3: Install Custom Nodes & VM Controller Bridge
# -------------------------------------------------------------
log("🧩 Step 3/5: Installing Custom Nodes & VM Controller Bridge...")
nodes_dir = os.path.join(COMFY_DIR, "custom_nodes")
os.makedirs(nodes_dir, exist_ok=True)

NODES = {
    "ComfyUI_IPAdapter_plus": "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git",
    "ComfyUI-Florence2": "https://github.com/kijai/ComfyUI-Florence2.git"
}
for name, repo in NODES.items():
    dst = os.path.join(nodes_dir, name)
    if not os.path.exists(dst):
        subprocess.run(["git", "clone", "--depth", "1", repo, dst], check=False)
        req = os.path.join(dst, "requirements.txt")
        if os.path.exists(req):
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req], check=False)

# Embedded VM Controller Extension
ctrl_dir = os.path.join(nodes_dir, "vm_controller")
os.makedirs(ctrl_dir, exist_ok=True)
ctrl_code = '''import os, sys, time, json, subprocess, threading
import server
from aiohttp import web
import urllib.request

RCLONE_RC_URL = "http://127.0.0.1:5572"

@server.PromptServer.instance.routes.post('/fetch-model')
async def handle_fetch_model(request):
    try:
        data = await request.json()
        category = data.get('category', 'checkpoints')
        filename = data.get('name', '')
        remote_src = f"gdrive:NovelVisualizer/ComfyUI_Storage/models/{category}"
        local_dst = f"/tmp/models/{category}"
        os.makedirs(local_dst, exist_ok=True)

        payload = {
            "srcFs": remote_src,
            "srcRemote": filename,
            "dstFs": local_dst,
            "dstRemote": filename,
            "_async": True
        }
        req = urllib.request.Request(
            f"{RCLONE_RC_URL}/operations/copyfile",
            data=json.dumps(payload).encode('utf-8'),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            job_info = json.loads(resp.read().decode('utf-8'))
            return web.json_response({"status": "started", "jobid": job_info.get("jobid"), "file": filename})
    except Exception as e:
        return web.json_response({"status": "error", "error": str(e)}, status=500)

@server.PromptServer.instance.routes.get('/fetch-status')
async def handle_fetch_status(request):
    try:
        req = urllib.request.Request(f"{RCLONE_RC_URL}/core/stats", data=b'{}', headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            stats = json.loads(resp.read().decode('utf-8'))
            return web.json_response(stats)
    except Exception as e:
        return web.json_response({"status": "error", "error": str(e)}, status=500)

@server.PromptServer.instance.routes.post('/rclone-rc/{action:.*}')
async def handle_rclone_rc_proxy(request):
    try:
        action = request.match_info.get('action', '')
        body = await request.read()
        headers = {"Content-Type": "application/json"}
        req = urllib.request.Request(f"{RCLONE_RC_URL}/{action}", data=body if body else b'{}', headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return web.json_response(data)
    except Exception as e:
        return web.json_response({"status": "error", "error": str(e)}, status=500)

@server.PromptServer.instance.routes.post('/vm-kill')
async def handle_vm_kill(request):
    def suicide():
        time.sleep(1.0)
        print('🛑 Remote shutdown signal executed. Stopping Colab runtime...')
        os._exit(0)
    threading.Thread(target=suicide, daemon=False).start()
    return web.json_response({"status": "terminating"})

NODE_CLASS_MAPPINGS = {}
'''
with open(os.path.join(ctrl_dir, "__init__.py"), "w", encoding="utf-8") as f:
    f.write(ctrl_code)

# Configure extra_model_paths.yaml
extra_yaml = """colab_tmp:
    base_path: /tmp/models
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
colab_gdrive:
    base_path: /content/drive/MyDrive/NovelVisualizer/ComfyUI_Storage/models
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
"""
with open(os.path.join(COMFY_DIR, "extra_model_paths.yaml"), "w", encoding="utf-8") as f:
    f.write(extra_yaml)

# -------------------------------------------------------------
# Step 4: Launch ComfyUI Server (Detached Daemon)
# -------------------------------------------------------------
PORT = int(os.environ.get("COMFY_PORT", sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else "8188"))
log(f"🚀 Step 4/5: Launching ComfyUI server on port {PORT}...")
os.chdir(COMFY_DIR)
comfy_log = open("/content/comfyui.log", "a")
proc_comfy = subprocess.Popen([
    sys.executable, "main.py",
    "--listen", "0.0.0.0",
    "--port", str(PORT),
    "--preview-method", "auto"
], stdout=comfy_log, stderr=comfy_log, start_new_session=True)

time.sleep(4)

# -------------------------------------------------------------
# Step 5: Start Cloudflare Named Tunnel (Detached Daemon)
# -------------------------------------------------------------
log("🌐 Step 5/5: Connecting Cloudflare Named Tunnel (gcgpu.krhimanshu.in)...")
subprocess.run([
    "wget", "-nc", "-q",
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    "-O", "/tmp/cloudflared"
], check=False)
subprocess.run(["chmod", "+x", "/tmp/cloudflared"], check=False)

cf_log = open("/content/cloudflared.log", "a")
if CF_TOKEN_GCGPU:
    log("🌐 Binding Named Tunnel with CF_TOKEN_GCGPU...")
    proc_cf = subprocess.Popen([
        "/tmp/cloudflared", "tunnel", "run", "--token", CF_TOKEN_GCGPU
    ], stdout=cf_log, stderr=cf_log, start_new_session=True)
else:
    log("🌐 Launching fallback Quick Tunnel for port 8188...")
    proc_cf = subprocess.Popen([
        "/tmp/cloudflared", "tunnel", "--url", "http://127.0.0.1:8188"
    ], stdout=cf_log, stderr=cf_log, start_new_session=True)

time.sleep(3)
log("=" * 70)
log("🎉 GOOGLE COLAB COMFYUI IS LIVE ON https://gcgpu.krhimanshu.in !")
log("=" * 70)

