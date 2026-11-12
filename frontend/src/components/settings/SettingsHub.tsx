"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Trash2,
  Save,
  Loader2,
  Pencil,
  PlugZap,
  Eye,
  EyeOff,
  RefreshCw,
  Plus,
} from "lucide-react";
import type { ReadinessItem } from "@/app/api/settings/readiness/route";
import type { PublicWorkspaceSettings } from "@/lib/settings/workspace-settings";
import type { FetchedModelOption } from "@/app/api/vault/llm-models/route";
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
type AddProviderKind = "kaggle" | "gdrive" | "huggingface" | "civitai" | "llm";

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
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    case "REQUIRED_FOR_AGENT":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";
    case "RECOMMENDED":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-zinc-700 bg-zinc-800/70 text-zinc-300";
  }
}

function tierLabel(tier: ReadinessItem["tier"]) {
  switch (tier) {
    case "REQUIRED":
      return "Required";
    case "REQUIRED_FOR_AGENT":
      return "Required (AI)";
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

  // Add key modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addKind, setAddKind] = useState<AddProviderKind>("llm");

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

  // Add form states
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

  const [sourceKind, setSourceKind] = useState<"huggingface" | "civitai">("huggingface");
  const [sourceSecret, setSourceSecret] = useState("");
  const [savingSourceKey, setSavingSourceKey] = useState(false);

  const [llmProvider, setLlmProvider] = useState("gemini");
  const [llmAlias, setLlmAlias] = useState("gemini");
  const [llmModel, setLlmModel] = useState("gemini-3.5-flash-lite");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModelOption[]>([]);
  const [editFetchedModels, setEditFetchedModels] = useState<FetchedModelOption[]>([]);

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
      if (data.ok) toast.success(`${provider.toUpperCase()} (${accountAlias}): ${data.detail}`);
      else toast.error(`${provider.toUpperCase()} (${accountAlias}): ${data.detail}`);
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
      const configured = readinessItems.filter(
        (item) => item.configured || item.provider === "webhook"
      );
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
    setEditFetchedModels([]);
  }

  function openAddModalForProvider(provider: string) {
    if (provider === "kaggle" || provider === "gdrive" || provider === "huggingface" || provider === "civitai" || provider === "llm") {
      setAddKind(provider);
      if (provider === "huggingface" || provider === "civitai") setSourceKind(provider);
    } else {
      setAddKind("llm");
    }
    setAddModalOpen(true);
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
          : `Updated ${editingCred.provider} (${editAlias})`
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
      setAddModalOpen(false);
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
      setAddModalOpen(false);
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingGdrive(false);
    }
  }

  async function handleSaveModelSourceKey(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceSecret.trim()) return;
    setSavingSourceKey(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: sourceKind,
          accountAlias: "default",
          username: sourceKind,
          rawSecret: sourceSecret.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || `Failed to save ${sourceKind} token`);
        return;
      }
      toast.success(`Encrypted & saved ${sourceKind === "huggingface" ? "HuggingFace" : "Civitai"} key`);
      setSourceSecret("");
      setAddModalOpen(false);
      await Promise.all([refetchVault(), refetchReadiness()]);
    } finally {
      setSavingSourceKey(false);
    }
  }

  async function handleFetchLlmModels(params: {
    provider: string;
    apiKey?: string;
    accountAlias?: string;
    baseUrl?: string;
    target: "add" | "edit";
  }) {
    setFetchingModels(true);
    try {
      const res = await fetch("/api/vault/llm-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: params.provider,
          apiKey: params.apiKey,
          accountAlias: params.accountAlias,
          baseUrl: params.baseUrl,
          onlyFree: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to fetch live models");
        return;
      }
      const list = (data.models || []) as FetchedModelOption[];
      if (params.target === "add") {
        setFetchedModels(list);
        if (list[0]) setLlmModel(list[0].id);
      } else {
        setEditFetchedModels(list);
      }
      toast.success(`Loaded ${list.length} free model(s) from ${params.provider.toUpperCase()}`);
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleSaveLlm(e: React.FormEvent) {
    e.preventDefault();
    if (!llmApiKey.trim()) return;
    const resolvedAlias = llmAlias.trim().toLowerCase() || llmProvider;
    setSavingLlm(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "llm",
          accountAlias: resolvedAlias,
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
      toast.success(`Encrypted & saved ${llmProvider.toUpperCase()} key (${resolvedAlias})`);
      setLlmApiKey("");
      setAddModalOpen(false);
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
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Clean Underline Header */}
      <div className="space-y-3">
        <div>
          <h1 className="text-base font-semibold text-white">Settings &amp; Credential Vault</h1>
          <p className="text-xs text-zinc-500">
            Verify studio readiness, manage AES-256-GCM encrypted keys, and configure defaults.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-b border-zinc-800 text-xs font-medium">
          {[
            { id: "readiness" as const, label: `Readiness (${summary?.configuredCount ?? 0}/${summary?.totalCount ?? 8})` },
            { id: "keys" as const, label: `Stored Keys (${userCredentials.length})` },
            { id: "preferences" as const, label: "Workspace Preferences" },
            { id: "integrations" as const, label: "API & Book Visualiser" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 pb-2.5 transition ${
                activeTab === tab.id
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB A: READINESS CHECKLIST TABLE */}
      {activeTab === "readiness" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    summary?.coreReady ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                Core Cluster: {summary?.coreReady ? "Ready" : "Setup Needed"}
              </span>
              <span className="text-zinc-700">|</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    summary?.agenticReady ? "bg-emerald-500" : "bg-zinc-600"
                  }`}
                />
                Agentic AI: {summary?.agenticReady ? "Ready" : "Missing Key"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleTestAllConfigured}
              disabled={testingAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              {testingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5 text-zinc-400" />
              )}
              <span>Test All Connections</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#111114]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-medium text-zinc-500">
                <tr>
                  <th className="px-3.5 py-2.5">Requirement</th>
                  <th className="px-3 py-2.5">Tier</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Details / Live Result</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {readinessItems.map((item) => {
                  const tKey = testKeyId(item.provider, item.accountAlias);
                  const tState = testResults[tKey];
                  const matchingCred = credentials.find(
                    (c) => c.provider === item.provider && c.accountAlias === item.accountAlias
                  );

                  return (
                    <tr key={item.id} className="hover:bg-zinc-900/50">
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium text-zinc-100">{item.title}</div>
                        <div className="text-[11px] text-zinc-500">{item.usedFor}</div>
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tierBadge(
                            item.tier
                          )}`}
                        >
                          {tierLabel(item.tier)}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                            item.configured ? "text-emerald-400" : "text-zinc-500"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              item.configured ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                          />
                          {item.configured ? "Configured" : "Missing"}
                        </span>
                      </td>

                      <td className="max-w-xs px-3 py-2.5 font-mono text-[11px]">
                        {tState && !tState.loading && tState.detail ? (
                          <span className={tState.ok ? "text-emerald-300" : "text-rose-400"}>
                            {tState.detail}
                          </span>
                        ) : (
                          <span className="text-zinc-400">{item.hint || "--"}</span>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {(item.configured || item.provider === "webhook") && (
                            <button
                              type="button"
                              disabled={Boolean(tState?.loading)}
                              onClick={() => runConnectionTest(item.provider, item.accountAlias)}
                              className="inline-flex h-7 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                            >
                              {tState?.loading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <PlugZap className="h-3 w-3" />
                              )}
                              Test
                            </button>
                          )}

                          {item.provider === "colab" ? (
                            <Link
                              href="/vms"
                              className="inline-flex h-7 items-center rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                            >
                              Colab Setup
                            </Link>
                          ) : item.provider === "webhook" ? null : matchingCred ? (
                            <button
                              type="button"
                              onClick={() => openEditModal(matchingCred)}
                              className="inline-flex h-7 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openAddModalForProvider(item.provider)}
                              className="inline-flex h-7 items-center gap-1 rounded bg-indigo-600 px-2.5 text-[11px] font-medium text-white hover:bg-indigo-500"
                            >
                              <Plus className="h-3 w-3" />
                              Add
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB B: STORED KEYS TABLE + ADD KEY MODAL TRIGGER */}
      {activeTab === "keys" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-zinc-300">
                AES-256-GCM Encrypted Credentials
              </span>
              {internalCredentials.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInternalTokens((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  {showInternalTokens ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                  <span>
                    {showInternalTokens ? "Hide" : "Show"} {internalCredentials.length} runtime tokens
                  </span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Key</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#111114]">
            {visibleCredentials.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No credentials configured yet. Click <strong>Add Key</strong> to add Kaggle, Drive, HuggingFace, Civitai, or AI Provider keys.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-medium text-zinc-500">
                  <tr>
                    <th className="px-3.5 py-2.5">Provider</th>
                    <th className="px-3 py-2.5">Alias</th>
                    <th className="px-3 py-2.5">Identity / Model</th>
                    <th className="px-3 py-2.5">Secret Hint</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3.5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {visibleCredentials.map((c) => {
                    const tKey = testKeyId(c.provider, c.accountAlias);
                    const tState = testResults[tKey];
                    const isInternal = INTERNAL_PROVIDERS.has(c.provider);

                    return (
                      <tr key={c.id} className="hover:bg-zinc-900/50">
                        <td className="px-3.5 py-2.5 font-mono text-[11px] font-semibold uppercase text-zinc-200">
                          {c.provider}
                        </td>

                        <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-300">
                          {c.accountAlias}
                        </td>

                        <td className="px-3 py-2.5 text-[11px] text-zinc-300">
                          <div>{c.username || c.metadata?.baseFolder || "--"}</div>
                          {c.metadata?.baseFolder && c.username && (
                            <div className="font-mono text-[10px] text-zinc-500">
                              {c.metadata.baseFolder}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-400">
                          {c.secretHint || "••••"}
                        </td>

                        <td className="max-w-xs px-3 py-2.5 text-[11px]">
                          {tState && !tState.loading && tState.detail ? (
                            <span className={tState.ok ? "text-emerald-400" : "text-rose-400"}>
                              {tState.detail}
                            </span>
                          ) : (
                            <span className="text-zinc-500">{c.authType}</span>
                          )}
                        </td>

                        <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!isInternal && (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(tState?.loading)}
                                  onClick={() => runConnectionTest(c.provider, c.accountAlias)}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
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
                                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                >
                                  <Pencil className="h-3 w-3" />
                                  Edit
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(c.provider, c.accountAlias)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-rose-500/40 hover:text-rose-400"
                              title="Delete credential"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB C: LINEAR-STYLE WORKSPACE PREFERENCES */}
      {activeTab === "preferences" && prefsDraft && (
        <form onSubmit={handleSavePreferences} className="space-y-4">
          <div className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-[#111114]">
            {/* Default Dashboard */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">Default Landing Route (`/`)</div>
                <div className="text-[11px] text-zinc-500">
                  Workspace loaded immediately upon opening root URL.
                </div>
              </div>
              <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                {(["vms", "studio"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPrefsDraft({ ...prefsDraft, defaultDashboard: opt })}
                    className={`rounded px-3 py-1 font-medium transition ${
                      prefsDraft.defaultDashboard === opt
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {opt === "vms" ? "VM Cluster (/vms)" : "Studio (/studio)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Drive Base Folder */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">Google Drive Base Folder</div>
                <div className="text-[11px] text-zinc-500">
                  Root directory on 5 TB Drive for `models/`, `outputs/`, and FastBoot cache.
                </div>
              </div>
              <Input
                value={prefsDraft.gdriveBaseFolder}
                onChange={(e) =>
                  setPrefsDraft({ ...prefsDraft, gdriveBaseFolder: e.target.value })
                }
                className="h-8 w-full max-w-xs font-mono text-xs"
              />
            </div>

            {/* Auto-Backup */}
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">
                  Auto-Backup Direct HF / Civitai Downloads
                </div>
                <div className="text-[11px] text-zinc-500">
                  Upload newly fetched models to 5 TB Drive asynchronously via Rclone.
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefsDraft.autoBackupToDrive}
                onChange={(e) =>
                  setPrefsDraft({ ...prefsDraft, autoBackupToDrive: e.target.checked })
                }
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
              />
            </div>

            {/* Disk Threshold & Idle Timeout */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">
                  VM `/tmp/models` Cleanup &amp; Idle Timeout
                </div>
                <div className="text-[11px] text-zinc-500">
                  LRU disk free target (GB) and automatic VM shutdown minutes (`0` disables).
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                  className="h-8 w-20 text-xs"
                  title="Min Free GB"
                />
                <span className="text-[11px] text-zinc-500">GB</span>
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
                  className="h-8 w-20 text-xs"
                  title="Idle Timeout Minutes"
                />
                <span className="text-[11px] text-zinc-500">min</span>
              </div>
            </div>

            {/* Default Worker Profile + SDXL T4 VAE Fix */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">
                  Default Worker Profile &amp; T4 SDXL VAE Fix
                </div>
                <div className="text-[11px] text-zinc-500">
                  Auto-inject `sdxl_vae_fp16_fix.safetensors` to prevent black NaN outputs on T4.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={prefsDraft.defaultWorkerProfile}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, defaultWorkerProfile: e.target.value })
                  }
                  className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-200"
                >
                  {WORKER_PROFILE_LIST.map((p) => (
                    <option key={p.id} value={p.id} className="bg-zinc-900">
                      {p.shortTag} · {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="checkbox"
                  checked={prefsDraft.autoVaeFixSdxl}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, autoVaeFixSdxl: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
                />
              </div>
            </div>

            {/* Preferred AI Provider + Model + Autonomy */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-xs font-medium text-zinc-100">
                  Agentic AI Provider, Model &amp; Mode
                </div>
                <div className="text-[11px] text-zinc-500">
                  Primary provider with automatic failover across stored free keys.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={prefsDraft.preferredLlmProvider}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, preferredLlmProvider: e.target.value })
                  }
                  className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                >
                  <option value="gemini" className="bg-zinc-900">Gemini</option>
                  <option value="groq" className="bg-zinc-900">Groq</option>
                  <option value="openrouter" className="bg-zinc-900">OpenRouter</option>
                  <option value="openai" className="bg-zinc-900">OpenAI</option>
                  <option value="ollama" className="bg-zinc-900">Ollama</option>
                </select>
                <Input
                  value={prefsDraft.preferredLlmModel}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, preferredLlmModel: e.target.value })
                  }
                  className="h-8 w-44 font-mono text-xs"
                />
                <select
                  value={prefsDraft.agentMode}
                  onChange={(e) =>
                    setPrefsDraft({
                      ...prefsDraft,
                      agentMode: e.target.value === "AUTONOMOUS" ? "AUTONOMOUS" : "COPILOT",
                    })
                  }
                  className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                >
                  <option value="COPILOT" className="bg-zinc-900">Co-Pilot</option>
                  <option value="AUTONOMOUS" className="bg-zinc-900">Autonomous</option>
                </select>
              </div>
            </div>

            {/* Director Instructions */}
            <div className="space-y-1.5 px-4 py-3">
              <Label className="text-xs font-medium text-zinc-100">
                Custom Director System Instructions
              </Label>
              <textarea
                rows={2}
                value={prefsDraft.systemInstructions}
                onChange={(e) =>
                  setPrefsDraft({ ...prefsDraft, systemInstructions: e.target.value })
                }
                placeholder="Optional style, camera, or safety defaults for Agentic AI..."
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={savingPrefs}
              className="h-8 bg-indigo-600 px-4 text-xs font-medium text-white hover:bg-indigo-500"
            >
              {savingPrefs ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save Preferences
            </Button>
          </div>
        </form>
      )}

      {/* TAB D: BOOK VISUALISER & EXTERNAL API TOKENS */}
      {activeTab === "integrations" && <ExternalApiTokensCard />}

      {/* Unified "+ Add Key" Modal (Replaces 4 giant permanent form cards) */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="border-zinc-800 bg-[#111114] text-zinc-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-indigo-400" />
              Add Encrypted Vault Credential
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Secrets are encrypted with AES-256-GCM before storage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-5 gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1 text-[11px] font-medium">
              {(
                [
                  { id: "llm", label: "AI / LLM" },
                  { id: "kaggle", label: "Kaggle" },
                  { id: "gdrive", label: "Drive" },
                  { id: "huggingface", label: "HF" },
                  { id: "civitai", label: "Civitai" },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => {
                    setAddKind(k.id);
                    if (k.id === "huggingface" || k.id === "civitai") setSourceKind(k.id);
                  }}
                  className={`rounded py-1 transition ${
                    addKind === k.id ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            {addKind === "llm" && (
              <form onSubmit={handleSaveLlm} className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-xs">Provider</Label>
                    <select
                      value={llmProvider}
                      onChange={(e) => {
                        const p = e.target.value;
                        setLlmProvider(p);
                        setLlmAlias(p);
                        setFetchedModels([]);
                        if (p === "gemini") setLlmModel("gemini-3.5-flash-lite");
                        else if (p === "groq") setLlmModel("openai/gpt-oss-120b");
                        else if (p === "openrouter") setLlmModel("openrouter/free");
                        else if (p === "openai") setLlmModel("gpt-4.1-mini");
                        else if (p === "ollama") setLlmModel("qwen2.5:14b");
                      }}
                      className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100"
                    >
                      <option value="gemini" className="bg-zinc-900">Google Gemini (Free)</option>
                      <option value="groq" className="bg-zinc-900">Groq (Free Fast LPUs)</option>
                      <option value="openrouter" className="bg-zinc-900">OpenRouter (:free)</option>
                      <option value="openai" className="bg-zinc-900">OpenAI</option>
                      <option value="ollama" className="bg-zinc-900">Ollama</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Key Alias (supports multiple)</Label>
                    <Input
                      name="llm-key-alias"
                      autoComplete="off"
                      value={llmAlias}
                      onChange={(e) => setLlmAlias(e.target.value)}
                      placeholder="gemini, gemini-2, groq-2"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Default Model</Label>
                    <button
                      type="button"
                      disabled={fetchingModels}
                      onClick={() =>
                        handleFetchLlmModels({
                          provider: llmProvider,
                          apiKey: llmApiKey.trim() || undefined,
                          baseUrl: llmBaseUrl.trim() || undefined,
                          target: "add",
                        })
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      <RefreshCw className={`h-3 w-3 ${fetchingModels ? "animate-spin" : ""}`} />
                      Fetch Free Models
                    </button>
                  </div>
                  <Input
                    name="llm-model-id"
                    autoComplete="off"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                  />
                </div>

                {fetchedModels.length > 0 && (
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 font-mono text-xs text-emerald-300"
                  >
                    {fetchedModels.map((m) => (
                      <option key={m.id} value={m.id} className="bg-zinc-900">
                        {m.label} {m.note ? `· ${m.note}` : ""}
                      </option>
                    ))}
                  </select>
                )}

                {(llmProvider === "openrouter" || llmProvider === "ollama") && (
                  <div className="space-y-1">
                    <Label className="text-xs">Base URL</Label>
                    <Input
                      name="llm-custom-base-url"
                      autoComplete="off"
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

                <div className="space-y-1">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    name="llm-secret-token"
                    autoComplete="new-password"
                    required
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder="AIza... / gsk_... / sk-or-..."
                  />
                </div>

                <Button type="submit" disabled={savingLlm} className="w-full bg-indigo-600 text-xs">
                  {savingLlm ? "Saving..." : "Encrypt & Save AI Key"}
                </Button>
              </form>
            )}

            {addKind === "kaggle" && (
              <form onSubmit={handleSaveKaggle} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Account Alias</Label>
                  <select
                    value={kaggleAlias}
                    onChange={(e) => setKaggleAlias(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100"
                  >
                    <option value="acc1" className="bg-zinc-900">acc1 (gpu0 &amp; gpu1)</option>
                    <option value="acc2" className="bg-zinc-900">acc2 (gpu2 &amp; gpu3)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Kaggle Username</Label>
                  <Input required value={kaggleUser} onChange={(e) => setKaggleUser(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">API Key (KGAT_... or 32-char)</Label>
                  <Input
                    name="kaggle-api-secret"
                    autoComplete="new-password"
                    required
                    type="password"
                    value={kaggleKey}
                    onChange={(e) => setKaggleKey(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={savingKaggle} className="w-full bg-indigo-600 text-xs">
                  {savingKaggle ? "Saving..." : "Encrypt & Save Kaggle Key"}
                </Button>
              </form>
            )}

            {addKind === "gdrive" && (
              <form onSubmit={handleSaveGdrive} className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Drive Base Folder</Label>
                  <div className="flex gap-1 rounded border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setGdriveMode("oauth")}
                      className={`rounded px-2 py-0.5 ${
                        gdriveMode === "oauth" ? "bg-zinc-800 text-white" : "text-zinc-500"
                      }`}
                    >
                      OAuth
                    </button>
                    <button
                      type="button"
                      onClick={() => setGdriveMode("json")}
                      className={`rounded px-2 py-0.5 ${
                        gdriveMode === "json" ? "bg-zinc-800 text-white" : "text-zinc-500"
                      }`}
                    >
                      Rclone JSON
                    </button>
                  </div>
                </div>
                <Input
                  value={gdriveBaseFolder}
                  onChange={(e) => setGdriveBaseFolder(e.target.value)}
                  placeholder="NovelVisualizer/ComfyUI_Storage"
                />
                {gdriveMode === "oauth" ? (
                  <>
                    <Input
                      required
                      value={gdriveClientId}
                      onChange={(e) => setGdriveClientId(e.target.value)}
                      placeholder="GDRIVE_CLIENT_ID"
                    />
                    <Input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={gdriveClientSecret}
                      onChange={(e) => setGdriveClientSecret(e.target.value)}
                      placeholder="GDRIVE_CLIENT_SECRET"
                    />
                    <Input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={gdriveRefreshToken}
                      onChange={(e) => setGdriveRefreshToken(e.target.value)}
                      placeholder="GDRIVE_REFRESH_TOKEN"
                    />
                  </>
                ) : (
                  <textarea
                    rows={4}
                    required
                    value={gdriveRawJson}
                    onChange={(e) => setGdriveRawJson(e.target.value)}
                    placeholder='{"access_token":"...","refresh_token":"..."}'
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-100"
                  />
                )}
                <Button type="submit" disabled={savingGdrive} className="w-full bg-indigo-600 text-xs">
                  {savingGdrive ? "Saving..." : "Encrypt & Save Drive Token"}
                </Button>
              </form>
            )}

            {(addKind === "huggingface" || addKind === "civitai") && (
              <form onSubmit={handleSaveModelSourceKey} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {sourceKind === "huggingface" ? "HuggingFace Read Token (hf_...)" : "Civitai API Key"}
                  </Label>
                  <Input
                    name="model-source-token"
                    autoComplete="new-password"
                    required
                    type="password"
                    value={sourceSecret}
                    onChange={(e) => setSourceSecret(e.target.value)}
                    placeholder={sourceKind === "huggingface" ? "hf_..." : "Civitai token"}
                  />
                </div>
                <Button type="submit" disabled={savingSourceKey} className="w-full bg-indigo-600 text-xs">
                  {savingSourceKey ? "Saving..." : `Encrypt & Save ${sourceKind.toUpperCase()} Key`}
                </Button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* In-Place Edit Key Modal */}
      <Dialog
        open={Boolean(editingCred)}
        onOpenChange={(open) => !open && setEditingCred(null)}
      >
        <DialogContent className="border-zinc-800 bg-[#111114] text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Edit {editingCred?.provider.toUpperCase()} ({editingCred?.accountAlias})
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Update metadata without re-entering your secret, or supply a new secret to rotate it.
            </DialogDescription>
          </DialogHeader>

          {editingCred && (
            <form onSubmit={handleSaveEditModal} className="space-y-3 pt-1">
              <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                Hint: <span className="text-emerald-400">{editingCred.secretHint || "••••"}</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Account Alias</Label>
                  <Input value={editAlias} onChange={(e) => setEditAlias(e.target.value)} required />
                </div>

                {editingCred.provider !== "llm" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Username / Email</Label>
                    <Input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {editingCred.provider === "gdrive" && (
                <div className="space-y-1">
                  <Label className="text-xs">Google Drive Base Folder</Label>
                  <Input
                    value={editBaseFolder}
                    onChange={(e) => setEditBaseFolder(e.target.value)}
                  />
                </div>
              )}

              {editingCred.provider === "llm" && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-xs">LLM Provider</Label>
                      <Input
                        value={editLlmProvider}
                        onChange={(e) => setEditLlmProvider(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Default Model</Label>
                        <button
                          type="button"
                          disabled={fetchingModels}
                          onClick={() =>
                            handleFetchLlmModels({
                              provider: editLlmProvider,
                              accountAlias: editingCred.accountAlias,
                              baseUrl: editLlmBaseUrl.trim() || undefined,
                              target: "edit",
                            })
                          }
                          className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
                        >
                          {fetchingModels ? "Loading..." : "Fetch Free Models"}
                        </button>
                      </div>
                      <Input
                        name="edit-llm-model"
                        autoComplete="off"
                        value={editLlmModel}
                        onChange={(e) => setEditLlmModel(e.target.value)}
                      />
                    </div>
                  </div>

                  {editFetchedModels.length > 0 && (
                    <select
                      value={editLlmModel}
                      onChange={(e) => setEditLlmModel(e.target.value)}
                      className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 font-mono text-xs text-emerald-300"
                    >
                      {editFetchedModels.map((m) => (
                        <option key={m.id} value={m.id} className="bg-zinc-900">
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs">Custom Base URL (Optional)</Label>
                    <Input
                      name="edit-llm-base-url"
                      autoComplete="off"
                      value={editLlmBaseUrl}
                      onChange={(e) => setEditLlmBaseUrl(e.target.value)}
                      placeholder="https://openrouter.ai/api/v1"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Rotate Secret (Optional)</Label>
                <Input
                  name="edit-rotate-secret"
                  autoComplete="new-password"
                  type="password"
                  value={editNewSecret}
                  onChange={(e) => setEditNewSecret(e.target.value)}
                  placeholder="Leave blank to keep existing key"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingCred(null)}
                  className="border-zinc-800 bg-zinc-900 text-xs"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={savingEdit} className="bg-indigo-600 text-xs">
                  {savingEdit ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
