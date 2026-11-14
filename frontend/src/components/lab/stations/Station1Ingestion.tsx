"use client";

import React from "react";
import {
  Upload,
  BookOpen,
  Sparkles,
  FileText,
  Search,
  Zap,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { IngestionMode } from "@/types/lab";

export interface IngestionChapterItem {
  index: number;
  title: string;
  word_count?: number;
}

export interface IngestionBeatItem {
  passage_order_in_scene?: number;
  scene_number?: number;
  kinetic_intensity: number;
  dialogue_intensity: number;
  time_of_day_hint?: string;
  clean_text?: string;
  tts_text?: string;
  footnotes?: unknown[];
}

export interface IngestionResultPayload {
  all_chapters?: IngestionChapterItem[];
  total_chapters?: number;
  word_count?: number;
  atoms_count?: number;
  full_clean_text?: string;
  raw_text?: string;
  tts_stream_text?: string;
  temporal_shifts_count?: number;
  flashback_hints_count?: number;
  beats?: IngestionBeatItem[];
}

interface Station1IngestionProps {
  ingestionMode: IngestionMode;
  setIngestionMode: (mode: IngestionMode) => void;
  uploadedEpubFile: File | null;
  setUploadedEpubFile: (file: File | null) => void;
  selectedChapterIdx: number;
  setSelectedChapterIdx: (idx: number) => void;
  chapterSearch: string;
  setChapterSearch: (search: string) => void;
  rawHtmlInput: string;
  setRawHtmlInput: (html: string) => void;
  ingestionResult: IngestionResultPayload | null;
  textMode: "clean" | "tts";
  setTextMode: (mode: "clean" | "tts") => void;
  loading: boolean;
  onUploadDocument: (file: File, chapterIdx?: number) => Promise<void>;
  onLoadLotmVol1: (runFullAudit?: boolean) => Promise<void>;
  onLoadSampleNovel: () => Promise<void>;
  onChangeChapter: (targetChapter: number) => Promise<void>;
  onParseEpubDom: () => Promise<void>;
  onSendToStation2: () => void;
  onSendToStation6?: () => void;
}

export function Station1Ingestion({
  ingestionMode,
  setIngestionMode,
  uploadedEpubFile,
  setUploadedEpubFile,
  selectedChapterIdx,
  setSelectedChapterIdx,
  chapterSearch,
  setChapterSearch,
  rawHtmlInput,
  setRawHtmlInput,
  ingestionResult,
  textMode,
  setTextMode,
  loading,
  onUploadDocument,
  onLoadLotmVol1,
  onLoadSampleNovel,
  onChangeChapter,
  onParseEpubDom,
  onSendToStation2,
  onSendToStation6: _onSendToStation6,
}: Station1IngestionProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Mode Switcher */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
        {[
          { id: "epub_upload", label: "Upload EPUB / PDF Document", icon: Upload },
          {
            id: "lotm_vol1",
            label: "Lord of the Mysteries (Vol 1: Clown - 213 Chapters)",
            icon: BookOpen,
          },
          {
            id: "shadow_slave",
            label: "Shadow Slave (1,435 Chapters)",
            icon: Sparkles,
          },
          {
            id: "paste_html",
            label: "Paste Raw HTML / Prose",
            icon: FileText,
          },
        ].map((m) => {
          const Icon = m.icon;
          const isSelected = ingestionMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setIngestionMode(m.id as IngestionMode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                isSelected
                  ? "bg-emerald-600 text-white font-semibold shadow-md"
                  : "bg-neutral-900/60 text-neutral-400 hover:text-white border border-neutral-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Mode Input Panels */}
      {ingestionMode === "lotm_vol1" && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-indigo-950/40 border border-indigo-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <BookOpen className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  Lord of the Mysteries — Volume 1: Clown
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30 font-bold">
                  213 Chapters Benchmark
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-1 max-w-xl">
                Canonical webnovel by Cuttlefish That Loves Diving. Victorian steampunk / Cthulhu occult world.
                Follows Zhou Mingrui / Klein Moretti in Tingen City across Nighthawks, Sequence 9 Seer potion, and the 0-08 conspiracy.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-neutral-400 font-mono">
                <span className="text-neutral-300">• Drop-Cap: &lsquo;P&rsquo; + &lsquo;ain&rsquo; &rarr; &lsquo;Pain&rsquo;</span>
                <span className="text-neutral-300">• 0 Missing Chapters</span>
                <span className="text-neutral-300">• Zero GPU / AI Ingestion (&lt;2.5s)</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              onClick={() => onLoadLotmVol1(false)}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 font-medium text-xs text-neutral-200 border border-neutral-700 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              Pre-Flight Probe (&lt;100ms)
            </button>
            <button
              onClick={() => onLoadLotmVol1(true)}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4 text-amber-300" />
              {loading ? "Parsing 213 Chapters..." : "Ingest LOTM Vol 1 & Gate 0 Audit"}
            </button>
          </div>
        </div>
      )}

      {ingestionMode === "epub_upload" && (
        <div className="p-6 rounded-2xl bg-neutral-900/60 border border-neutral-800 flex flex-col items-center justify-center gap-4 text-center">
          <div className="p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Upload className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              Upload an EPUB or PDF Novel
            </h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-md">
              Supports .EPUB and .PDF archives. Reconstructs multi-column layout,
              strips running headers/footers, repairs hyphenated line wraps,
              stitches drop-caps, and validates Quality Gate 0.
            </p>
          </div>

          <input
            type="file"
            id="station1-epub-file-input"
            accept=".epub,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setUploadedEpubFile(f);
                onUploadDocument(f, 1);
              }
            }}
          />

          <div className="flex items-center gap-3">
            <label
              htmlFor="station1-epub-file-input"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium text-xs text-white cursor-pointer transition-all shadow-lg flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {uploadedEpubFile ? uploadedEpubFile.name : "Choose .EPUB / .PDF File"}
            </label>
            <button
              onClick={onLoadSampleNovel}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 border border-neutral-700 transition-all"
            >
              Load &lsquo;Shadow Slave&rsquo; Sample
            </button>
          </div>
        </div>
      )}

      {ingestionMode === "shadow_slave" && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-emerald-950/40 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Sparkles className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  Shadow Slave — Benchmark Dataset
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30 font-bold">
                  1,435 Chapters Indexed
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-1 max-w-xl">
                Dark fantasy progression novel by Guiltythree. Follows Sunny / Sunless in the Forgotten Shore,
                Crimson Spire, and the Dream Realm. Rigorous testing ground for bi-temporal tick management and memory retcon.
              </p>
            </div>
          </div>
          <button
            onClick={onLoadSampleNovel}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center gap-2 shrink-0"
          >
            <Zap className="w-4 h-4 text-amber-300" />
            {loading ? "Loading..." : "Load Chapter 1 Benchmark"}
          </button>
        </div>
      )}

      {ingestionMode === "paste_html" && (
        <div className="p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-neutral-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              Raw HTML / XHTML DOM String
            </h3>
            <button
              onClick={onParseEpubDom}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition-all"
            >
              Parse DOM Atoms
            </button>
          </div>
          <textarea
            value={rawHtmlInput}
            onChange={(e) => setRawHtmlInput(e.target.value)}
            rows={7}
            className="w-full bg-neutral-950 font-mono text-xs text-neutral-300 p-3 rounded-xl border border-neutral-800 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
      )}

      {/* Ingestion Results Display */}
      {ingestionResult && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chapter Selector sidebar if multiple chapters exist */}
          {ingestionResult.all_chapters && ingestionResult.all_chapters.length > 0 && (
            <div className="lg:col-span-4 flex flex-col gap-3 p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 max-h-[750px] overflow-hidden">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <span className="text-xs font-semibold text-neutral-200">
                  Chapters ({ingestionResult.total_chapters || ingestionResult.all_chapters.length})
                </span>
                <span className="text-[10px] font-mono text-neutral-500">
                  Select to Walk DOM
                </span>
              </div>

              <input
                type="text"
                value={chapterSearch}
                onChange={(e) => setChapterSearch(e.target.value)}
                placeholder="Search chapter title or number..."
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-indigo-500"
              />

              <div className="flex flex-col gap-1 overflow-y-auto pr-1">
                {ingestionResult.all_chapters
                  .filter((ch: IngestionChapterItem) =>
                    chapterSearch
                      ? ch.title.toLowerCase().includes(chapterSearch.toLowerCase()) ||
                        String(ch.index).includes(chapterSearch)
                      : true
                  )
                  .map((ch: IngestionChapterItem) => {
                    const isSelected = selectedChapterIdx === ch.index;
                    return (
                      <button
                        key={ch.index}
                        onClick={() => {
                          setSelectedChapterIdx(ch.index);
                          onChangeChapter(ch.index);
                        }}
                        className={`flex items-center justify-between p-2 rounded-lg text-left text-xs transition-all ${
                          isSelected
                            ? "bg-indigo-600 text-white font-semibold shadow-md"
                            : "hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="font-mono text-[10px] opacity-70">
                            #{ch.index}
                          </span>
                          <span className="truncate">{ch.title}</span>
                        </div>
                        {ch.word_count && (
                          <span className="text-[10px] opacity-60 font-mono shrink-0 ml-2">
                            {ch.word_count}w
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Walked DOM Output and Gate 0 Audit */}
          <div className={`${ingestionResult.all_chapters?.length ? "lg:col-span-8" : "lg:col-span-12"} flex flex-col gap-4`}>
            {/* Gate 0 Quality Badge */}
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">
                    Gate 0 Ingestion Passed: Quality Clean
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    Paragraphs stitched, drop-caps healed, non-story tags stripped.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSendToStation2}
                  className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md"
                >
                  Proceed to Story Brain
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Clean vs TTS Text Preview */}
            <div className="p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTextMode("clean")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      textMode === "clean"
                        ? "bg-neutral-800 text-white font-semibold"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    Clean Visual Story Text
                  </button>
                  <button
                    onClick={() => setTextMode("tts")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      textMode === "tts"
                        ? "bg-neutral-800 text-white font-semibold"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    TTS Phonetic & Pause Stream
                  </button>
                </div>
                <div className="text-[11px] font-mono text-neutral-500">
                  {ingestionResult.word_count || 0} words · {ingestionResult.atoms_count || 0} atoms
                </div>
              </div>

              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800/80 max-h-[450px] overflow-y-auto font-serif text-sm leading-relaxed text-neutral-200 select-text whitespace-pre-wrap">
                {textMode === "clean"
                  ? ingestionResult.full_clean_text || ingestionResult.raw_text || "No text available"
                  : ingestionResult.tts_stream_text || "No TTS text stream generated"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

