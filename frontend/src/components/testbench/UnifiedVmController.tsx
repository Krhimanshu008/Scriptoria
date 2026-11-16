"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Cpu, Power, Loader2, ChevronDown, SlidersHorizontal } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary } from "@/app/api/vm/accounts/route";
import { ManageGpuModal } from "./ManageGpuModal";
import { toast } from "sonner";

export interface UnifiedVmControllerProps {
  vms: PublicVmInstance[];
  kaggleAccounts?: KaggleAccountSummary[];
  onRefreshVms?: () => void;
  onRefreshHealth?: () => void;
}

const POPULAR_PROFILES = [
  { id: "LLM_LIGHTWEIGHT_SWARM", label: "5N-SWARM: Qwen 3.5 Swarm (4B)", tag: "Extraction" },
  { id: "LLM_QWEN_FAST_8B", label: "Qwen 8B Fast Vision", tag: "Fast VLM" },
  { id: "LLM_QWEN_TEXT_TURBO", label: "Qwen Text Turbo", tag: "Fast Text" },
  { id: "LLM_QWEN_MOE_35B", label: "Qwen MoE 35B A2.7B", tag: "Heavy MoE" },
  { id: "BASE_COMFY", label: "Base ComfyUI (SDXL)", tag: "Visual" },
  { id: "IMAGE_CORE", label: "Image Core (IP-Adapter)", tag: "Art" },
];

interface AccountGroup {
  alias: string;
  label: string;
  shortName: string;
  primaryTarget: string;
  targets: string[];
  status: string;
  stepProgress: number;
  workerProfile: string;
  isOnline: boolean;
  isStarting: boolean;
}

