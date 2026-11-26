import { sanitizeKaggleSlug } from "@/lib/orchestrator/kaggle-connection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto/vault";
import {
  buildRedactedSecretHint,
  getDecryptedCredential,
  saveUserCredential,
  updateUserCredential,
} from "@/lib/crypto/credentials";
import { invalidateColabMetaIfEmailChanged } from "@/lib/orchestrator/colab-runner";
import { appendSystemLog } from "@/lib/logs/logger";
import {
  assessGDriveTokenHealth,
  normalizeRcloneGdrivePayload,
  type GDriveTokenShape,
} from "@/lib/gdrive/oauth-config";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [creds, vms] = await Promise.all([
      prisma.credential.findMany({
        where: { userId: user.userId },
        orderBy: [{ provider: "asc" }, { accountAlias: "asc" }],
        select: {
          id: true,
          provider: true,
          accountAlias: true,
          username: true,
          encryptedKey: true,
          iv: true,
          authTag: true,
          authType: true,
          metadataJson: true,
          updatedAt: true,
        },
      }),
      prisma.vmInstance.findMany({
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
      }),
    ]);

    return NextResponse.json({
      credentials: creds.map((c) => {
        let meta: Record<string, unknown> | null = null;
        if (c.metadataJson) {
          try {
            meta = JSON.parse(c.metadataJson) as Record<string, unknown>;
          } catch {
            meta = null;
          }
        }
        let secretHint: string | null =
          typeof meta?.secretHint === "string" ? (meta.secretHint as string) : null;
        let gdriveHealth: ReturnType<typeof assessGDriveTokenHealth> | undefined;
        let plainForHint: string | null = null;
        if (!secretHint || c.provider === "gdrive") {
          try {
            plainForHint = decryptSecret({
              ciphertext: c.encryptedKey,
              iv: c.iv,
              authTag: c.authTag,
            });
            if (!secretHint) {
              secretHint = buildRedactedSecretHint(c.provider, plainForHint);
            }
          } catch {
            if (!secretHint) secretHint = "••••";
          }
        }
        if (c.provider === "gdrive") {
          let parsedGdrive: GDriveTokenShape | null = null;
          if (plainForHint) {
            try {
              parsedGdrive = JSON.parse(plainForHint) as GDriveTokenShape;
            } catch {
              parsedGdrive = null;
            }
          }
          gdriveHealth = assessGDriveTokenHealth(parsedGdrive, meta);
        }
        return {
          id: c.id,
          provider: c.provider,
          accountAlias: c.accountAlias,
          username: c.username,
          authType: c.authType,
          secretHint,
          metadata: gdriveHealth ? { ...(meta || {}), gdriveHealth } : meta,
          updatedAt: c.updatedAt.toISOString(),
          configured: true,
        };
      }),
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

    let finalSecret = rawSecret;
    let gdriveMetaPatch: Record<string, unknown> | null = null;
    if (provider === "gdrive") {
      try {
        const normalized = normalizeRcloneGdrivePayload(rawSecret, {
          clientId: body.clientId ? String(body.clientId) : undefined,
          clientSecret: body.clientSecret ? String(body.clientSecret) : undefined,
        });
        finalSecret = normalized.serialized;
        const nowIso = new Date().toISOString();
        gdriveMetaPatch = {
          ...(normalized.payload.refresh_token ? { refreshTokenIssuedAt: nowIso } : {}),
          lastRefreshError: null,
          accessTokenExpiresAt: normalized.payload.expiry || null,
        };
      } catch {
        return NextResponse.json(
          { error: "Google Drive secret must be a valid Rclone / OAuth JSON string." },
          { status: 400 }
        );
      }
    }

    let kaggleMetaPatch: Record<string, unknown> | null = null;
    if (provider === "kaggle" && metadata) {
      const sanitized = sanitizeKaggleSlug(metadata.kernelSlug);
      kaggleMetaPatch = sanitized
        ? { ...metadata, kernelSlug: sanitized }
        : { ...metadata, kernelSlug: undefined };
    }
    const prevColab =
      provider === "colab"
        ? await getDecryptedCredential(user.userId, "colab", accountAlias).catch(() => null)
        : null;

    const mergedMetadata =
      gdriveMetaPatch || kaggleMetaPatch || metadata
        ? { ...(metadata || {}), ...(kaggleMetaPatch || {}), ...(gdriveMetaPatch || {}) }
        : null;

    const saved = await saveUserCredential(user.userId, {
      provider,
      accountAlias,
      username,
      rawSecret: finalSecret,
      metadata: mergedMetadata,
    });

    if (provider === "gdrive" && metadata && typeof metadata.baseFolder === "string") {
      const folder = String(metadata.baseFolder).trim().replace(/^\/+|\/+$/g, "");
      if (folder) {
        await prisma.workspaceSettings
          .updateMany({
            where: { userId: user.userId },
            data: { gdriveBaseFolder: folder },
          })
          .catch(() => null);
      }
    }

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

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const provider = String(body.provider || "").trim().toLowerCase();
    const accountAlias = String(body.accountAlias || "default").trim();
    const newAccountAlias = body.newAccountAlias
      ? String(body.newAccountAlias).trim()
      : undefined;
    const username =
      body.username !== undefined
        ? body.username === null
          ? null
          : String(body.username).trim() || null
        : undefined;
    const rawSecret = body.rawSecret ? String(body.rawSecret).trim() : undefined;
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : undefined;

    if (!provider || !accountAlias) {
      return NextResponse.json(
        { error: "provider and accountAlias are required." },
        { status: 400 }
      );
    }

    let secretToUpdate = rawSecret;
    let patchMeta = metadata;
    if (provider === "kaggle" && metadata) {
      const sanitized = sanitizeKaggleSlug(metadata.kernelSlug);
      patchMeta = {
        ...metadata,
        ...(metadata.kernelSlug !== undefined ? { kernelSlug: sanitized || "" } : {}),
      };
    }
    if (provider === "gdrive") {
      const overrideClientId = body.clientId ? String(body.clientId).trim() : undefined;
      const overrideClientSecret = body.clientSecret ? String(body.clientSecret).trim() : undefined;
      if (rawSecret) {
        try {
          const normalized = normalizeRcloneGdrivePayload(rawSecret, {
            clientId: overrideClientId,
            clientSecret: overrideClientSecret,
          });
          secretToUpdate = normalized.serialized;
          const nowIso = new Date().toISOString();
          patchMeta = {
            ...(metadata || {}),
            ...(normalized.payload.refresh_token ? { refreshTokenIssuedAt: nowIso } : {}),
            lastRefreshError: null,
            accessTokenExpiresAt: normalized.payload.expiry || null,
          };
        } catch {
          return NextResponse.json(
            { error: "Google Drive secret must be a valid Rclone / OAuth JSON string." },
            { status: 400 }
          );
        }
      } else if (overrideClientId || overrideClientSecret) {
        const existingGdrive = await getDecryptedCredential(user.userId, "gdrive", accountAlias).catch(
          () => null
        );
        if (existingGdrive?.secret) {
          try {
            const normalized = normalizeRcloneGdrivePayload(existingGdrive.secret, {
              clientId: overrideClientId,
              clientSecret: overrideClientSecret,
            });
            secretToUpdate = normalized.serialized;
          } catch {
            // keep existing secret unchanged if malformed
          }
        }
      }
    }

    const prevColab =
      provider === "colab"
        ? await getDecryptedCredential(user.userId, "colab", accountAlias).catch(() => null)
        : null;

    const updated = await updateUserCredential(user.userId, {
      provider,
      accountAlias,
      newAccountAlias,
      username,
      rawSecret: secretToUpdate,
      metadata: patchMeta,
    });

    if (provider === "gdrive" && metadata && typeof metadata.baseFolder === "string") {
      const folder = String(metadata.baseFolder).trim().replace(/^\/+|\/+$/g, "");
      if (folder) {
        await prisma.workspaceSettings
          .updateMany({
            where: { userId: user.userId },
            data: { gdriveBaseFolder: folder },
          })
          .catch(() => null);
      }
    }

    if (provider === "colab" && username !== undefined) {
      await invalidateColabMetaIfEmailChanged(
        user.userId,
        newAccountAlias || accountAlias,
        prevColab?.username,
        username
      );
    }

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "SUCCESS",
      message: `Edited Vault credential for ${provider} (${newAccountAlias || accountAlias})${rawSecret ? " [secret rotated]" : " [metadata updated]"}.`,
    });

    return NextResponse.json({
      ok: true,
      id: updated.id,
      provider: updated.provider,
      accountAlias: updated.accountAlias,
      username: updated.username,
      authType: updated.authType,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update credential";
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

