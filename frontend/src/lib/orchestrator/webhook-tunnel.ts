import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { NextRequest } from "next/server";

export interface WebhookResolution {
  url: string;
  mode: "public" | "auto-tunnel" | "unreachable";
  reason?: string;
}

interface TunnelGlobalState {
  url: string | null;
  port: number;
  proc: ChildProcess | null;
  startingPromise: Promise<string | null> | null;
  exitHookRegistered: boolean;
}

const g = globalThis as typeof globalThis & {
  __scriptoriaLocalTunnel?: TunnelGlobalState;
};

function getTunnelState(): TunnelGlobalState {
  if (!g.__scriptoriaLocalTunnel) {
    g.__scriptoriaLocalTunnel = {
      url: null,
      port: 3000,
      proc: null,
      startingPromise: null,
      exitHookRegistered: false,
    };
  }
  return g.__scriptoriaLocalTunnel;
}

/**
 * Returns true if the URL points to loopback or private network space unreachable from Kaggle/Colab.
 */
export function isLocalOrPrivateUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return true;
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const m172 = host.match(/^172\.(\d+)\./);
    if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
    return false;
  } catch {
    return true;
  }
}

function getRequestPublicOrigin(req: NextRequest): string | null {
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const hostHeader = req.headers.get("host")?.trim();

  const candidateHost = fwdHost || hostHeader;
  if (candidateHost) {
    const proto =
      fwdProto ||
      (candidateHost.startsWith("localhost") || candidateHost.startsWith("127.0.0.1")
        ? "http"
        : "https");
    const candidate = `${proto}://${candidateHost}`.replace(/\/$/, "");
    if (!isLocalOrPrivateUrl(candidate)) {
      return candidate;
    }
  }

  const origin = req.nextUrl.origin.replace(/\/$/, "");
  return isLocalOrPrivateUrl(origin) ? null : origin;
}

export async function probeWebhookHealth(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function findCloudflaredBinary(): string | null {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      "C:\\Program Files\\cloudflared\\cloudflared.exe",
    ];
    for (const c of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
    }
  } else {
    const candidates = ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"];
    for (const c of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
    }
  }
  return "cloudflared";
}

function stopLocalTunnel(state: TunnelGlobalState) {
  if (state.proc && !state.proc.killed) {
    try {
      state.proc.kill();
    } catch {
      // ignore
    }
  }
  state.proc = null;
  state.url = null;
}

