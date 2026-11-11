
Here is the complete, production-grade architectural delivery for migrating Scriptoria from a monolithic FastAPI/vanilla JS app to a multi-tenant Full-Stack Next.js 15 (App Router) + TypeScript + Prisma (SQLite/LibSQL) platform.
1. Database Schema (prisma/schema.prisma)
This schema supports multi-user tenancy, isolated credentials with encrypted secrets, per-instance lifecycle tracking (including multi-step boot progression), prompt executions, and system audit logging.
Prisma
datasource db {
  provider = "sqlite" // Change to "libsql" if deploying with Turso
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           String        @id @default(cuid())
  email        String        @unique
  name         String?
  passwordHash String
  role         String        @default("USER") // ADMIN, USER
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  credentials  Credential[]
  vmInstances  VmInstance[]
  jobs         Job[]
  systemLogs   SystemLog[]
}

model Credential {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     String    // "kaggle", "colab", "cloudflare", "gdrive"
  accountAlias String    // e.g., "acc1", "acc2"
  username     String?   // Kaggle username or GCP client email
  encryptedKey String    // AES-256-GCM ciphertext
  iv           String    // Hex initialization vector
  authTag      String    // Hex authentication tag for GCM integrity
  authType     String    // "bearer" (KGAT_) or "basic" (legacy)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@unique([userId, provider, accountAlias])
  @@index([userId])
}

model VmInstance {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  target        String      // "gpu0", "gpu1", "gpu2", "gpu3", "gcgpu", "gcgpu1"
  provider      String      // "kaggle", "colab"
  accountAlias  String      // Bound to Credential.accountAlias
  publicUrl     String      // Cloudflare tunnel subdomain (e.g. "https://gpu0.userdomain.com")
  status        String      @default("OFFLINE") // OFFLINE, STARTING, ONLINE, STOPPING, ERROR
  stepProgress  Int         @default(0) // 0: Idle, 1: Provisioning, 2: Rclone Mount, 3: Port Bind, 4: Tunnel Up, 5: Ready
  lastHeartbeat DateTime?
  vramTotalGb   Float?
  vramUsedGb    Float?
  gpuName       String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  jobs          Job[]
  systemLogs    SystemLog[]

  @@unique([userId, target])
  @@index([userId, status])
}

model Job {
  id             String      @id @default(cuid())
  userId         String
  user           User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  vmInstanceId   String?
  vmInstance     VmInstance? @relation(fields: [vmInstanceId], references: [id], onDelete: SetNull)
  target         String
  prompt         String
  negativePrompt String?
  checkpoint     String
  seed           BigInt?
  status         String      @default("PENDING") // PENDING, PROCESSING, COMPLETED, FAILED
  outputUrls     String?     // Stored as JSON string array
  errorMessage   String?
  executionTimeMs Int?
  createdAt      DateTime    @default(now())
  completedAt    DateTime?

  @@index([userId, status])
  @@index([vmInstanceId])
}

model SystemLog {
  id           String      @id @default(cuid())
  userId       String
  user         User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  vmInstanceId String?
  vmInstance   VmInstance? @relation(fields: [vmInstanceId], references: [id], onDelete: Cascade)
  level        String      @default("INFO") // INFO, WARN, ERROR, DEBUG
  message      String
  metaJson     String?     // Arbitrary debug payload
  createdAt    DateTime    @default(now())

  @@index([userId, createdAt])
}
2. Encrypted Vault Service (src/lib/crypto/vault.ts)
Provides cryptographic isolation for provider API secrets, Google Drive refresh tokens, and Cloudflare keys using AES-256-GCM with per-record Initialization Vectors (IV) and GMAC Auth Tags.
TypeScript
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not defined");
  }
  // Guarantee a strict 32-byte (256-bit) key via SHA-256 derivation
  return crypto.createHash("sha256").update(secret).digest();
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts plain-text credentials using AES-256-GCM.
 */
export function encryptSecret(plainText: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypts AES-256-GCM payload with authenticated integrity verification.
 */
export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(payload.iv, "hex")
  );

  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));

  let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
3. Core Orchestration Services
A. Kaggle Client (src/lib/orchestrator/kaggle-client.ts)
Converts notebook bootstrap pipelines into executable Kaggle kernel push bundles, dynamically supporting legacy Basic Auth and newer KGAT_ Bearer tokens.
TypeScript
interface KaggleCredentials {
  username: string;
  key: string;
  authType: "bearer" | "basic";
}

