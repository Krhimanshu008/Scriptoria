import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  formatGoogleDriveApiError,
  GDRIVE_OAUTH_NONCE_COOKIE,
  getGoogleOAuthClientConfig,
  getOAuthStateSecret,
  resolveRequestOrigin,
  type GDriveTokenShape,
} from "@/lib/gdrive/oauth-config";
import { appendSystemLog } from "@/lib/logs/logger";

interface GDriveOAuthState {
  userId: string;
  alias: string;
  baseFolder?: string;
  returnTo?: string;
  redirectUri: string;
  nonce?: string;
}

function timingSafeCookieEquals(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export async function GET(req: NextRequest) {
  const baseOrigin = resolveRequestOrigin(req);
  let redirectPath = "/settings/vault";

  const redirectWithError = (err: string) => {
    const url = new URL(redirectPath, baseOrigin);
    url.searchParams.set("gdriveError", err);
    const res = NextResponse.redirect(url);
    res.cookies.delete(GDRIVE_OAUTH_NONCE_COOKIE);
    return res;
  };

  let logUserId: string | null = null;
  const logFailure = async (message: string) => {
    if (!logUserId) return;
    await appendSystemLog({
      userId: logUserId,
      category: "SYSTEM",
      level: "ERROR",
      message: `Google Drive OAuth error: ${message}`,
    }).catch(() => null);
  };

  try {
    const errParam = req.nextUrl.searchParams.get("error");
    if (errParam) {
      return redirectWithError(errParam);
    }

    const code = req.nextUrl.searchParams.get("code");
    const stateToken = req.nextUrl.searchParams.get("state");
    if (!code || !stateToken) {
      return redirectWithError("missing_code_or_state");
    }

    const user = await getAuthUser(req);
    const decoded = jwt.verify(stateToken, getOAuthStateSecret()) as GDriveOAuthState;
    if (decoded.returnTo && decoded.returnTo.startsWith("/")) {
      redirectPath = decoded.returnTo;
    }

    const nonceCookie = req.cookies.get(GDRIVE_OAUTH_NONCE_COOKIE)?.value;
    const nonceMatches = timingSafeCookieEquals(nonceCookie, decoded.nonce);
    let effectiveUserId: string | null = null;

    if (user && user.userId === decoded.userId) {
      effectiveUserId = user.userId;
    } else if (!user && nonceMatches && decoded.userId) {
      const dbUser = await prisma.user
        .findUnique({ where: { id: decoded.userId }, select: { id: true } })
        .catch(() => null);
      if (dbUser) effectiveUserId = dbUser.id;
    }

    if (!effectiveUserId) {
      await appendSystemLog({
        userId: user?.userId || decoded.userId || "system",
        category: "SYSTEM",
        level: "ERROR",
        message: `Google Drive OAuth session mismatch on ${baseOrigin} (hasSession=${Boolean(user)}, nonceMatch=${nonceMatches}, redirectUri=${decoded.redirectUri}).`,
      }).catch(() => null);
      return redirectWithError(
        `session_mismatch (callback reached ${baseOrigin}; verify you are signed in on the same domain)`
      );
    }
    logUserId = effectiveUserId;

    const alias = decoded.alias || "default";
    const gdriveCred = await getUserGDriveCredential(effectiveUserId, alias).catch(() => null);
    const { clientId, clientSecret } = getGoogleOAuthClientConfig(gdriveCred?.parsed);

    if (!clientId || !clientSecret) {
      await logFailure("missing_oauth_client_or_secret");
      return redirectWithError("missing_oauth_client_or_secret");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: decoded.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      cache: "no-store",
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      const msg = errText.includes("redirect_uri_mismatch")
        ? `redirect_uri_mismatch (ensure ${decoded.redirectUri} is in Google Cloud Console Authorized redirect URIs)`
        : `token_exchange_failed: ${errText.slice(0, 220)}`;
      await logFailure(msg);
      return redirectWithError(msg);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      token_type?: string;
    };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    });
    const profile = profileRes.ok
      ? ((await profileRes.json()) as { email?: string; name?: string })
      : {};

    const existing = await getDecryptedCredential(effectiveUserId, "gdrive", alias).catch(() => null);
    let existingParsed: GDriveTokenShape = {};
    if (existing?.secret) {
      try {
        existingParsed = JSON.parse(existing.secret) as GDriveTokenShape;
      } catch {
        // ignore invalid existing JSON
      }
    }

    const refreshToken = tokenData.refresh_token || existingParsed.refresh_token || "";
    if (!refreshToken) {
      const msg =
        "Google did not return a refresh_token. Revoke previous access at myaccount.google.com/permissions or re-try with prompt=consent.";
      await logFailure(msg);
      return redirectWithError(msg);
    }

    const nowIso = new Date().toISOString();
    const expiresInSec = Number(tokenData.expires_in || 3599);
    const expiryIso = new Date(Date.now() + expiresInSec * 1000).toISOString();
    const existingMeta = (existing?.metadata || {}) as Record<string, unknown>;
    const resolvedBaseFolder = (
      decoded.baseFolder ||
      (typeof existingMeta.baseFolder === "string" ? existingMeta.baseFolder : "") ||
      gdriveCred?.baseFolder ||
      process.env.GDRIVE_BASE_FOLDER ||
      "Scriptoria"
    )
      .trim()
      .replace(/^\/+|\/+$/g, "");

    const payload: GDriveTokenShape = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || "Bearer",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      expiry: expiryIso,
      expires_in: expiresInSec,
      scope: tokenData.scope || "",
      email: profile.email || existingParsed.email || undefined,
    };

    const refreshIssuedAt = tokenData.refresh_token
      ? nowIso
      : (typeof existingMeta.refreshTokenIssuedAt === "string"
          ? existingMeta.refreshTokenIssuedAt
          : nowIso);

    await saveUserCredential(effectiveUserId, {
      provider: "gdrive",
      accountAlias: alias,
      username: profile.email || existing?.username || "personal-drive",
      rawSecret: JSON.stringify(payload),
      authType: "oauth_json",
      metadata: {
        ...existingMeta,
        baseFolder: resolvedBaseFolder,
        email: profile.email || existing?.username || undefined,
        secretHint: `OAuth (${refreshToken.slice(0, 4)}••••${refreshToken.slice(-4)})`,
        oauthFlow: "web_oauth",
        hasDriveScope: Boolean(tokenData.scope?.includes("drive")),
        refreshTokenIssuedAt: refreshIssuedAt,
        lastRefreshedAt: nowIso,
        accessTokenExpiresAt: expiryIso,
        lastRefreshError: null,
      },
    });

    if (resolvedBaseFolder) {
      await prisma.workspaceSettings
        .updateMany({
          where: { userId: effectiveUserId },
          data: { gdriveBaseFolder: resolvedBaseFolder },
        })
        .catch(() => null);
    }

    // Verify Google Drive API is enabled for this GCP OAuth project immediately so 403 SERVICE_DISABLED is surfaced cleanly.
    let driveApiWarning: string | null = null;
    try {
      const aboutCheck = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!aboutCheck.ok) {
        const bodyTxt = await aboutCheck.text().catch(() => "");
        driveApiWarning = formatGoogleDriveApiError(aboutCheck.status, bodyTxt);
      }
    } catch {
      // non-blocking connectivity check
    }

    await appendSystemLog({
      userId: effectiveUserId,
      category: "SYSTEM",
      level: driveApiWarning ? "WARN" : "SUCCESS",
      message: driveApiWarning
        ? `Connected Google Drive OAuth for ${profile.email || alias}, but API check warned: ${driveApiWarning}`
        : `Connected Google Drive OAuth for ${profile.email || alias} (${alias}) with offline refresh token.`,
    });

    const okUrl = new URL(redirectPath, baseOrigin);
    okUrl.searchParams.set("gdriveConnected", profile.email || alias);
    if (driveApiWarning) {
      okUrl.searchParams.set("gdriveWarning", driveApiWarning);
    }
    const res = NextResponse.redirect(okUrl);
    res.cookies.delete(GDRIVE_OAUTH_NONCE_COOKIE);
    return res;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "OAuth callback error";
    await logFailure(msg);
    return redirectWithError(msg);
  }
}
