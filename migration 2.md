Here is your End-to-End Execution & Migration Plan to transition Scriptoria from your current FastAPI + index.html setup to the Next.js 15 + SQLite + Google Drive (Rclone) + Route-less Tunnel architecture.
It is structured into 6 sequential phases so you can migrate, test personally with your Google Drive today, and flip a single switch when you are ready to open it to the public.
Phase 0: Legacy-to-Next.js Architecture Mapping
Before writing code, here is how every piece of your current Python project maps to the new Next.js codebase:
Legacy Python File	Responsibility	New Next.js 15 Location
.env / config.py	Static Kaggle keys, tunnel domains, GDrive config	prisma/schema.prisma (Credential & VmInstance tables) + src/lib/crypto/vault.ts (AES-256-GCM encrypted)
vm_manager.py	Global states dict, Kaggle push, /vm-kill calls	src/lib/orchestrator/notebook-builder.ts + kaggle-client.ts + vm-gateway.ts
notebooks/*.ipynb	Static notebook files for gpu0/gpu1/colab	Dynamically generated in-memory per user with Caddy (:8000) + 1 Route-less Tunnel + Rclone (:5572)
server.py	FastAPI endpoints (/toggle, /status, /run)	src/app/api/vm/..., src/app/api/models/..., src/app/api/workflow/...
log_broker.py	In-memory log ring buffer	SystemLog table + VM Heartbeat Payload
static/index.html	Monolithic 1,000+ line HTML/JS UI	src/app/(dashboard)/... + src/components/gpu/GpuCard.tsx + Studio + History
Phase 1: Project Scaffolding & Database Setup (10 Minutes)
1. Initialize the Next.js 15 Project
Run these commands in a new directory (or a v2-nextjs branch of your repo):
Bash
npx create-next-app@latest scriptoria-web --typescript --tailwind --eslint --app --src-dir
cd scriptoria-web

# Install Core Dependencies (ORM, Icons, State, Auth, Crypto)
npm install @prisma/client @libsql/client lucide-react zustand @tanstack/react-query jsonwebtoken bcryptjs
npm install -D prisma @types/jsonwebtoken @types/bcryptjs tsx

# Initialize Shadcn UI
npx shadcn@latest init -d
npx shadcn@latest add button card badge progress tabs dialog input label select toast
2. Configure .env.local
Create .env.local in your root folder:
Env
# Local SQLite for personal testing (Switch to Turso libsql:// URL when deploying to Vercel)
DATABASE_URL="file:./scriptoria.db"

# Master AES-256-GCM Vault Key (Generate once and keep secret)
ENCRYPTION_KEY="a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"

# Mode Switch: Keep "false" while testing personally; set "true" when launching to public
ALLOW_PUBLIC_REGISTRATION="false"

# Public URL where Kaggle/Colab VMs can send webhooks back to your Next.js server
NEXT_PUBLIC_APP_URL="https://your-app-domain.vercel.app"
3. Push the Prisma Schema
Place the schema.prisma (from our earlier step) into prisma/schema.prisma and initialize your local SQLite database:
Bash
npx prisma db push
Phase 2: One-Command Migration of Your .env & Google Drive Token
Instead of manually entering your existing Kaggle accounts and Google Drive token through the UI every time you reset, create a seed script at scripts/seed-personal.ts.
Run rclone authorize "drive" locally if you haven't grabbed the JSON string yet, then drop your credentials into this script and run it once:
TypeScript
// scripts/seed-personal.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptSecret } from "../src/lib/crypto/vault";

const prisma = new PrismaClient();

async function main() {
  // 1. Create Your Personal Admin Account
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@krhimanshu.in" },
    update: {},
    create: {
      email: "admin@krhimanshu.in",
      name: "Himanshu (Admin)",
      passwordHash,
      role: "ADMIN",
    },
  });

  // 2. Helper to encrypt and save a credential into the Vault
  async function saveCred(provider: string, alias: string, username: string, rawSecret: string, authType = "bearer") {
    const enc = encryptSecret(rawSecret);
    await prisma.credential.upsert({
      where: { userId_provider_accountAlias: { userId: admin.id, provider, accountAlias: alias } },
      update: { username, encryptedKey: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, authType },
      create: {
        userId: admin.id,
        provider,
        accountAlias: alias,
        username,
        encryptedKey: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        authType,
      },
    });
  }

  // 3. Migrate your Kaggle Accounts & Already-Setup Google Drive Token
  await saveCred("kaggle", "acc1", "YOUR_KAGGLE_USER_1", "YOUR_KAGGLE_KEY_1", "basic");
  await saveCred("kaggle", "acc2", "YOUR_KAGGLE_USER_2", "YOUR_KAGGLE_KEY_2", "basic");
  await saveCred(
    "gdrive",
    "default",
    "personal-drive",
    '{"access_token":"YOUR_RCLONE_DRIVE_JSON_TOKEN_HERE"}' // Paste your rclone token JSON here
  );

  // 4. Seed your 6 GPU Cluster Slots
  const targets = [
    { target: "gpu0", provider: "kaggle", accountAlias: "acc1" },
    { target: "gpu1", provider: "kaggle", accountAlias: "acc1" },
    { target: "gpu2", provider: "kaggle", accountAlias: "acc2" },
    { target: "gpu3", provider: "kaggle", accountAlias: "acc2" },
    { target: "gcgpu", provider: "colab", accountAlias: "colab1" },
    { target: "gcgpu1", provider: "colab", accountAlias: "colab2" },
  ];

  for (const t of targets) {
    await prisma.vmInstance.upsert({
      where: { userId_target: { userId: admin.id, target: t.target } },
      update: {},
      create: {
        userId: admin.id,
        target: t.target,
        provider: t.provider,
        accountAlias: t.accountAlias,
        publicUrl: "",
        status: "OFFLINE",
      },
    });
  }

  console.log("✅ Personal credentials, Google Drive Vault, and 6 GPU slots seeded!");
}

main().finally(() => prisma.$disconnect());
Run it with:
Bash
npx tsx scripts/seed-personal.ts
Phase 3: Upgrading the VM Bootstrap Script (Crucial ComfyUI + GDrive Link)
To make ComfyUI automatically load models streamed from your Google Drive into /tmp/models and save outputs into /tmp/outputs (without touching Kaggle's 20GB disk limit), create src/lib/orchestrator/notebook-builder.ts.
It injects ComfyUI's extra_model_paths.yaml and starts Caddy (:8000) + Rclone (:5572) + Dual ComfyUI (:8188, :8189) + Kill/Sidecar (:9999) + 1 Route-less Tunnel:
TypeScript
// src/lib/orchestrator/notebook-builder.ts

export interface NotebookBuildConfig {
  appWebhookUrl: string;
  registrationJwt: string;
  vmSecret: string;
  gdriveTokenJson: string;
  gpuTargets: [string, string]; // e.g., ["gpu0", "gpu1"]
}

export function buildUnifiedNotebookPythonCode(cfg: NotebookBuildConfig): string {
  return `
import os, sys, re, time, json, subprocess, threading, requests
from http.server import HTTPServer, BaseHTTPRequestHandler

APP_URL = "${cfg.appWebhookUrl}"
REG_JWT = "${cfg.registrationJwt}"
VM_SECRET = "${cfg.vmSecret}"
GDRIVE_TOKEN = '''${cfg.gdriveTokenJson}'''
TARGETS = ${JSON.stringify(cfg.gpuTargets)}
LAST_ACTIVE = time.time()

# 1. Create /tmp directories for Google Drive Model Streaming & Outputs
for d in ["checkpoints", "loras", "vae", "controlnet"]:
    os.makedirs(f"/tmp/models/{d}", exist_ok=True)
os.makedirs("/tmp/outputs", exist_ok=True)

# 2. Configure Rclone for Your Personal Google Drive
with open("/tmp/rclone.conf", "w") as f:
    f.write(f"[gdrive]\\ntype = drive\\nscope = drive\\ntoken = {GDRIVE_TOKEN}\\n")

os.system("curl -sL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o rclone.zip && unzip -qo rclone.zip && cp rclone-*-linux-amd64/rclone /usr/local/bin/")
subprocess.Popen([
    "rclone", "rcd", "--config", "/tmp/rclone.conf",
    "--rc-addr", "127.0.0.1:5572", "--rc-no-auth",
    "--drive-chunk-size", "128M", "--multi-thread-streams", "8", "--transfers", "8"
])

# 3. Install ComfyUI & point extra_model_paths.yaml to /tmp/models
if not os.path.exists("ComfyUI"):
    os.system("git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git")
    os.system("pip install -q -r ComfyUI/requirements.txt")

with open("/tmp/extra_model_paths.yaml", "w") as f:
    f.write("""
scriptoria_tmp:
    base_path: /tmp/models/
    checkpoints: checkpoints/
    loras: loras/
    vae: vae/
    controlnet: controlnet/
""")

# Boot Dual ComfyUI Instances (CUDA:0 on 8188, CUDA:1 on 8189)
for idx, port in enumerate([8188, 8189]):
    subprocess.Popen([
        "python3", "ComfyUI/main.py",
        "--port", str(port),
        "--cuda-device", str(idx),
        "--extra-model-paths-config", "/tmp/extra_model_paths.yaml",
        "--output-directory", "/tmp/outputs",
        "--enable-cors-header"
    ])

# 4. In-Band Control Server (Port 9999): Handles /vm-kill & GDrive Output Sync
class SidecarHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()
        if self.headers.get("X-VM-Secret") != VM_SECRET:
            self.send_response(403); self.end_headers(); return

        if self.path == "/vm-kill":
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status":"KILLED"}')
            threading.Thread(target=lambda: (time.sleep(1), os._exit(0))).start()

        elif self.path == "/sync-output":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            filename = body["filename"]
            date_dir = time.strftime("%Y-%m-%d")
            remote_path = f"Scriptoria/outputs/{date_dir}"

            # Copy from /tmp/outputs to Google Drive
            requests.post("http://127.0.0.1:5572/operations/copyfile", json={
                "srcFs": "/tmp/outputs", "srcRemote": filename,
                "dstFs": f"gdrive:{remote_path}", "dstRemote": filename
            })
            stat = requests.post("http://127.0.0.1:5572/operations/stat", json={
                "fs": f"gdrive:{remote_path}", "remote": filename
            }).json()
            file_id = stat.get("item", {}).get("ID", "")

            self.send_response(200); self.end_headers()
            self.wfile.write(json.dumps({"gdriveFileId": file_id}).encode())

threading.Thread(target=lambda: HTTPServer(("127.0.0.1", 9999), SidecarHandler).serve_forever(), daemon=True).start()

# 5. Start Caddy Port Multiplexer on Port 8000
os.system("curl -sL 'https://caddyserver.com/api/download?os=linux&arch=amd64' -o caddy && chmod +x caddy")
with open("/tmp/Caddyfile", "w") as f:
    f.write(f""":8000 {{
    @unauth not header X-VM-Secret "{VM_SECRET}"
    respond @unauth "Unauthorized" 403
    reverse_proxy 127.0.0.1:{{http.request.header.X-Target-Port}}
}}""")
subprocess.Popen(["./caddy", "run", "--config", "/tmp/Caddyfile"])

# 6. Start ONE Route-less Cloudflare Tunnel on Port 8000
os.system("curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared")
with open("/tmp/cf.log", "w") as out:
    subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"], stdout=out, stderr=subprocess.STDOUT)

tunnel_url = None
for _ in range(40):
    time.sleep(1)
    m = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", open("/tmp/cf.log").read())
    if m:
        tunnel_url = m.group(0)
        break

# 7. Register Tunnel URL back to Next.js & Start Heartbeat Loop
while True:
    try:
        requests.post(f"{APP_URL}/api/vm/heartbeat", json={
            "token": REG_JWT,
            "tunnelUrl": tunnel_url,
            "targets": TARGETS
        }, timeout=10)
    except Exception as e:
        print("Heartbeat error:", e)
    
    # 15-Minute Idle Zero-Quota Self-Kill Watchdog
    if time.time() - LAST_ACTIVE > 900:
        os._exit(0)
    time.sleep(20)
`.trim();
}
Phase 4: Backend API Routes Implementation Checklist
Create these 6 core API Route Handlers inside src/app/api/ to replace server.py:
POST /api/vm/[target]/toggle/route.ts
If OFFLINE: Fetches your decrypted kaggle + gdrive credentials from SQLite, generates the notebook script via buildUnifiedNotebookPythonCode(), and pushes to Kaggle REST API (kernels/push).
If ONLINE: Calls VmGateway.callPort(9999, "/vm-kill") to trigger os._exit(0) and sets status to OFFLINE.
POST /api/vm/heartbeat/route.ts
Receives the periodic 20s ping from the running VM, verifies REG_JWT, and updates publicUrl (the trycloudflare.com URL), status = "ONLINE", and lastHeartbeat = new Date() for both dual-GPU targets (gpu0 and gpu1).
GET /api/models/list/route.ts
Calls GDriveModelStreamer.listModelsInDrive() on Port 5572 to return all .safetensors files inside your gdrive:Scriptoria/models/checkpoints folder.
POST /api/models/stream/route.ts
Calls GDriveModelStreamer.startModelStream(modelName) on Port 5572 to pull a checkpoint from your Google Drive into /tmp/models/checkpoints at 250 MB/s, and returns live progress via /core/stats.
POST /api/workflow/run/route.ts
Sends the ComfyUI workflow JSON to Port 8188 (gpu0) or 8189 (gpu1).
Once ComfyUI outputs the file into /tmp/outputs, calls Port 9999 (/sync-output) so the VM uploads the image to gdrive:Scriptoria/outputs/YYYY-MM-DD/ and returns the permanent gdriveFileId.
Saves the gdriveFileId in the Job table in SQLite.
GET /api/outputs/[fileId]/route.ts
Streams the saved image directly from your Google Drive API v3 using your Vault's gdrive token so your History page works 24/7 even when all VMs are turned off.
Phase 5: Frontend UI Migration (index.html ➔ 4 Modular Views)
Break your single static/index.html into these 4 clean components inside src/app/(dashboard)/:
Text
src/app/(dashboard)/
├── layout.tsx                 # Topbar showing Active GPUs count & Quota burn timer
├── page.tsx                   # 1. CLUSTER VIEW: 6x <GpuCard /> grid + Boot/Kill controls
├── models/page.tsx            # 2. GDRIVE MODEL MANAGER: Lists your GDrive models + "Stream to /tmp" button
├── studio/page.tsx            # 3. PROMPT STUDIO: Prompt inputs, Model selector, Target GPU selector, Render canvas
├── history/page.tsx           # 4. PERMANENT GALLERY: Grid of <img src="/api/outputs/[fileId]" /> from GDrive
└── settings/vault/page.tsx    # 5. CREDENTIAL VAULT: Update Kaggle keys, Colab tokens, or GDrive JSON
Phase 6: Step-by-Step Testing & Cutover Plan
Follow this exact sequence to test your migration today without breaking your existing workflow:
Step 1: Local Webhook Tunnel (For Testing on Localhost)
Because your Kaggle notebook runs in Google's cloud, it needs a public URL to reach your local Next.js /api/vm/heartbeat route while you test locally.
Open a second terminal on your PC and run:
Bash
cloudflared tunnel --url http://localhost:3000
Copy the https://xxxx.trycloudflare.com URL it gives you and put it as NEXT_PUBLIC_APP_URL in your .env.local.
Step 2: Test the 4 Milestones One by One
Milestone 1 (Boot & Handshake): Click "Boot Cluster Node" on gpu0 in your new Next.js dashboard. Watch Kaggle spin up the dual-GPU kernel, start the single route-less tunnel, and automatically flip both gpu0 and gpu1 to ONLINE in your dashboard.
Milestone 2 (Google Drive Model Stream): Open the Models tab. Confirm it lists the .safetensors files from your Scriptoria/models/checkpoints Google Drive folder. Click "Stream to VM" on one checkpoint and watch the MB/s progress bar reach 100%.
Milestone 3 (Dual-GPU Generation & GDrive Auto-Save): Open Studio, select gpu0 (Port 8188) and gpu1 (Port 8189), and dispatch a test prompt to each simultaneously. Verify that the generated images appear in the UI and appear inside your Google Drive under Scriptoria/outputs/2026-11-11/.
Milestone 4 (Zero-Quota Kill & Offline Persistence): Click the Skull (Kill) button on gpu0. Verify the Kaggle kernel exits immediately (os._exit(0)), then go to the History tab and confirm your generated images still load from Google Drive while the VM is OFFLINE.
Step 3: Future Public Launch Switch
When your personal testing is complete and you are ready to publish Scriptoria for public users:
Switch DATABASE_URL from file:./scriptoria.db to a Turso (LibSQL) database URL and add Upstash Redis for heartbeats.
Change ALLOW_PUBLIC_REGISTRATION="true" in your environment variables.
Every new user who signs up will automatically get their own isolated Credential Vault to connect their own Kaggle accounts, Colab runtimes, and Google Drive.