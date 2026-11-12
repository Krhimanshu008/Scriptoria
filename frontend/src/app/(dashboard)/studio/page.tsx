"use client";

import React from "react";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { LiveConsole } from "@/components/logs/LiveConsole";

export default function StudioPage() {
  return (
    <div className="space-y-4">
      <StudioWorkspace />
      <LiveConsole />
    </div>
  );
}
