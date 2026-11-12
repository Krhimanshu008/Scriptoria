import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential, mintGDriveAccessToken } from "@/lib/gdrive/client";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";

function formatBytesToTbOrGb(bytesStr?: string): string {
  const bytes = Number(bytesStr || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const tb = bytes / 1024 ** 4;
  if (tb >= 0.5) return `${tb.toFixed(2)} TB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatSeconds(sec: number): string {
  const mins = Math.max(0, Math.floor(sec / 60));
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, "0")}m`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const provider = String(body.provider || "").trim().toLowerCase();
    const accountAlias = String(body.accountAlias || "default").trim();

    if (!provider) {
      return NextResponse.json({ error: "provider is required." }, { status: 400 });
    }

    if (provider === "webhook") {
      const webhook = await resolveReachableWebhookBaseUrl(req);
      if (webhook.mode === "unreachable" || !webhook.url) {
        return NextResponse.json({
          ok: false,
          provider: "webhook",
          mode: webhook.mode,
          detail: webhook.reason || "No reachable public callback URL detected.",
        });
      }
      try {
        const healthRes = await fetch(`${webhook.url}/api/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!healthRes.ok) {
          return NextResponse.json({
            ok: false,
            provider: "webhook",
            mode: webhook.mode,
            url: webhook.url,
            detail: `Webhook URL responded with HTTP ${healthRes.status}.`,
          });
        }
        return NextResponse.json({
          ok: true,
          provider: "webhook",
          mode: webhook.mode,
          url: webhook.url,
          detail: `Reachable (${webhook.mode}) -> ${webhook.url}`,
        });
      } catch (err) {
        return NextResponse.json({
          ok: false,
          provider: "webhook",
          mode: webhook.mode,
          url: webhook.url,
          detail: err instanceof Error ? err.message : "Health check timed out",
        });
      }
    }

    if (provider === "gdrive") {
      const gdrive = await getUserGDriveCredential(user.userId);
      if (!gdrive) {
        return NextResponse.json(
          { ok: false, detail: "Google Drive credential not configured." },
          { status: 404 }
        );
      }

      const accessToken = await mintGDriveAccessToken(gdrive.parsed);
      const res = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json({
          ok: false,
          detail: `Google Drive API rejected token (${res.status}): ${text.slice(0, 140)}`,
        });
      }

      const data = (await res.json()) as {
        user?: { emailAddress?: string; displayName?: string };
        storageQuota?: { limit?: string; usage?: string };
      };
      const email = data.user?.emailAddress || "Connected Drive";
      const used = formatBytesToTbOrGb(data.storageQuota?.usage);
      const limit = data.storageQuota?.limit
        ? formatBytesToTbOrGb(data.storageQuota.limit)
        : "Unlimited";

      return NextResponse.json({
        ok: true,
        detail: `${email} · ${used} / ${limit} used · Base: ${gdrive.baseFolder}`,
        meta: { email, used, limit, baseFolder: gdrive.baseFolder },
      });
    }

    if (provider === "kaggle") {
      const cred = await getDecryptedCredential(user.userId, "kaggle", accountAlias);
      if (!cred || !cred.username) {
        return NextResponse.json(
          { ok: false, detail: `Kaggle (${accountAlias}) is not configured.` },
          { status: 404 }
        );
      }

      const quota = await KaggleOrchestrator.getQuota({
        username: cred.username,
        key: cred.secret,
        authType: cred.authType === "bearer" ? "bearer" : "basic",
      });

      return NextResponse.json({
        ok: true,
        detail: `${cred.username} · ${formatSeconds(quota.remainingSeconds)} / ${formatSeconds(quota.totalAllowedSeconds)} GPU quota left`,
        meta: quota,
      });
    }

    if (provider === "colab") {
      const cred = await getDecryptedCredential(user.userId, "colab", accountAlias);
      if (!cred) {
        return NextResponse.json(
          { ok: false, detail: `Colab (${accountAlias}) is not linked.` },
          { status: 404 }
        );
      }

      try {
        const parsed = JSON.parse(cred.secret) as {
          email?: string;
          manualLink?: boolean;
          refresh_token?: string;
          access_token?: string;
        };
        if (parsed.manualLink && !parsed.refresh_token) {
          return NextResponse.json({
            ok: true,
            detail: `Gmail bound (${parsed.email || cred.username}) · Self-renewing launcher ready`,
          });
        }

        if (parsed.refresh_token && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: parsed.refresh_token,
              grant_type: "refresh_token",
            }).toString(),
            signal: AbortSignal.timeout(10000),
          });
          if (!tokenRes.ok) {
            return NextResponse.json({
              ok: false,
              detail: `Colab Google OAuth refresh failed (${tokenRes.status}). Re-link Google account.`,
            });
          }
          return NextResponse.json({
            ok: true,
            detail: `Google OAuth active (${cred.username || parsed.email || accountAlias})`,
          });
        }

        return NextResponse.json({
          ok: true,
          detail: `Linked (${cred.username || parsed.email || accountAlias})`,
        });
      } catch {
        return NextResponse.json({
          ok: true,
          detail: `Configured (${cred.username || accountAlias})`,
        });
      }
    }

    if (provider === "huggingface") {
      const cred = await getDecryptedCredential(user.userId, "huggingface", accountAlias);
      if (!cred) {
        return NextResponse.json(
          { ok: false, detail: "HuggingFace token not configured." },
          { status: 404 }
        );
      }

      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${cred.secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          detail: `HuggingFace rejected token (${res.status}). Check read scope.`,
        });
      }
      const data = (await res.json()) as { name?: string; type?: string };
      return NextResponse.json({
        ok: true,
        detail: `Verified HF user: @${data.name || "user"} (${data.type || "user"})`,
      });
    }

    if (provider === "civitai") {
      const cred = await getDecryptedCredential(user.userId, "civitai", accountAlias);
      if (!cred) {
        return NextResponse.json(
          { ok: false, detail: "Civitai API key not configured." },
          { status: 404 }
        );
      }

      const res = await fetch("https://civitai.com/api/v1/me", {
        headers: { Authorization: `Bearer ${cred.secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          detail: `Civitai rejected API key (${res.status}).`,
        });
      }
      const data = (await res.json()) as { username?: string };
      return NextResponse.json({
        ok: true,
        detail: `Verified Civitai user: ${data.username || "authenticated"}`,
      });
    }

    if (provider === "llm") {
      const cred = await getDecryptedCredential(user.userId, "llm", accountAlias);
      if (!cred) {
        return NextResponse.json(
          { ok: false, detail: `LLM credential '${accountAlias}' not configured.` },
          { status: 404 }
        );
      }
      const meta = (cred.metadata || {}) as {
        llmProvider?: string;
        model?: string;
        baseUrl?: string;
      };
      const llmProvider = (meta.llmProvider || accountAlias || "gemini").toLowerCase();

      if (llmProvider === "gemini") {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=5", {
          headers: { "x-goog-api-key": cred.secret },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          return NextResponse.json({
            ok: false,
            detail: `Gemini API rejected key (${res.status}).`,
          });
        }
        return NextResponse.json({
          ok: true,
          detail: `Gemini API verified · Model: ${meta.model || cred.username || "gemini-2.5-flash"}`,
        });
      }

      const defaultBase =
        llmProvider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : llmProvider === "ollama"
          ? "http://127.0.0.1:11434/v1"
          : "https://api.openai.com/v1";
      const baseUrl = (meta.baseUrl || defaultBase).replace(/\/$/, "");
      const headers: Record<string, string> = {};
      if (cred.secret && cred.secret !== "ollama") {
        headers["Authorization"] = `Bearer ${cred.secret}`;
      }

      const res = await fetch(`${baseUrl}/models`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          detail: `${llmProvider.toUpperCase()} endpoint returned HTTP ${res.status}.`,
        });
      }
      return NextResponse.json({
        ok: true,
        detail: `${llmProvider.toUpperCase()} verified · Model: ${meta.model || cred.username || "default"}`,
      });
    }

    return NextResponse.json(
      { ok: false, detail: `Unsupported test provider '${provider}'.` },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Credential test failed";
    return NextResponse.json({ ok: false, detail: message }, { status: 200 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
