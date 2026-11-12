"use client";

import React, { Suspense } from "react";
import { SettingsHub } from "@/components/settings/SettingsHub";

export default function VaultSettingsPage() {
  return (
    <Suspense
      fallback={<div className="py-12 text-center text-xs text-zinc-400">Loading Key Vault...</div>}
    >
      <SettingsHub defaultTab="keys" />
    </Suspense>
  );
}
