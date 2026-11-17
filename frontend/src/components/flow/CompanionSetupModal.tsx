// frontend/src/components/flow/CompanionSetupModal.tsx
"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Radio,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { FlowCompanionStatus } from "@/types/flow-contracts";

interface CompanionSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  status?: FlowCompanionStatus | null;
  onRefresh?: () => void;
}

const LOCAL_EXT_PATH =
  "C:\\Users\\5480\\Desktop\\Automation\\Book_Visualiser\\Scriptoria\\extension\\scriptoria-flow-bridge";

export function CompanionSetupModal({
  isOpen,
  onClose,
  status,
  onRefresh,
}: CompanionSetupModalProps) {
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isOpen) return null;

  const isConnected =
    status &&
    status.connection_state !== "DISCONNECTED" &&
    status.connection_state !== "ERROR";

  const handleCopyPath = () => {
    navigator.clipboard.writeText(LOCAL_EXT_PATH);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-200 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-zinc-950 shadow-md">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Scriptoria Flow Companion Setup & Account Bridge
              {isConnected ? (
                <span className="rounded-full bg-emerald-950 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                  ONLINE 🟢
                </span>
              ) : (
                <span className="rounded-full bg-rose-950 px-2.5 py-0.5 text-[10px] font-semibold text-rose-300 border border-rose-500/30">
                  OFFLINE 🔴
                </span>
              )}
            </h2>
            <p className="text-xs text-zinc-400">
              Connect Google Flow (Imagen 3 / Veo) & Google AI Studio (3.8 TTS) to Scriptoria in 2 minutes.
            </p>
          </div>
        </div>

        {/* Live Bridge Diagnostics Ribbon */}
        <div className="my-4 grid grid-cols-3 gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Chrome Extension</span>
            <span className="font-medium flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  isConnected ? "bg-emerald-400 animate-pulse" : "bg-rose-500"
                }`}
              />
              {isConnected ? "Connected (WebSocket)" : "Not Connected"}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Google Flow Tab</span>
            <span className="font-medium flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.flow_project_id ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
              {status?.flow_project_id ? "Detected & Synced" : "Waiting for Tab"}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Server Target</span>
            <span className="font-mono text-[11px] text-amber-300 truncate">
              scriptoria.krhimanshu.in
            </span>
          </div>
        </div>

        {/* 3 Simple Setup Steps */}
        <div className="space-y-3.5 max-h-[50vh] overflow-y-auto pr-1">
          {/* Step 1: Install Extension */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 text-[11px]">
                  1
                </span>
                Install Extension in Google Chrome
              </span>
              <div className="flex items-center gap-2">
                <a
                  href="/api/flow/extension/zip"
                  download="scriptoria-flow-companion.zip"
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 transition"
                >
                  <Download className="h-3 w-3" /> Download .ZIP
                </a>
                <button
                  onClick={handleCopyPath}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 transition"
                  title="Copy local workspace extension folder path"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Path Copied!" : "Copy Local Folder Path"}
                </button>
              </div>
            </div>

            <ol className="text-xs text-zinc-300 space-y-1 list-decimal list-inside pl-1">
              <li>
                In Google Chrome, open a new tab and go to:{" "}
                <code className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-[11px] text-zinc-200">
                  chrome://extensions/
                </code>
              </li>
              <li>
                In the top-right corner, switch <strong>Developer mode</strong> to <strong>ON</strong>.
              </li>
              <li>
                Click <strong>Load unpacked</strong> and select either your local folder or the unzipped download folder.
              </li>
              <li>
                Pin 📌 <strong>Scriptoria Flow Companion</strong> to your Chrome toolbar for easy access.
              </li>
            </ol>
          </div>

          {/* Step 2: Connect Google Flow & AI Studio Account */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-sky-300 text-[11px]">
                  2
                </span>
                Open & Sign In to Google Flow & AI Studio
              </span>
              <div className="flex items-center gap-2">
                <a
                  href="https://flow.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 transition"
                >
                  🌊 Open Flow <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="https://aistudio.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/20 transition"
                >
                  🎙️ AI Studio <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <p className="text-xs text-zinc-300 mb-2 leading-relaxed">
              Open both tabs in the <strong>same Chrome browser</strong> where your Google Pro account is logged in.
            </p>

            <div className="rounded-lg bg-zinc-950/70 border border-zinc-800 p-2.5 text-[11px] text-zinc-400 flex items-start gap-2">
              <span className="text-emerald-400 font-bold shrink-0">🛡️ Zero-Credential Security:</span>
              <span>
                You do <strong>not</strong> need to copy session tokens, cookies, or passwords. The extension runs in your browser and uses your native Google login session directly to execute prompts and capture media.
              </span>
            </div>
          </div>

          {/* Step 3: Verify & Dispatch */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-[11px]">
                  3
                </span>
                Verify Connection & Dispatch Swarm
              </span>
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 transition"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                Check Status
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              In the extension popup, ensure <strong>☁️ Production (scriptoria.krhimanshu.in)</strong> is selected and click <strong>⚡ Ping Test</strong>. Once connected, close this dialog and click <strong>🚀 Launch Companion Swarm</strong>!
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-zinc-800 pt-4">
          <div className="text-[11px] text-zinc-400">
            Need help? The extension code is located at <code className="text-zinc-300">extension/scriptoria-flow-bridge</code>.
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition"
          >
            Got it, Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompanionSetupModal;
