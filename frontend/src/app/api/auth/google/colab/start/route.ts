import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAuthUser } from "@/lib/auth/session";
import { getUserGDriveCredential } from "@/lib/gdrive/client";

function getStateSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("JWT_SECRET or ENCRYPTION_KEY is not configured");
  return secret;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
    }

    const alias = req.nextUrl.searchParams.get("alias") === "acc2" ? "acc2" : "acc1";
    const includeColabScope = req.nextUrl.searchParams.get("colabScope") === "true";

    const gdriveCred = await getUserGDriveCredential(user.userId);
    const clientId =
      process.env.GOOGLE_OAUTH_CLIENT_ID || gdriveCred?.parsed?.client_id || "";

    if (!clientId) {
      return NextResponse.redirect(
        new URL("/?colabError=missing_google_oauth_client", req.nextUrl.origin)
      );
    }

    const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
    // Use actual request origin if user is accessing localhost while NEXT_PUBLIC_APP_URL points elsewhere
    const callbackOrigin =
      req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1"
        ? req.nextUrl.origin
        : origin;

    const redirectUri = `${callbackOrigin}/api/auth/google/colab/callback`;

    const state = jwt.sign(
      { userId: user.userId, alias, includeColabScope, redirectUri },
      getStateSecret(),
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
      new URL(`/?colabError=${encodeURIComponent(message)}`, req.nextUrl.origin)
    );
  }
}

