import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { KaggleOrchestrator, KaggleQuotaInfo } from "@/lib/orchestrator/kaggle-client";
import {
  peekActiveTunnelUrl,
  prewarmLocalTunnelIfNeeded,
} from "@/lib/orchestrator/webhook-tunnel";

export interface KaggleAccountSummary {
  accountAlias: string;
  username: string | null;
  configured: boolean;
  targets: string[];
  quota: KaggleQuotaInfo | null;
  quotaError?: string;
}

export interface ColabAccountSummary {
  accountAlias: string;
  email: string | null;
  name: string | null;
  connected: boolean;
  hasColabScope: boolean;
  hasDriveScope: boolean;
  driveFileId: string | null;
  runnerConfigured: boolean;
  targets: string[];
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    prewarmLocalTunnelIfNeeded(req);

    const [vms, colabRelatedCreds, gdriveCred] = await Promise.all([
      prisma.vmInstance.findMany({ where: { userId: user.userId } }),
      prisma.credential.findMany({
        where: {
          userId: user.userId,
          provider: { in: ["colab", "colab-meta", "colab-runner"] },
        },
        select: { provider: true, accountAlias: true, username: true, metadataJson: true },
      }),
      getUserGDriveCredential(user.userId).catch(() => null),
    ]);

    const kaggleAliases = ["acc1", "acc2"];
    const kaggleAccounts: KaggleAccountSummary[] = await Promise.all(
      kaggleAliases.map(async (alias) => {
        const targets = vms
          .filter((v) => v.provider === "kaggle" && v.accountAlias === alias)
          .map((v) => v.target)
          .sort();
        let cred: Awaited<ReturnType<typeof getDecryptedCredential>> = null;
        try {
          cred = await getDecryptedCredential(user.userId, "kaggle", alias);
        } catch (err) {
          return {
            accountAlias: alias,
            username: null,
            configured: false,
            targets,
            quota: null,
            quotaError:
              err instanceof Error
                ? `Decrypt failed (${err.message}). Check ENCRYPTION_KEY.`
                : "Failed to decrypt Kaggle credential",
          };
        }
        if (!cred || !cred.username) {
          return {
            accountAlias: alias,
            username: null,
            configured: false,
            targets,
            quota: null,
          };
        }

        try {
          const quota = await KaggleOrchestrator.getQuota({
            username: cred.username,
            key: cred.secret,
            authType: cred.authType === "bearer" ? "bearer" : "basic",
          });
          return {
            accountAlias: alias,
            username: cred.username,
            configured: true,
            targets,
            quota,
          };
        } catch (err) {
          return {
            accountAlias: alias,
            username: cred.username,
            configured: true,
            targets,
            quota: null,
            quotaError: err instanceof Error ? err.message : "Failed to load quota",
          };
        }
      })
    );

    const colabAliases = ["acc1", "acc2"];
    const colabAccounts: ColabAccountSummary[] = colabAliases.map((alias) => {
      const targets = vms
        .filter((v) => v.provider === "colab" && v.accountAlias === alias)
        .map((v) => v.target)
        .sort();
      const primaryTarget = targets[0] || (alias === "acc2" ? "gcgpu1" : "gcgpu");
      const row = colabRelatedCreds.find(
        (c) => c.provider === "colab" && c.accountAlias === alias
      );
      const metaRow = colabRelatedCreds.find(
        (c) => c.provider === "colab-meta" && c.accountAlias === primaryTarget
      );
      const runnerRow = colabRelatedCreds.find(
        (c) => c.provider === "colab-runner" && c.accountAlias === primaryTarget
      );

      let name: string | null = null;
      let hasColabScope = false;
      let hasDriveScope = false;
      let driveFileId: string | null = null;

      if (row?.metadataJson) {
        try {
          const meta = JSON.parse(row.metadataJson) as {
            name?: string;
            hasColabScope?: boolean;
            hasDriveScope?: boolean;
            driveFileId?: string;
          };
          name = meta.name || null;
          hasColabScope = Boolean(meta.hasColabScope);
          hasDriveScope = Boolean(meta.hasDriveScope);
          driveFileId = meta.driveFileId || null;
        } catch {
          // ignore
        }
      }

      if (metaRow?.metadataJson) {
        try {
          const m = JSON.parse(metaRow.metadataJson) as { driveFileId?: string };
          if (m.driveFileId) driveFileId = m.driveFileId;
        } catch {
          // ignore
        }
      }

      return {
        accountAlias: alias,
        email: row?.username || null,
        name,
        connected: Boolean(row),
        hasColabScope,
        hasDriveScope,
        driveFileId,
        runnerConfigured: Boolean(runnerRow),
        targets,
      };
    });

    const oauthConfigured = Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
        (gdriveCred?.parsed?.client_id && gdriveCred?.parsed?.client_secret)
    );

    return NextResponse.json({
      kaggleAccounts,
      colabAccounts,
      googleOAuthAvailable: oauthConfigured,
      activeTunnelUrl: peekActiveTunnelUrl(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cluster accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
