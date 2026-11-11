# 🎨 Scriptoria

> **High-Performance Multi-Cloud GPU Orchestrator, ComfyUI Studio & Automation Suite**  
> Manage, schedule, and stream generative AI workloads seamlessly across **Kaggle Dual-GPU instances**, **Google Colab runtimes**, and a **Vercel Serverless Control Plane**.

---

## 🌟 Highlights

- **⚡ 6-GPU Multi-Cloud Cluster**:
  - **Kaggle Account 1 (`gpu0`, `gpu1`)**: 2x Tesla T4 GPUs on ports `8188` & `8189` consuming only **1x quota meter**.
  - **Kaggle Account 2 (`gpu2`, `gpu3`)**: 2x Tesla T4 GPUs on ports `8190` & `8191` unlocking an additional 30h/week quota.
  - **Google Colab (`gcgpu`, `gcgpu1`)**: On-demand T4 runtimes with isolated multi-account ADC credential management.
- **🚀 On-Demand Model Streaming (100–300 MB/s)**:
  - Eliminates 20-minute boot times. Checkpoints (SDXL, Illustrious, Flux) stream into Linux `/tmp` in seconds via Google Drive Rclone RC.
- **🛑 Zero Quota Leakage (`/vm-kill`)**:
  - Remote in-band shutdown sidecars automatically terminate containers (`os._exit(0)` / `runtime.unassign()`) so no cloud credits are wasted.
- **🌐 Real-Time Web Dashboard**:
  - Live 5-step provisioning steppers, GPU VRAM gauges, prompt dispatch test pad, live WebSocket CLI logs, and model catalogs.
- **☁️ Vercel Serverless Ready**:
  - Deploys as a lightweight serverless control plane on Vercel with zero server overhead.

---

## 📂 Repository Structure

```
Scriptoria/
├── api/
│   └── index.py             # Vercel Serverless Function entry point
├── docs/
│   ├── architecture.md      # Detailed cloud topology & design specifications
│   └── multi_account_colab.md # Multi-account Colab ADC setup guide
├── static/
│   └── index.html           # Dark-mode Web Dashboard & live telemetry UI
├── colab_bootstrap.py       # Colab runtime daemon & ComfyUI bootstrap
├── comfy_client.py          # Asynchronous ComfyUI REST & WebSocket client
├── comfy_ide_studio.py      # Terminal CLI suite for IDE workflows
├── config.py                # Pydantic environment & endpoint configuration
├── enroll_colab.py          # 1-Command CLI for enrolling new Google accounts
├── log_broker.py            # Circular buffer & WebSocket real-time log broker
├── notebook_generator.py    # Generates production Kaggle & Colab .ipynb runners
├── server.py                # FastAPI backend & telemetry hub
├── vm_manager.py            # Multi-cloud VM state machine & health poller
├── .env.example             # Configuration template
├── requirements.txt         # Python dependencies
├── vercel.json              # Vercel deployment configuration
└── start_dashboard.bat      # Windows 1-click dashboard launcher
```

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/Krhimanshu008/Scriptoria.git
cd Scriptoria
pip install -r requirements.txt
```

### 2. Environment Configuration
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
```
Fill in your Kaggle API keys, Cloudflare tunnel tokens, and Google OAuth credentials in `.env`.

### 3. Launching the Web Dashboard
```bash
# Windows 1-Click
start_dashboard.bat

# Or terminal:
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

---

## 💻 CLI & IDE Commands

You can interact with your cloud cluster directly from the terminal using `comfy_ide_studio.py`:

```bash
# Check status of all 6 cloud GPUs
python comfy_ide_studio.py vm-status

# Start or stop a specific GPU instance
python comfy_ide_studio.py vm-toggle --target gpu2

# In-band emergency stop (0 quota burn)
python comfy_ide_studio.py vm-stop --target gpu2

# Sync available model checkpoints and node catalog
python comfy_ide_studio.py sync-catalog --target gpu2

# Enroll an additional Google Colab account
python enroll_colab.py acc2
```

---

## 🔒 Security Best Practices

- All API keys, Google Drive tokens, and Cloudflare credentials are kept strictly in `.env`.
- Generated notebook runners and temporary session tokens in `notebooks/` are git-ignored.
- Containers communicate exclusively over authenticated Cloudflare Named Tunnels.

---

## 📄 License
MIT License. Built with ❤️ for generative AI automation.
