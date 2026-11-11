import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { KaggleOrchestrator, KaggleQuotaInfo } from "@/lib/orchestrator/kaggle-client";

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
  targets: string[];
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [vms, colabCreds, gdriveCred] = await Promise.all([
      prisma.vmInstance.findMany({ where: { userId: user.userId } }),
      prisma.credential.findMany({
        where: { userId: user.userId, provider: "colab" },
        select: { accountAlias: true, username: true, metadataJson: true, authType: true },
      }),
      getUserGDriveCredential(user.userId),
    ]);

    const kaggleAliases = ["acc1", "acc2"];
    const kaggleAccounts: KaggleAccountSummary[] = await Promise.all(
      kaggleAliases.map(async (alias) => {
        const targets = vms
          .filter((v) => v.provider === "kaggle" && v.accountAlias === alias)
          .map((v) => v.target)
          .sort();
        const cred = await getDecryptedCredential(user.userId, "kaggle", alias);
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
      const row = colabCreds.find((c) => c.accountAlias === alias);
      let name: string | null = null;
      let hasColabScope = false;
      if (row?.metadataJson) {
        try {
          const meta = JSON.parse(row.metadataJson) as { name?: string; hasColabScope?: boolean };
          name = meta.name || null;
          hasColabScope = Boolean(meta.hasColabScope);
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cluster accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

