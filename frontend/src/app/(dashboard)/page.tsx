"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Download,
  ExternalLink,
  Clock,
  Cpu,
  Globe,
  Copy,
  Check,
  Power,
  Skull,
  UserCheck,
  AlertCircle,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { GpuCard } from "@/components/gpu/GpuCard";
import { LiveConsole } from "@/components/logs/LiveConsole";
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

function formatHoursMinutes(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins.toString().padStart(2, "0")}m`;
}

function ClusterPageContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [probing, setProbing] = useState(false);
  const [groupLoading, setGroupLoading] = useState<string | null>(null);
  const [colabDialog, setColabDialog] = useState<{ url: string; target: string } | null>(null);
  const [connectModalAlias, setConnectModalAlias] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [includeColabScope, setIncludeColabScope] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  useEffect(() => {
    const connected = searchParams.get("colabConnected");
    const err = searchParams.get("colabError");
    if (connected) {
      toast.success(`Connected Google account (${connected})`);
      queryClient.invalidateQueries({ queryKey: ["vm-accounts"] });
      router.replace("/");
    } else if (err) {
      toast.error(`Google account link failed: ${err}`);
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
    refetchInterval: 5000,
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
  const colabAccounts = accountsData?.colabAccounts ?? [
    { accountAlias: "acc1", email: null, name: null, connected: false, hasColabScope: false, targets: ["gcgpu"] },
    { accountAlias: "acc2", email: null, name: null, connected: false, hasColabScope: false, targets: ["gcgpu1"] },
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
      toast.success("Refreshed cluster health & Kaggle quota");
    } finally {
      setProbing(false);
    }
  }

  async function handleGroupToggle(groupKey: string, primaryTarget: string, confirmKill = false) {
    if (confirmKill && !confirm(`Trigger immediate Zero-Quota kill for ${groupKey}?`)) return;
    setGroupLoading(groupKey);
    try {
      const res = await fetch(`/api/vm/${primaryTarget}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to toggle ${groupKey}`);
        return;
      }
      toast.success(data.message || `Updated ${groupKey}`);
      queryClient.invalidateQueries({ queryKey: ["vm-status"] });
    } catch {
      toast.error(`Network error toggling ${groupKey}`);
    } finally {
      setGroupLoading(null);
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
      toast.success(`Copied ${target} Python bootstrap cell! Paste into Colab and press Ctrl+F9.`);
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

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/google/colab/callback`
      : "/api/auth/google/colab/callback";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">GPU Cluster Overview</h1>
          <p className="text-xs text-zinc-400">
            Grouped by cloud account: Kaggle Dual-T4 pairs burn 1x weekly quota per session; Colab slots connect directly to your browser Google account.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleForceProbe}
          disabled={probing}
          className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${probing ? "animate-spin" : ""}`} />
          Refresh Health &amp; Quotas
        </Button>
      </div>

      {/* SECTION 1: KAGGLE ACCOUNT GROUPS */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyan-400">
            <Cpu className="h-4 w-4" />
            Kaggle Dual-T4 Account Pools (4× T4 GPUs)
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {kaggleAccounts.map((acc) => {
            const accVms = vms.filter(
              (v) => v.provider === "kaggle" && v.accountAlias === acc.accountAlias
            );
            const primaryTarget = acc.targets[0] || (acc.accountAlias === "acc2" ? "gpu2" : "gpu0");
            const anyActive = accVms.some(
              (v) => v.status === "ONLINE" || v.status === "BUSY" || v.status === "STARTING"
            );

            const totalSec = acc.quota?.totalAllowedSeconds ?? 108000;
            const remainSec = acc.quota?.remainingSeconds ?? totalSec;
            const usedSec = acc.quota?.usedSeconds ?? 0;
            const remainPct = Math.min(100, Math.round((remainSec / Math.max(1, totalSec)) * 100));

            return (
              <div
                key={acc.accountAlias}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4"
              >
                {/* Account Group Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800/80 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-xs font-bold uppercase text-cyan-300">
                        Kaggle {acc.accountAlias}
                      </span>
                      <span className="font-mono text-sm font-semibold text-white">
                        {acc.username || "Not Configured"}
                      </span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-300">
                        2× T4 · 1× Quota Meter
                      </span>
                    </div>

                    {/* Remaining Weekly Quota Bar */}
                    {acc.quota ? (
                      <div className="mt-2 space-y-1.5 pt-1">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 font-semibold text-emerald-400">
                            <Clock className="h-3.5 w-3.5" />
                            {formatHoursMinutes(remainSec)} remaining
                          </span>
                          <span className="text-zinc-500">
                            ({formatHoursMinutes(usedSec)} used of {formatHoursMinutes(totalSec)})
                          </span>
                          {acc.quota.resetAt && (
                            <span className="text-[11px] text-zinc-500">
                              · Resets {new Date(acc.quota.resetAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full transition-all duration-500 ${
                              remainPct < 15
                                ? "bg-rose-500"
                                : remainPct < 35
                                ? "bg-amber-500"
                                : "bg-cyan-500"
                            }`}
                            style={{ width: `${remainPct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">
                        {acc.quotaError
                          ? `Quota check: ${acc.quotaError}`
                          : acc.configured
                          ? "Loading remaining quota..."
                          : "Add credentials in Settings Vault to view remaining hours."}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleGroupToggle(acc.accountAlias, primaryTarget, false)}
                      disabled={groupLoading === acc.accountAlias || !acc.configured}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${
                        anyActive
                          ? "border border-amber-500/30 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
                          : "bg-indigo-600 text-white hover:bg-indigo-500"
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {anyActive ? "Stop Pair" : "Boot Dual-T4"}
                    </button>

                    <button
                      onClick={() => handleGroupToggle(acc.accountAlias, primaryTarget, true)}
                      disabled={groupLoading === acc.accountAlias || !anyActive}
                      title="Zero-Quota Panic Kill"
                      className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-2 text-rose-400 transition hover:bg-rose-900/50 disabled:opacity-40"
                    >
                      <Skull className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Pair GPU Cards */}
                {vmsLoading ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="h-72 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50" />
                    <div className="h-72 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {accVms.map((vm) => (
                      <GpuCard
                        key={vm.id}
                        vm={vm}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
                        onColabReady={(url, target) => setColabDialog({ url, target })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 2: GOOGLE COLAB ACCOUNT POOL */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-400">
            <Globe className="h-4 w-4" />
            Google Colab Account Pool (2× T4 Runtimes)
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {colabAccounts.map((colAcc) => {
            const target = colAcc.targets[0] || (colAcc.accountAlias === "acc2" ? "gcgpu1" : "gcgpu");
            const colVm = vms.find((v) => v.target === target);

            const colabLaunchUrl = colAcc.email
              ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
                  colAcc.email
                )}&continue=${encodeURIComponent("https://colab.research.google.com/#create=true")}`
              : "https://colab.research.google.com/#create=true";

            return (
              <div
                key={colAcc.accountAlias}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4"
              >
                {/* Colab Account Group Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-bold uppercase text-amber-300">
                        Colab {colAcc.accountAlias}
                      </span>
                      {colAcc.connected ? (
                        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                          <UserCheck className="h-3.5 w-3.5" />
                          {colAcc.email}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
                          <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                          No Google account linked
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      {colAcc.connected
                        ? "One-click launch opens Google Colab directly under this account and streams from your main Drive Vault."
                        : "Connect a Google account via your browser to bind this Colab runtime slot."}
                    </p>
                  </div>

                  <button
                    onClick={() => setConnectModalAlias(colAcc.accountAlias)}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {colAcc.connected ? "Switch Account" : "Connect Google Account"}
                  </button>
                </div>

                {/* Quick Browser Launch Toolbar */}
                <div className="flex flex-wrap gap-2">
                  <a
                    href={colabLaunchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600/20 border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-600/30"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Colab{colAcc.email ? ` (${colAcc.email.split("@")[0]})` : ""}
                  </a>

                  <button
                    onClick={() => handleCopyColabScript(target)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
                  >
                    {copiedTarget === target ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Copy Setup Cell
                  </button>

                  <a
                    href={`/api/vm/colab/${target}/notebook`}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    .ipynb
                  </a>
                </div>

                {/* Underlying GpuCard */}
                {colVm && (
                  <GpuCard
                    vm={colVm}
                    onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
                    onColabReady={(url, t) => setColabDialog({ url, target: t })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <LiveConsole />

      {/* Connect Google Account Modal */}
      <Dialog
        open={Boolean(connectModalAlias)}
        onOpenChange={(open) => !open && setConnectModalAlias(null)}
      >
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Connect Google Account for Colab ({connectModalAlias})</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Select your Google account directly in the browser via OAuth, or link your Gmail address for instant AccountChooser launch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Option 1: Browser OAuth Picker */}
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="text-xs font-semibold text-zinc-200">
                Option 1: Google Browser Account Picker (OAuth2)
              </div>
              <p className="text-[11px] text-zinc-400">
                Requires this callback URI whitelisted once in your Google Cloud Console OAuth Client:
              </p>
              <code className="block break-all rounded-lg bg-zinc-950 px-2.5 py-1.5 font-mono text-[10px] text-indigo-300">
                {callbackUrl}
              </code>

              <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={includeColabScope}
                  onChange={(e) => setIncludeColabScope(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                Request <code className="text-zinc-300">colaboratory</code> API scope (only if enabled in GCP project)
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

            {/* Option 2: Quick Gmail Binding */}
            <form
              onSubmit={handleManualEmailLink}
              className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
            >
              <div className="text-xs font-semibold text-zinc-200">
                Option 2: Quick Gmail Link (Zero GCP Setup)
              </div>
              <p className="text-[11px] text-zinc-400">
                Save your Gmail address so &ldquo;Open Colab&rdquo; launches directly under that account via Google AccountChooser.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="manual-colab-email" className="text-xs">
                  Google Account Email
                </Label>
                <Input
                  id="manual-colab-email"
                  type="email"
                  required
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="your-account@gmail.com"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={savingEmail}
                className="w-full border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {savingEmail ? "Saving..." : "Bind Gmail to Colab Slot"}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Colab Ready Dialog */}
      <Dialog open={Boolean(colabDialog)} onOpenChange={(open) => !open && setColabDialog(null)}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Launch Google Colab Worker ({colabDialog?.target})</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Download the `.ipynb` runner or copy the setup cell, open Google Colab, choose GPU T4, and run it.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {colabDialog && (
              <>
                <a
                  href={colabDialog.url}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  <Download className="h-4 w-4" />
                  Download .ipynb
                </a>
                <button
                  onClick={() => handleCopyColabScript(colabDialog.target)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  <Copy className="h-4 w-4" />
                  Copy Setup Cell
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ClusterPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-xs text-zinc-400">Loading cluster overview...</div>
      }
    >
      <ClusterPageContent />
    </Suspense>
  );
}
