"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Globe, Copy, Check, Download } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { AccountClusterCard } from "@/components/gpu/AccountClusterCard";
import { LiveConsole } from "@/components/logs/LiveConsole";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
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

function CommandCenterContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [probing, setProbing] = useState(false);
  const [connectModalAlias, setConnectModalAlias] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [driveUrlInput, setDriveUrlInput] = useState("");
  const [includeColabScope, setIncludeColabScope] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  useEffect(() => {
    const connected = searchParams.get("colabConnected");
    const err = searchParams.get("colabError");
    if (connected) {
      toast.success(`Connected Google account (${connected})`);
      queryClient.invalidateQueries({ queryKey: ["vm-accounts"] });
      router.replace("/");
    } else if (err) {
      toast.error(`Colab / Google error: ${err}`);
      router.replace("/");
    }
  }, [searchParams, queryClient, router]);

  const { data: vmData, isLoading: vmsLoading } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed to fetch VM status");
      return res.json();
    },
    staleTime: 2500,
  });

  const { data: accountsData, refetch: refetchAccounts } = useQuery<{
    kaggleAccounts: KaggleAccountSummary[];
    colabAccounts: ColabAccountSummary[];
    googleOAuthAvailable: boolean;
  }>({
    queryKey: ["vm-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/vm/accounts");
      if (!res.ok) throw new Error("Failed to fetch cluster accounts");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const vms = vmData?.vms ?? [];
  const kaggleAccounts = accountsData?.kaggleAccounts ?? [
    { accountAlias: "acc1", username: "Account 1", configured: false, targets: ["gpu0", "gpu1"], quota: null },
    { accountAlias: "acc2", username: "Account 2", configured: false, targets: ["gpu2", "gpu3"], quota: null },
  ];
  const colabAccounts: ColabAccountSummary[] = accountsData?.colabAccounts ?? [
    {
      accountAlias: "acc1",
      email: null,
      name: null,
      connected: false,
      hasColabScope: false,
      hasDriveScope: false,
      driveFileId: null,
      runnerConfigured: false,
      targets: ["gcgpu"],
    },
    {
      accountAlias: "acc2",
      email: null,
      name: null,
      connected: false,
      hasColabScope: false,
      hasDriveScope: false,
      driveFileId: null,
      runnerConfigured: false,
      targets: ["gcgpu1"],
    },
  ];

  async function handleForceProbe() {
    setProbing(true);
    try {
      const [vmRes] = await Promise.all([
        fetch("/api/vm/status?probe=true"),
        refetchAccounts(),
      ]);
      if (vmRes.ok) {
        const fresh = await vmRes.json();
        queryClient.setQueryData(["vm-status"], fresh);
      }
      toast.success("Refreshed cluster health & Kaggle quotas");
    } finally {
      setProbing(false);
    }
  }

  async function handleCopyColabScript(target: string) {
    try {
      const res = await fetch(`/api/vm/colab/${encodeURIComponent(target)}/notebook?format=python`);
      const data = await res.json();
      if (!res.ok || !data.pythonCode) {
        toast.error(data.error || "Failed to generate Colab setup cell");
        return;
      }
      await navigator.clipboard.writeText(data.pythonCode);
      setCopiedTarget(target);
      toast.success(`Copied self-renewing cell for ${target}! Paste into Colab & press Ctrl+F9.`);
      setTimeout(() => setCopiedTarget(null), 3000);
    } catch {
      toast.error("Failed to copy setup script");
    }
  }

  async function handleManualEmailLink(e: React.FormEvent) {
    e.preventDefault();
    if (!connectModalAlias || !manualEmail.trim()) return;
    setSavingEmail(true);
    try {
      const email = manualEmail.trim();
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "colab",
          accountAlias: connectModalAlias,
          username: email,
          rawSecret: JSON.stringify({ email, manualLink: true }),
          metadata: { email, name: email, hasColabScope: false },
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        toast.error(body.error || "Failed to save Colab account");
        return;
      }
      toast.success(`Linked ${email} to Colab ${connectModalAlias}`);
      setManualEmail("");
      setConnectModalAlias(null);
      refetchAccounts();
    } finally {
      setSavingEmail(false);
    }
  }

  function openAccountConnectModal(colAcc: ColabAccountSummary) {
    setConnectModalAlias(colAcc.accountAlias);
    setDriveUrlInput(
      colAcc.driveFileId ? `https://colab.research.google.com/drive/${colAcc.driveFileId}` : ""
    );
  }

  async function handleSaveDriveFile(e: React.FormEvent) {
    e.preventDefault();
    if (!connectModalAlias) return;
    const colAcc = colabAccounts.find((c) => c.accountAlias === connectModalAlias);
    const target = colAcc?.targets[0] || (connectModalAlias === "acc2" ? "gcgpu1" : "gcgpu");
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/vm/colab/${encodeURIComponent(target)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_drive_file", driveUrlOrId: driveUrlInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to bind Colab Drive file");
        return;
      }
      toast.success(
        data.driveFileId
          ? `Linked saved Colab file (${data.driveFileId})`
          : "Cleared linked Colab Drive file — next Open Colab creates a fresh file."
      );
      refetchAccounts();
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleRotateRunnerKey() {
    if (!connectModalAlias) return;
    const colAcc = colabAccounts.find((c) => c.accountAlias === connectModalAlias);
    const target = colAcc?.targets[0] || (connectModalAlias === "acc2" ? "gcgpu1" : "gcgpu");
    if (!confirm(`Rotate runner key for ${target}? Old downloaded .ipynb copies will stop working.`)) {
      return;
    }
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/vm/colab/${encodeURIComponent(target)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate_key" }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to rotate key");
        return;
      }
      toast.success(`Rotated runner key for ${target}. Click Open Colab to sync Drive notebook.`);
      refetchAccounts();
    } finally {
      setSavingConfig(false);
    }
  }

  const modalColabTarget = connectModalAlias === "acc2" ? "gcgpu1" : "gcgpu";
  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/google/colab/callback`
      : "/api/auth/google/colab/callback";

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
      {/* LEFT STICKY GPU CLUSTER RAIL */}
      <aside className="space-y-3 lg:sticky lg:top-[74px] lg:z-30">
        <div className="flex items-center justify-between px-0.5">
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">GPU Cluster Rail</h1>
            <p className="text-[10px] text-zinc-400">Hover card for VRAM, logs &amp; WebUI</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleForceProbe}
            disabled={probing}
            title="Refresh Health & Quotas"
            className="glass-pill h-7 border-white/15 bg-white/[0.04] px-2.5 text-[11px] text-zinc-200 hover:bg-white/10"
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${probing ? "animate-spin" : ""}`} />
            Sync
          </Button>
        </div>

        {vmsLoading && vms.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((idx) => (
              <div key={idx} className="glass-panel h-28 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Unified Kaggle Account Pairs (GPU0+GPU1 & GPU2+GPU3) */}
            {kaggleAccounts.map((acc) => {
              const accVms = vms.filter(
                (v) => v.provider === "kaggle" && v.accountAlias === acc.accountAlias
              );
              return (
                <AccountClusterCard
                  key={`kaggle-${acc.accountAlias}`}
                  kind="kaggle"
                  kaggleAccount={acc}
                  vms={accVms}
                  onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
                />
              );
            })}

            {/* Colab Slots (GCGPU & GCGPU1) */}
            {colabAccounts.map((colAcc) => {
              const colVms = vms.filter(
                (v) => v.provider === "colab" && v.accountAlias === colAcc.accountAlias
              );
              return (
                <AccountClusterCard
                  key={`colab-${colAcc.accountAlias}`}
                  kind="colab"
                  colabAccount={colAcc}
                  vms={colVms}
                  onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
                  onOpenColabSetup={() => openAccountConnectModal(colAcc)}
                  onCopyCell={handleCopyColabScript}
                  copiedTarget={copiedTarget}
                />
              );
            })}
          </div>
        )}
      </aside>

      {/* RIGHT MAIN WORKSPACE: EMBEDDED STUDIO + COLLAPSIBLE CONSOLE */}
      <div className="min-w-0 space-y-4">
        <StudioWorkspace />
        <LiveConsole />
      </div>

      {/* Connect Google Account Modal */}
      <Dialog
        open={Boolean(connectModalAlias)}
        onOpenChange={(open) => !open && setConnectModalAlias(null)}
      >
        <DialogContent className="glass-popover border-white/15 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Colab Setup ({connectModalAlias})</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Link your Google account (`drive.file` auto-sync), copy the self-renewing cell, or bind an existing Drive URL.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Quick Manual Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCopyColabScript(modalColabTarget)}
                className="glass-pill flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/10"
              >
                {copiedTarget === modalColabTarget ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy Setup Cell
              </button>
              <a
                href={`/api/vm/colab/${encodeURIComponent(modalColabTarget)}/notebook`}
                className="glass-pill flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-white/10"
              >
                <Download className="h-3.5 w-3.5" />
                Download .ipynb
              </a>
            </div>

            <div className="glass-card space-y-3 rounded-xl p-4">
              <div className="text-xs font-semibold text-zinc-100">
                Option 1: Google Browser Account Picker (OAuth2 + Auto Drive Sync)
              </div>
              <p className="text-[11px] text-zinc-400">
                Callback URI required once in Google Cloud Console:
              </p>
              <code className="block break-all rounded-lg bg-black/50 px-2.5 py-1.5 font-mono text-[10px] text-cyan-300">
                {callbackUrl}
              </code>

              <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={includeColabScope}
                  onChange={(e) => setIncludeColabScope(e.target.checked)}
                  className="rounded border-white/20 bg-white/10"
                />
                Request <code className="text-zinc-200">colaboratory</code> API scope (only if enabled in GCP)
              </label>

              <a
                href={`/api/auth/google/colab/start?alias=${encodeURIComponent(
                  connectModalAlias || "acc1"
                )}&colabScope=${includeColabScope}`}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Globe className="h-4 w-4" />
                Select Google Account in Browser
              </a>
            </div>

            <form onSubmit={handleManualEmailLink} className="glass-card space-y-2.5 rounded-xl p-4">
              <div className="text-xs font-semibold text-zinc-100">
                Option 2: Quick Gmail Link (Zero GCP Setup)
              </div>
              <Label htmlFor="manual-colab-email" className="text-[11px] text-zinc-400">
                Google Account Email
              </Label>
              <Input
                id="manual-colab-email"
                type="email"
                required
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="your-account@gmail.com"
                className="glass-input border-white/10"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={savingEmail}
                className="w-full border-white/15 bg-white/[0.05] text-xs text-zinc-100 hover:bg-white/10"
              >
                {savingEmail ? "Saving..." : "Bind Gmail to Colab Slot"}
              </Button>
            </form>

            <form onSubmit={handleSaveDriveFile} className="glass-card space-y-2.5 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-100">
                  Saved Drive Notebook &amp; Security
                </div>
                <button
                  type="button"
                  onClick={handleRotateRunnerKey}
                  disabled={savingConfig}
                  className="text-[11px] font-medium text-amber-300 hover:text-amber-200"
                >
                  Rotate Runner Key
                </button>
              </div>
              <Input
                type="text"
                value={driveUrlInput}
                onChange={(e) => setDriveUrlInput(e.target.value)}
                placeholder="https://colab.research.google.com/drive/1AbC..."
                className="glass-input border-white/10"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={savingConfig}
                className="w-full border-white/15 bg-white/[0.05] text-xs text-zinc-100 hover:bg-white/10"
              >
                {savingConfig ? "Updating..." : "Save Colab Notebook URL"}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ClusterDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-xs text-zinc-400">Loading command center...</div>
      }
    >
      <CommandCenterContent />
    </Suspense>
  );
}
