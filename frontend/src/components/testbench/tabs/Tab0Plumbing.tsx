"use client";

import React, { useState, useEffect } from "react";
import {
  Wrench,
  Cloud,
  Database,
  Server,
  Upload,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  FileText,
  Folder,
  RefreshCw,
  Eye,
  Terminal,
  ShieldAlert,
  HardDrive,
  Copy,
  Check,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";
import { FastApiBridgeCard } from "@/components/testbench/FastApiBridgeCard";

interface Tab0PlumbingProps {
  activeBookId: string;
  onRefreshBooks: () => void;
}

const VALID_SAMPLE_OBSERVATION = {
  schema_version: "1.0.0",
  book_id: "21af9bba-9158-5e28-8da9-589130815b6a",
  chapter_index: 1,
  chapter_title: "Chapter 1",
  raw_text_r2_key: "parsed/21af9bba-9158-5e28-8da9-589130815b6a/ch_001.md",
  scenes: [
    {
      scene_id: "ch001_sc01",
      scene_order_in_chapter: 1,
      start_char_offset: 0,
      end_char_offset: 450,
      verbatim_excerpt_summary: "The boy reaches the small, abandoned church just as night is falling.",
      setting: {
        location_id: "loc_abandoned_church",
        location_name: "Abandoned Church",
        time_of_day: "dusk",
        weather_atmosphere: "peaceful, cool",
        lighting: "starlight through ruined roof",
        color_palette: ["#1A1A2E", "#E2B714"],
      },
      characters_present: [
        {
          entity_id: "char_santiago",
          name_in_scene: "The boy",
          action: "arriving with flock",
          emotional_state: "peaceful",
          visual_changes: "tatters",
          clothing_mention: "tatters",
        },
      ],
      items_interacted: [
        {
          item_id: "item_shovel",
          item_name: "shovel",
          held_by_entity_id: "char_santiago",
          condition: "intact",
        },
      ],
      key_visual_beats: [
        {
          beat_order: 1,
          shot_suggestion: "Wide shot of boy arriving at ruined church at dusk",
          focal_elements: ["ruined church", "sycamore tree", "stars"],
          quote_anchor: "The boy reached the small, abandoned church just as night was falling.",
        },
      ],
      time_clue: {
        raw_text: "just as night was falling",
        time_type: "PRESENT",
        delta_hint: "dusk",
      },
    },
  ],
  discovered_entities: [
    {
      entity_id: "char_santiago",
      canonical_name: "Santiago",
      aliases: ["The boy"],
      entity_type: "CHARACTER",
      static_traits: "young shepherd boy",
      chapter_state_delta: { outfit: "tatters" },
    },
  ],
  time_clues: [{ raw_text: "just as night was falling", time_type: "PRESENT", delta_hint: "dusk" }],
  location_clues: [
    {
      raw_text: "small, abandoned church",
      parent_hint: "Andalusia",
      environment_tags: ["exterior", "ruin"],
    },
  ],
};

export function Tab0Plumbing({ activeBookId, onRefreshBooks }: Tab0PlumbingProps) {
  // Tree state
  const [treeData, setTreeData] = useState<any>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Diagnostics state
  const [r2SmokeResult, setR2SmokeResult] = useState<any>(null);
  const [r2SmokeLoading, setR2SmokeLoading] = useState(false);
  const [tursoPingResult, setTursoPingResult] = useState<any>(null);
  const [tursoPingLoading, setTursoPingLoading] = useState(false);
  const [supaHealthResult, setSupaHealthResult] = useState<any>(null);
  const [supaHealthLoading, setSupaHealthLoading] = useState(false);
  const [vmPingResult, setVmPingResult] = useState<any>(null);
  const [vmPingLoading, setVmPingLoading] = useState(false);

  // Schema fault injector state
  const [schemaJson, setSchemaJson] = useState(JSON.stringify(VALID_SAMPLE_OBSERVATION, null, 2));
  const [validationResult, setValidationResult] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Pytest runner state
  const [testSuite, setTestSuite] = useState<string>("test_canonical_protocol.py");
  const [testOutput, setTestOutput] = useState<any>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // Upload modal state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAuthor, setUploadAuthor] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Fetch R2 tree for active book
  const fetchR2Tree = async () => {
    if (!activeBookId) return;
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/pipeline/r2/tree?book_id=${activeBookId}`);
      const data = await res.json();
      setTreeData(data);
    } catch (err: any) {
      toast.error("Failed to load R2 tree: " + err.message);
    } finally {
      setTreeLoading(false);
    }
  };

  useEffect(() => {
    fetchR2Tree();
  }, [activeBookId]);

  // Preview R2 Object
  const handlePreviewKey = async (key: string) => {
    setPreviewKey(key);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/pipeline/r2/object?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      setPreviewContent(data);
    } catch (err: any) {
      toast.error("Failed to fetch object: " + err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Run R2 Smoke Test
  const handleR2Smoke = async () => {
    setR2SmokeLoading(true);
    try {
      const res = await fetch("/api/pipeline/diagnostics/r2-smoke", { method: "POST" });
      const data = await res.json();
      setR2SmokeResult(data);
      if (data.success) {
        toast.success(`R2 Smoke Test Passed (${data.total_ms}ms roundtrip)`);
      } else {
        toast.error("R2 Smoke Test Failed: " + (data.error || "Unknown"));
      }
    } catch (err: any) {
      toast.error("R2 Smoke Test Error: " + err.message);
    } finally {
      setR2SmokeLoading(false);
    }
  };

  // Run Turso Ping
  const handleTursoPing = async () => {
    setTursoPingLoading(true);
    try {
      const res = await fetch("/api/pipeline/diagnostics/turso-ping", { method: "POST" });
      const data = await res.json();
      setTursoPingResult(data);
      if (data.success) {
        toast.success(`Turso Ping OK (${data.latency_ms}ms)`);
      } else {
        toast.error("Turso Ping Failed: " + (data.error || "Unknown"));
      }
    } catch (err: any) {
      toast.error("Turso Ping Error: " + err.message);
    } finally {
      setTursoPingLoading(false);
    }
  };

  // Run Supabase Check
  const handleSupaHealth = async () => {
    setSupaHealthLoading(true);
    try {
      const res = await fetch(`/api/pipeline/health?book_id=${activeBookId}`);
      const data = await res.json();
      setSupaHealthResult(data.supabase);
      if (data.supabase?.connected) {
        toast.success(`Supabase Online (${data.supabase.books_count} books in catalog)`);
      }
    } catch (err: any) {
      toast.error("Supabase check error: " + err.message);
    } finally {
      setSupaHealthLoading(false);
    }
  };

  // Run VM Swarm Ping
  const handleVmPing = async () => {
    setVmPingLoading(true);
    try {
      const res = await fetch("/api/vm/status");
      const data = await res.json();
      const vms = data.vms || [];
      const online = vms.filter((v: any) => v.status === "ONLINE" || v.status === "BUSY");
      const starting = vms.filter((v: any) => v.status === "STARTING");
      setVmPingResult({
        success: true,
        onlineCount: online.length,
        startingCount: starting.length,
        totalCount: vms.length,
        online: online.length > 0,
      });
      if (online.length > 0) {
        toast.success(`VM Swarm Online: ${online.length}/${vms.length} active GPUs`);
      } else if (starting.length > 0) {
        toast.info(`VM Swarm Starting: ${starting.length} booting`);
      } else {
        toast.info("VM Swarm Offline (0/6 online)");
      }
    } catch (err: any) {
      toast.error("VM ping error: " + err.message);
    } finally {
      setVmPingLoading(false);
    }
  };

  // Validate Schema
  const handleValidateSchema = async () => {
    setIsValidating(true);
    try {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(schemaJson);
      } catch {
        toast.error("Invalid JSON syntax in editor");
        setIsValidating(false);
        return;
      }
      const res = await fetch("/api/pipeline/contracts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedPayload),
      });
      const data = await res.json();
      setValidationResult(data);
      if (data.valid) {
        toast.success("Schema Validated: 100% Pydantic canonical protocol compliant!");
      } else {
        toast.error(`Schema Rejected: ${data.errors?.length || 1} violations found`);
      }
    } catch (err: any) {
      toast.error("Validation request failed: " + err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // Fault Injections
  const injectExtraField = () => {
    try {
      const obj = JSON.parse(schemaJson);
      obj.hallucinated_unauthorized_key = "MODEL_LEAK_ATTEMPT";
      setSchemaJson(JSON.stringify(obj, null, 2));
      toast.info("Injected: 'hallucinated_unauthorized_key' (EC-0.1 extra field test)");
    } catch (e) {
      toast.error("Invalid JSON syntax");
    }
  };

  const injectInvertedOffsets = () => {
    try {
      const obj = JSON.parse(schemaJson);
      if (obj.scenes?.[0]) {
        obj.scenes[0].start_char_offset = 500;
        obj.scenes[0].end_char_offset = 200;
      }
      setSchemaJson(JSON.stringify(obj, null, 2));
      toast.info("Injected: Inverted offsets start=500 > end=200 (EC-0.1 offset test)");
    } catch (e) {
      toast.error("Invalid JSON syntax");
    }
  };

  const injectEmptyBeats = () => {
    try {
      const obj = JSON.parse(schemaJson);
      if (obj.scenes?.[0]) {
        obj.scenes[0].key_visual_beats = [];
      }
      setSchemaJson(JSON.stringify(obj, null, 2));
      toast.info("Injected: Empty key_visual_beats array (EC-0.1 empty beats test)");
    } catch (e) {
      toast.error("Invalid JSON syntax");
    }
  };

  const resetValidSample = () => {
    setSchemaJson(JSON.stringify(VALID_SAMPLE_OBSERVATION, null, 2));
    setValidationResult(null);
    toast.success("Reset to canonical ChapterObservation protocol sample");
  };

  // Run Pytests
  const handleRunTests = async (suite: string) => {
    setIsRunningTests(true);
    setTestSuite(suite);
    try {
      const res = await fetch(`/api/pipeline/tests/run?suite=${encodeURIComponent(suite)}`, {
        method: "POST",
      });
      const data = await res.json();
      setTestOutput(data);
      if (data.passed) {
        toast.success(`Pytest Passed in ${data.duration_sec}s!`);
      } else {
        toast.error(`Pytest Failed (exit code ${data.exit_code})`);
      }
    } catch (err: any) {
      toast.error("Test execution failed: " + err.message);
    } finally {
      setIsRunningTests(false);
    }
  };

  // Handle Book Upload
  const handleBookUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error("Please select an EPUB or PDF file");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadTitle || uploadFile.name.replace(/\.[^/.]+$/, ""));
      formData.append("author", uploadAuthor || "Unknown");

      const res = await fetch("/api/pipeline/books", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Book uploaded: ${data.title} (${data.format})`);
        setUploadFile(null);
        setUploadTitle("");
        setUploadAuthor("");
        onRefreshBooks();
        fetchR2Tree();
      } else {
        toast.error("Upload failed: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      toast.error("Upload error: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-400" />
            Checkpoint 0: Plumbing, Contracts & Storage Lake
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Test Cloudflare R2 bucket integrity, Supabase catalog sync, Pydantic v1.0 schema strictness (EC-0.1), and upload torture test novels.
          </p>
        </div>
      </div>

      {/* Live FastAPI Bridge & Unicode Parity Probe */}
      <FastApiBridgeCard />

      {/* Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Upload + R2 Scoped Tree Explorer */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Novel Uploader Box */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 mb-3">
              <Upload className="h-4 w-4 text-amber-400" />
              Upload Novel (.epub / .pdf)
            </h2>

            <form onSubmit={handleBookUpload} className="flex flex-col gap-3">
              <div className="border-2 border-dashed border-zinc-700/80 hover:border-amber-500/60 rounded-lg p-4 text-center cursor-pointer transition-colors bg-zinc-950/40">
                <input
                  type="file"
                  id="bookFileInput"
                  accept=".epub,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setUploadFile(f);
                      if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                  className="hidden"
                />
                <label htmlFor="bookFileInput" className="cursor-pointer flex flex-col items-center">
                  <FileCode className="h-7 w-7 text-zinc-400 mb-1" />
                  <span className="text-xs font-medium text-zinc-300">
                    {uploadFile ? uploadFile.name : "Click to select or drag .epub / .pdf"}
                  </span>
                  <span className="text-[11px] text-zinc-500 mt-0.5">
                    {uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB` : "Streams directly to R2 /raw/ lake"}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Book Title</label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g. The Alchemist"
                    className="w-full mt-1 h-8 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-zinc-400">Author</label>
                  <input
                    type="text"
                    value={uploadAuthor}
                    onChange={(e) => setUploadAuthor(e.target.value)}
                    placeholder="e.g. Paulo Coelho"
                    className="w-full mt-1 h-8 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!uploadFile || isUploading}
                className="mt-1 flex h-9 items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition disabled:opacity-50"
              >
                {isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? "Uploading to Cloudflare R2..." : "Upload to R2 & Supabase"}
              </button>
            </form>
          </div>

          {/* R2 Scoped Tree Explorer */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Folder className="h-4 w-4 text-cyan-400" />
                R2 Bucket Objects (Active Book)
              </h2>
              <button
                onClick={fetchR2Tree}
                disabled={treeLoading}
                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                title="Refresh R2 keys"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${treeLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {treeLoading ? (
              <div className="flex items-center justify-center p-8 text-xs text-zinc-500">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Scanning Cloudflare R2 bucket...
              </div>
            ) : !treeData || treeData.total_objects === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                No objects found in R2 for this book ID.
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-xs overflow-y-auto max-h-[460px] pr-1">
                {/* Raw */}
                <div>
                  <div className="font-semibold text-zinc-400 uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    Raw EPUB/PDF ({treeData.raw?.length || 0})
                  </div>
                  {treeData.raw?.map((k: string) => (
                    <div
                      key={k}
                      className="group flex items-center justify-between py-1 px-2 rounded hover:bg-zinc-800/80 font-mono text-[11px] text-zinc-300"
                    >
                      <span className="truncate max-w-[280px]" title={k}>
                        {k.split("/").pop()}
                      </span>
                      <button
                        onClick={() => handlePreviewKey(k)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-amber-400"
                        title="Inspect"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Parsed */}
                <div>
                  <div className="font-semibold text-zinc-400 uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                    Parsed Markdowns & Manifest ({treeData.parsed?.length || 0})
                  </div>
                  {treeData.parsed?.map((k: string) => (
                    <div
                      key={k}
                      className="group flex items-center justify-between py-1 px-2 rounded hover:bg-zinc-800/80 font-mono text-[11px] text-zinc-300"
                    >
                      <span className="truncate max-w-[280px]" title={k}>
                        {k.split("/").pop()}
                      </span>
                      <button
                        onClick={() => handlePreviewKey(k)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-amber-400"
                        title="Inspect"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Extracted */}
                <div>
                  <div className="font-semibold text-zinc-400 uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Extracted Observations ({treeData.extracted?.length || 0})
                  </div>
                  {treeData.extracted?.length === 0 ? (
                    <div className="text-[11px] text-zinc-500 italic px-2">No observations extracted yet.</div>
                  ) : (
                    treeData.extracted?.map((k: string) => (
                      <div
                        key={k}
                        className="group flex items-center justify-between py-1 px-2 rounded hover:bg-zinc-800/80 font-mono text-[11px] text-zinc-300"
                      >
                        <span className="truncate max-w-[280px]" title={k}>
                          {k.split("/").pop()}
                        </span>
                        <button
                          onClick={() => handlePreviewKey(k)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-amber-400"
                          title="Inspect"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Compiled */}
                <div>
                  <div className="font-semibold text-zinc-400 uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Compiled Graph & DB ({treeData.compiled?.length || 0})
                  </div>
                  {treeData.compiled?.length === 0 ? (
                    <div className="text-[11px] text-zinc-500 italic px-2">No compiled graph yet.</div>
                  ) : (
                    treeData.compiled?.map((k: string) => (
                      <div
                        key={k}
                        className="group flex items-center justify-between py-1 px-2 rounded hover:bg-zinc-800/80 font-mono text-[11px] text-zinc-300"
                      >
                        <span className="truncate max-w-[280px]" title={k}>
                          {k.split("/").pop()}
                        </span>
                        <button
                          onClick={() => handlePreviewKey(k)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-amber-400"
                          title="Inspect"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (7 cols): Diagnostics + Fault Injector + Pytests */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Cloud Diagnostics Grid */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 mb-3">
              <Server className="h-4 w-4 text-emerald-400" />
              Live Infrastructure Smoke Tests
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* R2 Card */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                    <span className="flex items-center gap-1.5">
                      <Cloud className="h-3.5 w-3.5 text-cyan-400" /> R2 Storage
                    </span>
                    {r2SmokeResult?.success && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {r2SmokeResult
                      ? `${r2SmokeResult.total_ms}ms (Put: ${r2SmokeResult.put_ms}ms, Get: ${r2SmokeResult.get_ms}ms)`
                      : "Put/Get/Delete 1KB blob"}
                  </div>
                </div>
                <button
                  onClick={handleR2Smoke}
                  disabled={r2SmokeLoading}
                  className="mt-3 w-full h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {r2SmokeLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run Smoke Test
                </button>
              </div>

              {/* Supabase Card */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                    <span className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-emerald-400" /> Supabase
                    </span>
                    {supaHealthResult?.connected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {supaHealthResult
                      ? `${supaHealthResult.books_count} books in catalog`
                      : "Catalog table & idle guard"}
                  </div>
                </div>
                <button
                  onClick={handleSupaHealth}
                  disabled={supaHealthLoading}
                  className="mt-3 w-full h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {supaHealthLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Ping Supabase
                </button>
              </div>

              {/* Turso Card */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-amber-400" /> Turso libSQL
                    </span>
                    {tursoPingResult?.success && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {tursoPingResult ? `${tursoPingResult.latency_ms}ms latency` : "Remote libSQL control plane"}
                  </div>
                </div>
                <button
                  onClick={handleTursoPing}
                  disabled={tursoPingLoading}
                  className="mt-3 w-full h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {tursoPingLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Ping Turso
                </button>
              </div>

              {/* VM Swarm Card */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-purple-400" /> VM Swarm
                    </span>
                    {vmPingResult?.online && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {vmPingResult
                      ? `${vmPingResult.onlineCount}/${vmPingResult.totalCount || 6} online`
                      : "Dual-T4 & Colab cluster"}
                  </div>
                </div>
                <button
                  onClick={handleVmPing}
                  disabled={vmPingLoading}
                  className="mt-3 w-full h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {vmPingLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Ping Swarm
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Schema Fault Injector (EC-0.1) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                Schema Fault Injector & Contract Rejection (EC-0.1)
              </h2>
              <button
                onClick={resetValidSample}
                className="text-[11px] text-zinc-400 hover:text-amber-400 transition"
              >
                Reset to Valid
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              Inject intentional contract violations into canonical ChapterObservation and verify strict Pydantic rejection.
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={injectExtraField}
                className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800 text-rose-300 text-[11px] font-medium transition"
              >
                + Hallucinated Extra Field
              </button>
              <button
                onClick={injectInvertedOffsets}
                className="px-2.5 py-1 rounded bg-amber-950/60 hover:bg-amber-900/80 border border-amber-800 text-amber-300 text-[11px] font-medium transition"
              >
                Invert Char Offsets (start &gt; end)
              </button>
              <button
                onClick={injectEmptyBeats}
                className="px-2.5 py-1 rounded bg-orange-950/60 hover:bg-orange-900/80 border border-orange-800 text-orange-300 text-[11px] font-medium transition"
              >
                Empty Visual Beats Array
              </button>
            </div>

            <textarea
              value={schemaJson}
              onChange={(e) => setSchemaJson(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 focus:border-amber-500 focus:outline-none"
            />

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={handleValidateSchema}
                disabled={isValidating}
                className="h-8 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isValidating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Validate against canonical_protocol.py
              </button>

              {validationResult && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border ${
                    validationResult.valid
                      ? "bg-emerald-950/60 text-emerald-400 border-emerald-800"
                      : "bg-rose-950/60 text-rose-400 border-rose-800"
                  }`}
                >
                  {validationResult.valid ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> 100% Compliant (0 errors)
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4" /> Rejected ({validationResult.errors?.length || 1} violations)
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Error Detail Display */}
            {validationResult && !validationResult.valid && (
              <div className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-300 font-mono overflow-x-auto">
                <div className="font-semibold text-rose-200 mb-1">Pydantic Validation Trace:</div>
                {validationResult.errors?.map((err: any, idx: number) => (
                  <div key={idx} className="text-[11px] py-0.5">
                    • <span className="text-amber-400">{err.loc?.join(" → ")}</span>: {err.msg}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pytest Runner Panel */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 mb-3">
              <Terminal className="h-4 w-4 text-cyan-400" />
              Live Pytest Execution Suite
            </h2>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => handleRunTests("test_canonical_protocol.py")}
                disabled={isRunningTests}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition"
              >
                test_canonical_protocol.py (Contracts)
              </button>
              <button
                onClick={() => handleRunTests("test_r2_storage.py")}
                disabled={isRunningTests}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition"
              >
                test_r2_storage.py (Cloud Storage)
              </button>
              <button
                onClick={() => handleRunTests("test_book_compiler.py")}
                disabled={isRunningTests}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition"
              >
                test_book_compiler.py (Compiler & Graph)
              </button>
              <button
                onClick={() => handleRunTests("test_hybrid_rag.py")}
                disabled={isRunningTests}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition"
              >
                test_hybrid_rag.py (RAG & Retrieval)
              </button>
              <button
                onClick={() => handleRunTests("")}
                disabled={isRunningTests}
                className="px-2.5 py-1 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 text-[11px] font-medium hover:bg-cyan-900 transition"
              >
                Run All Unit Tests
              </button>
            </div>

            {isRunningTests && (
              <div className="flex items-center gap-2 text-xs text-amber-400 p-3 bg-zinc-950/60 rounded-lg border border-zinc-800">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Running {testSuite || "all pytest suites"}...
              </div>
            )}

            {testOutput && !isRunningTests && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
                  <span className={testOutput.passed ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                    {testOutput.passed ? "✓ ALL TESTS PASSED" : "✗ TEST FAILURES DETECTED"}
                  </span>
                  <span className="text-zinc-500">{testOutput.duration_sec}s</span>
                </div>
                <pre className="whitespace-pre-wrap leading-relaxed">{testOutput.output}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* R2 Object Preview Modal */}
      {previewKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="relative w-full max-w-4xl max-h-[85vh] rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-400" />
                <span className="font-mono text-xs font-semibold text-zinc-200">{previewKey}</span>
              </div>
              <button
                onClick={() => setPreviewKey(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-zinc-950 rounded-lg border border-zinc-800 p-4 font-mono text-xs text-zinc-300">
              {previewLoading ? (
                <div className="flex items-center justify-center p-12">
                  <RefreshCw className="h-5 w-5 animate-spin text-amber-400" />
                </div>
              ) : previewContent?.is_json ? (
                <pre className="whitespace-pre-wrap">{JSON.stringify(previewContent.json, null, 2)}</pre>
              ) : (
                <pre className="whitespace-pre-wrap">{previewContent?.text || "Empty file"}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
