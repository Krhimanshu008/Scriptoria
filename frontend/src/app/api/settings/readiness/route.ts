import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";

export interface ReadinessItem {
  id: string;
  title: string;
  tier: "REQUIRED" | "RECOMMENDED" | "OPTIONAL" | "REQUIRED_FOR_AGENT";
  provider: string;
  accountAlias: string;
  configured: boolean;
  usedFor: string;
  hint: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [creds, settings, webhook] = await Promise.all([
      prisma.credential.findMany({
        where: { userId: user.userId },
        select: { provider: true, accountAlias: true, username: true, metadataJson: true },
      }),
      getOrCreateWorkspaceSettings(user.userId),
      resolveReachableWebhookBaseUrl(req),
    ]);

    const findCred = (provider: string, accountAlias?: string) =>
      creds.find(
        (c) =>
          c.provider === provider &&
          (accountAlias === undefined || c.accountAlias === accountAlias)
      );

    const gdrive = findCred("gdrive");
    const kaggle1 = findCred("kaggle", "acc1");
    const kaggle2 = findCred("kaggle", "acc2");
    const kaggle3 = findCred("kaggle", "acc3");
    const colab1 = findCred("colab", "acc1");
    const colab2 = findCred("colab", "acc2");
    const hf = findCred("huggingface");
    const civitai = findCred("civitai");
    const llmCreds = creds.filter((c) => c.provider === "llm");
    const preferredLlm =
      llmCreds.find((c) => c.accountAlias === settings.preferredLlmProvider) || llmCreds[0];

    const hasPrimaryCompute = Boolean(kaggle1 || kaggle2 || kaggle3 || colab1 || colab2);

    const items: ReadinessItem[] = [
      {
        id: "gdrive",
        title: "Google Drive OAuth (5 TB Storage)",
        tier: "REQUIRED",
        provider: "gdrive",
        accountAlias: gdrive?.accountAlias || "default",
        configured: Boolean(gdrive),
        usedFor: "5 TB model backup, FastBoot v2 cache, and permanent output storage.",
        hint: gdrive
          ? `Base: ${
              (() => {
                try {
                  return (JSON.parse(gdrive.metadataJson || "{}") as { baseFolder?: string })
                    .baseFolder;
                } catch {
                  return null;
                }
              })() || settings.gdriveBaseFolder
            }`
          : "Missing OAuth token",
      },
      {
        id: "kaggle-acc1",
        title: "Kaggle Account (acc1 · Dual T4 + CPU Mirror)",
        tier: "REQUIRED",
        provider: "kaggle",
        accountAlias: "acc1",
        configured: Boolean(kaggle1),
        usedFor: "Boots gpu0 + gpu1 (2×T4 32 GB) and runs 0-GPU CPU Drive Mirror jobs.",
        hint: kaggle1?.username ? `@${kaggle1.username}` : "Add KGAT_ or API key",
      },
      {
        id: "kaggle-acc2",
        title: "Kaggle Account (acc2 · Secondary Dual T4)",
        tier: "OPTIONAL",
        provider: "kaggle",
        accountAlias: "acc2",
        configured: Boolean(kaggle2),
        usedFor: "Adds +30h/week Dual-T4 capacity on gpu2 + gpu3.",
        hint: kaggle2?.username ? `@${kaggle2.username}` : "Optional second Kaggle account",
      },
      {
        id: "kaggle-acc3",
        title: "Kaggle Account (acc3 · Tertiary Dual T4)",
        tier: "OPTIONAL",
        provider: "kaggle",
        accountAlias: "acc3",
        configured: Boolean(kaggle3),
        usedFor: "Adds +30h/week Dual-T4 capacity on gpu4 + gpu5.",
        hint: kaggle3?.username ? `@${kaggle3.username}` : "Optional third Kaggle account",
      },
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
        coreReady: Boolean(gdrive && hasPrimaryCompute && webhook.mode !== "unreachable"),
        agenticReady: llmCreds.length > 0,
        configuredCount: items.filter((i) => i.configured).length,
        totalCount: items.length,
        webhookMode: webhook.mode,
        webhookUrl: webhook.url || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect readiness";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

