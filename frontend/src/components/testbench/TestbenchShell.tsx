"use client";

import React, { useState, useEffect } from "react";
import { TestbenchTopBar, BookSummary, HealthState } from "./TestbenchTopBar";
import { TestbenchNavRail, TestbenchTabId } from "./TestbenchNavRail";
import { Tab0Plumbing } from "./tabs/Tab0Plumbing";
import { Tab1Parser } from "./tabs/Tab1Parser";
import { Tab2Extraction } from "./tabs/Tab2Extraction";
import { Tab3GraphStudio } from "./tabs/Tab3GraphStudio";
import { Tab4RAGWorkbench } from "./tabs/Tab4RAGWorkbench";
import { Tab5Scorecard } from "./tabs/Tab5Scorecard";
import { toast } from "sonner";

export function TestbenchShell() {
  const [activeTab, setActiveTab] = useState<TestbenchTabId>("tab0");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [activeBookId, setActiveBookId] = useState<string>("");
  const [health, setHealth] = useState<HealthState | null>(null);
  const [booksLoading, setBooksLoading] = useState(true);

  // Fetch books list from Supabase
  const fetchBooks = async () => {
    try {
      const res = await fetch("/api/pipeline/books");
      const data = await res.json();
      const list = data.books || [];
      setBooks(list);
      if (list.length > 0 && !activeBookId) {
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
    <div className="flex h-screen w-full flex-col bg-zinc-950 font-sans text-zinc-100 overflow-hidden">
      {/* Pinned Top Bar */}
      <TestbenchTopBar
        books={books}
        activeBookId={activeBookId}
        onSelectBook={(id) => setActiveBookId(id)}
        health={health}
        onRefreshHealth={fetchHealth}
        onOpenUploadModal={() => setActiveTab("tab0")}
      />

      {/* Main Body: Nav Rail (Left) + Active Tab (Right) */}
      <div className="flex flex-1 overflow-hidden">
        <TestbenchNavRail activeTab={activeTab} onSelectTab={(tab) => setActiveTab(tab)} />

        <main className="flex-1 overflow-y-auto bg-zinc-950/50">
          {activeTab === "tab0" && (
            <Tab0Plumbing activeBookId={activeBookId} onRefreshBooks={fetchBooks} />
          )}
          {activeTab === "tab1" && <Tab1Parser activeBookId={activeBookId} />}
          {activeTab === "tab2" && <Tab2Extraction activeBookId={activeBookId} />}
          {activeTab === "tab3" && <Tab3GraphStudio activeBookId={activeBookId} />}
          {activeTab === "tab4" && <Tab4RAGWorkbench activeBookId={activeBookId} />}
          {activeTab === "tab5" && (
            <Tab5Scorecard activeBookId={activeBookId} onNavigateTab={(tab) => setActiveTab(tab)} />
          )}
        </main>
      </div>
    </div>
  );
}
