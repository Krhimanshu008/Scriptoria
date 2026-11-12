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
  metadata: { baseFolder?: string } | null;
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
      </div>
    </div>
  );
}

