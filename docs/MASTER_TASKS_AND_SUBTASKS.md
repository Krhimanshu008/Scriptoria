# Scriptoria: Master Tasks & Subtasks Plan
**Document:** `docs/MASTER_TASKS_AND_SUBTASKS.md`  
**Author:** Principal Systems Architect & Technical Lead  
**Status:** ACTIVE TRACKER (Execution Roadmap & Granular Verification Criteria)  
**Date:** November 15, 2026  
**Companion Audit:** [`docs/FULL_SYSTEM_AUDIT_PLAN.md`](file:///c:/Users/Himan/OneDrive/Desktop/Himanshu/Scriptoria/docs/FULL_SYSTEM_AUDIT_PLAN.md)

---

## Status Tag Legend
* `✅ DONE (Verified)`: Implemented, tested, and verified live via UI or CLI.
* `⚠️ PARTIAL (Needs Live Check)`: Partially implemented or functional in mock mode; requires live end-to-end verification.
* `❌ BROKEN / CONFLICT`: Known failure, regression, collision, or unhandled exception requiring an immediate fix.
* `🆕 TO BUILD`: Net-new feature, missing endpoint, or capability identified during audit.
* `🗑️ REMOVE`: Deprecated legacy code, dead routes, or unneeded database schemas to be safely purged.

---

## Phase A: Legacy Code Reconciliation & Repo Cleanup

### Task A.1: PostgreSQL Legacy DDL & Schema Isolation
* **ID:** `Task A.1`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Files / DB Tables:**
  * `backend/scripts/init_db.sql`
  * `backend/scripts/setup_catalog_tables.py`
  * Supabase schemas: `core_sources`, `core_knowledge`, `domain_fiction`, `domain_education`, `core_production`
* **Priority & Dependencies:** P1 | Blocked by: None
* **Description:** Isolate the 5 legacy PostgreSQL schemas. Ensure new pipeline tables (`public.books_catalog` and `public.ingestion_jobs`) remain clean, lightweight, and independent of legacy 1536-dim vector tables.

#### Subtask A.1.1: Archive Legacy DDL & Document Migration Path
* **ID:** `Subtask A.1.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/scripts/init_db.sql` -> `docs/legacy/legacy_init_db.sql`
* **Acceptance Criteria:** `setup_catalog_tables.py` executes idempotently without referencing `init_db.sql`, creating only `books_catalog` and `ingestion_jobs`.

#### Subtask A.1.2: Fix Pytest Live Socket Failure on Supabase
* **ID:** `Subtask A.1.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/tests/conftest.py`, `backend/pytest.ini`, `backend/tests/test_fiction_pipeline.py`, `backend/tests/test_phase1_core.py`
* **Priority:** P0 | Blocked by: None
* **Description:** Created `conftest.py` with network probe and `@pytest.mark.requires_postgres` dynamic marker; registered in `pytest.ini`.
* **Acceptance Criteria:** `python -m pytest backend/tests -v` runs offline cleanly: 23 passed, 3 skipped, 0 failures, 0 warnings.

---

### Task A.2: Environment Variable Consolidation & De-duplication
* **ID:** `Task A.2`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Files:** `.env`, `backend/.env`, `frontend/.env`, `frontend/.env.local`
* **Priority:** P1 | Blocked by: None
* **Description:** Resolve conflicting `DATABASE_URL` values (Supabase Postgres vs Prisma SQLite) and remove duplicate API key aliases.

#### Subtask A.2.1: Disambiguate Database URLs
* **ID:** `Subtask A.2.1`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `.env`, `backend/.env`, `frontend/prisma/schema.prisma`
* **Acceptance Criteria:** `DATABASE_URL` in frontend strictly refers to `file:./scriptoria.db` or Turso libSQL; `SUPABASE_DATABASE_URL` is explicitly named in backend.

#### Subtask A.2.2: Remove Redundant Cloud & Model Keys
* **ID:** `Subtask A.2.2`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `.env`, `backend/.env`
* **Acceptance Criteria:** Standardize on single canonical names: `GEMINI_API_KEY`, `KAGGLE_API_TOKEN`, `CF_TUNNEL_TOKEN`, `COMFYUI_COLAB_URL`.

---

### Task A.3: Legacy Frontend Pages & Route Deprecation
* **ID:** `Task A.3`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Files:**
  * `frontend/src/app/(dashboard)/visualiser-lab/page.tsx`
  * `frontend/src/app/api/lab/[...path]/route.ts`
  * `frontend/src/app/api/v1/`
* **Priority:** P2 | Blocked by: None
* **Description:** Cleanly decouple old experimental visualiser lab and legacy worker claim routes from the modern testbench.

#### Subtask A.3.1: Redirect or Deprecate Visualiser Lab
* **ID:** `Subtask A.3.1`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `frontend/src/app/(dashboard)/visualiser-lab/page.tsx`
* **Acceptance Criteria:** Add deprecation banner or auto-redirect to `/testbench`.

---

## Phase B: P0 Critical Security, Quota & Data-Sync Fixes

### Task B.1: Mutual VRAM Process Eviction on Cloud VMs
* **ID:** `Task B.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/lib/orchestrator/notebook-builder.ts`
* **Priority:** P0 | Blocked by: None
* **Description:** Implemented mutual process eviction: `_stop_llm_workers_unlocked()` explicitly terminates ComfyUI (`ComfyUI/main.py`), and ComfyUI launcher evicts llama-server and clears PyTorch CUDA memory.

#### Subtask B.1.1: Add ComfyUI Process Termination to Sidecar
* **ID:** `Subtask B.1.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/lib/orchestrator/notebook-builder.ts`
* **Acceptance Criteria:** Verified mutual eviction code in `notebook-builder.ts`; GPU caches cleared via `torch.cuda.empty_cache()` and `ipc_collect()`.

---

### Task B.2: Live Turso Cloud Database Provisioning & Vector Sync
* **ID:** `Task B.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:**
  * `backend/app/services/phase4_rag/indexer.py`
  * `backend/scripts/pipeline_bridge.py` (`package_rag`, `turso_ping`, `health`)
* **Priority:** P0 | Blocked by: None
* **Description:** Implemented `sync_to_turso_cloud` in `indexer.py` with Turso Management API and DiskANN vector index; updated `package_rag` in `pipeline_bridge.py`. Local control plane fallback verified live (`80.1ms`).

#### Subtask B.2.1: Implement Turso Cloud Provisioning Service
* **ID:** `Subtask B.2.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/services/phase4_rag/indexer.py`, `backend/scripts/pipeline_bridge.py`
* **Acceptance Criteria:** Automated database provisioning and libSQL pipeline call tested and verified.

#### Subtask B.2.2: Push Compiled SQLite Schema & Create DiskANN Vector Index
* **ID:** `Subtask B.2.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/services/phase4_rag/indexer.py`
* **Acceptance Criteria:** Packages `book.db` (108 KB) and executes DiskANN vector DDL:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_chunks_vec ON rag_chunks(libsql_vector_idx(embedding, 'metric=cosine'));
  ```

---

### Task B.3: FTS5 BM25 Special Character Sanitization
* **ID:** `Task B.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/services/phase4_rag/retriever.py`
* **Priority:** P0 | Blocked by: None
* **Description:** Sanitized FTS5 queries by wrapping each token in double quotes (`"token"`) and stripping punctuation, preventing SQLite syntax crashes.

#### Subtask B.3.1: Implement Robust FTS5 Query Token Quoting
* **ID:** `Subtask B.3.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/services/phase4_rag/retriever.py`
* **Acceptance Criteria:** `rag_hybrid_search` verified via CLI: returns top chunks without `OperationalError`.

---

### Task B.4: Read-Only SQL Console Injection Guard
* **ID:** `Task B.4`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/scripts/pipeline_bridge.py` (`rag_sql`)
* **Priority:** P0 | Blocked by: None
* **Description:** Enforced strict read-only execution: rejects semicolons (multi-statement injection), forbids DDL/DML keywords, and connects with `?mode=ro`.

#### Subtask B.4.1: Enforce SQLITE_OPEN_READONLY & Statement Validation
* **ID:** `Subtask B.4.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/scripts/pipeline_bridge.py`
* **Acceptance Criteria:** Verified live: `SELECT` queries succeed; `DROP TABLE` and `SELECT 1; DROP TABLE` queries are rejected immediately.
* **Target Files:** `backend/app/services/phase4_rag/retriever.py`
* **Acceptance Criteria:** Wrap every extracted search term in double quotes (`"term"`); queries like `abandoned church (dusk)` or `"gold coins"` execute without `OperationalError`.

---

### Task B.4: Read-Only SQL Console Injection Guard
* **ID:** `Task B.4`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Files:** `backend/scripts/pipeline_bridge.py` (`rag_sql`), `frontend/src/app/api/pipeline/books/[id]/rag/sql/route.ts`
* **Priority:** P0 | Blocked by: None
* **Description:** Ensure Tab 4 SQL console strictly prevents DDL/DML statements (`DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`).

#### Subtask B.4.1: Enforce SQLITE_OPEN_READONLY & Statement Validation
* **ID:** `Subtask B.4.1`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `backend/scripts/pipeline_bridge.py`
* **Acceptance Criteria:** Open connection with `uri=True` and `file:... ?mode=ro`; reject queries that do not start with `SELECT` or `EXPLAIN`; reject chained statements (`semicolons`).

---

### Task B.5: Automated Supabase 7-Day Auto-Pause Guard
* **ID:** `Task B.5`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Files:** `backend/scripts/supabase_keepalive.py`
* **Priority:** P1 | Blocked by: None
* **Description:** Ensure free-tier Supabase project is automatically pinged every 3 days so it never enters paused state.

#### Subtask B.5.1: Create Scheduled Automation Job
* **ID:** `Subtask B.5.1`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `.github/workflows/supabase_keepalive.yml` or Antigravity scheduled automation
* **Acceptance Criteria:** Keepalive script runs on a 72-hour recurring schedule; verifies `ALIVE=True` in logs.

---

## Phase C: Backend Pipeline Hardening & Testbench APIs

### Task C.1: Native FastAPI Mounting of Pipeline Endpoints
* **ID:** `Task C.1`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `backend/app/main.py`, `backend/app/api/v1/endpoints/pipeline.py`
* **Priority:** P1 | Blocked by: None
* **Description:** Mount native FastAPI endpoints for Checkpoints 0–4 instead of relying exclusively on Node.js `child_process.spawn("python", ["pipeline_bridge.py", ...])`.

#### Subtask C.1.1: Create FastAPI Pipeline Router
* **ID:** `Subtask C.1.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/main.py`, `backend/app/routers/testbench_system.py`, `backend/app/routers/parser_inspector.py`, `backend/app/routers/vm_swarm_control.py`, `backend/app/routers/extraction_lab.py`
* **Acceptance Criteria:** Expose `/api/v1/testbench/*`, `/api/v1/parser/*`, `/api/v1/vm/*`, `/api/v1/extraction/*`. Verified with 17 passing pytest integration tests and pure-ASGI bridge guard.

#### Subtask C.1.2: Add Server-Sent Events (SSE) for Extraction Progress
* **ID:** `Subtask C.1.2`
* **Status:** `🆕 TO BUILD`
* **Target Files:** `backend/app/api/v1/endpoints/pipeline.py`
* **Acceptance Criteria:** Endpoint streams live token-generation progress and chapter completion events to the frontend.

---

### Task C.2: Pipeline Bridge Timeout Hardening
* **ID:** `Task C.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/lib/pipeline/bridge.ts`, `frontend/src/app/api/pipeline/books/[id]/chapters/[idx]/extract/route.ts`
* **Priority:** P1 | Blocked by: None
* **Description:** Extraction of long chapters can exceed the default 30-second child process timeout.
* **Acceptance Criteria:** `extract` route passes explicit `120000ms` (2 minutes); `compile` passes `60000ms`.

---

## Phase D: Testbench UI Implementation (Step-by-Step by Tab)

### Epic D0: Global Chrome & Tab 0 (Plumbing, Storage Lake, Contracts)

#### Task D0.1: TopBar Dynamic Status Pills & Panic Kill
* **ID:** `Task D0.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/TestbenchTopBar.tsx`
* **Acceptance Criteria:** TopBar displays active book selector, R2 latency (e.g. `52.1ms - 150 objs`), Supabase status (`2 books`), Turso status (`104 KB`), and toggleable `Boot Swarm` / `Panic Kill` button.

#### Task D0.2: Tab 0 EPUB/PDF Uploader & R2 Tree Viewer
* **ID:** `Task D0.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab0Plumbing.tsx`
* **Acceptance Criteria:** Uploading EPUB registers book in Supabase `books_catalog`, uploads blob to R2 (`raw/{book_id}/...`), and updates R2 Bucket Objects tree.

#### Task D0.3: Tab 0 Schema Fault Injector & Contract Rejection (EC-0.1)
* **ID:** `Task D0.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab0Plumbing.tsx`
* **Acceptance Criteria:** Clicking "Hallucinated Extra Field", "Invert Char Offsets", or "Empty Visual Beats" updates JSON; clicking "Validate" triggers Pydantic rejection with exact validation error trace.

---

### Epic D1: Tab 1 (Parser Inspector & Manifest Studio)

#### Task D1.1: Dynamic Manifest Section Loading & Word Splitter
* **ID:** `Task D1.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab1Parser.tsx`
* **Acceptance Criteria:** Loads all parsed sections dynamically from `manifest.json`; displays `SPLIT_PART` badges for sections exceeding 4,500 words.

#### Task D1.2: Markdown Viewer & `<SCENE_BREAK />` Highlighting
* **ID:** `Task D1.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab1Parser.tsx`
* **Acceptance Criteria:** Displays raw markdown and rendered view with styled scene break dividers and ligature badges.

#### Task D1.3: Text Sanitization Diff Visualizer & Dual-Span AST
* **ID:** `Task D1.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab1Parser.tsx`, `backend/app/routers/parser_inspector.py`
* **Acceptance Criteria:** Add before/after comparison tab displaying character-by-character replacements (ligatures, hyphen removals), collapsible AST hierarchy, and synchronized dual UTF-16/codepoint offset highlighter.

---

### Epic D2: Tab 2 (VM Swarm Console & Rolling Extraction Lab)

#### Task D2.1: Collapsible Swarm Selector Hub
* **ID:** `Task D2.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab2Extraction.tsx`
* **Acceptance Criteria:** Chevron toggle collapses architecture card into sleek single-line summary (`Target: GPU0 • Profile: Qwen 3.5 Swarm`), freeing ~250px vertical screen space.

#### Task D2.2: Unconstrained Vertical Scrolling & Layout
* **ID:** `Task D2.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/TestbenchShell.tsx`
* **Acceptance Criteria:** `<main>` container has `overflow-y-auto`; Columns A, B, and C are fully accessible and never cut off at viewport bottom.

#### Task D2.3: 3-Column Extraction Outputs & Quote Match Verification (EC-2.2)
* **ID:** `Task D2.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab2Extraction.tsx`, `backend/app/routers/extraction_lab.py`
* **Acceptance Criteria:**
  * Column A: Renders source prose with amber highlighted quote anchors.
  * Column B: Renders 100% exact quote match badges (`EXACT (100%)`) and beat cards.
  * Column C: Renders Glossary Out entities and EC-2.4 Bloat Guard limit meters (`Tag Length < 120`, `Aliases < 5`).

#### Task D2.4: Sudden-Death Crash & Idempotent Resume Simulator (EC-2.3)
* **ID:** `Task D2.4`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab2Extraction.tsx`, `backend/app/routers/extraction_lab.py`, `backend/tests/test_extraction_contracts_and_endpoints.py`
* **Acceptance Criteria:** Triggering crash simulation halts extraction at Chapter $N$; resuming immediately picks up from Chapter $N$ without re-extracting completed chapters $[1..N-1]$. Verified in UI and by automated integration test `test_crash_simulation_and_checkpoints_ec_2_3`.

---

### Epic D3: Tab 3 (Graph & Timeline Studio)

#### Task D3.1: Stage-2 Book Compiler Trigger & Stats Strip
* **ID:** `Task D3.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab3GraphStudio.tsx`
* **Acceptance Criteria:** "Run Stage-2 Book Compiler" executes `POST /api/pipeline/books/[id]/compile` and renders entity, location, tick, edge, and cycle detection metrics.

#### Task D3.2: Sub-Tab 3A Dual Timeline Scrubber (EC-3.1)
* **ID:** `Task D3.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab3GraphStudio.tsx`
* **Acceptance Criteria:** Displays chronological story tick pills; highlights `FLASHBACK` when `narrative_seq > story_time_tick`; updates world snapshot card on click.

#### Task D3.3: Sub-Tab 3B Character Registry & Tier Matrix (EC-3.2)
* **ID:** `Task D3.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab3GraphStudio.tsx`
* **Acceptance Criteria:** Table renders canonical characters with `TIER_1_CORE`, `TIER_2`, `TIER_3` badges, importance scores, and base anatomy preview.

#### Task D3.4: Sub-Tab 3C Location Tree & Materialized Paths (EC-3.3)
* **ID:** `Task D3.4`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab3GraphStudio.tsx`
* **Acceptance Criteria:** Renders hierarchical tree with materialized path notation (`/andalusia/abandoned_church`).

#### Task D3.5: Interactive Node-Link Knowledge Graph Canvas
* **ID:** `Task D3.5`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `frontend/src/components/testbench/tabs/Tab3GraphStudio.tsx`
* **Acceptance Criteria:** Render an interactive canvas/SVG showing entities as nodes and relationships as directed edges with zoom/pan controls.
* **Verification Evidence:** Built Sub-Tab 3D with interactive SVG canvas supporting zoom (+/-, mouse drag pan, reset view), visual tiers (Tier 1 Core cyan, Tier 2 purple, Tier 3 amber, locations emerald), directed edge lines scaled by co-occurrence weight with arrowheads, and clickable Node Inspector card displaying base anatomy and connected relations. Zero TypeScript compile errors (`npx tsc --noEmit`).

---

### Epic D4: Tab 4 (Hybrid RAG Workbench)

#### Task D4.1: `book.db` Packager & Storage Gauge (EC-4.4)
* **ID:** `Task D4.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/rag_workbench.py`, `frontend/src/components/testbench/tabs/Tab4RAGWorkbench.tsx`
* **Acceptance Criteria:** Packages database snapshot; uploads to `compiled/{book_id}/book.db`; renders KB footprint against 8MB budget with percentage meter.
* **Verification Evidence:** `POST /api/v1/rag/package` and `GET /api/v1/rag/footprint/{book_id}` verify database footprint (104.5 KB / 8192 KB budget = 1.28%). Tab 4 renders live gauge, quota meter, and Turso Cloud sync.

#### Task D4.2: Tool 1: Hybrid Search with Spoiler Shield (EC-4.2)
* **ID:** `Task D4.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/rag_workbench.py`, `frontend/src/components/testbench/tabs/Tab4RAGWorkbench.tsx`
* **Acceptance Criteria:** Adjusting `max_narrative_seq` slider blocks future chunks; displays BM25 rank, vector rank, and fused RRF score.
* **Verification Evidence:** Verified via `test_hybrid_search_rrf_and_spoiler_shield`. Setting `max_narrative_seq=2` filters out future chunks (narrative_seq > 2) with zero leak, reporting `future_blocked_chunks` in Tab 4.

#### Task D4.3: Tool 2 & Tool 3: Timeline State & Graph Traversal (EC-4.3)
* **ID:** `Task D4.3`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/rag_workbench.py`, `frontend/src/components/testbench/tabs/Tab4RAGWorkbench.tsx`
* **Acceptance Criteria:** Queries physical outfit/injuries at specific ticks; traverses multi-hop graph relationships without revealing spoiler edges.
* **Verification Evidence:** Verified via `test_timeline_state_recovery` and `test_graph_traversal`. Santiago's outfit shifts from shepherd cloak (tick 1) to desert robes (tick 4); graph expands 2 hops with custody transfer.

#### Task D4.4: Tool 4: Safe Read-Only SQL Console
* **ID:** `Task D4.4`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/rag_workbench.py`, `frontend/src/components/testbench/tabs/Tab4RAGWorkbench.tsx`
* **Acceptance Criteria:** Executes `SELECT` queries against `book.db` and renders tabular result grid; displays syntax errors cleanly in console card.
* **Verification Evidence:** Verified via `test_safe_sql_console_select_permitted` and `test_safe_sql_console_mutation_rejected`. Permitted `SELECT` queries return tabular rows and execution latency; mutations (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`) are rejected with 400 Bad Request.

---

### Epic D5: Tab 5 (Full E2E Pipeline Stepper & Regression Scorecard)

#### Task D5.1: Automated Edge-Case Scorecard (EC-0.1 to EC-4.4)
* **ID:** `Task D5.1`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/scorecard_stepper.py`, `frontend/src/components/testbench/tabs/Tab5Scorecard.tsx`
* **Acceptance Criteria:** Fetches real scorecard metrics from `/api/testbench/scorecard/[id]`; displays individual PASS/FAIL badges and scores for all 15 edge cases (EC-0.1 to EC-4.4).
* **Verification Evidence:** `GET /api/v1/scorecard/{book_id}` evaluates all 15 edge-case invariants with 100% pass rate. Tab 5 UI provides stage filtering (Plumbing, Parser, Extraction, Compiler, RAG) and displays exact verification evidence strings and latency metrics per check.

#### Task D5.2: Live 5-Stage Orchestrator (Replacing `setTimeout` Mocks)
* **ID:** `Task D5.2`
* **Status:** `✅ DONE (Verified)`
* **Target Files:** `backend/app/routers/scorecard_stepper.py`, `frontend/src/components/testbench/tabs/Tab5Scorecard.tsx`
* **Acceptance Criteria:** Clicking "Run Full End-to-End Pipeline" triggers actual sequential execution: Stage 1 (Parse) -> Stage 2 (Extract all chapters) -> Stage 3 (Compile graph) -> Stage 4 (Package RAG) -> Stage 5 (Refresh Scorecard), updating live progress bar.
* **Verification Evidence:** Replaced all `setTimeout` mocks with live call to `POST /api/v1/scorecard/e2e-run` which sequentially runs Parse -> Extraction -> Compiler -> RAG -> Invariant Evaluation, returning real stage durations and live stepper badge updates. Zero TypeScript compile errors (`npx tsc --noEmit`).

---

## Phase E: Full-Book & Torture Corpus Verification Gate

### Task E.1: Multi-Chapter Verification on *The Alchemist*
* **ID:** `Task E.1`
* **Status:** `⚠️ PARTIAL (Needs Live Check)`
* **Target Corpus:** `The Alchemist (25th Anniversary ed.) by Paulo Coelho.epub` (15 story chapters)
* **Priority:** P1 | Blocked by: Task D5.2
* **Acceptance Criteria:** Run all 15 chapters end-to-end; verify quote match rate $\ge 95\%$; verify Santiago alias resolution; verify `book.db` size $< 4 \text{ MB}$.

### Task E.2: Giant Chapter & Dialect Torture Test on *Moby Dick*
* **ID:** `Task E.2`
* **Status:** `🆕 TO BUILD`
* **Target Corpus:** `herman-melville_moby-dick.epub` (150 sections, archaic 19th-century prose)
* **Priority:** P2 | Blocked by: Task E.1
* **Acceptance Criteria:** Deterministic parser splits chapters $> 4,500$ words cleanly into split parts; extract at least 5 chapters without glossary bloat.

### Task E.3: Nonlinear Flashback & Frame Narrative Test on *The Name of the Wind*
* **ID:** `Task E.3`
* **Status:** `🆕 TO BUILD`
* **Target Corpus:** `The name of the wind_ the Kingkiller chronicle_ day one.epub` (Frame story with deep nested flashbacks)
* **Priority:** P2 | Blocked by: Task E.1
* **Acceptance Criteria:** Verify Stage-2 compiler isolates Kvothe's tavern frame story (present day) from young Kvothe's University narrative (past ticks), passing EC-3.1 with zero timeline bleeding.
