import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { getAuthUser, verifyVmRegistrationToken, type SessionUser } from "@/lib/auth/session";

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
  worker?: { provider: string; targets: string[] };
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

/**
 * Authenticates worker polling/completion routes via either API token, user session,
 * or signed `VmToken <REG_JWT>` header issued to active cloud GPU workers.
 */
export async function getWorkerAuthContext(req: NextRequest): Promise<ApiAuthContext | null> {
  const auth = req.headers.get("authorization")?.trim() || "";
  if (auth.toLowerCase().startsWith("vmtoken ")) {
    const vmJwt = auth.slice(8).trim();
    const verified = verifyVmRegistrationToken(vmJwt);
    if (!verified?.userId || !verified.vmSecret) return null;
    const rows = await prisma.vmInstance.findMany({ where: {
      userId: verified.userId, sessionGroup: verified.sessionGroup, target: { in: verified.targets },
      vmSecret: verified.vmSecret, status: { in: ["STARTING", "ONLINE", "BUSY"] },
    }, select: { provider: true, target: true } });
    if (rows.length) {
      return {
        worker: { provider: rows[0].provider, targets: rows.map((vm) => vm.target) },
        userId: verified.userId,
        email: `vm-${verified.sessionGroup}`,
        authKind: "api_token",
        scopes: ["batch", "worker"],
      };
    }
    return null;
  }
  return getAuthContext(req);
}

