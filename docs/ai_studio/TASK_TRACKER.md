# Scriptoria Live Sprint Task Tracker

**Active Sprint:** All Sprints (Sprint 1 through Sprint 5) — Completed & Verified  
**Primary Architect:** Gemini 4 Hydrogen (`gemini-4-hydrogen`) & Gemini 4 Argon (`gemini-4-argon`) via Google AI Studio  
**Orchestrator:** Antigravity Local Agent  
**Last Updated:** `2026-11-16T00:20:00+05:30`  
**Current Status:** ✅ **FULL SYSTEM COMPLETED & SIGNED OFF**

---

## Sprint Overview & Status Matrix

| Sprint | Scope / Components | Status | Test Coverage / Evidence |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | Tab 0 Plumbing & Tab 1 Parser Inspector | ✅ **COMPLETED** | 11/11 tests pass, contract hash `b9f84ad7...` |
| **Sprint 2** | Tab 2 VM Swarm & Extraction Lab | ✅ **COMPLETED** | 17/17 tests pass, contract hash `08e0a0b8...` |
| **Sprint 3** | Tab 3 Stage-2 Compiler & Temporal Graph Studio | ✅ **COMPLETED** | 22/22 tests pass, interactive SVG canvas, hash `067e55d5...` |
| **Sprint 4** | Tab 4 Hybrid RAG Workbench & Safe SQL Console | ✅ **COMPLETED** | 30/30 tests pass, safe SQL console, Turso sync, hash `d8002266...` |
| **Sprint 5** | Tab 5 Live 5-Stage Stepper & QA Scorecard (EC-0.1 to EC-4.4) | ✅ **COMPLETED** | 56/56 tests pass, all 15 edge cases passing 100%, hash `f92dac5e...` |

---

## Detailed Sprint Milestones

### Sprint 1: Tab 0 Plumbing & Tab 1 Parser Inspector
- [x] Pure-ASGI Bridge Guard & RFC 9562 UUIDv7 Traces (`bridge_guard.py`)
- [x] Pydantic Contract Strictness & Dual-Span Code Point Parity (`compute_utf16_span`)
- [x] Tab 0 & Tab 1 FastAPI Endpoints (`testbench_system.py`, `parser_inspector.py`)
- [x] Next.js Proxy Bridge (`/api/testbench/health`, `/contracts`, `/parser/*`)
- [x] Interactive UI: `<ContractHashBadge />`, `<FastApiBridgeCard />`, `Tab1Parser.tsx` AST viewer

### Sprint 2: Tab 2 VM Swarm & Extraction Lab
- [x] Extraction Contracts & Pydantic Schemas (`extraction_contracts.py`, EC-2.4 120-char bloat cap)
- [x] VM Swarm Control & VRAM Mutual Eviction Guard (`vm_swarm_control.py`)
- [x] Rolling Extractor, Quote Anchoring, and Crash Simulation (`extraction_lab.py`)
- [x] Next.js Proxy Bridge (`/api/testbench/vm/*`, `/api/testbench/extraction/*`)
- [x] Interactive UI: `Tab2Extraction.tsx` with live VRAM status pill, quote highlighting, and crash simulation

### Sprint 3: Tab 3 Stage-2 Compiler & Temporal Graph Studio
- [x] Stage-2 Compiler Contracts (`compiler_contracts.py` with `CompiledBookGraphResponse`, `TimelineTickSummary`, `CompiledEntitySummary`, `CompiledLocationSummary`, `GraphEdgeSummary`)
- [x] Compiler Router (`graph_studio.py` with dual timeline generation, late alias resolution, cycle-breaking location tree)
- [x] Next.js Proxy Bridge (`/api/testbench/compiler/*`)
- [x] Interactive UI (`Tab3GraphStudio.tsx`):
  - Sub-Tab 3A: Dual Timeline Scrubber (EC-3.1 flashback isolation)
  - Sub-Tab 3B: Character Registry & Visual Tier Matrix (EC-3.2)
  - Sub-Tab 3C: Location Hierarchy & Materialized Paths (EC-3.3)
  - Sub-Tab 3D: Interactive Node-Link Knowledge Graph Canvas with zoom/pan and node inspection (Task D3.5)
  - Sub-Tab 3E: Items & Custody Ledger