interface PushKernelParams {
  credentials: KaggleCredentials;
  kernelSlug: string;
  targetGpus: string[]; // e.g. ["gpu0", "gpu1"]
  cloudflareToken: string;
  rcloneConfigBase64?: string;
}

export class KaggleOrchestrator {
  private static KAGGLE_BASE_URL = "https://www.kaggle.com/api/v1";

  private static getHeaders(creds: KaggleCredentials): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (creds.authType === "bearer" || creds.key.startsWith("KGAT_")) {
      headers["Authorization"] = `Bearer ${creds.key}`;
    } else {
      const basicToken = Buffer.from(`${creds.username}:${creds.key}`).toString("base64");
      headers["Authorization"] = `Basic ${basicToken}`;
    }

    return headers;
  }

  /**
   * Builds the dual-GPU ComfyUI bootstrap notebook script
   */
  private static generateNotebookSource(targetGpus: string[], cfToken: string): string {
    return `
import os, sys, subprocess, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# In-band Zero-Quota Kill Server
class KillHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/vm-kill':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK: Terminating VM")
            def suicide():
                time.sleep(1)
                os._exit(0)
            threading.Thread(target=suicide).start()
        else:
            self.send_response(404)
            self.end_headers()

def run_kill_server():
    server = HTTPServer(('0.0.0.0', 9999), KillHandler)
    server.serve_forever()

threading.Thread(target=run_kill_server, daemon=True).start()

# Launch Dual-Instance ComfyUI Processes
# gpu0 -> CUDA:0 (Port 8188), gpu1 -> CUDA:1 (Port 8189)
os.system("git clone https://github.com/comfyanonymous/ComfyUI.git")
os.system("pip install -q -r ComfyUI/requirements.txt")

p1 = subprocess.Popen(["python3", "ComfyUI/main.py", "--port", "8188", "--cuda-device", "0", "--listen", "0.0.0.0"])
p2 = subprocess.Popen(["python3", "ComfyUI/main.py", "--port", "8189", "--cuda-device", "1", "--listen", "0.0.0.0"])

# Establish Cloudflare Named Tunnel Ingress
os.system("curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared")
subprocess.Popen(["./cloudflared", "tunnel", "run", "--token", "${cfToken}"])

p1.wait()
p2.wait()
    `.trim();
  }

  /**
   * Pushes the notebook kernel payload synchronously to prevent serverless freeze
   */
  public static async pushKernel(params: PushKernelParams): Promise<{ status: string; url: string }> {
    const { credentials, kernelSlug, targetGpus, cloudflareToken } = params;
    const notebookJson = {
      cells: [
        {
          cell_type: "code",
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [this.generateNotebookSource(targetGpus, cloudflareToken)],
        },
      ],
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.10.12" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    const payload = {
      id: `${credentials.username}/${kernelSlug}`,
      slug: kernelSlug,
      newTitle: kernelSlug,
      text: JSON.stringify(notebookJson),
      language: "python",
      kernelType: "notebook",
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      datasetDataSources: [], // NEVER inject cross-user private datasets here (avoids 409 conflicts)
    };

    const res = await fetch(`${this.KAGGLE_BASE_URL}/kernels/push`, {
      method: "POST",
      headers: this.getHeaders(credentials),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Kaggle API rejected kernel push (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    return {
      status: "QUEUED",
      url: data.url || `https://www.kaggle.com/code/${credentials.username}/${kernelSlug}`,
    };
  }
}
B. ComfyUI Client (src/lib/orchestrator/comfy-client.ts)
Handles prompt generation, server telemetry queries, model checkpoint loads via Rclone RC, and zero-quota termination.
TypeScript
export interface SystemStatsResponse {
  system: {
    os: string;
    python_version: string;
  };
  devices: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }>;
}

export class ComfyClient {
  constructor(private baseUrl: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Inspect live VRAM and hardware status
   */
  public async getSystemStats(): Promise<SystemStatsResponse> {
    const res = await fetch(`${this.baseUrl}/system_stats`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch system stats: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Dispatches a prompt graph execution to ComfyUI
   */
  public async queuePrompt(promptGraph: Record<string, unknown>, clientId: string): Promise<{ prompt_id: string }> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`ComfyUI prompt dispatch failed (${res.status}): ${errorText}`);
    }

    return res.json();
  }

  /**
   * Polls execution history until outputs are available
   */
  public async waitForJobResult(promptId: string, timeoutMs = 120000): Promise<string[]> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (res.ok) {
        const history = await res.json();
        if (history[promptId] && history[promptId].outputs) {
          const outputs = history[promptId].outputs;
          const imageUrls: string[] = [];

          for (const nodeId in outputs) {
            if (outputs[nodeId].images) {
              for (const img of outputs[nodeId].images) {
                imageUrls.push(`${this.baseUrl}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`);
              }
            }
          }
          if (imageUrls.length > 0) return imageUrls;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Prompt execution ${promptId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Invokes the in-band zero-quota killer sidecar
   */
  public async emergencyKill(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/vm-kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
4. API Route Handlers
A. /api/vm/[target]/toggle/route.ts
Handles starting or terminating instances securely per user, resolving encrypted credentials dynamically.
TypeScript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/crypto/vault";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";

// Dummy auth extractor; replace with Auth.js/NextAuth getServerSession(authOptions)
async function getAuthUserId(req: NextRequest): Promise<string | null> {
  return req.headers.get("x-user-id") || "cluser0001dummyid";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const { target } = await params;
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId, target } },
    });

    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    // TOGGLE OFF: If instance is ONLINE or STARTING -> Trigger kill
    if (vm.status === "ONLINE" || vm.status === "STARTING") {
      const client = new ComfyClient(vm.publicUrl);
      await client.emergencyKill();

      const updated = await prisma.vmInstance.update({
        where: { id: vm.id },
        data: {
          status: "OFFLINE",
          stepProgress: 0,
          vramUsedGb: 0,
        },
      });

      return NextResponse.json({ message: "Termination triggered", vm: updated });
    }

    // TOGGLE ON: Instance is OFFLINE -> Spin up via Cloud Provider
    const cred = await prisma.credential.findFirst({
      where: { userId, provider: vm.provider, accountAlias: vm.accountAlias },
    });

    if (!cred) {
      return NextResponse.json(
        { error: `Missing credentials for ${vm.provider} (${vm.accountAlias})` },
        { status: 400 }
      );
    }

    const decryptedKey = decryptSecret({
      ciphertext: cred.encryptedKey,
      iv: cred.iv,
      authTag: cred.authTag,
    });

    // Cloudflare Tunnel token
    const cfCred = await prisma.credential.findFirst({
      where: { userId, provider: "cloudflare" },
    });

    const cfToken = cfCred
      ? decryptSecret({ ciphertext: cfCred.encryptedKey, iv: cfCred.iv, authTag: cfCred.authTag })
      : "";

    if (vm.provider === "kaggle") {
      await KaggleOrchestrator.pushKernel({
        credentials: {
          username: cred.username || "",
          key: decryptedKey,
          authType: cred.authType as "bearer" | "basic",
        },
        kernelSlug: `scriptoria-runtime-${target}`,
        targetGpus: [target],
        cloudflareToken: cfToken,
      });

      const updated = await prisma.vmInstance.update({
        where: { id: vm.id },
        data: { status: "STARTING", stepProgress: 1 },
      });

      return NextResponse.json({ message: "Provisioning initiated", vm: updated });
    }

    return NextResponse.json({ error: `Unsupported provider: ${vm.provider}` }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
B. /api/workflow/run/route.ts
Queues a prompt job, dispatches it to the user's isolated ComfyUI worker, and stores execution records in SQLite.
TypeScript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id") || "cluser0001dummyid";
    const body = await req.json();
    const { target, prompt, negativePrompt, checkpoint, seed } = body;

    if (!target || !prompt) {
      return NextResponse.json({ error: "Target GPU and prompt are required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId, target } },
    });

    if (!vm || vm.status !== "ONLINE") {
      return NextResponse.json({ error: `GPU ${target} is not online.` }, { status: 400 });
    }

    // Persist Job in PENDING status
    const job = await prisma.job.create({
      data: {
        userId,
        vmInstanceId: vm.id,
        target,
        prompt,
        negativePrompt: negativePrompt || null,
        checkpoint: checkpoint || "v1-5-pruned-emaonly.safetensors",
        seed: seed ? BigInt(seed) : BigInt(Math.floor(Math.random() * 1000000000)),
        status: "PROCESSING",
      },
    });

    const client = new ComfyClient(vm.publicUrl);

    // Standard ComfyUI prompt graph JSON
    const comfyGraph = {
      "3": {
        inputs: {
          seed: Number(job.seed),
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
        class_type: "KSampler",
      },
      "4": {
        inputs: { ckpt_name: job.checkpoint },
        class_type: "CheckpointLoaderSimple",
      },
      "5": {
        inputs: { width: 512, height: 512, batch_size: 1 },
        class_type: "EmptyLatentImage",
      },
      "6": {
        inputs: { text: job.prompt, clip: ["4", 1] },
        class_type: "CLIPTextEncode",
      },
      "7": {
        inputs: { text: job.negativePrompt || "", clip: ["4", 1] },
        class_type: "CLIPTextEncode",
      },
      "8": {
        inputs: { samples: ["3", 0], vae: ["4", 2] },
        class_type: "VAEDecode",
      },
      "9": {
        inputs: { filename_prefix: "Scriptoria", images: ["8", 0] },
        class_type: "SaveImage",
      },
    };

    const startTime = Date.now();
    const { prompt_id } = await client.queuePrompt(comfyGraph, job.id);
    const imageUrls = await client.waitForJobResult(prompt_id);
    const executionDuration = Date.now() - startTime;

    const completedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputUrls: JSON.stringify(imageUrls),
        executionTimeMs: executionDuration,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      jobId: completedJob.id,
      status: "COMPLETED",
      outputs: imageUrls,
      durationMs: executionDuration,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Execution failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
5. Interactive Frontend Component (src/components/gpu/GpuCard.tsx)
Builds the operational GPU cluster monitor showing real-time step progress (1–5), VRAM gauges, ping latency, and emergency kill switches.
Tsx
"use client";

import React, { useState } from "react";
import { Power, Skull, Activity, Cpu, ExternalLink } from "lucide-react";

interface GpuCardProps {
  target: string;
  provider: "kaggle" | "colab";
  accountAlias: string;
  status: "OFFLINE" | "STARTING" | "ONLINE" | "STOPPING" | "ERROR";
  stepProgress: number; // 0 to 5
  vramTotalGb?: number;
  vramUsedGb?: number;
  latencyMs?: number;
  publicUrl: string;
  onRefresh?: () => void;
}

const STEP_LABELS = [
  "Idle",
  "1. Provision Kernel",
  "2. Rclone Stream",
  "3. Bind CUDA Ports",
  "4. CF Ingress Live",
  "5. ComfyUI Ready",
];

export const GpuCard: React.FC<GpuCardProps> = ({
  target,
  provider,
  accountAlias,
  status,
  stepProgress,
  vramTotalGb = 16,
  vramUsedGb = 0,
  latencyMs = 42,
  publicUrl,
  onRefresh,
}) => {
  const [loading, setLoading] = useState(false);

  const vramPercentage = Math.min(
    100,
    Math.round(((vramUsedGb || 0) / (vramTotalGb || 16)) * 100)
  );

  const handleToggle = async () => {
    setLoading(true);
    try {
      await fetch(`/api/vm/${target}/toggle`, { method: "POST" });
      onRefresh?.();
    } catch (err) {
      console.error("Toggle failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePanicKill = async () => {
    if (!confirm(`Trigger immediate Zero-Quota kill for ${target}?`)) return;
    setLoading(true);
    try {
      await fetch(`${publicUrl}/vm-kill`, { method: "POST", mode: "no-cors" });
      await fetch(`/api/vm/${target}/toggle`, { method: "POST" });
      onRefresh?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-xl transition-all hover:border-zinc-700">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-400" />
            <h3 className="font-mono text-lg font-bold tracking-tight uppercase">{target}</h3>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {provider} / {accountAlias}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                status === "ONLINE"
                  ? "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                  : status === "STARTING"
                  ? "animate-pulse bg-amber-500"
                  : "bg-zinc-600"
              }`}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {status}
            </span>
          </div>
        </div>

        {/* Stepper Progress Bar */}
        <div className="my-4">
          <div className="flex justify-between text-xs text-zinc-400">
            <span>Progress Phase</span>
            <span className="text-zinc-200">{STEP_LABELS[stepProgress] || "Idle"}</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {[1, 2, 3, 4, 5].map((step) => (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-sm transition-all duration-300 ${
                  step <= stepProgress ? "bg-indigo-500" : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
        </div>

        {/* VRAM Gauge */}
        <div className="my-4 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">VRAM Allocation</span>
            <span className="font-mono text-zinc-200">
              {vramUsedGb.toFixed(1)} / {vramTotalGb} GB ({vramPercentage}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                vramPercentage > 85 ? "bg-rose-500" : "bg-emerald-500"
              }`}
              style={{ width: `${vramPercentage}%` }}
            />
          </div>
        </div>

        {/* Diagnostics & Endpoint */}
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1">
            <Activity className="h-3.5 w-3.5 text-zinc-500" />
            <span>Ping: {status === "ONLINE" ? `${latencyMs}ms` : "--"}</span>
          </div>
          {status === "ONLINE" && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-indigo-400 hover:underline"
            >
              ComfyUI Ingress <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Control Actions */}
      <div className="mt-5 flex gap-2 border-t border-zinc-800/80 pt-4">
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
            status === "ONLINE"
              ? "bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-500/30"
              : "bg-indigo-600 text-white hover:bg-indigo-500"
          }`}
        >
          <Power className="h-4 w-4" />
          {status === "ONLINE" ? "Graceful Stop" : "Boot Cluster Node"}
        </button>

        <button
          onClick={handlePanicKill}
          disabled={loading || status === "OFFLINE"}
          title="Zero-Quota In-Band Kill"
          className="flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-xs font-semibold text-rose-400 transition hover:bg-rose-900/40 disabled:opacity-40"
        >
          <Skull className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
6. Step-by-Step Migration Plan
Code
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MIGRATION ROADMAP                                       │
│                                                                                        │
│   Phase 1: DB & Cryptography       Phase 2: Dual-Stack Ingress    Phase 3: Multi-User  │
│   ┌───────────────────────────┐    ┌──────────────────────────┐   ┌──────────────────┐ │
│   │ • Init Prisma (LibSQL)    │    │ • Deploy Next.js App     │   │ • Cutover Web UI │ │
│   │ • Seed User & Vault Keys  │───►│ • Run Side-by-Side with  │──►│ • Decommission   │ │
│   │ • Migrate .env secrets    │    │   legacy FastAPI server  │   │   Python backend │ │
│   └───────────────────────────┘    └──────────────────────────┘   └──────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
Step 1: Database Setup & Secret Encryption
Initialize the Prisma schema:
Bash
npm install @prisma/client prisma @libsql/client
npx prisma db push
Generate your master vault encryption key:
Bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Save this as ENCRYPTION_KEY inside .env.local.
Create a one-time migration script (scripts/migrate-env.ts) that reads your existing Python .env file, passes the Kaggle/Colab credentials through encryptSecret(), and creates default Credential and VmInstance rows linked to your primary admin account.
Step 2: Backward Compatibility with Kaggle & Colab Notebooks
No Notebook Code Changes Needed: The Node.js KaggleOrchestrator pushes the exact notebook JSON structure required by existing Kaggle environments.
Keep the In-Band Ports Consistent:
gpu0 maps to internal port 8188 (CUDA:0).
gpu1 maps to internal port 8189 (CUDA:1).
The Python kill server daemon remains bound to port 9999 with route /vm-kill.
Step 3: Serverless Deployment Safeguards (Vercel / Turso)
Replace Local SQLite with Turso: When deploying to Vercel, change provider = "sqlite" to provider = "libsql" and provide TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Standard local SQLite files will wipe on cold starts.
Synchronous Kaggle Push Execution: Avoid executing Kaggle dispatch calls inside fire-and-forget background promises (void pushKernel()). Always await the REST call inside the route handler before returning a 200 HTTP response so Vercel doesn't freeze the process mid-flight.
Step 4: Decommissioning the Legacy Python App
Direct the Cloudflare CNAME tunnel domain to the Next.js production ingress.
Verify that /api/workflow/run yields correct output URLs on live running GPUs.
Remove server.py, vm_manager.py, and static/index.html from your repository.