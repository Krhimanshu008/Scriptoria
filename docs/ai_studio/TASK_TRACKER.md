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

## Upcoming: Sprint 2 (Tab 2: VM Swarm & Extraction Lab)
- **Workstream 2.1:** Cloud VM Swarm & Worker Control Plane (Sidecar SSE log streaming on ports `:9999` and `:8190/:8191/:8192`).
- **Workstream 2.2:** Single/Range Chapter Extraction Runner with VRAM Mutual Eviction enforcement.
- **Workstream 2.3:** 3-Column Source Offset Highlighter & Quote Verification Inspector (`EC-2.2`).
