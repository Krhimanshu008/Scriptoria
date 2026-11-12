import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { invalidateColabMetaIfEmailChanged } from "@/lib/orchestrator/colab-runner";
import { appendSystemLog } from "@/lib/logs/logger";

interface ColabOAuthState {
  userId: string;
  alias: string;
  includeColabScope: boolean;
  redirectUri: string;
}

function getStateSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("JWT_SECRET or ENCRYPTION_KEY is not configured");
  return secret;
}

export async function GET(req: NextRequest) {
  const baseOrigin = req.nextUrl.origin;

  try {
    const errParam = req.nextUrl.searchParams.get("error");
    if (errParam) {
      return NextResponse.redirect(new URL(`/?colabError=${encodeURIComponent(errParam)}`, baseOrigin));
    }

    const code = req.nextUrl.searchParams.get("code");
    const stateToken = req.nextUrl.searchParams.get("state");
    if (!code || !stateToken) {
      return NextResponse.redirect(new URL("/?colabError=missing_code_or_state", baseOrigin));
    }

    const user = await getAuthUser(req);
    const decoded = jwt.verify(stateToken, getStateSecret()) as ColabOAuthState;

    if (!user || user.userId !== decoded.userId) {
      return NextResponse.redirect(new URL("/?colabError=session_mismatch", baseOrigin));
    }

    const gdriveCred = await getUserGDriveCredential(user.userId);
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || gdriveCred?.parsed?.client_id || "";
    const clientSecret =
      process.env.GOOGLE_OAUTH_CLIENT_SECRET || gdriveCred?.parsed?.client_secret || "";

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL("/?colabError=missing_oauth_secret", baseOrigin));
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
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return NextResponse.redirect(
        new URL(`/?colabError=${encodeURIComponent(`token_exchange_failed: ${errText}`)}`, baseOrigin)
      );
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(new URL("/?colabError=userinfo_failed", baseOrigin));
    }

    const profile = (await profileRes.json()) as { email: string; name?: string };
    const existingColab = await getDecryptedCredential(
      user.userId,
      "colab",
      decoded.alias
    ).catch(() => null);
    let existingParsed: { refresh_token?: string } = {};
    if (existingColab?.secret) {
      try {
        existingParsed = JSON.parse(existingColab.secret);
      } catch {
        // ignore
      }
    }

    const secretPayload = JSON.stringify({
      email: profile.email,
      name: profile.name || profile.email,
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token || existingParsed.refresh_token || "",
      access_token: tokenData.access_token,
      scope: tokenData.scope || "",
    });

    const hasColabScope = Boolean(tokenData.scope?.includes("colaboratory"));
    const hasDriveScope = Boolean(tokenData.scope?.includes("drive"));
    const existingMeta = (existingColab?.metadata || {}) as Record<string, unknown>;

    await saveUserCredential(user.userId, {
      provider: "colab",
      accountAlias: decoded.alias,
      username: profile.email,
      rawSecret: secretPayload,
      authType: "oauth_json",
      metadata: {
        ...existingMeta,
        email: profile.email,
        name: profile.name || profile.email,
        hasColabScope,
        hasDriveScope,
        connectedAt: new Date().toISOString(),
      },
    });

    await invalidateColabMetaIfEmailChanged(
      user.userId,
      decoded.alias,
      existingColab?.username,
      profile.email
    );

    await appendSystemLog({
      userId: user.userId,
      category: "COLAB",
      level: "SUCCESS",
      message: `Connected Google account ${profile.email} to Colab (${decoded.alias}).`,
    });

    return NextResponse.redirect(
      new URL(`/?colabConnected=${encodeURIComponent(`${decoded.alias}:${profile.email}`)}`, baseOrigin)
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "OAuth callback error";
    return NextResponse.redirect(new URL(`/?colabError=${encodeURIComponent(msg)}`, baseOrigin));
  }
}

