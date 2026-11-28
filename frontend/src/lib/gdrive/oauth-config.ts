import type { NextRequest } from "next/server";

export const GDRIVE_OAUTH_NONCE_COOKIE = "scriptoria_gdrive_oauth_nonce";

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  source: "vault" | "env" | "mixed" | "none";
}

export interface GDriveTokenShape {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  token_type?: string;
  expiry?: string;
  expires_in?: number;
  scope?: string;
  email?: string;
  [key: string]: unknown;
}

export interface GDriveTokenHealth {
  hasRefreshToken: boolean;
  hasClientCredentials: boolean;
  oauthClientConfigured: boolean;
  accessTokenExpired: boolean;
  accessTokenExpiresAt: string | null;
  refreshTokenIssuedAt: string | null;
  lastRefreshedAt: string | null;
  lastRefreshError: string | null;
  refreshTokenAgeDays: number | null;
  likelyRevoked: boolean;
  expiringSoonWarning: boolean;
}

/**
 * Resolves Google OAuth Client ID and Secret across Vault credentials and all
 * supported environment variable aliases (Vercel/local .env compatibility).
 */
export function getGoogleOAuthClientConfig(
  parsed?: { client_id?: unknown; client_secret?: unknown } | null
): GoogleOAuthClientConfig {
  const vaultId = typeof parsed?.client_id === "string" ? parsed.client_id.trim() : "";
  const vaultSecret =
    typeof parsed?.client_secret === "string" ? parsed.client_secret.trim() : "";

  const envId =
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.GDRIVE_CLIENT_ID?.trim() ||
    process.env.CLIENT_ID?.trim() ||
    "";

  const envSecret =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GDRIVE_CLIENT_SECRET?.trim() ||
    process.env.SECRET?.trim() ||
    "";

  // Never mix one OAuth client ID from Vault with another project's secret from Env.
  if (vaultId && vaultSecret) {
    return { clientId: vaultId, clientSecret: vaultSecret, source: "vault" };
  }
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: "env" };
  }

  const clientId = vaultId || envId;
  const clientSecret = vaultSecret || envSecret;
  const source: GoogleOAuthClientConfig["source"] =
    clientId && clientSecret
      ? "mixed"
      : vaultId || vaultSecret
      ? "vault"
      : clientId || clientSecret
      ? "env"
      : "none";

  return { clientId, clientSecret, source };
}

export function getOAuthStateSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("JWT_SECRET or ENCRYPTION_KEY is not configured");
  return secret;
}

function isUnroutableBindHost(hostOrUrl: string): boolean {
  return /^(https?:\/\/)?(0\.0\.0\.0|\[::\]|::)(:\d+)?(\/|$)/i.test(hostOrUrl.trim());
}

/**
 * Resolves the external browser-facing request origin even when running behind a reverse proxy
 * (e.g. Docker / standalone `next start` bound to `0.0.0.0:3000` behind Caddy/Nginx/Vercel).
 */
export function resolveRequestOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const headerHost = req.headers.get("host")?.trim();
  const host =
    (fwdHost && !isUnroutableBindHost(fwdHost) ? fwdHost : "") ||
    (headerHost && !isUnroutableBindHost(headerHost) ? headerHost : "");

  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");

  if (host) {
    const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto =
      fwdProto ||
      (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
        ? "http"
        : req.nextUrl.protocol.replace(/:$/, "") || "https");
    return `${proto}://${host}`;
  }

  if (configured && !isUnroutableBindHost(configured)) {
    return configured;
  }
  if (!isUnroutableBindHost(req.nextUrl.origin)) {
    return req.nextUrl.origin;
  }
  return configured || req.nextUrl.origin;
}

export function resolveOAuthCallbackOrigin(req: NextRequest): string {
  const origin = resolveRequestOrigin(req);
  let hostname = req.nextUrl.hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    // keep nextUrl hostname
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return origin;
  }
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (
    configured &&
    !isUnroutableBindHost(configured) &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)
  ) {
    // Keep same public HTTPS origin when possible so session/nonce cookies match the callback host.
    if (origin.startsWith("https://")) {
      return origin;
    }
    return configured;
  }
  return origin;
}

/**
 * Formats Google API 403 `SERVICE_DISABLED` responses cleanly with a direct GCP enable URL.
 */
export function formatGoogleDriveApiError(status: number, rawBody: string): string {
  const trimmed = rawBody.trim();
  let message = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      message = parsed.error.message;
    }
  } catch {
    // keep raw text
  }
  const projectMatch =
    message.match(/project\s+(\d{6,20})/i) || trimmed.match(/project=(\d{6,20})/i);
  if (status === 403 && (/has not been used in project/i.test(message) || /accessNotConfigured/i.test(trimmed))) {
    const projectId = projectMatch?.[1];
    const enableUrl = projectId
      ? `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${projectId}`
      : "https://console.cloud.google.com/apis/library/drive.googleapis.com";
    return `Google Drive API is disabled for GCP project ${projectId || "(your project)"}. Enable it once here and retry: ${enableUrl}`;
  }
  return `Google Drive API rejected token (${status}): ${message.slice(0, 260)}`;
}

