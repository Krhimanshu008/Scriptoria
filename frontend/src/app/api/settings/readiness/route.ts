import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import {
  assessGDriveTokenHealth,
  getGoogleOAuthClientConfig,
  type GDriveTokenHealth,
} from "@/lib/gdrive/oauth-config";

export interface ReadinessItem {
  id: string;
  title: string;
  tier: "REQUIRED" | "RECOMMENDED" | "OPTIONAL" | "REQUIRED_FOR_AGENT";
  provider: string;
  accountAlias: string;
  configured: boolean;
  usedFor: string;
  hint: string | null;
  health?: GDriveTokenHealth | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [creds, settings, webhook, gdriveCred] = await Promise.all([
      prisma.credential.findMany({
        where: { userId: user.userId },
        select: { provider: true, accountAlias: true, username: true, metadataJson: true },
      }),
      getOrCreateWorkspaceSettings(user.userId),
      resolveReachableWebhookBaseUrl(req),
      getUserGDriveCredential(user.userId).catch(() => null),
    ]);

    const findCred = (provider: string, accountAlias?: string) =>
      creds.find(
        (c) =>
          c.provider === provider &&
          (accountAlias === undefined || c.accountAlias === accountAlias)
      );

    const gdrive = findCred("gdrive");
    const kaggleCreds = creds.filter((c) => c.provider === "kaggle");
    const kaggleByAlias = new Map(kaggleCreds.map((c) => [c.accountAlias, c]));
    const colab1 = findCred("colab", "acc1");
    const colab2 = findCred("colab", "acc2");
    const hf = findCred("huggingface");
    const civitai = findCred("civitai");
    const llmCreds = creds.filter((c) => c.provider === "llm");
    const preferredLlm =
      llmCreds.find((c) => c.accountAlias === settings.preferredLlmProvider) || llmCreds[0];

    const gdriveMeta = gdriveCred?.metadata || (() => {
      try {
        return JSON.parse(gdrive?.metadataJson || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const gdriveHealth = assessGDriveTokenHealth(gdriveCred?.parsed, gdriveMeta);
    const oauthClientConfigured = Boolean(
      getGoogleOAuthClientConfig(gdriveCred?.parsed).clientId &&
        getGoogleOAuthClientConfig(gdriveCred?.parsed).clientSecret
    );

    const hasPrimaryCompute = Boolean(kaggleCreds.length > 0 || colab1 || colab2);

    const kaggleAliases = Array.from(
      new Set(["acc1", "acc2", "acc3", ...kaggleCreds.map((c) => c.accountAlias)])
    );
    const kaggleItems: ReadinessItem[] = kaggleAliases.map((alias, idx) => {
      const cred = kaggleByAlias.get(alias);
      return {
        id: `kaggle-${alias}`,
        title:
          idx === 0
            ? `Kaggle Account (${alias} · Primary Dual T4)`
            : `Kaggle Account (${alias} · Dual T4)`,
        tier: idx === 0 ? "REQUIRED" : "OPTIONAL",
        provider: "kaggle",
        accountAlias: alias,
        configured: Boolean(cred),
        usedFor: `Boots Dual-T4 GPU worker slots for ${alias}.`,
        hint: cred?.username ? `@${cred.username}` : `Connect Kaggle (${alias})`,
      };
    });

    const items: ReadinessItem[] = [
      {
        id: "gdrive",
        title: "Google Drive backup and storage",
        tier: "OPTIONAL",
        provider: "gdrive",
        accountAlias: gdrive?.accountAlias || "default",
        configured: Boolean(gdrive),
        usedFor: "5 TB model backup, FastBoot v2 cache, and permanent output storage.",
        hint: gdrive
          ? `Base: ${
              (typeof gdriveMeta?.baseFolder === "string" ? gdriveMeta.baseFolder : null) ||
              settings.gdriveBaseFolder
            }${
              gdriveHealth.likelyRevoked
                ? " · Token revoked/expired (click Reconnect)"
                : gdriveHealth.expiringSoonWarning
                ? ` · ${gdriveHealth.refreshTokenAgeDays}d old (Testing mode expires @7d)`
                : ""
            }`
          : oauthClientConfigured
          ? "Click Connect Google Drive (OAuth ready)"
          : "Missing OAuth token",
        health: gdriveHealth,
      },
      ...kaggleItems,
      {
        id: "colab-acc1",
        title: "Google Colab (acc1 / acc2)",
        tier: "OPTIONAL",
        provider: "colab",
        accountAlias: "acc1",
        configured: Boolean(colab1 || colab2),
        usedFor: "On-demand Colab T4 worker slots (gcgpu / gcgpu1) for Audio/LipSync or overflow.",
        hint:
          colab1?.username || colab2?.username
            ? [colab1?.username, colab2?.username].filter(Boolean).join(", ")
            : "Configure in VM Cluster → Colab Setup",
      },
      {
        id: "huggingface",
        title: "HuggingFace Read Token",
        tier: "RECOMMENDED",
        provider: "huggingface",
        accountAlias: hf?.accountAlias || "default",
        configured: Boolean(hf),
        usedFor: "Unlocks gated HF repos (FLUX.1-dev) and higher download speeds.",
        hint: hf ? "Configured (hf_••••)" : "Optional for public models; needed for gated repos",
      },
      {
        id: "civitai",
        title: "Civitai API Key",
        tier: "RECOMMENDED",
        provider: "civitai",
        accountAlias: civitai?.accountAlias || "default",
        configured: Boolean(civitai),
        usedFor: "Direct authenticated Civitai downloads for Illustrious/NoobAI checkpoints & LoRAs.",
        hint: civitai ? "Configured" : "Recommended for Civitai direct download links",
      },
      {
        id: "llm",
        title: "Agentic AI Provider Key (Gemini / OpenAI / OpenRouter / Ollama)",
        tier: "REQUIRED_FOR_AGENT",
        provider: "llm",
        accountAlias: preferredLlm?.accountAlias || settings.preferredLlmProvider || "gemini",
        configured: llmCreds.length > 0,
        usedFor: "Powers AI Co-Director, Drive model AI review, and Workflow Creator optimization.",
        hint:
          llmCreds.length > 0
            ? llmCreds.map((c) => `${c.accountAlias.toUpperCase()} (${c.username || "model"})`).join(" · ")
            : "Add Gemini / OpenAI / OpenRouter / Ollama key",
      },
      {
        id: "webhook",
        title: "Public Webhook Callback URL",
        tier: "REQUIRED",
        provider: "webhook",
        accountAlias: "default",
        configured: webhook.mode !== "unreachable",
        usedFor: "Allows remote Kaggle/Colab VMs to send heartbeats, progress, and backups.",
        hint:
          webhook.mode !== "unreachable"
            ? `${webhook.mode}: ${webhook.url}`
            : webhook.reason || "No public URL detected",
      },
    ];

    return NextResponse.json({
      items,
      summary: {
        coreReady: Boolean(hasPrimaryCompute && webhook.mode !== "unreachable"),
        agenticReady: llmCreds.length > 0,
        configuredCount: items.filter((i) => i.configured).length,
        totalCount: items.length,
        webhookMode: webhook.mode,
        webhookUrl: webhook.url || null,
        oauthClientConfigured,
        gdriveHealth,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect readiness";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

