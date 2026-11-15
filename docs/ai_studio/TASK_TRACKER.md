# Scriptoria Live Sprint Task Tracker

**Active Sprint:** Sprint 1 — Contract-Verified Testbench Bridge, Tab 0 (Plumbing) & Tab 1 (Parser Inspector)  
**Primary Architect:** Gemini 4 Hydrogen (`gemini-4-hydrogen`) & Gemini 4 Argon (`gemini-4-argon`) via Google AI Studio  
**Orchestrator:** Antigravity Local Agent  
**Last Updated:** `2026-11-15T23:35:00+05:30`  
**Current Status:** **SPRINT 1 COMPLETED & SIGNED OFF**

---

## Sprint Overview & Status Matrix

| Workstream | Scope / Components | Status | Test Coverage |
| :--- | :--- | :--- | :--- |
| **Workstream A** | Canonical Contracts, Dual-Span Offsets & Pure ASGI Guard | ✅ **COMPLETED** | 6/6 tests passing (0.25s) |
| **Workstream B** | Tab 0 & Tab 1 FastAPI Endpoints (`testbench_system.py`, `parser_inspector.py`) | ✅ **COMPLETED** | 5/5 tests passing (2.81s) |
| **Workstream C** | Next.js Typed Proxy Bridge (`server-client.ts`, `/api/testbench/*`) | ✅ **COMPLETED** | `tsc --noEmit` passed (0 errors) |
| **Workstream D** | Testbench Shell & React UI (`ContractHashBadge.tsx`, `FastApiBridgeCard.tsx`, `Tab1Parser.tsx`) | ✅ **COMPLETED** | Mounted & `tsc` clean (0 errors) |
| **Workstream E** | Sprint 1 E2E Verification & Exit Gate (`pytest`, `tsc --noEmit`, Contract Hash) | ✅ **COMPLETED** | 11/11 tests pass, 0 contract drift, 0 type errors |

---

## Detailed Task Breakdown

### Workstream A: Canonical Contracts & FastAPI Bridge Foundation
- [x] **Subtask A.1:** Fix missing `Union` import in `backend/app/services/phase2_ingestion/deterministic_parser.py`.
- [x] **Subtask A.2:** Implement `backend/app/schemas/testbench_contracts.py` with `StrictModel`, `compute_utf16_span`, `SpanRange`, and `ApiErrorEnvelope`.
- [x] **Subtask A.3:** Implement pure ASGI `backend/app/middleware/bridge_guard.py` with RFC 9562 UUIDv7 trace minting, timing-safe `secrets.compare_digest` verification, and global exception normalization.
- [x] **Subtask A.4:** Wire `install_bridge_guard(app)` into `backend/app/main.py`.
- [x] **Subtask A.5:** Implement `backend/scripts/export_contracts.py` for deterministic SHA-256 OpenAPI contract hashing and drift detection.
- [x] **Subtask A.6:** Add unit test suite `backend/tests/test_testbench_contracts.py` (6/6 passing in 0.25s).
- [x] **Subtask A.7:** Export and verify initial contracts: `sha256=7d249241f35185a18ee8bc297d94a3c1a7d1ff8d58f9e4545ef616e2bff41e5b`.

---

### Workstream B: Tab 0 & Tab 1 FastAPI Endpoints
- [x] **Subtask B.1:** Implement `backend/app/routers/testbench_system.py`:
  - `GET /api/v1/testbench/health` (Probes SQLite FTS5 integrity, VRAM Mutual Eviction lock state, worker ping, uptime).
  - `GET /api/v1/testbench/contracts` (Returns `contract_hash`, schema version, limits).
  - `POST /api/v1/testbench/echo-validate` (Echoes payload, checks normalization, returns `compute_utf16_span` metrics).
- [x] **Subtask B.2:** Implement `backend/app/routers/parser_inspector.py`:
  - `GET /api/v1/parser/presets` (Parser structural profiles & chunk limits).
  - `POST /api/v1/parser/inspect` (Dry-run parser execution + FTS5 sanitization preview + dual-span AST).
