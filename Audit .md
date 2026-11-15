You are acting as a Principal Systems Architect, Codebase Auditor, and Technical Lead for **Scriptoria**.

Your job is to inspect the **ENTIRE repository**—including **all previous/legacy code** (earlier frontend pages, existing API routes, `notebook-builder.ts`, `:8188` ComfyUI/VM code, old database schemas/scripts) **AND** the **new Checkpoints 0–4 pipeline code**—and produce a complete **System Audit** plus a **Master Task & Subtask Plan**.

**STRICT OPERATING RULES:**
1. **READ-ONLY DISCOVERY FIRST — DO NOT modify any source code yet.**
2. **NO BLIND SPOTS:** Inspect every directory in the repo (`frontend`/`src`/`app`, `backend`, `scripts`, `tests`, `docs`, config files, DB migrations/schemas). Do not assume anything works just because a unit test or summary doc says so.
3. **EVIDENCE REQUIRED:** Every audit item and task MUST cite exact file paths, function/class names, API routes, and DB tables/columns. Clearly mark what is `VERIFIED LIVE`, `MOCK/UNIT-TESTED ONLY`, `CONFLICTING WITH LEGACY CODE`, or `MISSING`.
4. **CREATE TWO OUTPUT DOCUMENTS:**
   - `docs/FULL_SYSTEM_AUDIT_PLAN.md` (Deep technical audit across all layers)
   - `docs/MASTER_TASKS_AND_SUBTASKS.md` (Granular, dependency-ordered Task & Subtask tracker covering the entire project)

---

### PART 1: INSTRUCTIONS FOR `docs/FULL_SYSTEM_AUDIT_PLAN.md`

Execute the audit step-by-step across these **8 Sections**:

#### Step 1: Whole-Codebase Inventory & Legacy-vs-New Reconciliation
1. Map the full repository file tree and classify **every** file into one of:
   - `[LEGACY / PREVIOUS CODE]` (Pre-Checkpoint UI, old parsers/extractors, `:8188` ComfyUI/image-gen hooks, old VM/tunnel handlers, old DB helpers)
   - `[CHECKPOINT 0–4 PIPELINE]` (Canonical protocol, deterministic parser, rolling extractor, Stage-2 compiler, RAG indexer/retriever)
   - `[SHARED INFRA & CONFIG]` (Auth, env vars, Turso/Supabase/R2 clients, `notebook-builder.ts`, package manifests)
2. **Conflict & Duplication Matrix:**
   - Identify duplicate services, competing DB clients, mismatched env var names, and conflicting data models between `[LEGACY]` and `[CHECKPOINT 0–4]`.
   - For every `[LEGACY]` module/route/table, recommend an explicit disposition: **KEEP & INTEGRATE**, **REFACTOR**, or **DEPRECATE / REMOVE**.