/**
 * Normalizes either raw Rclone OAuth JSON or a full `rclone config` snippet containing `token = {...}`,
 * enriching missing `client_id` and `client_secret` from explicit overrides or environment.
 */
export function normalizeRcloneGdrivePayload(
  rawInput: string,
  overrides?: { clientId?: string; clientSecret?: string }
): { payload: GDriveTokenShape; serialized: string } {
  let candidate = rawInput.trim();

  // Extract token JSON if user pasted full `[gdrive]\n...\ntoken = {...}` block
  const tokenLineMatch = candidate.match(/^\s*token\s*=\s*(\{[\s\S]*?\})\s*$/m);
  if (tokenLineMatch?.[1]) {
    const clientIdMatch = candidate.match(/^\s*client_id\s*=\s*(\S+)\s*$/m);
    const clientSecretMatch = candidate.match(/^\s*client_secret\s*=\s*(\S+)\s*$/m);
    const parsedInner = JSON.parse(tokenLineMatch[1]) as GDriveTokenShape;
    if (!parsedInner.client_id && clientIdMatch?.[1]) {
      parsedInner.client_id = clientIdMatch[1].trim();
    }
    if (!parsedInner.client_secret && clientSecretMatch?.[1]) {
      parsedInner.client_secret = clientSecretMatch[1].trim();
    }
    candidate = JSON.stringify(parsedInner);
  }

  const parsed = JSON.parse(candidate) as GDriveTokenShape;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Google Drive payload must be a JSON object.");
  }

  const oauthCfg = getGoogleOAuthClientConfig({
    client_id: overrides?.clientId?.trim() || parsed.client_id,
    client_secret: overrides?.clientSecret?.trim() || parsed.client_secret,
  });

  if (oauthCfg.clientId) parsed.client_id = oauthCfg.clientId;
  if (oauthCfg.clientSecret) parsed.client_secret = oauthCfg.clientSecret;

  if (!parsed.expiry && parsed.expires_in && parsed.access_token) {
    parsed.expiry = new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString();
  }

  return {
    payload: parsed,
    serialized: JSON.stringify(parsed),
  };
}

export function isInvalidGrantError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("token has been expired or revoked") ||
    lower.includes("token has been revoked")
  );
}

export function assessGDriveTokenHealth(
  parsed?: GDriveTokenShape | null,
  meta?: Record<string, unknown> | null
): GDriveTokenHealth {
  const oauthEnv = getGoogleOAuthClientConfig(parsed);
  const accessTokenExpiresAt =
    (typeof parsed?.expiry === "string" && parsed.expiry) ||
    (typeof meta?.accessTokenExpiresAt === "string" ? (meta.accessTokenExpiresAt as string) : null);

  let accessTokenExpired = false;
  if (accessTokenExpiresAt) {
    const ms = new Date(accessTokenExpiresAt).getTime();
    if (!Number.isNaN(ms) && Date.now() >= ms - 60_000) {
      accessTokenExpired = true;
    }
  } else if (!parsed?.access_token) {
    accessTokenExpired = true;
  }

  const refreshTokenIssuedAt =
    typeof meta?.refreshTokenIssuedAt === "string" ? (meta.refreshTokenIssuedAt as string) : null;
  const lastRefreshedAt =
    typeof meta?.lastRefreshedAt === "string" ? (meta.lastRefreshedAt as string) : null;
  const lastRefreshError =
    typeof meta?.lastRefreshError === "string" && meta.lastRefreshError.trim()
      ? (meta.lastRefreshError as string)
      : null;

  let refreshTokenAgeDays: number | null = null;
  if (refreshTokenIssuedAt) {
    const issuedMs = new Date(refreshTokenIssuedAt).getTime();
    if (!Number.isNaN(issuedMs)) {
      refreshTokenAgeDays = Math.max(0, Math.floor((Date.now() - issuedMs) / 86_400_000));
    }
  }

  const likelyRevoked = Boolean(lastRefreshError && isInvalidGrantError(lastRefreshError));
  const expiringSoonWarning =
    !likelyRevoked && refreshTokenAgeDays !== null && refreshTokenAgeDays >= 5;

  return {
    hasRefreshToken: Boolean(parsed?.refresh_token),
    hasClientCredentials: Boolean(oauthEnv.clientId && oauthEnv.clientSecret),
    oauthClientConfigured: Boolean(oauthEnv.clientId && oauthEnv.clientSecret),
    accessTokenExpired,
    accessTokenExpiresAt,
    refreshTokenIssuedAt,
    lastRefreshedAt,
    lastRefreshError,
    refreshTokenAgeDays,
    likelyRevoked,
    expiringSoonWarning,
  };
}