- [x] **Subtask B.3:** Mount both routers in `backend/app/main.py` under `/api/v1`.
- [x] **Subtask B.4:** Create and pass test suite `backend/tests/test_testbench_endpoints.py` (5/5 passed).
- [x] **Subtask B.5:** Update OpenAPI schema and re-verify contract hash via `export_contracts.py` (`sha256=b9f84ad7eac059f176856cb7494625e513693aed0a26dbd224bc4e54ffb1881a`).

---

### Workstream C: Next.js Typed Proxy Bridge & Codegen
- [x] **Subtask C.1:** Implement `frontend/src/types/testbench-contracts.ts` with pinned `EXPECTED_CONTRACT_HASH` and strict interfaces.
- [x] **Subtask C.2:** Implement `frontend/src/lib/bridge/server-client.ts` with `forwardToFastAPI()`, `AbortSignal.any` timeout/cancellation, payload caps, and `X-Trace-ID` propagation.
- [x] **Subtask C.3:** Implement route handlers:
  - `/api/testbench/health/route.ts`
  - `/api/testbench/contracts/route.ts`
  - `/api/testbench/echo-validate/route.ts`
  - `/api/testbench/parser/presets/route.ts`
  - `/api/testbench/parser/inspect/route.ts`
- [x] **Subtask C.4:** Verify full Next.js TypeScript compilation (`npx tsc --noEmit` exited with 0 errors).

---

### Workstream D: Testbench Shell + Tab 0 & Tab 1 React UI
- [x] **Subtask D.1:** Build `ContractHashBadge.tsx` with live contract parity check against `EXPECTED_CONTRACT_HASH`, hover tooltip with model count & schema version, and click-to-copy `X-Trace-ID`.
- [x] **Subtask D.2:** Mount `<ContractHashBadge />` in `TestbenchTopBar.tsx`.
- [x] **Subtask D.3:** Build `FastApiBridgeCard.tsx` with live SQLite FTS5 status, VRAM Coordinator status, and interactive Unicode / UTF-16 span parity tester.
- [x] **Subtask D.4:** Mount `<FastApiBridgeCard />` and fix the wrapped payload bug in `Tab0Plumbing.tsx`.
- [x] **Subtask D.5:** Upgrade `Tab1Parser.tsx` to bind directly to `/api/testbench/parser/presets` and `/api/testbench/parser/inspect`, with collapsible AST Tree, synchronized UTF-16 highlighter, chunk viewer, and diagnostics.
- [x] **Subtask D.6:** Verify TypeScript compilation (`npx tsc --noEmit` exited with 0 errors).

---

### Workstream E: Verification & Exit Gate
- [x] **Subtask E.1:** Full backend test suite pass (`pytest` - 11/11 passed in 1.68s).
- [x] **Subtask E.2:** Full frontend typecheck pass (`tsc --noEmit` - 0 errors).
- [x] **Subtask E.3:** Zero contract drift confirmed between backend OpenAPI and frontend types (`sha256=b9f84ad7eac059f176856cb7494625e513693aed0a26dbd224bc4e54ffb1881a`).
- [x] **Subtask E.4:** Synchronize tracker and Memory.md.

---

## Sprint 2: Tab 2 (VM Swarm & Rolling Extraction Lab)

**Active Sprint:** Sprint 2 — Cloud VM Swarm Control & Rolling Extraction Lab (Tab 2)  
**Primary Architect:** Gemini 4 Argon (`gemini-4-argon`) via Google AI Studio  
**Orchestrator:** Antigravity Local Agent  
**Last Updated:** `2026-11-15T23:50:00+05:30`  
**Current Status:** **SPRINT 2 COMPLETED & VERIFIED**

### Sprint 2 Overview & Status Matrix

| Workstream | Scope / Components | Status | Test Coverage |
| :--- | :--- | :--- | :--- |
| **Workstream 2A** | Extraction Contracts & Pydantic Schemas (`extraction_contracts.py`) | ✅ **COMPLETED** | Pydantic v2 `StrictModel`, EC-2.4 120-char bloat cap verified |
| **Workstream 2B** | FastAPI Endpoints (`vm_swarm_control.py`, `extraction_lab.py`) | ✅ **COMPLETED** | 6/6 tests passing (3.20s), 17/17 combined tests |
| **Workstream 2C** | Next.js Typed Proxy Bridge (`/api/testbench/vm/*`, `/api/testbench/extraction/*`) | ✅ **COMPLETED** | `tsc --noEmit` passed (0 errors) |
| **Workstream 2D** | Tab 2 UI Polish (`Tab2Extraction.tsx` VRAM Eviction + Live Extraction + Crash Sim) | ✅ **COMPLETED** | Mounted & `tsc` clean (0 errors) |
| **Workstream 2E** | Sprint 2 Contract Hash & Drift Verification | ✅ **COMPLETED** | Pinned `sha256=08e0a0b8a38adab857ec8d2c933dfd88fbbed1e0036ff675f0a18b165f036292` |

