"use client";

import React, { useEffect } from "react";
import { AlertCircle, RotateCcw, LogIn } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError] Uncaught dashboard segment error:", error);
  }, [error]);

  const handleClearSessionAndLogin = () => {
    document.cookie =
      "scriptoria_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0;";
    window.location.href = "/login";
  };

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <AlertCircle className="h-6 w-6" />
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-bold text-zinc-100">
            Unable to Load Dashboard View
          </h2>
          <p className="text-xs text-zinc-400">
            A backend service or database operation failed to complete.
          </p>
        </div>

        {error?.digest && (
          <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[11px] font-mono text-zinc-500">
            Digest: {error.digest}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => reset()}
            className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry View
          </button>
          <button
            onClick={handleClearSessionAndLogin}
            className="w-full py-2 px-4 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition"
          >
            <LogIn className="h-3.5 w-3.5" />
            Re-authenticate (Go to Login)
          </button>
        </div>
      </div>
    </div>
  );
}