async function waitForPublicDnsPropagation(baseUrl: string): Promise<void> {
  try {
    const hostname = new URL(baseUrl).hostname;
    for (let i = 0; i < 8; i++) {
      try {
        const doh = await fetch(
          `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
          {
            headers: { Accept: "application/dns-json" },
            cache: "no-store",
            signal: AbortSignal.timeout(2000),
          }
        );
        if (doh.ok) {
          const data = (await doh.json()) as { Status?: number; Answer?: unknown[] };
          if (data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0) {
            return;
          }
        }
      } catch {
        // ignore transient DoH query blip
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch {
    // ignore URL parse issues
  }
}

/**
 * Starts or reuses a local `cloudflared` quick tunnel when running locally outside Vercel.
 */
export async function ensureLocalQuickTunnel(localPort = 3000): Promise<string | null> {
  if (process.env.VERCEL === "1" || process.env.DISABLE_AUTO_TUNNEL === "true") {
    return null;
  }

  const state = getTunnelState();

  // Reuse active running cloudflared process without tearing down a live tunnel across requests
  if (
    state.url &&
    state.port === localPort &&
    state.proc &&
    state.proc.exitCode === null &&
    !state.proc.killed
  ) {
    return state.url;
  }

  if (state.startingPromise) {
    return state.startingPromise;
  }

  state.startingPromise = (async () => {
    const bin = findCloudflaredBinary();
    if (!bin) return null;

    stopLocalTunnel(state);
    state.port = localPort;

    if (!state.exitHookRegistered) {
      state.exitHookRegistered = true;
      process.once("exit", () => stopLocalTunnel(state));
    }

    const foundUrl = await new Promise<string | null>((resolve) => {
      let resolved = false;
      let capturedUrl: string | null = null;
      let registered = false;

      const done = (val: string | null) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (regFallbackTimer) clearTimeout(regFallbackTimer);
          resolve(val);
        }
      };

      let regFallbackTimer: ReturnType<typeof setTimeout> | null = null;

      let child: ChildProcess;
      try {
        child = spawn(/*turbopackIgnore: true*/ bin, [
          "tunnel",
          "--url",
          `http://127.0.0.1:${localPort}`,
          "--no-autoupdate",
        ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch {
        done(null);
        return;
      }

      state.proc = child;
      const onChunk = (chunk: Buffer) => {
        const txt = chunk.toString("utf8");
        const match = txt.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match?.[0] && !capturedUrl) {
          capturedUrl = match[0];
          state.url = capturedUrl;
          // Give cloudflared up to 4s to finish edge connection registration if not logged yet
          if (registered) {
            done(capturedUrl);
          } else {
            regFallbackTimer = setTimeout(() => done(capturedUrl), 4000);
          }
        }
        if (/Registered tunnel connection/i.test(txt)) {
          registered = true;
          if (capturedUrl) done(capturedUrl);
        }
      };

      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);
      child.once("error", () => {
        stopLocalTunnel(state);
        done(null);
      });
      child.once("exit", () => {
        if (state.proc === child) {
          state.proc = null;
          state.url = null;
        }
        done(null);
      });

      const timer = setTimeout(() => done(capturedUrl), 18_000);
    });

    if (!foundUrl) return null;

    // Wait for Cloudflare public DNS (1.1.1.1) propagation without poisoning local Windows DNS cache
    await waitForPublicDnsPropagation(foundUrl);
    return foundUrl;
  })();

  try {
    return await state.startingPromise;
  } finally {
    state.startingPromise = null;
  }
}

export function peekActiveTunnelUrl(): string | null {
  const state = getTunnelState();
  return state.proc && !state.proc.killed ? state.url : null;
}

/**
 * Resolves a live, publicly reachable control plane URL for cloud GPUs (Kaggle / Colab)
 * without ever injecting stale quick-tunnel URLs or dead localhost links.
 */
export async function resolveReachableWebhookBaseUrl(
  req: NextRequest
): Promise<WebhookResolution> {
  // 1. Live public host from the incoming HTTP request (Vercel, custom domain, active tunnel)
  const reqPublic = getRequestPublicOrigin(req);
  if (reqPublic) {
    return { url: reqPublic, mode: "public" };
  }

  // 2. Configured NEXT_PUBLIC_APP_URL only if public AND verified alive
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (configured && !isLocalOrPrivateUrl(configured)) {
    const alive = await probeWebhookHealth(configured, 2500);
    if (alive) {
      return { url: configured, mode: "public" };
    }
  }

  // 3. Vercel deployment URL environment variables
  const vercelHost = (
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    ""
  ).trim();
  if (vercelHost) {
    const cleanVercel = `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    return { url: cleanVercel, mode: "public" };
  }

  // 4. Local Next.js server: spin up or reuse an ephemeral cloudflared tunnel automatically
  const localPort = Number(req.nextUrl.port || (req.nextUrl.protocol === "https:" ? 443 : 3000));
  const tunnelUrl = await ensureLocalQuickTunnel(Number.isFinite(localPort) ? localPort : 3000);
  if (tunnelUrl) {
    return { url: tunnelUrl, mode: "auto-tunnel" };
  }

  return {
    url: req.nextUrl.origin.replace(/\/$/, ""),
    mode: "unreachable",
    reason:
      "Control plane URL is local/unreachable from cloud GPUs. Deploy to Vercel, configure a live NEXT_PUBLIC_APP_URL, or ensure cloudflared is installed locally.",
  };
}

