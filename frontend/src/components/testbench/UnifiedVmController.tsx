"use client";

import React, { useState, useEffect } from "react";
import { Cpu, Power, Loader2, Sparkles, Check, ChevronDown } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { toast } from "sonner";

export interface UnifiedVmControllerProps {
  vms: PublicVmInstance[];
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

export function UnifiedVmController({
  vms,
  onRefreshVms,
  onRefreshHealth,
}: UnifiedVmControllerProps) {
  // Default to gpu0 or first available target
  const [selectedTarget, setSelectedTarget] = useState<string>("gpu0");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Sync selectedTarget if vms load and gpu0 isn't present
  useEffect(() => {
    if (vms.length > 0 && !vms.some((v) => v.target === selectedTarget)) {
      setSelectedTarget(vms[0].target);
    }
  }, [vms, selectedTarget]);

  const activeVm = vms.find((v) => v.target === selectedTarget) || vms[0];

  const vmStatus = activeVm?.status || "OFFLINE";
  const isOnline = vmStatus === "ONLINE" || vmStatus === "BUSY";
  const isStarting = vmStatus === "STARTING";
  const isOffline = !isOnline && !isStarting;

  const currentProfile = activeVm?.workerProfile || "LLM_LIGHTWEIGHT_SWARM";

  // Handle changing worker profile for the selected VM
  const handleProfileChange = async (newProfile: string) => {
    if (!activeVm) return;
    setIsUpdatingProfile(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(activeVm.target)}/profile`, {
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
        `Worker profile set to ${newProfile} on ${activeVm.target.toUpperCase()}`
      );
      onRefreshVms?.();
    } catch (err: any) {
      toast.error("Failed to update profile: " + err.message);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Single Boot / Cancel / Kill Toggle Button
  const handleToggleVm = async () => {
    if (!activeVm) return;
    setIsActionLoading(true);
    const target = activeVm.target;

    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/toggle`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || `Action failed on ${target}`);
        return;
      }

      if (isOnline || isStarting) {
        toast.success(`Termination signal sent for ${target.toUpperCase()}`);
      } else {
        toast.success(`⚡ Boot signal sent to ${target.toUpperCase()}! Initializing kernel...`);
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

  const formatTargetLabel = (vm: PublicVmInstance) => {
    const rawTarget = vm.target.toUpperCase();
    const alias = vm.displayName ? vm.displayName.split("(")[0].trim() : rawTarget;
    const provider = vm.provider === "colab" ? "Colab" : "Kaggle";
    return `${alias} (${provider})`;
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 bg-zinc-900/90 border border-zinc-800 rounded-lg p-1">
      {/* 1. Target VM Selector */}
      <div className="relative flex items-center">
        <span
          className={`absolute left-2.5 h-2 w-2 rounded-full pointer-events-none ${getStatusDot(
            vmStatus
          )}`}
        />
        <select
          value={activeVm?.target || "gpu0"}
          onChange={(e) => setSelectedTarget(e.target.value)}
          aria-label="Select VM Target"
          className="h-7 pl-6 pr-6 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-medium text-zinc-200 hover:border-zinc-700 focus:border-amber-500 focus:outline-none appearance-none cursor-pointer max-w-[140px] sm:max-w-[170px] truncate"
        >
          {vms.length > 0 ? (
            vms.map((vm) => (
              <option key={vm.target} value={vm.target}>
                {formatTargetLabel(vm)} · {vm.status}
              </option>
            ))
          ) : (
            <option value="gpu0">Kaggle GPU 0 (Dual-T4) · OFFLINE</option>
          )}
        </select>
        <ChevronDown className="h-3 w-3 text-zinc-500 absolute right-1.5 pointer-events-none" />
      </div>

      {/* 2. Worker Profile / Model Selector */}
      <div className="relative flex items-center">
        <select
          value={currentProfile}
          onChange={(e) => handleProfileChange(e.target.value)}
          disabled={isStarting || isUpdatingProfile}
          aria-label="Select Model Profile"
          className="h-7 pl-2 pr-6 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-medium text-zinc-200 hover:border-zinc-700 focus:border-amber-500 focus:outline-none appearance-none cursor-pointer max-w-[130px] sm:max-w-[160px] truncate disabled:opacity-50"
        >
          {POPULAR_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 text-zinc-500 absolute right-1.5 pointer-events-none" />
      </div>

      {/* 3. Single Action Button: Boot / Starting / Kill */}
      {isOnline ? (
        <button
          type="button"
          onClick={handleToggleVm}
          disabled={isActionLoading}
          className="flex h-7 items-center gap-1.5 rounded-md border border-rose-700/80 bg-rose-950/80 px-2.5 text-[11px] font-semibold text-rose-300 shadow-sm transition hover:bg-rose-900 active:scale-95 disabled:opacity-50 shrink-0"
          title={`Click to kill ${selectedTarget.toUpperCase()} and release GPU quota`}
        >
          <Power className={`h-3 w-3 text-rose-400 ${isActionLoading ? "animate-spin" : ""}`} />
          <span>Kill {selectedTarget.toUpperCase()}</span>
        </button>
      ) : isStarting ? (
        <button
          type="button"
          onClick={handleToggleVm}
          disabled={isActionLoading}
          className="flex h-7 items-center gap-1.5 rounded-md border border-amber-600/80 bg-amber-950/80 px-2.5 text-[11px] font-semibold text-amber-300 shadow-sm transition hover:bg-amber-900 active:scale-95 shrink-0"
          title={`VM is booting step (${activeVm?.stepProgress || 1}/5). Click to cancel.`}
        >
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
          <span>Starting ({activeVm?.stepProgress || 1}/5)</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleToggleVm}
          disabled={isActionLoading}
          className="flex h-7 items-center gap-1.5 rounded-md border border-amber-500 bg-amber-500 px-3 text-[11px] font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:opacity-50 shrink-0"
          title={`Click to boot ${selectedTarget.toUpperCase()} with selected profile`}
        >
          {isActionLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Cpu className="h-3 w-3" />
          )}
          <span>Boot {selectedTarget.toUpperCase()}</span>
        </button>
      )}
    </div>
  );
}