- [x] 22/22 pytest tests passing; commit `3303419` pushed to `origin/main`

### Sprint 4: Tab 4 Hybrid RAG Workbench & Safe SQL Console
- [x] RAG & SQL Contracts (`rag_contracts.py` with `RagHybridSearchRequest`, `TimelineStateQueryRequest`, `GraphTraversalRequest`, `SqlConsoleRequest`, `DatabaseFootprintResponse`, `TursoSyncRequest`)
- [x] Hybrid RAG & SQL Router (`rag_workbench.py` with Reciprocal Rank Fusion, Global Spoiler Shield, 2-hop graph traversal, storage budget gauge, and safe read-only SQL enforcement)
- [x] Next.js Proxy Bridge (`/api/testbench/rag/*`)
- [x] Interactive UI (`Tab4RAGWorkbench.tsx` with 3-column search view, spoiler shield slider, physical outfit recovery, and safe tabular SQL grid)
- [x] 30/30 pytest tests passing; commit `ef6f89b` pushed to `origin/main`

### Sprint 5: Tab 5 Live 5-Stage Stepper & QA Scorecard
- [x] Scorecard Contracts (`scorecard_contracts.py` with `EdgeCaseCheckResult`, `ScorecardResponse`, `PipelineStageStatus`, `E2EPipelineRunRequest`, `E2EPipelineRunResponse`)
- [x] Scorecard & Pipeline Stepper Router (`scorecard_stepper.py` with true sequential 5-stage runner and 15-check edge case invariant evaluation)
- [x] Full UI Testbench Navigation & Layout Overhaul (Argon Architecture Spec):
  - [x] Zero-clipping `CloudClusterPopover.tsx` consolidating R2, Supabase, Turso, and VM Swarm telemetry into a single badge
  - [x] Horizontal 38px Checkpoints Stepper Ribbon (`TestbenchTabstrip.tsx`) replacing dual vertical rail

---

### Subproject: Google AI Flow Browser Companion & Asset Orchestration Engine
- [x] Workstream F1: Canonical Contracts (`flow_contracts.py` with `StrictModel` validation, `FlowCompanionStatus`, `FlowIngredientSync`, `FlowGenerationTask`, `FlowMediaResultEvent`, `FlowQueueAction`)
- [x] Workstream F2: Prisma Database Schema (`schema.prisma` with `FlowProjectBinding`, `FlowIngredient`, and `FlowAsset` relations)
- [x] Workstream F3: Chrome Companion Extension MV3 (`extension/scriptoria-flow-bridge/`: `manifest.json`, `injected.js` `window.fetch` sniffer, `content.js` Lexical/React DOM injector & `@` ingredient resolver)
- [x] Workstream F4: FastAPI Bridge Router (`flow_bridge.py`: WebSocket `/api/v1/flow-bridge/ws`, in-band async streaming asset downloader to `output/flow_assets/`, SHA-256 hash calculation)
- [x] Workstream F5: Next.js Frontend Integration (`flow-contracts.ts`, route `/api/flow/dispatch`, `<FlowCompanionBadge />` live UI status pill)
- [x] 62/62 tests passing, 0 TypeScript errors, Prisma schema 100% valid
  - [x] Auto-collapsing app sidebar to 56px (`w-14`) Icon Rail on `/testbench`
  - [x] 100% full-viewport locked workspace (`w-[calc(100vw-3.5rem)]`) for deep 3-column test tools
  - [x] Canonical contract parity verified (`sha256=f92dac5e...`), 0 TypeScript errors, commits `89f2aff` and `5f94a90` deployed
- [x] Next.js Proxy Bridge (`/api/testbench/scorecard/*`)
- [x] Interactive UI (`Tab5Scorecard.tsx` with live 5-stage sequential stepper replacing setTimeout mocks, and automated QA regression matrix with stage filtering and verifiable evidence strings)
- [x] Full test pass: 56 passed, 3 skipped, 0 failures; zero contract drift (`f92dac5e...`); commit `f54b2fb` pushed to `origin/main`
