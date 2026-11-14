Your IDE agent has built an impressive backend foundation—your parsers, Kaggle hot-reloadable VM swarm (:8190/:8191/:8192/:9999), rolling extractor, Stage-2 compiler, and Hybrid/Graph RAG retriever are all unit-tested.
Now, to test every micro-step manually across any full book (not just Chapter 1 of The Alchemist) without living in terminal logs, you need an Interactive Pipeline Testbench UI inside your existing Next.js app.
Below is a complete, minor-to-major UI blueprint mapped directly to your existing codebase (VmClusterCard.tsx, canonical_protocol.py, deterministic_parser.py, rolling_extractor.py, retriever.py, etc.).
Global Layout & Persistent Chrome (Always Visible)
Before building individual pages, put a persistent command header + left navigation across the entire Testbench:
Top Control Bar:
Active Book Switcher: Dropdown listing all rows in Supabase books_catalog + status pill (UPLOADED → PARSED → EXTRACTING 3/7 → COMPILED → RAG_READY) + + Upload New Book modal.
Live Cloud Health Pills (Click to Ping):
R2: Latency (ms) + bucket object count for active book.
Supabase: Connection status + last supabase_keepalive.py timestamp.
Turso: Active DB status (Local Snapshot Only vs Synced to Turso Cloud) + DB size (104 KB / 8 MB budget).
VM Swarm: ONLINE / OFFLINE + active endpoints (:8190, :8191, :8192, :9999).
🛑 Emergency /vm-kill Panic Button: Always pinned in the top-right corner so you never accidentally burn weekly Kaggle GPU quota while inspecting JSON or graphs.
Left Navigation (6 Tabs matching your Checkpoints):
0. Plumbing & Contracts
1. Parser Inspector
2. VM & Extraction Lab
3. Graph & Timeline Studio
4. Hybrid & Graph RAG Workbench
5. Full E2E & Regression Suite
Tab 0: Checkpoint 0 — Plumbing, Contracts & Upload Lab
Purpose: Test R2, Supabase, Turso, Pydantic schema strictness, and upload your Torture Test books.
Major Components:
Book Uploader & Raw R2 Explorer:
Drag-and-drop .epub / .pdf uploader → streams to R2 /raw/{book_id}/ and inserts a books_catalog row in Supabase.
Read-only R2 Tree Browser scoped to the active book_id (/raw, /parsed, /extracted, /compiled) with 1-click "Download / View Raw JSON/MD" modal.
Infrastructure Diagnostics Grid:
R2 Smoke Test button (Put/Get/Delete 1 KB test blob).
Supabase Keepalive & Job Reset: View ingestion_jobs rows, manually trigger supabase_keepalive.py, or Reset Stuck Job Status.
Turso Connection Test: Provision/verify remote Turso DB for the active book (test_turso_connection).
Minor Must-Haves (Edge-Case Testing):
Interactive Schema Fault Injector (EC-0.1): A split JSON editor loaded with a valid ChapterObservation sample + 1-click fault buttons:
+ Add Hallucinated Extra Field
Invert Char Offsets (start > end)
Empty Visual Beats Array
Click "Validate against canonical_protocol.py" → renders exact Pydantic error trace.
Pytest Trigger Panel: Buttons to run test_canonical_protocol.py, test_r2_storage.py, test_book_compiler.py, test_hybrid_rag.py from the UI and stream pass/fail output.
Tab 1: Checkpoint 1 — Deterministic Parser Inspector (Zero-LLM)
Purpose: Visually verify EPUB/PDF cleanup, frontmatter skipping, scene break detection, and oversized chapter splitting.
Major Components:
Parser Config & Run Bar:
Interactive toggles before running DeterministicNovelParser: Max Chunk Words (4500), Strip Running Headers/Footers, Fix Broken Hyphens, Normalize Ligatures, Skip Frontmatter.
"Run Deterministic Parser" button → displays parse duration (ms) and section summary (7 Story, 6 Front/Backmatter).
Chapter & Section Navigator (Left Pane):
Lists every file in manifest.json with badges: FRONTMATTER (index=0) (greyed), STORY (ch_001) (blue), SPLIT PART (ch_004_part_01/02) (amber).
Per-item stats: Word count, Char count, <SCENE_BREAK /> count, Extracted images.
Sanitization & Markdown Diff Viewer (Main Pane):
Rendered / Raw Toggle for ch_XXX.md pulled live from R2.
Color-coded inline highlights for <SCENE_BREAK /> dividers (bright orange pills).
Minor Must-Haves (Edge-Case Testing):
Cleanup Diff Ledger: A collapsible panel listing exact transformations applied in that chapter (e.g., Line 42: "moon-\nlight" → "moonlight", Line 88: "ﬁre" → "fire"), plus a Search for Leftover Artifacts quick-check (regex scan for stray ﬁ, ﬂ, Page \d+, or mid-word \n-).
Split-Boundary Verifier (4,500+ word chapters): When clicking a split part (part_01 / part_02), show the last 3 lines of Part 1 stacked directly above the first 3 lines of Part 2 so you can verify zero sentences were cut in half.
Manual Classification Override: Toggle a section between FRONTMATTER (Skip) and STORY and click "Save Updated manifest.json to R2" (crucial when an epub puts Chapter 1 inside a weird HTML spine file!).
Tab 2: Checkpoint 2 — VM Swarm Console & Rolling Extraction Lab
Purpose: Control Kaggle LLM_LIGHTWEIGHT_SWARM, benchmark models, run controlled chapter extraction, inspect quote accuracy, and test crash-resume.
Major Components:
Upgraded VM Swarm Header (Integrates VmClusterCard.tsx & AccountClusterCard.tsx):
Controls for ACC1 / ACC2: 🔄 Fetch VM (sync), ⚡ Hot Reload, 🛑 Kill VM (/vm-kill).
3-Model Live Health & Benchmark Strip: Individual status + 1-click "Run Speed Benchmark" button for :8190 (Qwen 3.5-9B VLM), :8191 (Qwen 3.5-4B Extractor), and :8192 (MiniCPM-V 1B) showing gen tok/s, prompt eval tok/s, and roundtrip ms.
Collapsible Sidecar (:9999) Live Log Streamer + GPU0 / GPU1 VRAM usage badges.
Granular Extraction Runner:
Mode selector: Single Chapter (ch_00X), Chapter Range (ch_001 → ch_003), or Full Book Loop.
Graceful Stop Button: "Stop After Current Chapter" (lets you pause without wasting mid-chapter compute).
⚡ Simulated Sudden-Death Crash Test (EC-2.3): Button to run Chapter 1–2, forcefully abort before Chapter 3, then click "Resume Rolling Extractor"—UI highlights skipped chapters (R2 Hit - Skipped) and proves Chapter 3 starts cleanly with Chapter 2's glossary!
3-Column Live Extraction Inspector (The Heart of Tab 2):
Column A — Source Prose & Offset Highlighter (ch_XXX.md): Clicking any Scene or Visual Beat in Column B automatically scrolls Column A and highlights [start_char_offset : end_char_offset] + underlines the quote_anchor.
Column B — Extracted ChapterObservation JSON & Audit (EC-2.1, EC-2.2):
Pretty tree view + raw JSON toggle.
Per-beat Quote Match Badge: 100% Exact Match (green), Fuzzy Match 96% (yellow), or Mismatch (red, showing diff!).
Self-Healing Retry Counter: Shows if Qwen failed schema validation on attempt 1 and succeeded on retry, plus extraction time & tok/s.
Column C — Rolling Entity Glossary Evolution (EC-2.4):
Side-by-side "Glossary IN" vs "Glossary OUT" for the selected chapter.
Displays Bloat Guard Meters per entity: Tag Length (e.g. 84/120 chars) and Aliases Count (2/5 max) + total glossary token footprint.
Minor Must-Haves:
Prompt Inspector Modal: Click "View Exact LLM Prompt" on any chapter to inspect the exact system prompt, Rolling Glossary injected, trailing 200 words from the previous chapter, and assistant prefill sent to :8191.
Re-Extract Single Chapter Button: Tweak your prompt or fix a bad chapter and overwrite only ch_XXX_obs.json in R2.
Tab 3: Checkpoint 3 — Stage-2 "Book Compiler" & Temporal Graph Studio
Purpose: Compile all extracted chapters into book_graph.json, then visually catch alias bugs, flashback leaks, location cycles, and scoring mistakes.
Major Components:
Compiler Execution & Diagnostics Header:
"Run Stage-2 Book Compiler" button (runs Alias Resolver, Dual Timeline, Location Tree, Carry-Forward State Machine, Importance Scorer).
Compiler Audit Log (Warnings Feed): Explicitly surfaces edge-case triggers, e.g.:
⚠ Cycle Detected & Broken: Room A -> Manor B -> Room A
⚠ Time Skip Detected at Scene 14: Carry-forward outfit marked STALE_TIME_SKIP
ℹ Merged Alias: "The Shepherd" + "Boy" -> Santiago
4 Sub-Tabs Inside Tab 3:
3A. Dual Timeline Scrubber (narrative_seq vs story_time_tick) (EC-3.1):
Dual-track interactive timeline bar. Track 1 = Reading Order (Ch 1 → 7), Track 2 = Chronological Story Ticks (Tick 1 → N).
Flashback / Dream scenes appear with distinct purple/amber badges and connecting arcs showing where they jump backward in time.
Click any Tick → opens a World Snapshot Card below (Location, Lighting, Characters Present, Outfits, Physical Conditions, Held Items).
Flashback Isolation Checker: Quick-select any character to view their state Before Flashback vs During Flashback vs After Flashback side-by-side to confirm present-day scars/outfits weren't overwritten!
3B. Character Registry, Aliases & Importance Tier Matrix (EC-3.2):
Sortable table showing Canonical Name, Merged Aliases (with chapter first seen), Visual Tier (Tier 1 Core / Tier 2 Supporting / Tier 3 Extra), and stacked bar chart of the Score Breakdown (0.35P + 0.25A + 0.25C + 0.15D).
Click any character → Inspect base_anatomy (zero clothes!) + chronological Outfit & Condition Strip across all scenes.
3C. World Map / Hierarchical Location Tree & Graph Canvas (EC-3.3):
Left pane: Collapsible folder tree (World → Country → Region → Settlement → Building → Room) displaying materialized_path (e.g. /andalusia/abandoned_church_sacristy), clearly showing skipped intermediate levels.
Right pane: Interactive graph canvas (React Flow or Cytoscape.js) showing Location nodes, location_edges (ROAD_TO, ADJACENT, NORTH_OF), and connected Entities.
3D. Items & Custody Ledger:
Select any tracked item (e.g., Chest of Treasure, Urim and Thummim) → shows a timeline chain of custody (Owner A → Location X → Owner B) and item state changes.
Minor Must-Haves:
Manual Graph Override Drawer: If the compiler wrongly merged two characters or missed an alias in an edge-case book, let the UI split/merge aliases or edit parent_location_id and re-save book_graph.json without re-running Kaggle GPU!
Tab 4: Checkpoint 4 — Hybrid RAG, Graph RAG & Turso Workbench
Purpose: Package book.db, sync to Turso Cloud, verify DB size, and interactively test all 4 Agentic Retrieval Tools with spoiler filters.
Major Components:
Packager, Turso Sync & Quota Panel (EC-4.4):
"Build book.db & Generate 768-dim Embeddings" button → shows chunk count, embedding generation time, and SQLite row counts (rag_chunks, kg_nodes, kg_states, kg_edges, kg_locations).
"Push to Turso Cloud" + "Upload Snapshot to R2" buttons.
Footprint Gauge: Exact size (104 KB vs 8 MB per-book target) + Total Turso Free Tier usage (X MB / 5 GB).
Built-in Read-Only SQL Console: Dropdown table inspector (rag_chunks, kg_edges, etc.) + raw SQL box to run ad-hoc queries directly against book.db or live Turso!
4-Tool Agentic Retrieval Playground:
Global Spoiler Shield Bar (EC-4.2): Slider/number input for max_narrative_seq (1 .. Max) and story_time_tick right at the top so every tool test respects your spoiler barrier.
Tool 1: hybrid_search_prose(query, max_narrative_seq) (EC-4.1):
Query input + Top-K selector.
3-Column Rank Comparison View:
DiskANN Vector Top-K (semantic score)
FTS5 BM25 Top-K (keyword score)
Final RRF Fused Ranking (showing exact math 1/(60+r_v) + 1/(60+r_f)).
Displays a "Spoiler Shield Blocked: X future chunks hidden" counter!
Tool 2: query_timeline_state(character_ids, tick):
Multi-select character picker + tick slider → outputs the exact JSON state packet an Art Director agent would receive.
Tool 3: traverse_knowledge_graph(entity_id, max_hops, tick) (EC-4.3):
Pick seed entity + hops (1–3) + tick → renders an interactive subgraph of discovered nodes/edges + edge table showing valid_from_tick / valid_to_tick.
Tool 4: fetch_r2_verbatim(r2_key):
Clicking any search result or graph evidence link immediately opens a drawer displaying the full verbatim R2 source passage with the matched chunk highlighted.
Tab 5: Full End-to-End Pipeline & Edge-Case Regression Runner
Purpose: Once individual tabs work, run a brand-new book from scratch in 1 click and generate a pass/fail QA scorecard.
Major Components:
5-Stage Live Stepper: Upload → Parse → Extract (Ch 1..N) → Compile → Package & Sync with per-stage duration, token throughput, and direct deep-links to inspect errors in Tabs 1–4.
Automated Edge-Case Scorecard (EC-0.1 through EC-4.4): Runs all invariant checks on the currently selected book (e.g., 95%+ Quote Match?, 0 Location Cycles?, 0 Future Spoiler Leaks at Ch 1?, book.db < 8 MB?) and renders a green/red QA badge report.
Backend API Endpoints Needed to Power This UI
Have your IDE agent expose these lightweight FastAPI routes (proxied through Next.js /api/pipeline/...):
Text
# Tab 0: Plumbing & Uploads
GET  /api/health/all                         -> R2, Supabase, Turso, VM Swarm live pings
GET  /api/r2/tree?book_id=...                -> List all R2 keys & sizes for a book
GET  /api/r2/object?key=...                  -> Preview raw JSON / Markdown from R2
POST /api/books/upload                       -> Upload EPUB/PDF to R2 + create Supabase row
POST /api/contracts/validate                 -> Validate arbitrary JSON against ChapterObservation
POST /api/tests/run?suite=...                -> Run pytest suite & stream output (SSE)