### Detailed Sprint 2 Task Breakdown
- [x] **Subtask 2A.1:** Implement `backend/app/schemas/extraction_contracts.py` with `QuoteAnchorMatch`, `VisualBeat`, `ExtractedScene`, `ExtractedEntityItem` (EC-2.4 120 char bloat cap), `RollingGlossarySnapshot`, `ChapterExtractionRequest`, `ChapterExtractionResponse`, `VramEvictionState`, `CrashSimulationResponse`.
- [x] **Subtask 2B.1:** Implement `backend/app/routers/vm_swarm_control.py`:
  - `GET /api/v1/vm/swarm/status` (probes ports 8190, 8191, 8192, 9999 and targets gpu0, gpu1, tpu0).
  - `POST /api/v1/vm/vram/lock` (mutual eviction state machine with 409 ApiErrorEnvelope on conflict).
- [x] **Subtask 2B.2:** Implement `backend/app/routers/extraction_lab.py`:
  - `POST /api/v1/extraction/chapter` (sentence-level beat extraction, exact & fuzzy quote anchoring with `SpanRange` offsets, EC-2.4 bloat clamping).
  - `GET /api/v1/extraction/checkpoints/{book_id}` (checkpoint listing for resume state).
  - `POST /api/v1/extraction/crash-simulate` (mid-run crash simulation at chapter $N$, preserving $1..N-1$).
- [x] **Subtask 2B.3:** Mount both routers in `backend/app/main.py`.
- [x] **Subtask 2B.4:** Create unit & integration test suite `backend/tests/test_extraction_contracts_and_endpoints.py` (6/6 passing).
- [x] **Subtask 2B.5:** Re-export contracts via `export_contracts.py` (`sha256=08e0a0b8...`).
- [x] **Subtask 2C.1:** Update `frontend/src/types/testbench-contracts.ts` with new contract hash and TypeScript interfaces.
- [x] **Subtask 2C.2:** Create Next.js route handlers:
  - `/api/testbench/vm/swarm/status/route.ts`
  - `/api/testbench/vm/vram/lock/route.ts`
  - `/api/testbench/extraction/chapter/route.ts`
  - `/api/testbench/extraction/checkpoints/[bookId]/route.ts`
  - `/api/testbench/extraction/crash-simulate/route.ts`
- [x] **Subtask 2D.1:** Upgrade `Tab2Extraction.tsx`:
  - Add interactive VRAM Mutual Eviction Status pill in header with lock/release buttons.
  - Wire extraction button to `/api/testbench/extraction/chapter` fallback.
  - Wire sudden-death crash test to live `/api/testbench/extraction/crash-simulate` endpoint.
- [x] **Subtask 2E.1:** Verify full Next.js compilation (`npx tsc --noEmit` - 0 errors).
- [x] **Subtask 2E.2:** Verify full backend pytest suite (17/17 tests passing in 2.80s).
- [x] **Subtask 2E.3:** Verify zero contract drift (`export_contracts.py --check`).

---

## Upcoming: Sprint 3 (Tab 3: Graph & Timeline Studio)
- **Workstream 3.1:** Stage-2 Book Compiler Contracts & Endpoints (`book_compiler.py`, cycle detection, alias resolution).
- **Workstream 3.2:** Dual Timeline Scrubber (`narrative_seq` vs `story_time_tick`) & Flashback Isolation (`EC-3.1`).
- **Workstream 3.3:** Character Registry & Tier Matrix (`EC-3.2`).
- **Workstream 3.4:** Interactive Location Tree & Node-Link Graph Studio (`EC-3.3`).
