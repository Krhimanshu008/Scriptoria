import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { getAuthUser, type SessionUser } from "@/lib/auth/session";

export function hashApiToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateStudioApiToken(): {
  rawToken: string;
  tokenPrefix: string;
  tokenHash: string;
} {
  const bytes = crypto.randomBytes(24).toString("hex");
  const rawToken = `sk_scriptoria_${bytes}`;
  const tokenPrefix = `${rawToken.slice(0, 18)}••••${rawToken.slice(-4)}`;
  return {
    rawToken,
    tokenPrefix,
    tokenHash: hashApiToken(rawToken),
  };
}

export function extractBearerOrHeaderToken(req: NextRequest): string | null {
  const xKey = req.headers.get("x-scriptoria-key")?.trim();
  if (xKey) return xKey;
  const auth = req.headers.get("authorization")?.trim();
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token.startsWith("sk_scriptoria_")) return token;
  }
  return null;
}

export interface ApiAuthContext {
  userId: string;
  email: string;
  authKind: "session" | "api_token";
  scopes: string[];
  webhookSecret?: string | null;
}

/**
 * Authenticates either an interactive dashboard session OR an external Bearer `sk_scriptoria_...` token.
 */
export async function getAuthContext(req: NextRequest): Promise<ApiAuthContext | null> {
  const rawToken = extractBearerOrHeaderToken(req);
  if (rawToken) {
    await ensureDbSchemaReady();
    const tokenHash = hashApiToken(rawToken);
    const tokenRow = await prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!tokenRow) return null;

    await prisma.apiToken
      .update({ where: { id: tokenRow.id }, data: { lastUsedAt: new Date() } })
      .catch(() => null);

    return {
      userId: tokenRow.userId,
      email: tokenRow.user.email,
      authKind: "api_token",
      scopes: tokenRow.scopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      webhookSecret: tokenRow.webhookSecret,
    };
  }

  const session: SessionUser | null = await getAuthUser(req);
  if (!session) return null;

  return {
    userId: session.userId,
    email: session.email,
    authKind: "session",
    scopes: ["ingest", "batch", "read", "admin"],
  };
}

