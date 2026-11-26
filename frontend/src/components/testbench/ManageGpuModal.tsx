"use client";

import React, { useState } from "react";
import {
  X,
  Server,
  Plus,
  Trash2,
  KeyRound,
  User,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary } from "@/app/api/vm/accounts/route";
import { toast } from "sonner";

interface ManageGpuModalProps {
  isOpen: boolean;
  onClose: () => void;
  vms: PublicVmInstance[];
  kaggleAccounts?: KaggleAccountSummary[];
  onRefreshVms?: () => void;
}

export function ManageGpuModal({
  isOpen,
  onClose,
  vms,
  kaggleAccounts = [],
  onRefreshVms,
}: ManageGpuModalProps) {
  const [activeTab, setActiveTab] = useState<"manage" | "add">("manage");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Form fields for adding new account
  const [newAlias, setNewAlias] = useState("acc3");
  const [connectionName, setConnectionName] = useState("");
  const [newKernelSlug, setNewKernelSlug] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [gpuType, setGpuType] = useState<"dual_t4" | "single">("dual_t4");

  if (!isOpen) return null;

  // Filter out Colab from GPU management list
  const gpuVms = vms.filter((v) => v.provider !== "colab" && !v.target.startsWith("tpu"));

  // Group VMs by accountAlias
  const accountGroups = new Map<string, { alias: string; targets: string[]; status: string; username?: string }>();
  gpuVms.forEach((vm) => {
    const alias = vm.accountAlias || vm.target;
    const existing = accountGroups.get(alias);
    const matchedAccount = kaggleAccounts.find((a) => a.accountAlias === alias);
    const username = matchedAccount?.username || undefined;

    if (!existing) {
      accountGroups.set(alias, {
        alias,
        targets: [vm.target],
        status: vm.status,
        username,
      });
    } else {
      existing.targets.push(vm.target);
      if (vm.status === "ONLINE" || vm.status === "STARTING") {
        existing.status = vm.status;
      }
    }
  });

  const accountsList = Array.from(accountGroups.values());

  // Handle Deleting Account / Slots
  const handleDeleteAccount = async (alias: string) => {
    if (!confirm(`Are you sure you want to remove ${alias.toUpperCase()} and all associated GPU slots?`)) {
      return;
    }

    setIsDeleting(alias);
    try {
      const res = await fetch(`/api/vm/manage?accountAlias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to delete account");
        return;
      }

      toast.success(data.message || `Account ${alias.toUpperCase()} removed successfully`);
      onRefreshVms?.();
    } catch (err: unknown) {
      toast.error("Failed to delete: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setIsDeleting(null);
    }
  };

  // Handle Adding New Account
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlias.trim()) {
      toast.error("Account alias is required (e.g. acc3)");
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch("/api/vm/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountAlias: newAlias.trim().toLowerCase(),
          displayName: connectionName.trim() || undefined,
          kernelSlug: newKernelSlug.trim() || undefined,
          username: newUsername.trim() || undefined,
          apiKey: newApiKey.trim() || undefined,
          gpuType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to add account");
        return;
      }

      toast.success(data.message || "Account added successfully!");
      setNewUsername("");
      setNewApiKey("");
      setConnectionName("");
      setNewKernelSlug("");
      setActiveTab("manage");
      onRefreshVms?.();
    } catch (err: unknown) {
      toast.error("Failed to add account: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="relative w-full max-w-xl rounded-xl border border-zinc-800 bg-[#0d0d10] p-5 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Server className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                Manage Compute Swarm & GPU Accounts
              </h2>
              <p className="text-[11px] text-zinc-400">
                Configure, add, or remove active Kaggle dual-GPU nodes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2 mb-4 border-b border-zinc-800/60 pb-2">
          <button
            onClick={() => setActiveTab("manage")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              activeTab === "manage"
                ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Active Accounts ({accountsList.length})
          </button>
          <button
            onClick={() => setActiveTab("add")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeTab === "add"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Plus className="h-3 w-3" />
            <span>Add GPU Account</span>
          </button>
        </div>

        {/* Tab 1: Manage Active Accounts */}
        {activeTab === "manage" && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {accountsList.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs">
                No GPU accounts configured. Click &quot;Add GPU Account&quot; to add one.
              </div>
            ) : (
              accountsList.map((acc) => {
                const isDeletingThis = isDeleting === acc.alias;
                const isOnline = acc.status === "ONLINE" || acc.status === "BUSY";
                return (
                  <div
                    key={acc.alias}
                    className="flex items-center justify-between p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          isOnline
                            ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                            : acc.status === "STARTING"
                            ? "bg-amber-400 animate-pulse"
                            : "bg-zinc-600"
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-200 uppercase">
                            {kaggleAccounts.find((a) => a.accountAlias === acc.alias)?.displayName || acc.username || "Personal Kaggle"}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800/90 px-1.5 py-0.5 rounded border border-zinc-700">
                            {acc.targets.join(", ")}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                              isOnline
                                ? "text-emerald-400 bg-emerald-950/60"
                                : "text-zinc-500 bg-zinc-800"
                            }`}
                          >
                            {acc.status}
                          </span>
                        </div>
                        {acc.username && (
                          <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1">
                            <User className="h-3 w-3 text-zinc-500" />
                            <span>{acc.username}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteAccount(acc.alias)}
                      disabled={isDeletingThis}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/50 transition disabled:opacity-50"
                      title={`Remove account ${acc.alias.toUpperCase()} and release GPU slots`}
                    >
                      {isDeletingThis ? (
                        <Loader2 className="h-4 w-4 animate-spin text-rose-400" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 2: Add New Account Form */}
        {activeTab === "add" && (
          <form onSubmit={handleAddAccount} className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Account Alias (e.g. acc2, acc3, acc4)
                </label>
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="acc3"
                  className="w-full h-8 px-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Display Label (Optional)
                </label>
                <input
                  type="text"
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Kaggle ACC3"
                  className="w-full h-8 px-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                Notebook Slug (Optional)
              </label>
              <input
                type="text"
                value={newKernelSlug}
                onChange={(e) => setNewKernelSlug(e.target.value)}
                maxLength={50}
                placeholder="ml-batch-inference-lab (default)"
                className="w-full h-8 px-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                GPU slots stay linked cleanly when you customize labels or notebook names.
              </p>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                Kaggle Username (Optional)
              </label>
              <div className="relative flex items-center">
                <User className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. mykaggleaccount"
                  className="w-full h-8 pl-8 pr-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                Kaggle API Key / Token (Optional)
              </label>
              <div className="relative flex items-center">
                <KeyRound className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="KGAT_... or hex API key"
                  className="w-full h-8 pl-8 pr-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                GPU Configuration
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGpuType("dual_t4")}
                  className={`p-2 rounded-md border text-left flex flex-col transition ${
                    gpuType === "dual_t4"
                      ? "border-amber-500/80 bg-amber-500/10 text-amber-300"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <span className="font-semibold text-xs">Dual-T4 (30h/wk)</span>
                  <span className="text-[10px] text-zinc-500">2x T4 GPUs (Ports 8188 & 8189)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGpuType("single")}
                  className={`p-2 rounded-md border text-left flex flex-col transition ${
                    gpuType === "single"
                      ? "border-amber-500/80 bg-amber-500/10 text-amber-300"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <span className="font-semibold text-xs">Single GPU (P100)</span>
                  <span className="text-[10px] text-zinc-500">1x GPU (Port 8188)</span>
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isAdding}
                className="w-full h-8 rounded-md bg-amber-500 text-zinc-950 font-semibold text-xs hover:bg-amber-400 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isAdding ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving & Provisioning...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Provision Account & GPU Slots</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="border-t border-zinc-800/80 pt-3 mt-4 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Persisted to local SQLite database</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
