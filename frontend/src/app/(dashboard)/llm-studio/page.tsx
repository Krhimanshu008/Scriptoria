"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LlmStudioTab } from "@/components/studio/LlmStudioTab";
import { AgentCoDirectorPanel } from "@/components/studio/AgentCoDirectorPanel";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";

export default function LlmStudioPage() {
  const [showCoDirector, setShowCoDirector] = useState(false);

  const { data: vmData, refetch: refetchVms } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed to fetch VM cluster state");
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 4000,
  });

  const vms = vmData?.vms || [];

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex justify-end">
          <Button
            size="xs"
            variant="outline"
            onClick={() => setShowCoDirector((v) => !v)}
          >
            {showCoDirector ? (
              <>
                <PanelRightClose className="size-3.5" /> Hide Co-Director
              </>
            ) : (
              <>
                <PanelRightOpen className="size-3.5" /> AI Co-Director
              </>
            )}
          </Button>
        </div>

        <LlmStudioTab vms={vms} onVmsUpdated={() => void refetchVms()} />
      </div>

      {showCoDirector && (
        <aside className="w-full shrink-0 lg:w-[360px]">
          <AgentCoDirectorPanel />
        </aside>
      )}
    </div>
  );
}
