Moving your ComfyUI + Rclone On-Demand architecture to Google Colab’s official CLI (google-colab-cli) and REST API (colaboratory.googleapis.com) resolves the hardest bottlenecks you faced on Kaggle[1][2].
Based on the Colab REST API Reference and the Google Colab CLI architecture, here is what changes and the complete implementation plan to toggle Colab directly from your IDE or Web Dashboard API.
1. How Colab CLI & REST API Upgrade Your Architecture
Bottleneck on Kaggle	How Colab CLI / API Solves It
Black-Box Batch Logs (kaggle kernels push hides stdout until completion)	Live Streaming Execution: colab exec and colab ssh stream stdout/stderr to your local terminal or backend in real time[1][3].
3rd-Party Tunnels Needed (cloudflared / ngrok URLs change every boot; ngrok is blocked on Colab)	Native OpenSSH ProxyCommand Bridge: colab ssh --proxy-mode runs over Google's sanctioned WebSocket tunnel[3]. You can use standard SSH Local Port Forwarding (-L 8188:localhost:8188 -L 8189:localhost:8189) so ComfyUI and your Sidecar appear directly on localhost!
No Granular Lifecycle Control	Instant Toggle via REST/CLI: Provision a T4, L4, A100, or H100 in seconds (POST /v1beta/runtimes or colab new --gpu L4) and kill it immediately (DELETE /v1beta/runtimes/{id} or colab stop) to save compute units[4][5].
No FUSE Support (/dev/fuse blocked on Kaggle)	FUSE Works Natively: Colab supports both colab drivemount (/content/drive) and /dev/fuse[6]. (Note: Keeping your Approach B Rclone RC fetcher to /tmp/models is still faster for PyTorch .safetensors mmap loading, and runs at 150+ MB/s over Google's internal backbone).
2. Understanding the Two Control Layers
Layer A: The Colab REST API (https://colaboratory.googleapis.com)
Designed for programmatic runtime lifecycle management using OAuth2 scope https://www.googleapis.com/auth/colaboratory[5][7]:
GET /v1beta/subscription: Checks your Colab tier (Free, Pro, Pro+) and compute unit status[5].
GET /v1beta/runtimespecs: Lists hardware accelerators (T4, L4, G4, A100, H100, v5e1, v6e1) and returns "eligible": true/false for your account[4][8].
POST /v1beta/runtimes?runtimeId=comfy-node: Assigns a new VM runtime[9]. Returns a Long-Running Operation (v1.operations), which you await via GET /v1/{name=operations/*}:wait[5][9].
GET /v1beta/runtimes & GET /v1beta/runtimes/comfy-node: Polls active runtime status[5][10].
DELETE /v1beta/runtimes/comfy-node: Immediately unassigns the VM and stops billing compute units[11][12].
Layer B: The Google Colab CLI (google-colab-cli) & MCP Server
Wraps the REST API + Jupyter kernel execution + WebSocket SSH bridge into a local binary (colab)[3][11][13]:
colab new -s comfy-node --gpu T4 -k: Provisions the runtime (-k enables keep-alive)[14].
colab exec -s comfy-node -f bootstrap.py: Transmits a local script and runs it remotely without manual file uploads[13][15].
colab ssh --proxy-mode -s comfy-node: Bridges local OpenSSH directly into the Colab container[3][16].
MCP Server (https://colaboratory.googleapis.com/mcp) & COLAB_SKILL.md: Allows IDE agents (Cursor, VS Code, Claude Code, Antigravity) to directly call create_runtime, execute_code, and delete_runtime[7][13][17].
3. Step-by-Step Architecture Plan
Step 1: Install & Authenticate google-colab-cli Locally
Note: google-colab-cli natively supports Linux, macOS, and WSL2 on Windows[4].
Bash
# Install via uv (recommended by Google) or pip
uv tool install google-colab-cli

# Authenticate (use --auth=oauth2 for interactive login, or --auth=adc for headless automation)
colab auth
# Verify your tier & GPU eligibility
colab pay
Step 2: Configure IDE & Local Port Forwarding via ~/.ssh/config
Instead of running cloudflared inside the notebook, configure your local machine’s ~/.ssh/config to use colab ssh --proxy-mode[16].
Add this block to ~/.ssh/config:
Sshconfig
Host colab-comfy
    HostName comfy-node
    User root
    ProxyCommand colab ssh --proxy-mode -s %h
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    # Forward ComfyUI (8188) and Rclone Sidecar (8189) directly to your local PC!
    LocalForward 8188 127.0.0.1:8188
    LocalForward 8189 127.0.0.1:8189
    ServerAliveInterval 30
What this unlocks:
IDE Toggle: In VS Code / Cursor / Windsurf, open Remote-SSH and connect to colab-comfy[3][18]. Your IDE opens a full workspace inside the Colab GPU VM.
Zero-Config Localhost Routing: While connected, http://localhost:8188 (ComfyUI) and http://localhost:8189 (your Rclone Model Fetcher Sidecar) work natively on your local machine without Cloudflare tunnels.
Step 3: Create the Remote Bootstrap Script (colab_bootstrap.py)
With colab exec -f colab_bootstrap.py, you don't need .ipynb files anymore[13][15]. Keep this script locally in your repo; colab exec ships it to the runtime automatically[13]:
Python
# colab_bootstrap.py
import os, subprocess, time

# Inject Rclone OAuth Config
rclone_conf = f"""[gdrive]
type = drive
client_id = {os.environ['GDRIVE_CLIENT_ID']}
client_secret = {os.environ['GDRIVE_CLIENT_SECRET']}
scope = drive
token = {{"refresh_token":"{os.environ['GDRIVE_REFRESH_TOKEN']}"}}
"""
os.makedirs('/root/.config/rclone', exist_ok=True)
with open('/root/.config/rclone/rclone.conf', 'w') as f:
    f.write(rclone_conf)

# 1. Install Rclone & Setup /tmp/models
subprocess.run(['apt-get', 'update', '-qq'], check=True)
subprocess.run(['apt-get', 'install', '-y', '-qq', 'rclone', 'aria2'], check=True)

for cat in ['checkpoints', 'loras', 'vae', 'unet', 'clip', 'controlnet']:
    os.makedirs(f'/tmp/models/{cat}', exist_ok=True)

# 2. Start Rclone RC Daemon (:5572) for on-demand model streaming
subprocess.Popen([
    'rclone', 'rcd',
    '--rc-addr=127.0.0.1:5572',
    '--rc-no-auth',
    '--transfers=4',
    '--drive-chunk-size=128M'
])

# 3. Clone & Start ComfyUI (:8188) + Sidecar (:8189)
if not os.path.exists('/content/ComfyUI'):
    subprocess.run(['git', 'clone', '--depth', '1', 'https://github.com/comfyanonymous/ComfyUI.git', '/content/ComfyUI'], check=True)
    subprocess.run(['pip', 'install', '-q', '-r', '/content/ComfyUI/requirements.txt'], check=True)

extra_paths = """
colab_tmp:
    base_path: /tmp/models
    checkpoints: checkpoints/
    loras: loras/
    vae: vae/
    unet: unet/
    clip: clip/
    controlnet: controlnet/
"""
with open('/content/ComfyUI/extra_model_paths.yaml', 'w') as f:
    f.write(extra_paths)

# Launch ComfyUI and Sidecar in background
subprocess.Popen(['python3', '/content/ComfyUI/main.py', '--listen', '127.0.0.1', '--port', '8188'])
subprocess.Popen(['uvicorn', 'sidecar:app', '--host', '127.0.0.1', '--port', '8189'])

print("✅ ComfyUI (:8188), Sidecar (:8189), and Rclone RC (:5572) are LIVE!")
Step 4: Build the Local Toggle API (For Your Web Dashboard / IDE)
You can expose a local controller endpoint in your Web Dashboard backend that toggles the Colab GPU runtime ON/OFF via API and automatically binds the SSH port-forward tunnel.
Below is a clean controller using both the Colab REST API (for fast status/spec checks) and the Colab CLI (for provisioning, bootstrap execution, and SSH tunneling):
Python
import subprocess
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
SESSION_NAME = "comfy-node"
COLAB_API_BASE = "https://colaboratory.googleapis.com/v1beta"

ssh_tunnel_proc: subprocess.Popen | None = None

class ToggleRequest(BaseModel):
    action: str          # "start" or "stop"
    gpu: str = "T4"      # "T4", "L4", "A100", "H100"

@app.get("/colab/specs")
async def list_eligible_gpus(oauth_token: str):
    """Calls Colab REST API v1beta/runtimespecs to check GPU availability."""
    headers = {"Authorization": f"Bearer {oauth_token}"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{COLAB_API_BASE}/runtimespecs", headers=headers)
        resp.raise_for_status()
        return resp.json()

@app.post("/colab/toggle")
async def toggle_colab(req: ToggleRequest):
    global ssh_tunnel_proc

    if req.action == "start":
        # 1. Provision Runtime via Colab CLI
        res = subprocess.run(
            ["colab", "new", "-s", SESSION_NAME, "--gpu", req.gpu, "-k"],
            capture_output=True, text=True
        )
        if res.returncode != 0 and "already exists" not in res.stderr:
            raise HTTPException(status_code=500, detail=res.stderr)

        # 2. Upload Sidecar & Execute Bootstrap Script
        subprocess.run(["colab", "upload", "-s", SESSION_NAME, "sidecar.py", "/content/sidecar.py"], check=True)
        subprocess.run(["colab", "exec", "-s", SESSION_NAME, "-f", "colab_bootstrap.py"], check=True)

        # 3. Open Background SSH Tunnel forwarding 8188 (ComfyUI) & 8189 (Sidecar)
        if ssh_tunnel_proc is None or ssh_tunnel_proc.poll() is not None:
            ssh_tunnel_proc = subprocess.Popen(["ssh", "-N", "colab-comfy"])

        return {
            "status": "online",
            "session": SESSION_NAME,
            "gpu": req.gpu,
            "comfyui_url": "http://localhost:8188",
            "sidecar_url": "http://localhost:8189"
        }

    elif req.action == "stop":
        # 1. Kill local SSH port-forward tunnel
        if ssh_tunnel_proc and ssh_tunnel_proc.poll() is None:
            ssh_tunnel_proc.terminate()
            ssh_tunnel_proc = None

        # 2. Release Colab Runtime VM (stops compute unit billing immediately)
        subprocess.run(["colab", "stop", "-s", SESSION_NAME], check=True)
        return {"status": "offline", "session": SESSION_NAME}
4. End-to-End Workflow Summary
Click "Power ON GPU (L4)" on your Dashboard (or run colab new -s comfy-node --gpu L4 in IDE):
Your backend provisions the Colab runtime in ~5–10 seconds[4].
colab exec pushes and runs colab_bootstrap.py[13][15].
OpenSSH connects in the background via colab ssh --proxy-mode, binding remote ports 8188 and 8189 to your local localhost:8188 and localhost:8189[3][16].
Generate Image (Lazy Model Fetch):
Your Dashboard sends POST http://localhost:8189/fetch-model for Wai_Illustrious_v16.safetensors.
The Sidecar instructs Rclone RC (:5572) to pull only that file from Google Drive into /tmp/models/checkpoints/ at ~150 MB/s.
Your Dashboard polls GET http://localhost:8189/fetch-status and renders the live progress bar.
ComfyUI (http://localhost:8188) executes the prompt.
Click "Power OFF" (or colab stop -s comfy-node):
Calls DELETE /v1beta/runtimes/comfy-node under the hood, tearing down the VM immediately so zero idle compute units are burned[11][12].