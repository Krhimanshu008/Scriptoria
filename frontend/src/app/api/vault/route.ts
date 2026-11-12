import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { invalidateColabMetaIfEmailChanged } from "@/lib/orchestrator/colab-runner";
import { appendSystemLog } from "@/lib/logs/logger";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creds = await prisma.credential.findMany({
      where: { userId: user.userId },
      orderBy: [{ provider: "asc" }, { accountAlias: "asc" }],
      select: {
        id: true,
        provider: true,
        accountAlias: true,
        username: true,
        authType: true,
        metadataJson: true,
        updatedAt: true,
      },
    });

    const vms = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        target: true,
        displayName: true,
        provider: true,
        accountAlias: true,
        sessionGroup: true,
        internalPort: true,
        useRouteLess: true,
      },
    });

    return NextResponse.json({
      credentials: creds.map((c) => ({
        id: c.id,
        provider: c.provider,
        accountAlias: c.accountAlias,
        username: c.username,
        authType: c.authType,
        metadata: c.metadataJson ? JSON.parse(c.metadataJson) : null,
        updatedAt: c.updatedAt.toISOString(),
        configured: true,
      })),
      vms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch vault";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const provider = String(body.provider || "").trim().toLowerCase();
    const accountAlias = String(body.accountAlias || "default").trim();
    const username = body.username ? String(body.username).trim() : null;
    const rawSecret = String(body.rawSecret || "").trim();
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;

    if (!provider || !rawSecret) {
      return NextResponse.json(
        { error: "Provider and secret payload are required." },
        { status: 400 }
      );
    }

    if (provider === "gdrive") {
      try {
        JSON.parse(rawSecret);
      } catch {
        return NextResponse.json(
          { error: "Google Drive secret must be a valid Rclone / OAuth JSON string." },
          { status: 400 }
        );
      }
    }

    const prevColab =
      provider === "colab"
        ? await getDecryptedCredential(user.userId, "colab", accountAlias).catch(() => null)
        : null;

    const saved = await saveUserCredential(user.userId, {
      provider,
      accountAlias,
      username,
      rawSecret,
      metadata,
    });

    if (provider === "colab") {
      await invalidateColabMetaIfEmailChanged(
        user.userId,
        accountAlias,
        prevColab?.username,
        username
      );
    }

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "SUCCESS",
      message: `Updated encrypted Vault credential for ${provider} (${accountAlias}).`,
    });

    return NextResponse.json({
      id: saved.id,
      provider: saved.provider,
      accountAlias: saved.accountAlias,
      username: saved.username,
      authType: saved.authType,
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save vault credential";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const provider = req.nextUrl.searchParams.get("provider");
    const accountAlias = req.nextUrl.searchParams.get("accountAlias");
    if (!provider || !accountAlias) {
      return NextResponse.json({ error: "provider and accountAlias are required." }, { status: 400 });
    }

    await prisma.credential.deleteMany({
      where: { userId: user.userId, provider, accountAlias },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete credential";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

