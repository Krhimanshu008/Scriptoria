import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  getGoogleOAuthClientConfig,
  getOAuthStateSecret,
  type GDriveTokenShape,
} from "@/lib/gdrive/oauth-config";
import { appendSystemLog } from "@/lib/logs/logger";

interface GDriveOAuthState {
  userId: string;
  alias: string;
  baseFolder?: string;
  returnTo?: string;
  redirectUri: string;
}

export async function GET(req: NextRequest) {
  const baseOrigin = req.nextUrl.origin;
  let redirectPath = "/settings/vault";

  const redirectWithError = (err: string) => {
    const url = new URL(redirectPath, baseOrigin);
    url.searchParams.set("gdriveError", err);
    return NextResponse.redirect(url);
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

    if (!user || user.userId !== decoded.userId) {
      return redirectWithError("session_mismatch");
    }

    const alias = decoded.alias || "default";
    const gdriveCred = await getUserGDriveCredential(user.userId, alias).catch(() => null);
    const { clientId, clientSecret } = getGoogleOAuthClientConfig(gdriveCred?.parsed);

    if (!clientId || !clientSecret) {
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
      return redirectWithError(`token_exchange_failed: ${errText.slice(0, 180)}`);
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

    const existing = await getDecryptedCredential(user.userId, "gdrive", alias).catch(() => null);
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
      return redirectWithError(
        "Google did not return a refresh_token. Revoke previous access or re-try with prompt=consent."
      );
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

    await saveUserCredential(user.userId, {
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
          where: { userId: user.userId },
          data: { gdriveBaseFolder: resolvedBaseFolder },
        })
        .catch(() => null);
    }

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "SUCCESS",
      message: `Connected Google Drive OAuth for ${profile.email || alias} (${alias}) with offline refresh token.`,
    });

    const okUrl = new URL(redirectPath, baseOrigin);
    okUrl.searchParams.set("gdriveConnected", profile.email || alias);
    return NextResponse.redirect(okUrl);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "OAuth callback error";
    return redirectWithError(msg);
  }
}
