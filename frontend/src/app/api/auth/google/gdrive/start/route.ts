import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser, shouldUseSecureCookie } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  GDRIVE_OAUTH_NONCE_COOKIE,
  getGoogleOAuthClientConfig,
  getOAuthStateSecret,
  resolveOAuthCallbackOrigin,
  resolveRequestOrigin,
} from "@/lib/gdrive/oauth-config";

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get("returnTo") || "/settings/vault";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/settings/vault";
  const reqOrigin = resolveRequestOrigin(req);

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.redirect(new URL("/login", reqOrigin));
    }

    const alias = (req.nextUrl.searchParams.get("alias") || "default").trim() || "default";
    const baseFolder = req.nextUrl.searchParams.get("baseFolder")?.trim() || undefined;

    const gdriveCred = await getUserGDriveCredential(user.userId, alias).catch(() => null);
    const { clientId, clientSecret } = getGoogleOAuthClientConfig(gdriveCred?.parsed);

    if (!clientId || !clientSecret) {
      const errUrl = new URL(safeReturnTo, reqOrigin);
      errUrl.searchParams.set("gdriveError", "missing_google_oauth_client");
      return NextResponse.redirect(errUrl);
    }

    const callbackOrigin = resolveOAuthCallbackOrigin(req);
    const redirectUri = `${callbackOrigin}/api/auth/google/gdrive/callback`;
    const nonce = crypto.randomBytes(16).toString("hex");

    const state = jwt.sign(
      {
        userId: user.userId,
        alias,
        baseFolder: baseFolder || gdriveCred?.baseFolder || undefined,
        returnTo: safeReturnTo,
        redirectUri,
        nonce,
      },
      getOAuthStateSecret(),
      { expiresIn: "10m" }
    );

    const scopes = [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/drive",
    ];

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "select_account consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);

    const res = NextResponse.redirect(authUrl.toString());
    res.cookies.set(GDRIVE_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(req),
      path: "/api/auth/google",
      maxAge: 600,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth start failed";
    const errUrl = new URL(safeReturnTo, reqOrigin);
    errUrl.searchParams.set("gdriveError", message);
    return NextResponse.redirect(errUrl);
  }
}