export function UnifiedVmController({
  vms,
  kaggleAccounts = [],
  onRefreshVms,
  onRefreshHealth,
}: UnifiedVmControllerProps) {
  const [selectedAlias, setSelectedAlias] = useState<string>("acc1");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  // 1. Filter out Colab and TPU slots (focus purely on Kaggle Dual-GPU accounts)
  const activeGpuVms = useMemo(() => {
    return vms.filter((v) => v.provider !== "colab" && !v.target.startsWith("tpu"));
  }, [vms]);

  // 2. Aggregate individual VM slots into Account Groups
  const accounts: AccountGroup[] = useMemo(() => {
    const map = new Map<string, { alias: string; targets: string[]; vms: PublicVmInstance[] }>();

    activeGpuVms.forEach((vm) => {
      const alias = (vm.accountAlias || vm.target).toLowerCase();
      const existing = map.get(alias);
      if (!existing) {
        map.set(alias, { alias, targets: [vm.target], vms: [vm] });
      } else {
        existing.targets.push(vm.target);
        existing.vms.push(vm);
      }
    });

    // If no GPU slots found, provision a fallback placeholder
    if (map.size === 0) {
      return [
        {
          alias: "acc1",
          label: "Kaggle Acc 1 · Dual-T4",
          shortName: "Acc 1",
          primaryTarget: "gpu0",
          targets: ["gpu0", "gpu1"],
          status: "OFFLINE",
          stepProgress: 0,
          workerProfile: "LLM_LIGHTWEIGHT_SWARM",
          isOnline: false,
          isStarting: false,
        },
      ];
    }

    return Array.from(map.values()).map(({ alias, targets, vms: groupVms }) => {
      const matchedCred = kaggleAccounts.find((a) => a.accountAlias.toLowerCase() === alias);
      const username = matchedCred?.username || null;

      // Clean display names
      const aliasNum = alias.replace(/\D/g, "");
      const shortName = aliasNum ? `Acc ${aliasNum}` : alias.toUpperCase();
      const userLabel = username ? ` (${username})` : "";
      const isDual = targets.length > 1;
      const label = `Kaggle ${shortName}${userLabel} · ${isDual ? "Dual-T4" : "1x GPU"}`;

      // Status priority: ONLINE > BUSY > STARTING > STOPPING > OFFLINE
      let status = "OFFLINE";
      let stepProgress = 0;
      if (groupVms.some((v) => v.status === "ONLINE")) {
        status = "ONLINE";
      } else if (groupVms.some((v) => v.status === "BUSY")) {
        status = "BUSY";
      } else if (groupVms.some((v) => v.status === "STARTING")) {
        status = "STARTING";
        const startingVm = groupVms.find((v) => v.status === "STARTING");
        stepProgress = startingVm?.stepProgress || 1;
      }

      const primaryTarget = targets[0] || "gpu0";
      const workerProfile = groupVms[0]?.workerProfile || "LLM_LIGHTWEIGHT_SWARM";
      const isOnline = status === "ONLINE" || status === "BUSY";
      const isStarting = status === "STARTING";

      return {
        alias,
        label,
        shortName,
        primaryTarget,
        targets,
        status,
        stepProgress,
        workerProfile,
        isOnline,
        isStarting,
      };
    });
  }, [activeGpuVms, kaggleAccounts]);

  // Keep selectedAlias valid
  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.alias === selectedAlias)) {
      setSelectedAlias(accounts[0].alias);
    }
  }, [accounts, selectedAlias]);

  const activeAccount = accounts.find((a) => a.alias === selectedAlias) || accounts[0];

  // Handle changing worker profile for the selected Account
  const handleProfileChange = async (newProfile: string) => {
    if (!activeAccount) return;
    setIsUpdatingProfile(true);
    try {
      // Update profile across primary target
      const res = await fetch(`/api/vm/${encodeURIComponent(activeAccount.primaryTarget)}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerProfile: newProfile }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update worker profile");
        return;
      }
      toast.success(
        `Worker profile set to ${newProfile} on ${activeAccount.shortName}`
      );
      onRefreshVms?.();
    } catch (err: any) {
      toast.error("Failed to update profile: " + err.message);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Single Boot / Kill Toggle for the Selected Account
  const handleToggleAccount = async () => {
    if (!activeAccount) return;
    setIsActionLoading(true);
    const target = activeAccount.primaryTarget;

    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/toggle`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || `Action failed on ${activeAccount.shortName}`);
        return;
      }

      if (activeAccount.isOnline || activeAccount.isStarting) {
        toast.success(`Termination signal sent for ${activeAccount.shortName}`);
      } else {
        toast.success(`⚡ Boot signal sent to ${activeAccount.shortName}! Initializing kernel...`);
      }

      onRefreshVms?.();
      onRefreshHealth?.();
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusDot = (status: string) => {
    if (status === "ONLINE" || status === "BUSY") {
      return "bg-emerald-400 shadow-[0_0_6px_#34d399]";
    }
    if (status === "STARTING") {
      return "bg-amber-400 animate-pulse";
    }
    return "bg-zinc-600";
  };

  return (
    <>
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 bg-zinc-900/90 border border-zinc-800 rounded-lg p-0.5 sm:p-1">
        {/* 1. Account-Based Selector (Groups paired GPUs) */}
        <div className="relative flex items-center">
          <span
            className={`absolute left-2 h-2 w-2 rounded-full pointer-events-none ${getStatusDot(
              activeAccount.status
            )}`}
          />
          <select
            value={activeAccount.alias}
            onChange={(e) => setSelectedAlias(e.target.value)}
            aria-label="Select GPU Account"
            className="h-7 pl-5 pr-5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-medium text-zinc-200 hover:border-zinc-700 focus:border-amber-500 focus:outline-none appearance-none cursor-pointer max-w-[130px] sm:max-w-[170px] md:max-w-[210px] truncate"
          >
            {accounts.map((acc) => (
              <option key={acc.alias} value={acc.alias}>
                {acc.label} · {acc.status}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3 w-3 text-zinc-500 absolute right-1 pointer-events-none" />
        </div>

        {/* 2. Worker Profile / Model Selector */}
        <div className="relative flex items-center">
          <select
            value={activeAccount.workerProfile}
            onChange={(e) => handleProfileChange(e.target.value)}
            disabled={activeAccount.isStarting || isUpdatingProfile}
            aria-label="Select Model Profile"
            className="h-7 pl-2 pr-5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-medium text-zinc-200 hover:border-zinc-700 focus:border-amber-500 focus:outline-none appearance-none cursor-pointer max-w-[95px] sm:max-w-[125px] md:max-w-[155px] truncate disabled:opacity-50"
          >
            {POPULAR_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3 w-3 text-zinc-500 absolute right-1 pointer-events-none" />
        </div>

        {/* 3. Single Action Button: Boot / Starting / Kill Account */}
        {activeAccount.isOnline ? (
          <button
            type="button"
            onClick={handleToggleAccount}
            disabled={isActionLoading}
            className="flex h-7 items-center gap-1 rounded-md border border-rose-700/80 bg-rose-950/80 px-2 sm:px-2.5 text-[11px] font-semibold text-rose-300 shadow-sm transition hover:bg-rose-900 active:scale-95 disabled:opacity-50 shrink-0 whitespace-nowrap"
            title={`Kill ${activeAccount.shortName} and release GPU quota`}
          >
            <Power className={`h-3 w-3 text-rose-400 ${isActionLoading ? "animate-spin" : ""}`} />
            <span>Kill {activeAccount.shortName}</span>
          </button>
        ) : activeAccount.isStarting ? (
          <button
            type="button"
            onClick={handleToggleAccount}
            disabled={isActionLoading}
            className="flex h-7 items-center gap-1 rounded-md border border-amber-600/80 bg-amber-950/80 px-2 sm:px-2.5 text-[11px] font-semibold text-amber-300 shadow-sm transition hover:bg-amber-900 active:scale-95 shrink-0 whitespace-nowrap"
            title={`Account is booting step (${activeAccount.stepProgress}/5). Click to cancel.`}
          >
            <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
            <span>Starting ({activeAccount.stepProgress}/5)</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleToggleAccount}
            disabled={isActionLoading}
            className="flex h-7 items-center gap-1 sm:gap-1.5 rounded-md border border-amber-500 bg-amber-500 px-2.5 sm:px-3 text-[11px] font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:opacity-50 shrink-0 whitespace-nowrap"
            title={`Click to boot ${activeAccount.shortName} with selected profile`}
          >
            {isActionLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Cpu className="h-3 w-3" />
            )}
            <span>Boot {activeAccount.shortName}</span>
          </button>
        )}

        {/* 4. Manage / Add / Remove GPUs Button */}
        <button
          type="button"
          onClick={() => setIsManageModalOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-amber-400 hover:border-zinc-700 transition shrink-0"
          title="Add or Remove GPU Accounts & Slots"
          aria-label="Manage GPU Accounts"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* In-Place Manage / Add / Remove GPU Accounts Modal */}
      <ManageGpuModal
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        vms={vms}
        kaggleAccounts={kaggleAccounts}
        onRefreshVms={onRefreshVms}
      />
    </>
  );
}