#### Step 2: Frontend Audit (Previous UI + VM Controls + Missing Testbench UI)
1. Audit all existing Next.js pages, layouts, components (`VmClusterCard.tsx`, `AccountClusterCard.tsx`, etc.), hooks, and Next.js `/api/*` proxy routes (`/api/vm/[target]/hot-reload`, `/api/vm/[target]/sync`, `/api/vm/heartbeat`, plus any older routes).
2. Check TypeScript strictness, hardcoded URLs/IDs, API timeout limits (for long extraction/compile calls), SSE/streaming support, and error boundaries.
3. Perform a **Complete UI Gap Analysis** comparing what exists today vs. what is needed to manually test every step from the browser:
   - **Global Chrome:** Book switcher, live health pills (`R2`, `Supabase`, `Turso`, `VM Swarm`), persistent emergency `/vm-kill` button.
   - **Tab 0 (Plumbing & Contracts):** R2 file browser, EPUB/PDF uploader, Pydantic fault injector (`EC-0.1`), Pytest runner panel, Supabase keepalive trigger.
   - **Tab 1 (Parser Inspector):** Parser parameter toggles, frontmatter/story manual override (`manifest.json`), cleanup diff log, `<SCENE_BREAK />` viewer, `>4500`-word split boundary viewer.
   - **Tab 2 (VM & Extraction Lab):** Integrated VM swarm controls + `:8190/:8191/:8192` benchmark panel + Sidecar `:9999` log stream + Single/Range/Full extraction controls + Crash/Resume simulator (`EC-2.3`) + 3-column Source Offset Highlighter / Quote Verification (`EC-2.2`) / Rolling Glossary Diff (`EC-2.4`).
   - **Tab 3 (Graph & Timeline Studio):** Stage-2 compiler trigger + warnings feed + Dual Timeline scrubber (`narrative_seq` vs `story_time_tick`) + Flashback isolation checker (`EC-3.1`) + Character Tier matrix + Interactive Location Tree/Graph (`EC-3.3`) + Item custody ledger.
   - **Tab 4 (Hybrid & Graph RAG Workbench):** `book.db` packager + live Turso Cloud sync + DB quota gauge + read-only SQL console + 4-tool retrieval playground (`query_timeline_state`, `hybrid_search_prose` 3-column Vector/BM25/RRF view, `traverse_knowledge_graph`, `fetch_r2_verbatim`) + Spoiler Shield slider (`EC-4.2`).
   - **Tab 5 (E2E & Regression):** Full 5-stage pipeline runner + `EC-0.1`..`EC-4.4` automated scorecard.

#### Step 3: Backend Pipeline Audit (Previous Services + Checkpoints 0–4)
Audit all FastAPI/Python endpoints, services, and scripts:
1. **API & Orchestration Layer:** List every existing backend route, missing routes needed for the UI above, background task/queue handling, and CORS/proxy alignment with Next.js.
2. **Checkpoint 0 (`canonical_protocol.py`):** Strictness, schema versioning, validation edge cases.
3. **Checkpoint 1 (`deterministic_parser.py`):** EPUB/PDF edge cases (ligatures, hyphens, headers/footers, CSS scene breaks, empty/poem chapters, oversized splits).
4. **Checkpoint 2 (`rolling_extractor.py`):** Prompt/glossary bloat caps, self-healing JSON retries, quote matching, sudden-death resume integrity on real R2/Supabase state (check if tested beyond Chapter 1 of *The Alchemist*).
5. **Checkpoint 3 (Stage-2 Book Compiler):** Alias resolution accuracy, flashback isolation in carry-forward state machine, time-skip `STALE_TIME_SKIP` handling, location cycle detection, importance score math.
6. **Checkpoint 4 (`embeddings.py`, `indexer.py`, `retriever.py`):** Chunking quality, embedding model/dimensions (`768`, `F16_BLOB`), FTS5 special-character escaping (preventing SQLite syntax errors on punctuation/quotes!), RRF fusion math, and Spoiler Shield enforcement across all 4 tools including multi-hop graph edges.

#### Step 4: Cloud VM Swarm, Sidecar & ComfyUI (`:8188`) Audit
1. Inspect `notebook-builder.ts`, Sidecar (`:9999`), tunnel management (`:8188`, `:8190`, `:8191`, `:8192`), `RLock` thread safety, VRAM cleanup on hot-reload, and `vmSecret` heartbeat handshake.
2. Verify how legacy `:8188` (ComfyUI / image generation) coexists with `LLM_LIGHTWEIGHT_SWARM` without causing VRAM OOM on Kaggle Dual-T4 (`16GB x 2`, Turing SM 7.5).
3. Audit GPU quota safety: idle auto-kill timers, orphan process cleanup, and crash fail-safes.