# Tab 1: Parser
POST /api/books/{id}/parse                   -> Run DeterministicNovelParser with config flags
GET  /api/books/{id}/manifest                -> Fetch parsed manifest.json + cleanup diff log
PUT  /api/books/{id}/manifest                -> Save manual frontmatter/story classification override

# Tab 2: Extraction & VM
POST /api/vm/{target}/benchmark              -> Benchmark :8190, :8191, :8192 live speeds
GET  /api/vm/{target}/logs                   -> Stream Sidecar :9999 logs (SSE)
POST /api/books/{id}/extract                 -> Body: { mode: "single"|"range"|"full", start, end }
POST /api/books/{id}/extract/stop            -> Graceful stop after current chapter
GET  /api/books/{id}/chapters/{idx}/audit    -> Returns md + obs.json + quote match % + glossary diff

# Tab 3: Compiler & Graph
POST /api/books/{id}/compile                 -> Run Stage-2 Compiler + return diagnostic warnings
GET  /api/books/{id}/graph                   -> Return compiled book_graph.json
PUT  /api/books/{id}/graph/override          -> Manual alias merge/split or location parent fix

# Tab 4: RAG & Turso
POST /api/books/{id}/package                 -> Run embeddings + indexer.py + push to Turso + R2
POST /api/books/{id}/rag/sql                 -> Execute read-only SELECT on book.db / Turso
POST /api/books/{id}/rag/hybrid-search       -> Returns Vector, BM25, RRF lists + blocked spoiler count
POST /api/books/{id}/rag/timeline-state      -> Calls retriever.query_timeline_state()
POST /api/books/{id}/rag/graph-traverse      -> Calls retriever.traverse_knowledge_graph()
Practical Build Order for Your IDE Agent
Step 1: Build the Top Bar + Tab 0 + Tab 1 first so you can immediately upload your 4 Torture Test files and visually verify DeterministicNovelParser on every chapter.
Step 2: Build Tab 2 (connecting to your existing VmClusterCard.tsx + rolling_extractor.py) and test running The Alchemist Chapters 1→7 with a simulated crash at Chapter 3.
Step 3: Build Tab 3 (with React Flow for the location/entity graph and a dual-track timeline bar) and Tab 4 (3-column Vector/BM25/RRF search debugger + Spoiler Slider) to test full-book retrieval end-to-end.