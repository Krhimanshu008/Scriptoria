# Scriptoria

> **Multi-Cloud GPU Orchestrator, ComfyUI Prompt Studio & Google Drive Model Streaming Platform**  
> Built with **Next.js 16 (App Router)**, **Prisma (SQLite / Turso LibSQL)**, **AES-256-GCM Encrypted Credential Vault**, **Rclone RC**, and **Route-less Caddy + Cloudflared Tunnels**.

---

## Architecture Highlights

- **6-GPU Multi-Account Cluster**:
  - **Kaggle Account 1 (`gpu0`, `gpu1`)**: Dual Tesla T4 (`CUDA_VISIBLE_DEVICES=0/1` on `:8188` & `:8189`) grouped by account with live weekly quota telemetry (`/api/vm/accounts`).
  - **Kaggle Account 2 (`gpu2`, `gpu3`)**: Dual Tesla T4 (`:8188` & `:8189`) providing an isolated second weekly quota pool.
  - **Google Colab (`gcgpu`, `gcgpu1`)**: On-demand T4 runtimes with browser Google account linking (`/api/auth/google/colab/{start,callback}`), 1-click setup cell copy (`?format=python`), and `.ipynb` export.
- **Route-less Ingress & Zero-Quota Sidecar**:
  - Containers run Caddy (`:8000`) authenticated via `X-VM-Secret` and `X-Target-Port`, exposed cleanly via ephemeral `cloudflared` quick tunnels reporting back to `/api/vm/heartbeat`.
  - In-band `/vm-kill` triggers immediate container shutdown (`os._exit(0)` / runtime unassign) via Sidecar (`:9999`) to prevent idle quota burn.
- **On-Demand Google Drive -> `/tmp` Streaming**:
  - Rclone Remote Control (`rclone rcd` on `127.0.0.1:5572`) streams checkpoints/LoRAs on demand into `/tmp/models/*` and auto-uploads rendered outputs back to Google Drive.
- **ComfyUI Prompt Studio & Presets**:
  - One-click SDXL/Illustrious presets (including 2-pass Latent Hires Fix) runnable via Scriptoria or pushable directly into a GPU's live ComfyUI WebUI sidebar (`/api/workflow/push-preset`).

---

## Repository Structure

```text
Scriptoria/
├── frontend/                  # Next.js 16 full-stack application (Vercel Root Directory)
│   ├── prisma/                # Prisma schema & Turso SQL init script
│   ├── scripts/               # DB seed, Turso init & credential migration scripts
│   └── src/
│       ├── app/               # App Router pages & REST API route handlers
│       ├── components/        # Modular UI components (GpuCard, LiveConsole, layout shell)
│       └── lib/               # Auth, AES-256-GCM Vault, GDrive, Prisma & VM orchestrators
├── docs/                      # Architecture notes & historical references
├── Migration.md               # Migration specification
└── PROJECT_MEMORY.md          # Project design notes
```

---

## Quick Start (Local Development)

```bash
cd frontend
cp .env.example .env.local
npm install
npm run db:push
npm run dev
```

Or build and start production mode locally:

```bash
cd frontend
npm run build
npm run start
```

### Vercel Production Setup

1. Set Vercel **Root Directory** to `frontend`.
2. Configure environment variables (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ENCRYPTION_KEY`, `JWT_SECRET`, `NEXT_PUBLIC_APP_URL`, `ALLOW_PUBLIC_REGISTRATION`, `GDRIVE_BASE_FOLDER`).
3. Deploy from `main` (Vercel runs `npm install` with `postinstall: prisma generate` and `npm run build`).
