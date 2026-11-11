# 🏛️ Scriptoria: Cloud GPU & Orchestration Architecture

Scriptoria is a hybrid multi-cloud GPU orchestrator and studio designed for high-performance generative AI workloads (ComfyUI) spanning **Kaggle Dual-GPU instances**, **Google Colab runtimes**, and a **Vercel Serverless Control Plane**.

---

## 🌟 High-Level Topology

```
                   ┌────────────────────────────────────────┐
                   │        Vercel Serverless Gateway       │
                   │       (or Local FastAPI Server)        │
                   │       http://127.0.0.1:8000 / Web      │
                   └──────────────────┬─────────────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            │                                                   │
  (Kaggle API REST)                                     (Colab CLI / Web)
            │                                                   │
            ▼                                                   ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│     Kaggle Account 1 (T4x2)   │               │      Google Colab (T4)        │
│  - Port 8188: GPU 0 (CUDA:0)  │               │  - Account 1: Port 8188       │
│  - Port 8189: GPU 1 (CUDA:1)  │               │    (gcgpu.krhimanshu.in)      │
│  Tunnel: gpu0/1.krhimanshu.in │               │  - Account 2: Port 8189       │
└───────────────────────────────┘               │    (gcgpu1.krhimanshu.in)     │
            │                                   └───────────────────────────────┘
            ▼                                                   │
┌───────────────────────────────┐                               │
│     Kaggle Account 2 (T4x2)   │                               │
│  - Port 8190: GPU 2 (CUDA:0)  │                               │
│  - Port 8191: GPU 3 (CUDA:1)  │                               │
│  Tunnel: gpu2/3.krhimanshu.in │                               │
└───────────────────────────────┘                               │
            │                                                   │
            └─────────────────────────┬─────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Google Drive Storage (RC) │
                        │  - On-Demand Model Stream │
                        │  - ~100-300 MB/s to /tmp  │
                        └───────────────────────────┘
```

---

## 🔑 Core Components

### 1. Unified VM State Machine (`vm_manager.py`)
- Tracks lifecycle of 6 independent GPU endpoints (`gpu0`, `gpu1`, `gpu2`, `gpu3`, `gcgpu`, `gcgpu1`).
- Provides 1-click startup, real-time step tracking (1 to 5), and in-band shutdown (`POST /vm-kill`).
- Isolates credential state per account under `~/.config/kaggle-pool/<acc>` and `~/.config/colab-pool/<acc>`.

### 2. High-Speed Rclone RC On-Demand Streaming
- Rather than waiting 15–20 minutes to download multiple large SDXL/Illustrious model checkpoints into persistent storage, instances launch in **~30–45 seconds**.
- An in-band Rclone Remote Control (RC) daemon dynamically streams checkpoints directly into RAM/Linux `/tmp` at **100–300 MB/s** when requested by the dashboard.

### 3. Dual-GPU Kaggle Quota Optimization
- A single Kaggle GPU notebook launches **two separate ComfyUI instances** bound to `CUDA:0` and `CUDA:1`.
- This unlocks **2x T4 GPUs** simultaneously while consuming only **1x Kaggle quota** meter (30h/week per account).
- With dual accounts, this provides up to **4x T4 GPUs** running in parallel across 60 hours/week.

### 4. Zero Quota Leakage (`/vm-kill`)
- Both Kaggle and Colab containers include an in-band HTTP sidecar listening on `/vm-kill`.
- Kaggle invokes `os._exit(0)` to immediately stop the kernel worker.
- Colab invokes `from google.colab import runtime; runtime.unassign()` to release the VM instance instantly.

### 5. Multi-Account Colab Support (`enroll_colab.py`)
- Standard Colab CLI tools lock to a single OS user keyring.
- Scriptoria isolates each account into Application Default Credentials (ADC) tokens in `~/.config/colab-pool/<acc>/adc.json`.
- Run `python enroll_colab.py <acc_alias>` to add accounts in seconds.

### 6. Vercel Serverless Deployment (`vercel.json` & `api/index.py`)
- The control plane can run as a serverless web app on Vercel.
- Kaggle launches are triggered via Kaggle's REST API.
- Live telemetry and ComfyUI prompts are routed directly through Cloudflare tunnels without requiring a 24/7 dedicated local server.

