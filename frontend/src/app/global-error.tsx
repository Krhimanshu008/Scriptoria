"use client";

import React, { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError] Unhandled root application exception:", error);
  }, [error]);

  const handleClearSessionAndLogin = () => {
    // Clear session cookies and redirect to login
    document.cookie =
      "scriptoria_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0;";
    window.location.href = "/login";
  };

  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-4 font-sans">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <div className="space-y-1">
            <h1 className="text-lg font-bold text-zinc-100">
              Temporary Server Interruption
            </h1>
            <p className="text-xs text-zinc-400">
              Scriptoria encountered an unexpected error while initializing this view.
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
              className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
            >
              Reload Application
            </button>
            <button
              onClick={handleClearSessionAndLogin}
              className="w-full py-2 px-4 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium transition"
            >
              Clear Session &amp; Sign In Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
