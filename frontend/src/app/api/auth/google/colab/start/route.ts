import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  getGoogleOAuthClientConfig,
  getOAuthStateSecret,
  resolveOAuthCallbackOrigin,
  resolveRequestOrigin,
} from "@/lib/gdrive/oauth-config";

export async function GET(req: NextRequest) {
  const reqOrigin = resolveRequestOrigin(req);
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.redirect(new URL("/login", reqOrigin));
    }

    const alias = req.nextUrl.searchParams.get("alias") === "acc2" ? "acc2" : "acc1";
    const includeColabScope = req.nextUrl.searchParams.get("colabScope") === "true";

    const gdriveCred = await getUserGDriveCredential(user.userId);
    const { clientId } = getGoogleOAuthClientConfig(gdriveCred?.parsed);

    if (!clientId) {
      return NextResponse.redirect(
        new URL("/?colabError=missing_google_oauth_client", reqOrigin)
      );
    }

    const callbackOrigin = resolveOAuthCallbackOrigin(req);
    const redirectUri = `${callbackOrigin}/api/auth/google/colab/callback`;

    const state = jwt.sign(
      { userId: user.userId, alias, includeColabScope, redirectUri },
      getOAuthStateSecret(),
      { expiresIn: "10m" }
    );

    const scopes = [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/drive.file",
    ];
    if (includeColabScope) {
      scopes.push("https://www.googleapis.com/auth/colaboratory");
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "select_account consent");
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth start failed";
    return NextResponse.redirect(
      new URL(`/?colabError=${encodeURIComponent(message)}`, reqOrigin)
    );
  }
}

