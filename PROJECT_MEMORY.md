# 🧠 Scriptoria: Project Memory & Knowledge Handover

> **Document Purpose**: This file serves as the definitive context and knowledge transfer document for any developer, future AI assistant, or new session working on **Scriptoria**. It documents the complete system architecture, operational procedures, multi-cloud GPU cluster setup, edge cases, and hard-won debugging solutions.

---

## 1. Executive Summary

- **Project Name**: Scriptoria Cloud GPU Orchestrator
- **GitHub Repository**: [https://github.com/Krhimanshu008/Scriptoria](https://github.com/Krhimanshu008/Scriptoria)
- **Live Production URL**: [https://scriptoria.krhimanshu.in](https://scriptoria.krhimanshu.in)
- **Local Control Plane**: `http://127.0.0.1:8000`
- **Core Technology Stack**:
  - **Backend**: FastAPI, Uvicorn, HTTPX (async REST client), Pydantic v2
  - **Frontend**: Vanilla JS (ES6+), Tailwind CSS (CDN), FontAwesome 6, WebSockets with HTTP polling fallback
  - **Deployment**: Vercel Serverless (Production Gateway) + Local Python Daemon (Development & CLI automation)
  - **Cloud Compute**: Kaggle Notebooks (2x Dual-GPU sessions) + Google Colab (2x Single-GPU sessions)
  - **Storage & Ingress**: Cloudflare Named Tunnels (`cloudflared`), Google Drive with Rclone Remote Control (`rcd`)

---

## 2. Cluster Topology & 6-GPU Architecture

Scriptoria manages an orchestration cluster of **6 GPU endpoints** designed to maximize free-tier compute while minimizing quota consumption:

```
┌──────────────────────────────────────────────────────────────────────────┐
│              SCRIPTORIA CONTROL PLANE (Vercel & Local)                  │
│                https://scriptoria.krhimanshu.in                          │
│                                                                          │
│  [gpu0] Kaggle Acc 1 (CUDA:0)  ───►  https://gpu0.krhimanshu.in:8188    │
│  [gpu1] Kaggle Acc 1 (CUDA:1)  ───►  https://gpu1.krhimanshu.in:8189    │
│  [gpu2] Kaggle Acc 2 (CUDA:0)  ───►  https://gpu2.krhimanshu.in:8190    │
│  [gpu3] Kaggle Acc 2 (CUDA:1)  ───►  https://gpu3.krhimanshu.in:8191    │
│  [gcgpu] Colab Acc 1 (T4)      ───►  https://gcgpu.krhimanshu.in:8188   │
│  [gcgpu1] Colab Acc 2 (T4)     ───►  https://gcgpu1.krhimanshu.in:8189  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Detailed Endpoint Specifications

| Target | Provider | Account Alias | Kaggle/Google User | Physical Hardware | Port | Public Ingress Domain | Quota Cost |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`gpu0`** | Kaggle | `acc1` | `himanshukr7532` | Tesla T4 (CUDA:0, 16GB) | 8188 | `https://gpu0.krhimanshu.in` | 1x Shared Quota (30h/wk) |
| **`gpu1`** | Kaggle | `acc1` | `himanshukr7532` | Tesla T4 (CUDA:1, 16GB) | 8189 | `https://gpu1.krhimanshu.in` | **0h extra** (same session as gpu0) |
| **`gpu2`** | Kaggle | `acc2` | `krhimanshu001` | Tesla T4 (CUDA:0, 16GB) | 8190 | `https://gpu2.krhimanshu.in` | 1x Shared Quota (30h/wk) |
| **`gpu3`** | Kaggle | `acc2` | `krhimanshu001` | Tesla T4 (CUDA:1, 16GB) | 8191 | `https://gpu3.krhimanshu.in` | **0h extra** (same session as gpu2) |
| **`gcgpu`** | Colab | `acc1` | `krhimanshuk010@gmail.com` | Tesla T4 (16GB) | 8188 | `https://gcgpu.krhimanshu.in` | Colab Free Tier Runtime |
| **`gcgpu1`**| Colab | `acc2` | `acc2` pool | Tesla T4 (16GB) | 8189 | `https://gcgpu1.krhimanshu.in` | Colab Free Tier Runtime |

### Quota Optimization Logic
- Kaggle accounts get 30 hours/week of GPU quota. A dual-T4 session (`nvidia-tesla-t4-2`) counts as **1x meter** against the 30h limit.
- Scriptoria boots **one notebook per Kaggle account** running **two independent ComfyUI processes** bound via `CUDA_VISIBLE_DEVICES=0` and `CUDA_VISIBLE_DEVICES=1`.
- Starting either `gpu0` or `gpu1` boots the unified container. Starting either `gpu2` or `gpu3` boots Account 2's container.
- Total Available Compute: **4x T4 GPUs on Kaggle** (60 combined hours/week) + **2x T4 GPUs on Colab**.

---

## 3. Network Architecture & Ingress

All remote GPU nodes communicate with the dashboard without port forwarding or dynamic DDNS by using **Cloudflare Named Tunnels**:

1. **Tunnel 1: `Comfyui` (`CF_TOKEN_KAGGLE`)**:
   - `gpu0.krhimanshu.in` ➔ `http://127.0.0.1:8188`
   - `gpu1.krhimanshu.in` ➔ `http://127.0.0.1:8189`
   - `gpu2.krhimanshu.in` ➔ `http://127.0.0.1:8190`
   - `gpu3.krhimanshu.in` ➔ `http://127.0.0.1:8191`

2. **Tunnel 2: `Google Colab (1 GPU)` (`CF_TOKEN_GCGPU`)**:
   - `gcgpu.krhimanshu.in` ➔ `http://127.0.0.1:8188`
   - `gcgpu1.krhimanshu.in` ➔ `http://127.0.0.1:8189`

3. **In-Band Health Monitoring & Remote Kill**:
   - Every GPU container runs a lightweight custom API bridge in `custom_nodes/vm_controller`:
     - `GET /system_stats`: Returns GPU VRAM, free memory, device name, and RAM statistics. Pinned by `vm_manager.py` every 5 seconds.
     - `POST /vm-kill`: Immediately terminates the cloud session cleanly (`os._exit(0)` on Kaggle or `runtime.unassign()` on Colab) to prevent idle quota drain.

---

## 4. Model Storage & Ultra-Fast On-Demand Streaming

Instead of bundling 20 GB models into Kaggle datasets or downloading from HuggingFace on every boot (taking 15–20 minutes), Scriptoria implements **Google Drive + Rclone Remote Control (RC) streaming**:

1. **Storage Location**:
   - Remote: `gdrive:NovelVisualizer/ComfyUI_Storage/models/{category}/{filename}`
   - Categories: `checkpoints`, `loras`, `vae`, `unet`, `clip`, `clip_vision`, `controlnet`, `ipadapter`
2. **Streaming Execution**:
   - An Rclone RC daemon runs in the background on port `5572` inside each VM with high-throughput parameters:
     ```bash
     rclone rcd --rc-addr=127.0.0.1:5572 --rc-no-auth --transfers=4 --drive-chunk-size=64M
     ```
   - When the user selects a checkpoint or model in the dashboard, the backend triggers `POST /fetch-model` on the target ComfyUI node.
   - The node issues an async copy job (`/operations/copyfile`) from Google Drive directly into Linux `/tmp/models/` at **100–300 MB/s**.
   - A 4 GB checkpoint downloads in **~12–18 seconds**.
   - `extra_model_paths.yaml` points ComfyUI directly to `/tmp/models`.

---

## 5. Deployment Environments: Local vs Vercel Serverless

Scriptoria is designed to run in two interchangeable modes:

### Mode A: Local Development & Automation (`http://127.0.0.1:8000`)
- **How to Run**: Run `start_dashboard.bat` or `python -m uvicorn server:app --host 127.0.0.1 --port 8000`.
- **Features**:
  - Full WebSocket support (`/ws`) for instant CLI terminal streaming.
  - Native Google Colab CLI (`colab.exe`) automation using OAuth2/ADC tokens.
  - Background lifespan monitor loop pinging endpoints every 5s.

### Mode B: Vercel Serverless Production (`https://scriptoria.krhimanshu.in`)
- **Entrypoint**: `api/index.py` handles all serverless requests and proxies to `server.py`.
- **Zero-Config Routing**: Configured in `vercel.json` with rewrites pointing to `/api/index.py`. The root `index.html` is served directly by Vercel Edge CDN.
- **Pure REST API Kaggle Push**: Vercel does not spawn subprocesses. Instead, it issues pure HTTP POST requests to `https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel` using `httpx`.
- **Serverless Filesystem**: AWS Lambda/Vercel has a read-only filesystem except for `/tmp`. When `IS_SERVERLESS` is true, all notebook bundle generation and outputs are routed to `/tmp`.
- **WebSocket Fallback**: Because Vercel Serverless terminates connections after HTTP responses, the frontend automatically falls back to polling `/api/logs` (every 3s) and `/api/status` (every 5s), providing full live log streaming in the web console.
- **1-Click Colab Launch**: Since Windows `colab.exe` cannot run inside Vercel, the UI provides 1-click launch links opening the pre-configured notebook directly in Google Colab.

---

## 6. Codebase File Structure & Responsibilities

```
c:\Users\5480\Desktop\Automation\Notebook\
├── api/
│   ├── index.py                 # Vercel serverless entrypoint and API route gateway
│   └── static/index.html        # Edge copy of the dashboard HTML
├── docs/
│   ├── architecture.md          # Architectural diagram and core design specs
│   ├── multi_account_colab.md   # Step-by-step guide for Colab multi-account setup
│   └── notes/                   # Additional operational notes
├── notebooks/                   # Auto-generated notebook bundles (git-ignored)
│   ├── gcgpu/                   # Colab Account 1 bundle
│   ├── kaggle_dual/             # Kaggle Account 1 dual-GPU bundle
│   └── kaggle_dual_acc2/        # Kaggle Account 2 dual-GPU bundle
├── outputs/                     # Generated image outputs (git-ignored)
├── static/
│   └── index.html               # Static dashboard copy mounted by local FastAPI
├── colab_bootstrap.py           # Remote script uploaded and run inside Colab by CLI
├── comfy_client.py              # ComfyUI prompt queueing, catalog inspection, image downloading
├── comfy_ide_studio.py          # Interactive CLI terminal for managing VMs and dispatching prompts
├── config.py                    # Master settings, environment loading, and serverless path routing
├── enroll_colab.py              # Helper script for enrolling secondary Google Colab accounts (ADC)
├── index.html                   # Master single-page dashboard (real-time telemetry & prompt pad)
├── log_broker.py                # In-memory circular log buffer & WebSocket/HTTP stream broker
├── notebook_generator.py        # Programmatic builder for dual-GPU Kaggle and Colab .ipynb files
├── requirements.txt             # Python dependencies for local and Vercel environments
├── server.py                    # FastAPI application, REST endpoints, and WebSocket handler
├── start_dashboard.bat          # 1-click Windows batch launcher for local dashboard
├── vercel.json                  # Vercel deployment and rewrite configuration
├── vm_manager.py                # Core VM state machine, REST Kaggle push, health checks, shutdown
└── PROJECT_MEMORY.md            # THIS KNOWLEDGE BASE DOCUMENT
```

---

## 7. Environment Variables Reference

The project reads environment variables from `.env` locally and from Vercel Project Settings in production:

```env
# Server
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8000

# Kaggle Multi-Account Credentials
KAGGLE_ACC1_USERNAME=himanshukr7532
KAGGLE_ACC1_KEY=KGAT_...                        # Kaggle OAuth Access Token (Bearer auth)
KAGGLE_ACC2_USERNAME=krhimanshu001
KAGGLE_ACC2_KEY=e9a42...                        # Kaggle Legacy API Key (Basic auth)

# Cloudflare Tunnel Tokens
CF_TOKEN_KAGGLE=eyJh...                         # "Comfyui" Named Tunnel token (ports 8188-8191)
CF_TOKEN_GCGPU=eyJh...                          # "Google Colab" Named Tunnel token

# Google Drive Rclone Streaming
GDRIVE_CLIENT_ID=...apps.googleusercontent.com
GDRIVE_CLIENT_SECRET=GOCSPX-...
GDRIVE_REFRESH_TOKEN=1//04...

# Public Endpoint Overrides (Defaults match Cloudflare DNS)
COMFYUI_GPU0_URL=https://gpu0.krhimanshu.in
COMFYUI_GPU1_URL=https://gpu1.krhimanshu.in
COMFYUI_GPU2_URL=https://gpu2.krhimanshu.in
COMFYUI_GPU3_URL=https://gpu3.krhimanshu.in
COMFYUI_GCGPU_URL=https://gcgpu.krhimanshu.in
COMFYUI_GCGPU1_URL=https://gcgpu1.krhimanshu.in
```

---

## 8. Critical Lessons Learned & Bug Resolutions

Every developer or AI working on this codebase should be aware of these critical edge cases:

### 1. Kaggle Authentication Differences (OAuth vs Legacy Key)
- **Symptom**: `401 Unauthorized` when calling Kaggle API endpoints.
- **Cause**: Account 1 uses a new Kaggle Access Token (`KGAT_...`), whereas Account 2 uses a legacy 32-character hex key.
- **Solution**:
  - If `key.startswith("KGAT_")`: Authenticate using `headers={"Authorization": f"Bearer {key}"}`.
  - Otherwise: Authenticate using HTTP Basic Auth `auth=(username, key)`.

### 2. Kaggle 409 Conflict on SaveKernel
- **Symptom**: `409 Client Error: Conflict for url: https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel`.
- **Cause**: The kernel metadata for Account 2 (`krhimanshu001`) attempted to attach private datasets owned by Account 1 (`himanshukr7532/nv-comfyui-model-library`).
- **Solution**: Never attach another user's private dataset sources in `kernel-metadata.json`. Account 2 leaves `datasetDataSources: []` and streams all models dynamically from Google Drive via Rclone.

### 3. Vercel Serverless Read-Only Filesystem
- **Symptom**: `500 FUNCTION_INVOCATION_FAILED: [Errno 30] Read-only file system: '/var/task/notebooks'`.
- **Cause**: AWS Lambda containers only allow writes in `/tmp`. Calling `mkdir()` at module top-level in `config.py` crashed the application during cold start.
- **Solution**: Check `IS_SERVERLESS = bool(os.environ.get("VERCEL") or ...)` and redirect `NOTEBOOKS_DIR`, `OUTPUTS_DIR`, and `TEMPLATES_DIR` to `/tmp`.

### 4. Background Task Freeze on Vercel
- **Symptom**: Clicking "Start VM" on Vercel returned 200, but the VM never booted on Kaggle.
- **Cause**: Calling `asyncio.create_task(self._run_kaggle_push(...))` returned the HTTP response immediately. In serverless, returning the response terminates or freezes the execution environment, aborting the background task before it could call Kaggle.
- **Solution**: In `start_vm()`, synchronously `await self._run_kaggle_push(...)`. Kaggle's pure REST API saves and triggers the kernel in **~1.3 seconds**, allowing the HTTP handler to return a verified `STARTING (Step 3)` response.

### 5. WebSocket Incompatibility on Serverless
- **Symptom**: Dashboard terminal showed `Reconnecting...` indefinitely on `https://scriptoria.krhimanshu.in`.
- **Cause**: Vercel Serverless functions do not support long-lived persistent WebSocket connections (`/ws`).
- **Solution**: Added automatic HTTP polling fallback in `index.html`. If WebSocket connection fails, it transparently polls `/api/logs?limit=50` and `/api/status`, providing real-time terminal output and status updates on Vercel without manual configuration.

---

## 9. Standard Operational Runbook

### Starting the Cluster Locally
```powershell
# Open project directory
cd C:\Users\5480\Desktop\Automation\Notebook

# Launch FastAPI web server
python -m uvicorn server:app --host 127.0.0.1 --port 8000
# Dashboard is available at http://127.0.0.1:8000
```

### Starting VMs via REST API
```bash
# Start Kaggle Account 1 (Both gpu0 and gpu1 boot simultaneously)
curl -X POST https://scriptoria.krhimanshu.in/api/vm/gpu0/toggle

# Start Kaggle Account 2 (Both gpu2 and gpu3 boot simultaneously)
curl -X POST https://scriptoria.krhimanshu.in/api/vm/gpu2/toggle

# Check Live Health Across All 6 GPUs
curl https://scriptoria.krhimanshu.in/api/status
```

### Stopping VMs (Zero-Quota Drain)
```bash
# In-band shutdown for Kaggle Account 1
curl -X POST https://scriptoria.krhimanshu.in/api/vm/gpu0/stop

# In-band shutdown for Kaggle Account 2
curl -X POST https://scriptoria.krhimanshu.in/api/vm/gpu2/stop
```

### Deploying Updates to Vercel
```powershell
# Commit changes and push to GitHub (Vercel automatically builds and deploys within ~30s)
git add .
git commit -m "Update feature or fix"
git push origin main
```

---

## 10. Future Roadmap & Pending Work

1. **Book Visualizer Integration**:
   - Merge the neighboring `Novel Visualiser` repository into Scriptoria to form an all-in-one AI book-to-comic/novel video generation studio.
2. **Cluster Load Balancer**:
   - Implement an intelligent round-robin prompt dispatcher in `comfy_client.py` that automatically routes image generation workflows to whichever of the 6 GPUs has the shortest queue and highest free VRAM.
3. **Automated Quota Rotation**:
   - Add a scheduled cron task that switches active workloads from Account 1 to Account 2 when weekly Kaggle quota reaches 28 hours.