#### Step 5: Database-by-Database Audit (R2, Supabase, Turso)
Audit **each database separately** for schema integrity, data flow, sync drift, and **free-tier limits**:
1. **Cloudflare R2 (`r2_storage.py`):** Bucket folder structure, large file upload/streaming, retry logic, orphan cleanup on re-parse/delete, and any legacy bucket prefixes.
2. **Supabase (PostgreSQL):** Inspect ALL existing tables (legacy + `books_catalog` + `ingestion_jobs`), foreign keys, indexes, state transition rules, RLS policies, client vs `SERVICE_ROLE_KEY` separation, `supabase_keepalive.py` reliability (preventing 7-day auto-pause), and `500 MB` free-tier usage.
3. **Turso (libSQL):**
   - Inspect ALL existing Turso tables (including previous VM profile tables like `LLM_LIGHTWEIGHT_SWARM`!) AND the new per-book DB design.
   - **CRITICAL CHECK:** Verify whether Checkpoint 4 currently **only builds a local `book.db` + uploads to R2**, OR actually provisions, pushes, and queries a live **Turso Cloud** database (`libsql_vector_idx` DiskANN + `FTS5`). Flag any gap clearly!
   - Verify `5 GB` total storage / `100 DB` free-tier strategy (control DB vs per-book DBs).

#### Step 6: Security, Reliability & Data Integrity Audit
Check auth/authorization on `/api/vm/*`, `/api/pipeline/*`, and backend routes; SQL injection risks (especially FTS5 and any future raw SQL console); path traversal/SSRF in R2 previews or tunnel proxies; secrets exposure in `NEXT_PUBLIC_*` vars.

#### Step 7: Live Verification & Test Coverage Audit
Separate every component into:
- Tested only with unit mocks
- Tested only on Chapter 1 of *The Alchemist*
- Verified end-to-end across a full multi-chapter book + Torture Test Corpus (`ugly PDF`, `flashback/alias novel`, `giant chapter`).

---

### PART 2: INSTRUCTIONS FOR `docs/MASTER_TASKS_AND_SUBTASKS.md`

Convert the entire audit into a **single unified Master Project Plan** covering **everything** (Legacy Cleanup + Audit Fixes + Missing Backend APIs + Full 6-Tab Testbench UI + Full-Book E2E Verification).

Organize it into clear **Phases / Epics → Tasks → Subtasks** using this exact structure:
- **Phase A: Legacy Code Reconciliation & Repo Cleanup** (deprecate/merge/refactor old code & DB tables)
- **Phase B: P0 Critical Security, Quota & Data-Sync Fixes** (secrets, auth, Turso live cloud sync, FTS5 sanitization, GPU idle-kill)
- **Phase C: Backend Pipeline Hardening & Testbench APIs** (exposing all missing FastAPI endpoints for Tabs 0–5 + SSE streaming)
- **Phase D: Testbench UI Implementation (Step-by-Step by Tab)**
  - Epic D0: Global Chrome & Tab 0 (Plumbing, Uploader, Fault Injector, Pytest Runner)
  - Epic D1: Tab 1 (Parser Inspector, Cleanup Diff, Split Boundary & Manual Override)
  - Epic D2: Tab 2 (VM Swarm Console, Benchmarks, Single/Range/Full Runner, Crash/Resume, 3-Col Offset/Quote/Glossary Inspector)
  - Epic D3: Tab 3 (Stage-2 Compiler, Dual Timeline, Flashback Checker, Tier Matrix, Location Tree/Graph, Item Custody)
  - Epic D4: Tab 4 (Turso Live Sync Console, Read-Only SQL Explorer, 4-Tool RAG & Spoiler-Shield Playground)
  - Epic D5: Tab 5 (Full E2E Pipeline Stepper & `EC-0.1`..`EC-4.4` Scorecard)
- **Phase E: Full-Book & Torture Corpus Verification Gate** (running full multi-chapter books + all edge cases live before starting Phase 2 Image Gen / Multi-Agent production)

**For EVERY Task and Subtask in `docs/MASTER_TASKS_AND_SUBTASKS.md`, include:**
1. **ID & Title** (e.g., `Task B.2` / `Subtask B.2.1`)
2. **Status Tag:** `✅ DONE (Verified)` | `⚠️ PARTIAL (Needs Live Check)` | `❌ BROKEN / CONFLICT` | `🆕 TO BUILD` | `🗑️ REMOVE`
3. **Target Files / DB Tables**
4. **Priority & Dependencies** (`P0 / P1 / P2`, `Blocked by: ...`)
5. **Exact Acceptance / Edge-Case Test Criteria** (how I will verify it myself in the UI or CLI).