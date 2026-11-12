"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, Plus, Trash2, Copy, Check, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ApiTokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string;
  hasWebhookSecret: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export function ExternalApiTokensCard() {
  const [name, setName] = useState("Book Visualiser App");
  const [creating, setCreating] = useState(false);
  const [newlyIssued, setNewlyIssued] = useState<{
    rawToken: string;
    webhookSecret: string | null;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data, refetch } = useQuery<{ tokens: ApiTokenItem[] }>({
    queryKey: ["api-tokens"],
    queryFn: async () => {
      const res = await fetch("/api/tokens");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const tokens = data?.tokens ?? [];
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://scriptoria.krhimanshu.in";

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Book Visualiser", scopes: "ingest,batch,read" }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to generate token");
        return;
      }
      setNewlyIssued({ rawToken: body.rawToken, webhookSecret: body.webhookSecret });
      toast.success("Generated external API token — copy it now!");
      refetch();
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this external API token immediately?")) return;
    await fetch(`/api/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast.success("Revoked API token");
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-[#111114] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <FileCode2 className="h-4 w-4 text-zinc-400" />
          <span>Book Visualiser &amp; External App Ingestion API (`v1`)</span>
        </div>
        <p className="text-xs text-zinc-400">
          Issue scoped Bearer keys (`sk_scriptoria_...`) so external apps can submit canonical scenes or raw prose to the Multi-GPU Batch Optimizer.
        </p>

        <div className="grid grid-cols-1 gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300 sm:grid-cols-2">
          <div>
            <span className="text-zinc-500">POST</span> {origin}/api/v1/ingest
          </div>
          <div>
            <span className="text-zinc-500">GET</span> {origin}/api/v1/schema
          </div>
        </div>

        <form onSubmit={handleCreateToken} className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token label (e.g. Book Visualiser Prod)"
            className="h-8 max-w-xs text-xs"
          />
          <Button
            type="submit"
            disabled={creating}
            className="h-8 bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500"
          >
            {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Generate API Token
          </Button>
        </form>

        {newlyIssued && (
          <div className="space-y-2 rounded-md border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs">
            <div className="font-medium text-emerald-200">
              Save this token now — it will not be shown in full again:
            </div>
            <div className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-white">
              <span className="truncate">{newlyIssued.rawToken}</span>
              <button
                type="button"
                onClick={() => handleCopy("token", newlyIssued.rawToken)}
                className="text-zinc-400 hover:text-white"
              >
                {copiedField === "token" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            {newlyIssued.webhookSecret && (
              <div className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
                <span className="truncate">Webhook HMAC Secret: {newlyIssued.webhookSecret}</span>
                <button
                  type="button"
                  onClick={() => handleCopy("wh", newlyIssued.webhookSecret!)}
                  className="text-zinc-400 hover:text-white"
                >
                  {copiedField === "wh" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-[#111114]">
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-xs font-medium text-zinc-300">
          <KeyRound className="h-3.5 w-3.5 text-zinc-500" />
          <span>Active Tokens ({tokens.length})</span>
        </div>

        {tokens.length === 0 ? (
          <p className="p-4 text-xs text-zinc-500">No external app tokens issued yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {tokens.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{t.name}</span>
                  <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                    {t.tokenPrefix}
                  </span>
                  <span className="text-[11px] text-zinc-500">Scopes: {t.scopes}</span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>
                    Last used: {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "Never"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(t.id)}
                    className="text-zinc-500 hover:text-rose-400"
                    title="Revoke token"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

