"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  ShieldCheck,
  Trash2,
  Save,
  Loader2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Pencil,
  PlugZap,
  Sparkles,
  Cpu,
  HardDrive,
  Eye,
  EyeOff,
  FileCode2,
} from "lucide-react";
import type { ReadinessItem } from "@/app/api/settings/readiness/route";
import type { PublicWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { WORKER_PROFILE_LIST } from "@/lib/catalog/worker-profiles";
import { ExternalApiTokensCard } from "@/components/settings/ExternalApiTokensCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type SettingsTab = "readiness" | "keys" | "preferences" | "integrations";

interface RedactedCredential {
  id: string;
  provider: string;
  accountAlias: string;
  username: string | null;
  authType: string;
  secretHint?: string;
  metadata: {
    baseFolder?: string;
    model?: string;
    baseUrl?: string;
    llmProvider?: string;
    secretHint?: string;
  } | null;
  updatedAt: string;
}

interface TestResultState {
  loading: boolean;
  ok?: boolean;
  detail?: string;
}

const INTERNAL_PROVIDERS = new Set(["kaggle-meta", "colab-meta", "colab-runner"]);

function tierBadge(tier: ReadinessItem["tier"]) {
  switch (tier) {
    case "REQUIRED":
      return "border-rose-400/35 bg-rose-500/15 text-rose-200";
    case "REQUIRED_FOR_AGENT":
      return "border-violet-400/35 bg-violet-500/15 text-violet-200";
    case "RECOMMENDED":
      return "border-amber-400/35 bg-amber-500/15 text-amber-200";
    default:
      return "border-white/15 bg-white/[0.05] text-zinc-300";
  }
}

function tierLabel(tier: ReadinessItem["tier"]) {
  switch (tier) {
    case "REQUIRED":
      return "Required";
    case "REQUIRED_FOR_AGENT":
      return "Required for AI";
    case "RECOMMENDED":
      return "Recommended";
    default:
      return "Optional";
  }
}

export function SettingsHub({ defaultTab = "readiness" }: { defaultTab?: SettingsTab }) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const tabParam = searchParams.get("tab");
  const resolvedInitial: SettingsTab =
    tabParam === "keys" ||
    tabParam === "preferences" ||
    tabParam === "readiness" ||
    tabParam === "integrations"
      ? tabParam
      : defaultTab;

  const [activeTab, setActiveTab] = useState<SettingsTab>(resolvedInitial);
  const [showInternalTokens, setShowInternalTokens] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResultState>>({});
  const [testingAll, setTestingAll] = useState(false);

  // Edit existing key modal state
  const [editingCred, setEditingCred] = useState<RedactedCredential | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBaseFolder, setEditBaseFolder] = useState("");
  const [editLlmProvider, setEditLlmProvider] = useState("gemini");
  const [editLlmModel, setEditLlmModel] = useState("");
  const [editLlmBaseUrl, setEditLlmBaseUrl] = useState("");
  const [editNewSecret, setEditNewSecret] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Add/replace key form states
  const [kaggleAlias, setKaggleAlias] = useState("acc1");
  const [kaggleUser, setKaggleUser] = useState("");
  const [kaggleKey, setKaggleKey] = useState("");
  const [savingKaggle, setSavingKaggle] = useState(false);

  const [gdriveMode, setGdriveMode] = useState<"oauth" | "json">("oauth");
  const [gdriveClientId, setGdriveClientId] = useState("");
  const [gdriveClientSecret, setGdriveClientSecret] = useState("");
  const [gdriveRefreshToken, setGdriveRefreshToken] = useState("");
  const [gdriveRawJson, setGdriveRawJson] = useState("");
  const [gdriveBaseFolderInput, setGdriveBaseFolder] = useState<string | null>(null);
  const [savingGdrive, setSavingGdrive] = useState(false);

  const [hfToken, setHfToken] = useState("");
  const [civitaiKey, setCivitaiKey] = useState("");
  const [savingSourceKey, setSavingSourceKey] = useState<"huggingface" | "civitai" | null>(null);

  const [llmProvider, setLlmProvider] = useState("gemini");
  const [llmModel, setLlmModel] = useState("gemini-2.5-flash");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);

  // Preferences draft overrides (derived cleanly from query without useEffect setState)
  const [prefsOverrides, setPrefsOverrides] = useState<Partial<PublicWorkspaceSettings>>({});
  const [savingPrefs, setSavingPrefs] = useState(false);

  const { data: vaultData, refetch: refetchVault } = useQuery<{
    credentials: RedactedCredential[];
  }>({
    queryKey: ["vault-credentials"],
    queryFn: async () => {
      const res = await fetch("/api/vault");
      if (!res.ok) throw new Error("Failed to load vault");
      return res.json();
    },
  });

  const { data: readinessData, refetch: refetchReadiness } = useQuery<{
    items: ReadinessItem[];
    summary: {
      coreReady: boolean;
      agenticReady: boolean;
      configuredCount: number;
      totalCount: number;
      webhookMode: string;
      webhookUrl: string | null;
    };
  }>({
    queryKey: ["settings-readiness"],
    queryFn: async () => {
      const res = await fetch("/api/settings/readiness");
      if (!res.ok) throw new Error("Failed to load readiness checklist");
      return res.json();
    },
  });

  const { data: settingsData, refetch: refetchSettings } = useQuery<{
    settings: PublicWorkspaceSettings;
  }>({
    queryKey: ["workspace-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load workspace settings");
      return res.json();
    },
  });

  const gdriveBaseFolder =
    gdriveBaseFolderInput ??
    settingsData?.settings.gdriveBaseFolder ??
    "NovelVisualizer/ComfyUI_Storage";
  const prefsDraft: PublicWorkspaceSettings | null = settingsData?.settings
    ? { ...settingsData.settings, ...prefsOverrides }
    : null;
  const setPrefsDraft = (next: PublicWorkspaceSettings) => setPrefsOverrides(next);

  const credentials = vaultData?.credentials ?? [];
  const userCredentials = credentials.filter((c) => !INTERNAL_PROVIDERS.has(c.provider));
  const internalCredentials = credentials.filter((c) => INTERNAL_PROVIDERS.has(c.provider));
  const visibleCredentials = showInternalTokens ? credentials : userCredentials;

  const readinessItems = readinessData?.items ?? [];
  const summary = readinessData?.summary;

  function testKeyId(provider: string, accountAlias: string) {
    return `${provider}:${accountAlias}`;
  }

  async function runConnectionTest(provider: string, accountAlias = "default") {
    const k = testKeyId(provider, accountAlias);
    setTestResults((prev) => ({ ...prev, [k]: { loading: true } }));
    try {
      const res = await fetch("/api/vault/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, accountAlias }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [k]: {
          loading: false,
          ok: Boolean(data.ok),
          detail: data.detail || (data.ok ? "Connected" : "Check failed"),
        },
      }));
      if (data.ok) {
        toast.success(`${provider.toUpperCase()} (${accountAlias}): ${data.detail}`);
      } else {
        toast.error(`${provider.toUpperCase()} (${accountAlias}): ${data.detail}`);
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [k]: { loading: false, ok: false, detail: "Network request failed" },
      }));
      toast.error(`Failed testing ${provider} (${accountAlias})`);
    }
  }

  async function handleTestAllConfigured() {
    setTestingAll(true);
    try {
      const configured = readinessItems.filter((item) => item.configured || item.provider === "webhook");
      await Promise.all(
        configured.map((item) => runConnectionTest(item.provider, item.accountAlias))
      );
    } finally {
      setTestingAll(false);
    }
  }

  function openEditModal(cred: RedactedCredential) {
    setEditingCred(cred);
    setEditAlias(cred.accountAlias);
    setEditUsername(cred.username || "");
    setEditBaseFolder(cred.metadata?.baseFolder || "NovelVisualizer/ComfyUI_Storage");
    setEditLlmProvider(cred.metadata?.llmProvider || cred.accountAlias || "gemini");
    setEditLlmModel(cred.metadata?.model || cred.username || "");
    setEditLlmBaseUrl(cred.metadata?.baseUrl || "");
    setEditNewSecret("");
  }

  async function handleSaveEditModal(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCred) return;
    setSavingEdit(true);
    try {
      const metadata: Record<string, unknown> = { ...(editingCred.metadata || {}) };
      let usernameToSend: string | null = editUsername.trim() || null;

      if (editingCred.provider === "gdrive") {
        metadata.baseFolder = editBaseFolder.trim() || "NovelVisualizer/ComfyUI_Storage";
      } else if (editingCred.provider === "llm") {
        metadata.llmProvider = editLlmProvider.trim().toLowerCase();
        metadata.model = editLlmModel.trim();
        metadata.baseUrl = editLlmBaseUrl.trim() || undefined;
        usernameToSend = editLlmModel.trim() || editLlmProvider;
      }

      const res = await fetch("/api/vault", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: editingCred.provider,
          accountAlias: editingCred.accountAlias,
          newAccountAlias: editAlias.trim() || editingCred.accountAlias,
          username: usernameToSend,
          rawSecret: editNewSecret.trim() || undefined,
          metadata,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to update credential");
        return;
      }

      toast.success(
        editNewSecret.trim()
          ? `Updated metadata & rotated secret for ${editingCred.provider} (${editAlias})`
          : `Updated metadata for ${editingCred.provider} (${editAlias})`
      );
      setEditingCred(null);
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSaveKaggle(e: React.FormEvent) {
    e.preventDefault();
    setSavingKaggle(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "kaggle",
          accountAlias: kaggleAlias,
          username: kaggleUser,
          rawSecret: kaggleKey,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to save Kaggle credential");
        return;
      }
      toast.success(`Encrypted & saved Kaggle (${kaggleAlias})`);
      setKaggleKey("");
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingKaggle(false);
    }
  }

  async function handleSaveGdrive(e: React.FormEvent) {
    e.preventDefault();
    setSavingGdrive(true);
    try {
      const rawSecret =
        gdriveMode === "json"
          ? gdriveRawJson
          : JSON.stringify({
              client_id: gdriveClientId.trim(),
              client_secret: gdriveClientSecret.trim(),
              refresh_token: gdriveRefreshToken.trim(),
              token_type: "Bearer",
            });

      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gdrive",
          accountAlias: "default",
          username: "personal-drive",
          rawSecret,
          metadata: {
            baseFolder: gdriveBaseFolder.trim() || "NovelVisualizer/ComfyUI_Storage",
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to save Google Drive credential");
        return;
      }
      toast.success("Encrypted & saved Google Drive OAuth Vault");
      setGdriveRefreshToken("");
      setGdriveRawJson("");
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingGdrive(false);
    }
  }

  async function handleSaveModelSourceKey(provider: "huggingface" | "civitai", rawSecret: string) {
    if (!rawSecret.trim()) return;
    setSavingSourceKey(provider);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          accountAlias: "default",
          username: provider,
          rawSecret: rawSecret.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || `Failed to save ${provider} token`);
        return;
      }
      toast.success(
        `Encrypted & saved ${provider === "huggingface" ? "HuggingFace" : "Civitai"} key`
      );
      if (provider === "huggingface") setHfToken("");
      else setCivitaiKey("");
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingSourceKey(null);
    }
  }

  async function handleSaveLlm(e: React.FormEvent) {
    e.preventDefault();
    if (!llmApiKey.trim()) return;
    setSavingLlm(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "llm",
          accountAlias: llmProvider,
          username: llmModel.trim() || llmProvider,
          rawSecret: llmApiKey.trim(),
          metadata: {
            llmProvider,
            model: llmModel.trim(),
            baseUrl: llmBaseUrl.trim() || undefined,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to save LLM API key");
        return;
      }
      toast.success(`Encrypted & saved ${llmProvider.toUpperCase()} AI key`);
      setLlmApiKey("");
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleDelete(provider: string, accountAlias: string) {
    if (!confirm(`Delete stored key for ${provider} (${accountAlias})?`)) return;
    const res = await fetch(
      `/api/vault?provider=${encodeURIComponent(provider)}&accountAlias=${encodeURIComponent(accountAlias)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success(`Removed ${provider} (${accountAlias})`);
      await Promise.all([refetchVault(), refetchReadiness()]);
    }
  }

  async function handleSavePreferences(e: React.FormEvent) {
    e.preventDefault();
    if (!prefsDraft) return;
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefsDraft),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save preferences");
        return;
      }
      toast.success("Workspace preferences saved");
      setPrefsOverrides({});
      queryClient.setQueryData(["workspace-settings"], { settings: data.settings });
      refetchSettings();
      refetchReadiness();
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Settings, Readiness &amp; Encrypted Key Vault
          </h1>
          <p className="text-xs text-zinc-400">
            Verify studio key requirements, edit or test AES-256-GCM credentials without re-entering secrets, and configure default routes &amp; guardrails.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("readiness")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "readiness"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Key Readiness ({summary?.configuredCount ?? 0}/{summary?.totalCount ?? 8})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("keys")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "keys"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Stored Keys ({userCredentials.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("preferences")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "preferences"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Workspace Preferences</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("integrations")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "integrations"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            <span>API &amp; Book Visualiser</span>
          </button>
        </div>
      </div>

      {/* TAB A: STUDIO READINESS & KEY REQUIREMENTS MATRIX */}
      {activeTab === "readiness" && (
        <div className="space-y-5">
          <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  summary?.coreReady
                    ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
                    : "border-amber-400/35 bg-amber-500/15 text-amber-200"
                }`}
              >
                {summary?.coreReady ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-400" />
                )}
                <span>
                  Core GPU &amp; Storage: {summary?.coreReady ? "Ready to Boot" : "Setup Needed"}
                </span>
              </div>

              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  summary?.agenticReady
                    ? "border-violet-400/35 bg-violet-500/15 text-violet-200"
                    : "border-white/15 bg-white/[0.04] text-zinc-300"
                }`}
              >
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span>
                  Agentic AI Studio: {summary?.agenticReady ? "LLM Key Ready" : "Missing LLM Key"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleTestAllConfigured}
                disabled={testingAll}
                className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                {testingAll ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-3.5 w-3.5" />
                )}
                Test All Active Connections
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {readinessItems.map((item) => {
              const tKey = testKeyId(item.provider, item.accountAlias);
              const tState = testResults[tKey];
              const matchingCred = credentials.find(
                (c) => c.provider === item.provider && c.accountAlias === item.accountAlias
              );

              return (
                <div
                  key={item.id}
                  className={`glass-panel flex flex-col justify-between gap-3 rounded-2xl p-4 ${
                    item.configured
                      ? "border-emerald-400/25"
                      : item.tier === "REQUIRED"
                      ? "border-rose-400/25 bg-rose-500/[0.03]"
                      : ""
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{item.title}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tierBadge(
                              item.tier
                            )}`}
                          >
                            {tierLabel(item.tier)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">{item.usedFor}</p>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          item.configured
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-white/[0.07] text-zinc-400"
                        }`}
                      >
                        {item.configured ? "Configured" : "Missing"}
                      </span>
                    </div>

                    {item.hint && (
                      <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
                        {item.hint}
                      </div>
                    )}

                    {tState && !tState.loading && tState.detail && (
                      <div
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                          tState.ok
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                            : "border-rose-400/30 bg-rose-500/10 text-rose-200"
                        }`}
                      >
                        {tState.detail}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-2.5">
                    {(item.configured || item.provider === "webhook") && (
                      <button
                        type="button"
                        disabled={Boolean(tState?.loading)}
                        onClick={() => runConnectionTest(item.provider, item.accountAlias)}
                        className="glass-pill flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-white/10"
                      >
                        {tState?.loading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <PlugZap className="h-3 w-3" />
                        )}
                        Live Test
                      </button>
                    )}

                    {item.provider === "colab" ? (
                      <Link
                        href="/vms"
                        className="glass-pill rounded-lg px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-white/10"
                      >
                        Open Colab Setup
                      </Link>
                    ) : item.provider === "webhook" ? null : matchingCred ? (
                      <button
                        type="button"
                        onClick={() => openEditModal(matchingCred)}
                        className="glass-pill flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/10"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit Key
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveTab("keys")}
                        className="rounded-lg bg-indigo-600/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                      >
                        Add Key
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB B: STORED KEYS MANAGER (VIEW, EDIT WITHOUT SECRET, TEST & ADD) */}
      {activeTab === "keys" && (
        <div className="space-y-6">
          {/* Stored Credentials List */}
          <div className="glass-panel rounded-2xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>Already Stored AES-256-GCM Keys</span>
              </div>

              {internalCredentials.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInternalTokens((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  {showInternalTokens ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {showInternalTokens ? "Hide" : "Show"} {internalCredentials.length} internal VM runner tokens
                  </span>
                </button>
              )}
            </div>

            {visibleCredentials.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No credentials configured yet. Add your Kaggle, Google Drive, HF, Civitai, or LLM keys below.
              </p>
            ) : (
              <div className="divide-y divide-white/10">
                {visibleCredentials.map((c) => {
                  const tKey = testKeyId(c.provider, c.accountAlias);
                  const tState = testResults[tKey];
                  const isInternal = INTERNAL_PROVIDERS.has(c.provider);

                  return (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold uppercase text-indigo-300">
                            {c.provider}
                          </span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
                            {c.accountAlias}
                          </span>
                          {c.secretHint && (
                            <span className="rounded border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                              {c.secretHint}
                            </span>
                          )}
                          {c.username && (
                            <span className="text-zinc-300">
                              {c.provider === "llm" ? "Model:" : "User:"} <strong>{c.username}</strong>
                            </span>
                          )}
                          {c.metadata?.baseFolder && (
                            <span className="text-zinc-400">Folder: {c.metadata.baseFolder}</span>
                          )}
                          {c.metadata?.baseUrl && (
                            <span className="text-zinc-500">URL: {c.metadata.baseUrl}</span>
                          )}
                        </div>

                        {tState && !tState.loading && tState.detail && (
                          <div
                            className={`text-[11px] ${
                              tState.ok ? "text-emerald-300" : "text-rose-300"
                            }`}
                          >
                            {tState.detail}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          {c.authType}
                        </span>

                        {!isInternal && (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(tState?.loading)}
                              onClick={() => runConnectionTest(c.provider, c.accountAlias)}
                              className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-cyan-200 hover:bg-white/10"
                              title="Test connection"
                            >
                              {tState?.loading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <PlugZap className="h-3 w-3" />
                              )}
                              Test
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditModal(c)}
                              className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10"
                              title="Edit metadata or rotate key"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDelete(c.provider, c.accountAlias)}
                          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                          title="Delete credential"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add / Update Forms Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Kaggle Form */}
            <form onSubmit={handleSaveKaggle} className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="h-4 w-4 text-cyan-400" />
                <span>Add / Replace Kaggle Account</span>
              </div>

              <div className="space-y-1.5">
                <Label>Account Alias</Label>
                <select
                  value={kaggleAlias}
                  onChange={(e) => setKaggleAlias(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="acc1" className="bg-zinc-900">
                    acc1 (gpu0 &amp; gpu1)
                  </option>
                  <option value="acc2" className="bg-zinc-900">
                    acc2 (gpu2 &amp; gpu3)
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Kaggle Username</Label>
                <Input
                  required
                  value={kaggleUser}
                  onChange={(e) => setKaggleUser(e.target.value)}
                  placeholder="himanshukr7532"
                />
              </div>

              <div className="space-y-1.5">
                <Label>API Key / OAuth Token (KGAT_... or Legacy Hex)</Label>
                <Input
                  required
                  type="password"
                  value={kaggleKey}
                  onChange={(e) => setKaggleKey(e.target.value)}
                  placeholder="KGAT_... or 32-char API key"
                />
              </div>

              <Button
                type="submit"
                disabled={savingKaggle}
                className="w-full bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                {savingKaggle ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Encrypt &amp; Save Kaggle Key
              </Button>
            </form>

            {/* Google Drive Form */}
            <form onSubmit={handleSaveGdrive} className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <KeyRound className="h-4 w-4 text-emerald-400" />
                  <span>Add / Replace Google Drive OAuth Vault</span>
                </div>

                <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setGdriveMode("oauth")}
                    className={`rounded-md px-2 py-1 ${
                      gdriveMode === "oauth" ? "bg-indigo-600 text-white" : "text-zinc-400"
                    }`}
                  >
                    OAuth Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setGdriveMode("json")}
                    className={`rounded-md px-2 py-1 ${
                      gdriveMode === "json" ? "bg-indigo-600 text-white" : "text-zinc-400"
                    }`}
                  >
                    Rclone JSON
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Drive Base Folder</Label>
                <Input
                  value={gdriveBaseFolder}
                  onChange={(e) => setGdriveBaseFolder(e.target.value)}
                  placeholder="NovelVisualizer/ComfyUI_Storage"
                />
                <p className="text-[11px] text-zinc-500">
                  Models load from <code>{gdriveBaseFolder || "Scriptoria"}/models/</code> and outputs save to <code>{gdriveBaseFolder || "Scriptoria"}/outputs/YYYY-MM-DD/</code>.
                </p>
              </div>

              {gdriveMode === "oauth" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>GDRIVE_CLIENT_ID</Label>
                    <Input
                      required
                      value={gdriveClientId}
                      onChange={(e) => setGdriveClientId(e.target.value)}
                      placeholder="...apps.googleusercontent.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>GDRIVE_CLIENT_SECRET</Label>
                    <Input
                      required
                      type="password"
                      value={gdriveClientSecret}
                      onChange={(e) => setGdriveClientSecret(e.target.value)}
                      placeholder="GOCSPX-..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>GDRIVE_REFRESH_TOKEN</Label>
                    <Input
                      required
                      type="password"
                      value={gdriveRefreshToken}
                      onChange={(e) => setGdriveRefreshToken(e.target.value)}
                      placeholder="1//04..."
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label>Rclone Token JSON (from `rclone authorize &quot;drive&quot;`)</Label>
                  <textarea
                    rows={4}
                    required
                    value={gdriveRawJson}
                    onChange={(e) => setGdriveRawJson(e.target.value)}
                    placeholder='{"access_token":"...","refresh_token":"...","expiry":"..."}'
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              <Button
                type="submit"
                disabled={savingGdrive}
                className="w-full bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {savingGdrive ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Encrypt &amp; Save Google Drive Token
              </Button>
            </form>

            {/* HuggingFace & Civitai Direct Fetch Tokens */}
            <div className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="h-4 w-4 text-amber-400" />
                <span>Model Source Tokens (HuggingFace &amp; Civitai)</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Recommended for gated HuggingFace repos (FLUX.1-dev) and direct Civitai downloads.
              </p>

              <div className="space-y-1.5">
                <Label>HuggingFace Read Token (hf_...)</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    placeholder="hf_..."
                  />
                  <Button
                    type="button"
                    disabled={savingSourceKey === "huggingface" || !hfToken.trim()}
                    onClick={() => handleSaveModelSourceKey("huggingface", hfToken)}
                    className="shrink-0 bg-amber-600 text-xs font-semibold text-white hover:bg-amber-500"
                  >
                    {savingSourceKey === "huggingface" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Civitai API Key</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={civitaiKey}
                    onChange={(e) => setCivitaiKey(e.target.value)}
                    placeholder="Civitai API token"
                  />
                  <Button
                    type="button"
                    disabled={savingSourceKey === "civitai" || !civitaiKey.trim()}
                    onClick={() => handleSaveModelSourceKey("civitai", civitaiKey)}
                    className="shrink-0 bg-amber-600 text-xs font-semibold text-white hover:bg-amber-500"
                  >
                    {savingSourceKey === "civitai" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Multi-Provider LLM Vault */}
            <form onSubmit={handleSaveLlm} className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="h-4 w-4 text-violet-400" />
                <span>Agentic AI Co-Director LLM Key</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Provider</Label>
                  <select
                    value={llmProvider}
                    onChange={(e) => {
                      const p = e.target.value;
                      setLlmProvider(p);
                      if (p === "gemini") setLlmModel("gemini-2.5-flash");
                      else if (p === "openai") setLlmModel("gpt-4.1-mini");
                      else if (p === "openrouter") setLlmModel("google/gemini-2.5-flash");
                      else if (p === "ollama") setLlmModel("qwen2.5:14b");
                    }}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="gemini" className="bg-zinc-900">
                      Google Gemini
                    </option>
                    <option value="openai" className="bg-zinc-900">
                      OpenAI
                    </option>
                    <option value="openrouter" className="bg-zinc-900">
                      OpenRouter
                    </option>
                    <option value="ollama" className="bg-zinc-900">
                      Ollama / Local OpenAI-Compatible
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Default Model</Label>
                  <Input
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="gemini-2.5-flash"
                  />
                </div>
              </div>

              {(llmProvider === "openrouter" || llmProvider === "ollama") && (
                <div className="space-y-1.5">
                  <Label>Custom Base URL</Label>
                  <Input
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    placeholder={
                      llmProvider === "ollama"
                        ? "http://127.0.0.1:11434/v1"
                        : "https://openrouter.ai/api/v1"
                    }
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>API Key (use &quot;ollama&quot; for local server)</Label>
                <Input
                  required
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="AIza... / sk-... / ollama"
                />
              </div>

              <Button
                type="submit"
                disabled={savingLlm}
                className="w-full bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500"
              >
                {savingLlm ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Encrypt &amp; Save AI Provider Key
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* TAB C: WORKSPACE PREFERENCES */}
      {activeTab === "preferences" && prefsDraft && (
        <form onSubmit={handleSavePreferences} className="space-y-5">
          {/* Default Landing Dashboard */}
          <div className="glass-panel space-y-3 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="h-4 w-4 text-cyan-400" />
              <span>Default Landing Dashboard (`/`)</span>
            </div>
            <p className="text-xs text-zinc-400">
              Choose which workspace opens automatically when you visit the root URL (`/`). You can always switch tabs at any time from the top navigation bar.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPrefsDraft({ ...prefsDraft, defaultDashboard: "vms" })}
                className={`rounded-xl border p-4 text-left transition ${
                  prefsDraft.defaultDashboard === "vms"
                    ? "border-indigo-400 bg-indigo-500/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-cyan-400" />
                    VM Cluster Dashboard (`/vms`)
                  </span>
                  {prefsDraft.defaultDashboard === "vms" && (
                    <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-200">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Boot Kaggle/Colab GPUs, configure profiles &amp; pre-warm models before launching Studio.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setPrefsDraft({ ...prefsDraft, defaultDashboard: "studio" })}
                className={`rounded-xl border p-4 text-left transition ${
                  prefsDraft.defaultDashboard === "studio"
                    ? "border-indigo-400 bg-indigo-500/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-400" />
                    Agentic Studio (`/studio`)
                  </span>
                  {prefsDraft.defaultDashboard === "studio" && (
                    <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-200">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Jump straight into prompt &amp; workflow creation when GPUs are already booted or auto-managed.
                </p>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Storage & Sync Preferences */}
            <div className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <HardDrive className="h-4 w-4 text-emerald-400" />
                <span>5 TB Drive Storage &amp; VM Disk</span>
              </div>

              <div className="space-y-1.5">
                <Label>Default Google Drive Base Folder</Label>
                <Input
                  value={prefsDraft.gdriveBaseFolder}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, gdriveBaseFolder: e.target.value })
                  }
                  placeholder="NovelVisualizer/ComfyUI_Storage"
                />
              </div>

              <div className="space-y-1.5">
                <Label>VM `/tmp/models` LRU Auto-Cleanup Threshold (GB free)</Label>
                <Input
                  type="number"
                  min={1}
                  max={40}
                  step={0.5}
                  value={prefsDraft.diskCleanupThresholdGb}
                  onChange={(e) =>
                    setPrefsDraft({
                      ...prefsDraft,
                      diskCleanupThresholdGb: Number(e.target.value) || 6,
                    })
                  }
                />
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-xs">
                <div>
                  <div className="font-medium text-zinc-200">
                    Auto-backup Direct HF / Civitai Downloads to 5 TB Drive
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Uploads freshly fetched checkpoints/LoRAs in background via Rclone
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefsDraft.autoBackupToDrive}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, autoBackupToDrive: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-white/10"
                />
              </label>
            </div>

            {/* Compute & Hardware Guardrails */}
            <div className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Cpu className="h-4 w-4 text-amber-400" />
                <span>Compute &amp; Tesla T4 Guardrails</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Global Idle Timeout (minutes, 0 = off)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={prefsDraft.idleTimeoutMinutes}
                    onChange={(e) =>
                      setPrefsDraft({
                        ...prefsDraft,
                        idleTimeoutMinutes: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Default Worker Profile</Label>
                  <select
                    value={prefsDraft.defaultWorkerProfile}
                    onChange={(e) =>
                      setPrefsDraft({ ...prefsDraft, defaultWorkerProfile: e.target.value })
                    }
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    {WORKER_PROFILE_LIST.map((p) => (
                      <option key={p.id} value={p.id} className="bg-zinc-900">
                        {p.shortTag} · {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-xs">
                <div>
                  <div className="font-medium text-zinc-200">
                    Auto-inject `sdxl_vae_fp16_fix` on SDXL / Illustrious / NoobAI
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Prevents black NaN outputs &amp; saves VRAM on 16 GB Tesla T4 GPUs
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefsDraft.autoVaeFixSdxl}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, autoVaeFixSdxl: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-white/20 bg-white/10"
                />
              </label>
            </div>
          </div>

          {/* Agentic AI Defaults */}
          <div className="glass-panel space-y-4 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span>Agentic AI Co-Director Defaults</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Preferred LLM Provider</Label>
                <select
                  value={prefsDraft.preferredLlmProvider}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, preferredLlmProvider: e.target.value })
                  }
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="gemini" className="bg-zinc-900">
                    Google Gemini
                  </option>
                  <option value="openai" className="bg-zinc-900">
                    OpenAI
                  </option>
                  <option value="openrouter" className="bg-zinc-900">
                    OpenRouter
                  </option>
                  <option value="ollama" className="bg-zinc-900">
                    Ollama
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Preferred Model ID</Label>
                <Input
                  value={prefsDraft.preferredLlmModel}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, preferredLlmModel: e.target.value })
                  }
                  placeholder="gemini-2.5-flash"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Default Agent Autonomy</Label>
                <select
                  value={prefsDraft.agentMode}
                  onChange={(e) =>
                    setPrefsDraft({
                      ...prefsDraft,
                      agentMode: e.target.value === "AUTONOMOUS" ? "AUTONOMOUS" : "COPILOT",
                    })
                  }
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="COPILOT" className="bg-zinc-900">
                    Co-Pilot (Approve Plan Before Boot/Run)
                  </option>
                  <option value="AUTONOMOUS" className="bg-zinc-900">
                    Autonomous (Auto-Execute Safe Workflows)
                  </option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Custom Director System Instructions (Optional)</Label>
              <textarea
                rows={3}
                value={prefsDraft.systemInstructions}
                onChange={(e) =>
                  setPrefsDraft({ ...prefsDraft, systemInstructions: e.target.value })
                }
                placeholder="e.g., Prefer anime cinematic lighting, 16:9 composition for establishing shots, and use Illustrious v1.0 as default unless FLUX is requested..."
                className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={savingPrefs}
                className="bg-indigo-600 px-6 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                {savingPrefs ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Workspace Preferences
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* TAB D: BOOK VISUALISER & EXTERNAL API TOKENS */}
      {activeTab === "integrations" && <ExternalApiTokensCard />}

      {/* In-Place Edit Key Modal */}
      <Dialog
        open={Boolean(editingCred)}
        onOpenChange={(open) => !open && setEditingCred(null)}
      >
        <DialogContent className="glass-popover border-white/15 text-zinc-100">
          <DialogHeader>
            <DialogTitle>
              Edit Stored Key — {editingCred?.provider.toUpperCase()} ({editingCred?.accountAlias})
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Update metadata, folder paths, or model settings without re-typing your secret. Leave the secret field blank to keep the existing encrypted key.
            </DialogDescription>
          </DialogHeader>

          {editingCred && (
            <form onSubmit={handleSaveEditModal} className="space-y-3.5 pt-1">
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 font-mono text-[11px] text-zinc-300">
                Current key hint: <span className="text-emerald-300">{editingCred.secretHint || "••••"}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Account Alias</Label>
                  <Input
                    value={editAlias}
                    onChange={(e) => setEditAlias(e.target.value)}
                    required
                  />
                </div>

                {editingCred.provider !== "llm" && (
                  <div className="space-y-1">
                    <Label>Username / Email</Label>
                    <Input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      placeholder="username or label"
                    />
                  </div>
                )}
              </div>

              {editingCred.provider === "gdrive" && (
                <div className="space-y-1">
                  <Label>Google Drive Base Folder</Label>
                  <Input
                    value={editBaseFolder}
                    onChange={(e) => setEditBaseFolder(e.target.value)}
                    placeholder="NovelVisualizer/ComfyUI_Storage"
                  />
                </div>
              )}

              {editingCred.provider === "llm" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>LLM Provider</Label>
                      <Input
                        value={editLlmProvider}
                        onChange={(e) => setEditLlmProvider(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Default Model</Label>
                      <Input
                        value={editLlmModel}
                        onChange={(e) => setEditLlmModel(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Custom Base URL (Optional)</Label>
                    <Input
                      value={editLlmBaseUrl}
                      onChange={(e) => setEditLlmBaseUrl(e.target.value)}
                      placeholder="https://openrouter.ai/api/v1"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label>Rotate / Replace Secret (Optional)</Label>
                <Input
                  type="password"
                  value={editNewSecret}
                  onChange={(e) => setEditNewSecret(e.target.value)}
                  placeholder="Leave blank to keep existing encrypted key"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingCred(null)}
                  className="border-white/15 bg-white/[0.04] text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingEdit}
                  className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  {savingEdit ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-3.5 w-3.5" />
                  )}
                  Save Changes
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

