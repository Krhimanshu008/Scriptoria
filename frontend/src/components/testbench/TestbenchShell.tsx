"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TestbenchTopBar, BookSummary, HealthState } from "./TestbenchTopBar";
import { TestbenchTabstrip } from "./TestbenchTabstrip";
import type { TestbenchTabId } from "./TestbenchNavRail";
import { Tab0Plumbing } from "./tabs/Tab0Plumbing";
import { Tab1Parser } from "./tabs/Tab1Parser";
import { Tab2Extraction } from "./tabs/Tab2Extraction";
import { Tab3GraphStudio } from "./tabs/Tab3GraphStudio";
import { Tab4RAGWorkbench } from "./tabs/Tab4RAGWorkbench";
import { Tab5Scorecard } from "./tabs/Tab5Scorecard";
import { HighDensityStoryboardModal } from "./HighDensityStoryboardModal";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { toast } from "sonner";

export function TestbenchShell() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TestbenchTabId>("tab0");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [activeBookId, setActiveBookId] = useState<string>("");
  const [health, setHealth] = useState<HealthState | null>(null);
  const [booksLoading, setBooksLoading] = useState(true);
  const [isStoryboardOpen, setIsStoryboardOpen] = useState(false);

  // Cluster VM Status Query (shared with DashboardShell and GPU Cluster)
  const { data: vmData, refetch: refetchVms } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed to fetch VM status");
      return res.json();
    },
    refetchInterval: (query) => {
      const list = query.state.data?.vms ?? [];
      return list.some((v) => v.status === "STARTING") ? 2500 : 5000;
    },
    staleTime: 2500,
  });

  // Cluster Accounts Query (Kaggle Quota, Colab Tokens)
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

  const vms = vmData?.vms ?? [];

  // Fetch books list from Supabase
  const fetchBooks = async (selectBookId?: string) => {
    try {
      const res = await fetch("/api/pipeline/books");
      const data = await res.json();
      const list = data.books || [];
      setBooks(list);
      if (selectBookId) {
        setActiveBookId(selectBookId);
      } else if (list.length > 0 && (!activeBookId || !list.some((b: any) => b.book_id === activeBookId))) {
        setActiveBookId(list[0].book_id);
      }
    } catch (err: any) {
      console.error("Failed to fetch books catalog:", err);
    } finally {
      setBooksLoading(false);
    }
  };

  // Fetch live health
  const fetchHealth = async () => {
    try {
      const res = await fetch(`/api/pipeline/health${activeBookId ? `?book_id=${activeBookId}` : ""}`);
      const data = await res.json();
      if (data && typeof data === "object") {
        setHealth(data);
      }
    } catch (err) {
      console.error("Health check error:", err);
    }
  };

  const handleRefreshCluster = () => {
    fetchHealth();
    queryClient.invalidateQueries({ queryKey: ["vm-status"] });
    queryClient.invalidateQueries({ queryKey: ["vm-accounts"] });
  };

  useEffect(() => {
    fetchBooks();
    fetchHealth();
  }, []);

  useEffect(() => {
    if (activeBookId) {
      fetchHealth();
    }
  }, [activeBookId]);

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 font-sans text-zinc-100 overflow-hidden">
      {/* Pinned Top Bar */}
      <TestbenchTopBar
        books={books}
        activeBookId={activeBookId}
        onSelectBook={(id) => setActiveBookId(id)}
        health={health}
        onRefreshHealth={fetchHealth}
        onOpenUploadModal={() => setActiveTab("tab0")}
        onOpenStoryboardModal={() => setIsStoryboardOpen(true)}
        vms={vms}
        kaggleAccounts={accountsData?.kaggleAccounts || []}
        colabAccounts={accountsData?.colabAccounts || []}
        onRefreshVms={handleRefreshCluster}
      />

      {/* Studio Horizontal Tabstrip (Checkpoints 0 - 5) */}
      <TestbenchTabstrip activeTab={activeTab} onSelectTab={(tab) => setActiveTab(tab)} />

      {/* Main Body: Active Tab full width */}
      <main className="flex-1 min-h-0 w-full bg-zinc-950/50 overflow-y-auto">
        {activeTab === "tab0" && (
          <Tab0Plumbing
            activeBookId={activeBookId}
            onRefreshBooks={fetchBooks}
            onSelectBook={(id) => setActiveBookId(id)}
          />
        )}
        {activeTab === "tab1" && <Tab1Parser activeBookId={activeBookId} />}
        {activeTab === "tab2" && (
          <Tab2Extraction
            activeBookId={activeBookId}
            vms={vms}
            kaggleAccounts={accountsData?.kaggleAccounts || []}
            colabAccounts={accountsData?.colabAccounts || []}
            onRefreshVms={handleRefreshCluster}
          />
        )}
        {activeTab === "tab3" && <Tab3GraphStudio activeBookId={activeBookId} />}
        {activeTab === "tab4" && <Tab4RAGWorkbench activeBookId={activeBookId} />}
        {activeTab === "tab5" && (
          <Tab5Scorecard activeBookId={activeBookId} onNavigateTab={(tab) => setActiveTab(tab)} />
        )}
      </main>

      {/* High-Density Storyboard Studio Modal (80-100 Frames) */}
      <HighDensityStoryboardModal
        isOpen={isStoryboardOpen}
        onClose={() => setIsStoryboardOpen(false)}
        activeBookId={activeBookId}
        defaultChapterTitle={books.find((b) => b.book_id === activeBookId)?.title || "Active Chapter"}
        defaultChapterIndex={1}
      />
    </div>
  );
}
