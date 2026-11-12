"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Globe,
  Copy,
  Check,
  Download,
  Cpu,
  HardDriveUpload,
  Wifi,
  Sparkles,
  Settings,
  Loader2,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import type { PublicWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { VmClusterCard, type CatalogModelChoice } from "@/components/gpu/VmClusterCard";
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

function formatQuotaHours(sec: number): string {
  const mins = Math.max(0, Math.floor(sec / 60));
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, "0")}m`;
}

function VmClusterContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [probing, setProbing] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);
  const [mirroring, setMirroring] = useState(false);
  const [mirrorAccount, setMirrorAccount] = useState("acc1");

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
      router.replace("/vms");
    } else if (err) {
      toast.error(`Colab / Google error: ${err}`);
      router.replace("/vms");
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

  const { data: settingsData } = useQuery<{ settings: PublicWorkspaceSettings }>({
    queryKey: ["workspace-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: catalogData, refetch: refetchCatalog } = useQuery<{
    models: CatalogModelChoice[];
  }>({
    queryKey: ["catalog-choices"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      return res.json();
    },
    staleTime: 30000,
  });

  const vms = vmData?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const totalOnlineVram = onlineVms.reduce((acc, v) => acc + (v.vramTotalGb || 16), 0);
  const usedOnlineVram = onlineVms.reduce((acc, v) => acc + (v.vramUsedGb || 0), 0);

  const kaggleAccounts = accountsData?.kaggleAccounts ?? [
    {
      accountAlias: "acc1",
      username: "Account 1",
      configured: false,
      targets: ["gpu0", "gpu1"],
      quota: null,
    },
    {
      accountAlias: "acc2",
      username: "Account 2",
      configured: false,
      targets: ["gpu2", "gpu3"],
      quota: null,
    },
    {
      accountAlias: "acc3",
      username: "Account 3",
      configured: false,
      targets: ["gpu4", "gpu5"],
      quota: null,
    },
    {
      accountAlias: "acc4",
      username: "Account 4",
      configured: false,
      targets: ["gpu6", "gpu7"],
      quota: null,
    },
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

  const combinedQuotaSec = kaggleAccounts.reduce(
    (acc, a) => acc + (a.quota?.remainingSeconds ?? 0),
    0
  );
  const hasAnyQuota = kaggleAccounts.some((a) => Boolean(a.quota));

  const catalogChoices = catalogData?.models ?? [];
  const unbackedCount = catalogChoices.filter((m) => m.backupStatus !== "BACKED_UP").length;
  const globalIdleTimeout = settingsData?.settings.idleTimeoutMinutes ?? 15;

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

  async function handleTestWebhook() {
    setTestingWebhook(true);
    try {
      const res = await fetch("/api/vault/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "webhook" }),
      });
      const data = await res.json();
      setWebhookStatus({
        ok: Boolean(data.ok),
        detail: data.detail || (data.ok ? "Callback reachable" : "Unreachable"),
      });
      if (data.ok) {
        toast.success(data.detail || "Public callback webhook reachable");
      } else {
        toast.error(data.detail || "Public callback unreachable");
      }
    } finally {
      setTestingWebhook(false);
    }
  }

  async function handleTriggerCpuMirror() {
    setMirroring(true);
    try {
      const res = await fetch("/api/catalog/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountAlias: mirrorAccount, limit: 8 }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to launch 0-GPU CPU Drive Mirror");
        return;
      }
      toast.success(data.message || `Queued ${data.queuedCount ?? 0} models for Drive mirror`);
      refetchCatalog();
    } finally {
      setMirroring(false);
    }
  }

  async function handleCopyColabScript(target: string) {
    try {
      const res = await fetch(
        `/api/vm/colab/${encodeURIComponent(target)}/notebook?format=python`
      );
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
      toast.success(`Linked Google account ${email} to Colab (${connectModalAlias})`);
      setManualEmail("");
      setConnectModalAlias(null);
      refetchAccounts();
    } finally {
      setSavingEmail(false);
    }
  }

  const modalColabAccount = colabAccounts.find((a) => a.accountAlias === connectModalAlias);
  const modalColabTarget =
    modalColabAccount?.targets?.[0] || (connectModalAlias === "acc2" ? "gcgpu1" : "gcgpu");

  function openAccountConnectModal(account: ColabAccountSummary) {
    setConnectModalAlias(account.accountAlias);
    setManualEmail(account.email || "");
    setDriveUrlInput(
      account.driveFileId ? `https://colab.research.google.com/drive/${account.driveFileId}` : ""
    );
  }

  async function handleRotateRunnerKey() {
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/vm/colab/${encodeURIComponent(modalColabTarget)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate_key" }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to rotate runner key");
        return;
      }
      toast.success(
        `Rotated security key for ${modalColabTarget}. Copy the updated Cell once to sync Colab.`
      );
      refetchAccounts();
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSaveDriveFile(e: React.FormEvent) {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/vm/colab/${encodeURIComponent(modalColabTarget)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_drive_file",
          driveUrlOrId: driveUrlInput.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to bind Colab Drive URL");
        return;
      }
      toast.success(
        body.driveFileId
          ? `Bound permanent Open Colab link for ${modalColabTarget}!`
          : `Cleared custom Drive link for ${modalColabTarget}.`
      );
      refetchAccounts();
    } finally {
      setSavingConfig(false);
    }
  }

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://scriptoria.krhimanshu.in";
  const callbackUrl = `${origin}/api/auth/google/colab/callback`;

  return (
    <div className="space-y-4">
      {/* Compact Header Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">GPU Compute Cluster</h1>
          <p className="text-xs text-zinc-500">
            Kaggle Dual-T4 &amp; Colab T4 worker slots, boot profiles, and Drive model mirror.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleTestWebhook}
            disabled={testingWebhook}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              webhookStatus?.ok === true
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : webhookStatus?.ok === false
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
            title={webhookStatus?.detail || "Ping public callback URL"}
          >
            {testingWebhook ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span>
              {webhookStatus ? (webhookStatus.ok ? "Webhook OK" : "Webhook Fail") : "Ping Webhook"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleForceProbe}
            disabled={probing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? "animate-spin" : ""}`} />
            <span>Probe</span>
          </button>

          <Link
            href="/settings"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Settings</span>
          </Link>

          <Link
            href="/studio"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Open Studio</span>
          </Link>
        </div>
      </div>

      {/* Single Compact Segmented Telemetry Strip (No 4 Big Boxes) */}
      <div className="grid grid-cols-2 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-[#111114] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Online Slots</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-emerald-400">
            {onlineVms.length} <span className="text-xs font-normal text-zinc-500">/ {vms.length || 6}</span>
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Active VRAM</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {totalOnlineVram.toFixed(0)}G{" "}
            <span className="text-xs font-normal text-zinc-500">({usedOnlineVram.toFixed(1)}G used)</span>
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Kaggle Quota</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {hasAnyQuota ? formatQuotaHours(combinedQuotaSec) : "--"}
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Idle Watchdog</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {globalIdleTimeout === 0 ? "Off" : `${globalIdleTimeout}m`}
          </span>
        </div>
      </div>

      {/* Expanded 2-Column VM Cards */}
      {vmsLoading && vms.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-56 animate-pulse rounded-lg border border-zinc-800 bg-[#111114]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {kaggleAccounts.map((acc) => {
            const accVms = vms.filter(
              (v) => v.provider === "kaggle" && v.accountAlias === acc.accountAlias
            );
            return (
              <VmClusterCard
                key={`kaggle-${acc.accountAlias}`}
                kind="kaggle"
                kaggleAccount={acc}
                vms={accVms}
                globalIdleTimeoutMinutes={globalIdleTimeout}
                catalogChoices={catalogChoices}
                onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
              />
            );
          })}

          {colabAccounts.map((colAcc) => {
            const colVms = vms.filter(
              (v) => v.provider === "colab" && v.accountAlias === colAcc.accountAlias
            );
            return (
              <VmClusterCard
                key={`colab-${colAcc.accountAlias}`}
                kind="colab"
                colabAccount={colAcc}
                vms={colVms}
                globalIdleTimeoutMinutes={globalIdleTimeout}
                catalogChoices={catalogChoices}
                onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
                onOpenColabSetup={() => openAccountConnectModal(colAcc)}
                onCopyCell={handleCopyColabScript}
                copiedTarget={copiedTarget}
              />
            );
          })}
        </div>
      )}

      {/* Compact 0-GPU CPU Drive Mirror Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#111114] px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <HardDriveUpload className="h-4 w-4 text-zinc-400" />
          <div className="text-xs">
            <span className="font-medium text-zinc-200">Zero-GPU CPU Drive Mirror:</span>{" "}
            <span className="text-zinc-400">
              {unbackedCount > 0
                ? `${unbackedCount} model(s) ready to mirror from HF/Civitai into 5 TB Drive`
                : "All registered remote catalog models backed up."}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={mirrorAccount}
            onChange={(e) => setMirrorAccount(e.target.value)}
            className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-300"
          >
            <option value="acc1" className="bg-zinc-900">
              acc1 (CPU)
            </option>
            <option value="acc2" className="bg-zinc-900">
              acc2 (CPU)
            </option>
            <option value="acc3" className="bg-zinc-900">
              acc3 (CPU)
            </option>
            <option value="acc4" className="bg-zinc-900">
              acc4 (CPU)
            </option>
          </select>

          <button
            type="button"
            disabled={mirroring || unbackedCount === 0}
            onClick={handleTriggerCpuMirror}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
          >
            {mirroring ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Cpu className="h-3 w-3" />
            )}
            <span>Mirror Missing (0 GPU)</span>
          </button>
        </div>
      </div>

      {/* Collapsible Console */}
      <LiveConsole />

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

export default function VmClusterDashboardPage() {
  return (
    <Suspense
      fallback={<div className="py-12 text-center text-xs text-zinc-400">Loading VM Cluster...</div>}
    >
      <VmClusterContent />
    </Suspense>
  );
}

