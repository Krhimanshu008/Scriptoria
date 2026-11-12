import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { generateStudioApiToken } from "@/lib/auth/api-token";
import { appendSystemLog } from "@/lib/logs/logger";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const tokens = await prisma.apiToken.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        webhookSecret: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        scopes: t.scopes,
        hasWebhookSecret: Boolean(t.webhookSecret),
        lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list API tokens";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "Book Visualiser Integration").trim().slice(0, 64);
    const scopes = String(body.scopes || "ingest,batch,read").trim();
    const generateWebhookSecret = body.generateWebhookSecret !== false;

    const { rawToken, tokenPrefix, tokenHash } = generateStudioApiToken();
    const webhookSecret = generateWebhookSecret
      ? `whsec_${crypto.randomBytes(20).toString("hex")}`
      : null;

    const row = await prisma.apiToken.create({
      data: {
        userId: user.userId,
        name: name || "External App Token",
        tokenPrefix,
        tokenHash,
        scopes,
        webhookSecret,
      },
    });

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "SUCCESS",
      message: `Issued external Studio API token "${row.name}" (${row.tokenPrefix}).`,
    });

    return NextResponse.json({
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      scopes: row.scopes,
      rawToken, // Returned once upon creation
      webhookSecret, // Returned once upon creation
      createdAt: row.createdAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create API token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Token id is required." }, { status: 400 });
    }
    await prisma.apiToken.deleteMany({
      where: { id, userId: user.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke API token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

