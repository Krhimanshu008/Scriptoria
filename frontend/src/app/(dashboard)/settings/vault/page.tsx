"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface RedactedCredential {
  id: string;
  provider: string;
  accountAlias: string;
  username: string | null;
  authType: string;
  metadata: { baseFolder?: string; model?: string; baseUrl?: string; llmProvider?: string } | null;
  updatedAt: string;
}

export default function VaultPage() {
  const [kaggleAlias, setKaggleAlias] = useState("acc1");
  const [kaggleUser, setKaggleUser] = useState("");
  const [kaggleKey, setKaggleKey] = useState("");
  const [savingKaggle, setSavingKaggle] = useState(false);

  const [gdriveMode, setGdriveMode] = useState<"oauth" | "json">("oauth");
  const [gdriveClientId, setGdriveClientId] = useState("");
  const [gdriveClientSecret, setGdriveClientSecret] = useState("");
  const [gdriveRefreshToken, setGdriveRefreshToken] = useState("");
  const [gdriveRawJson, setGdriveRawJson] = useState("");
  const [gdriveBaseFolder, setGdriveBaseFolder] = useState("Scriptoria");
  const [savingGdrive, setSavingGdrive] = useState(false);

  const [hfToken, setHfToken] = useState("");
  const [civitaiKey, setCivitaiKey] = useState("");
  const [savingSourceKey, setSavingSourceKey] = useState<"huggingface" | "civitai" | null>(null);

  const [llmProvider, setLlmProvider] = useState("gemini");
  const [llmModel, setLlmModel] = useState("gemini-2.5-flash");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);

  const { data, refetch } = useQuery<{ credentials: RedactedCredential[] }>({
    queryKey: ["vault-credentials"],
    queryFn: async () => {
      const res = await fetch("/api/vault");
      if (!res.ok) throw new Error("Failed to load vault");
      return res.json();
    },
  });

  const credentials = data?.credentials ?? [];

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
      refetch();
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
          metadata: { baseFolder: gdriveBaseFolder.trim() || "Scriptoria" },
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
      refetch();
    } finally {
      setSavingGdrive(false);
    }
  }

  async function handleDelete(provider: string, accountAlias: string) {
    const res = await fetch(
      `/api/vault?provider=${encodeURIComponent(provider)}&accountAlias=${encodeURIComponent(accountAlias)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success(`Removed ${provider} (${accountAlias})`);
      refetch();
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
      toast.success(`Encrypted & saved ${provider === "huggingface" ? "HuggingFace" : "Civitai"} key`);
      if (provider === "huggingface") setHfToken("");
      else setCivitaiKey("");
      refetch();
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
      refetch();
    } finally {
      setSavingLlm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">AES-256-GCM Credential Vault</h1>
        <p className="text-xs text-zinc-400">
          All Kaggle API tokens and Google Drive OAuth tokens are encrypted per-record with unique IVs &amp; GCM auth tags before storage.
        </p>
      </div>

      {/* Stored Credentials Table */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Configured Encrypted Keys</span>
        </div>

        {credentials.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No credentials configured yet. Add your Kaggle and Google Drive tokens below.
          </p>
        ) : (
          <div className="divide-y divide-white/10">
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-3 text-xs">
                <div>
                  <span className="font-mono font-bold uppercase text-indigo-400">
                    {c.provider}
                  </span>{" "}
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    {c.accountAlias}
                  </span>
                  {c.username && (
                    <span className="ml-2 text-zinc-400">User: {c.username}</span>
                  )}
                  {c.metadata?.baseFolder && (
                    <span className="ml-2 text-zinc-500">
                      Folder: {c.metadata.baseFolder}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    {c.authType} · encrypted
                  </span>
                  <button
                    onClick={() => handleDelete(c.provider, c.accountAlias)}
                    className="text-zinc-500 transition hover:text-rose-400"
                    title="Delete credential"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Kaggle Form */}
        <form
          onSubmit={handleSaveKaggle}
          className="glass-panel space-y-4 rounded-2xl p-5"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <KeyRound className="h-4 w-4 text-cyan-400" />
            <span>Kaggle Account Credentials</span>
          </div>

          <div className="space-y-1.5">
            <Label>Account Alias</Label>
            <select
              value={kaggleAlias}
              onChange={(e) => setKaggleAlias(e.target.value)}
              className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
            >
              <option value="acc1" className="bg-zinc-900">acc1 (gpu0 &amp; gpu1)</option>
              <option value="acc2" className="bg-zinc-900">acc2 (gpu2 &amp; gpu3)</option>
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
            {savingKaggle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Encrypt &amp; Save Kaggle Key
          </Button>
        </form>

        {/* Google Drive Form */}
        <form
          onSubmit={handleSaveGdrive}
          className="glass-panel space-y-4 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              <span>Google Drive Rclone / OAuth Vault</span>
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
              placeholder="Scriptoria or NovelVisualizer/ComfyUI_Storage"
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
            {savingGdrive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
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
            Optional for public models; required for gated HuggingFace repos (FLUX.1-dev) and Civitai downloads.
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
                <option value="gemini" className="bg-zinc-900">Google Gemini</option>
                <option value="openai" className="bg-zinc-900">OpenAI</option>
                <option value="openrouter" className="bg-zinc-900">OpenRouter</option>
                <option value="ollama" className="bg-zinc-900">Ollama / Local OpenAI-Compatible</option>
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
            {savingLlm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Encrypt &amp; Save AI Provider Key
          </Button>
        </form>
      </div>
    </div>
  );
}

