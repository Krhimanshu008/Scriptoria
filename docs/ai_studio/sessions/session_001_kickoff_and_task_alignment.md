# AI Studio Session 001: Bridge Verification & Sprint 1 Architecture

- **Session ID:** `session_001_kickoff_and_task_alignment`
- **Timestamp:** `2026-11-15T22:28:50+05:30`
- **Platform:** Google AI Studio Playground
- **Account:** `himanshu20031225@gmail.com` (PRO)
- **Model:** `gemini-4-hydrogen` (Thinking: `High`, Duration: `23.8s`)
- **Grounding:** `Google Search` enabled
- **Session Tokens:** ~11,033 tokens
- **Browser Session Recording:** [`recording.mp4`](file:///C:/Users/Himan/.gemini/antigravity/brain/718865cc-13dd-4292-bda9-cb3b4748a7dc/recording.mp4)

---

## 1. Prompt Submitted to Gemini 4 Hydrogen

```markdown
Hello Gemini 4 Hydrogen! You are now connected with the Antigravity local agent on the Scriptoria project repository. 

We are utilizing your High Thinking capabilities as our Chief Architect & Deep Reasoning Engine for planning, auditing, and executing the platform until it achieves all goals.

Here is our current milestone status:
1. Checkpoints 0–4 core code and P0 fixes (VRAM mutual eviction, FTS5 sanitization, SQL injection guards, and test mocks) are complete and verified.
2. Master task tracking is set up in `docs/MASTER_TASKS_AND_SUBTASKS.md`.
3. Our next focus is Phase C (Missing Backend Pipeline & Testbench APIs) and Phase D (Building the 6-Tab Testbench UI: Tab 0 Plumbing/Contracts, Tab 1 Parser Inspector, Tab 2 VM Swarm/Extraction, Tab 3 Graph/Timeline Studio, Tab 4 Hybrid RAG Workbench, Tab 5 E2E Stepper).

Please provide your high-thinking architectural assessment:
1. How should we sequence the development of the Tab 0 (Plumbing & Contracts) and Tab 1 (Parser Inspector) FastAPI endpoints and React components?
2. What are the key contract and schema guardrails we must enforce between the Next.js frontend proxy and the FastAPI pipeline bridge?
3. Outline the exact implementation plan for the first concrete sprint.
```

---

## 2. Gemini 4 Hydrogen Reasoning & Synthesis

### Core Architectural Conclusions:
1. **Observability & Contract Truth Must Precede Feature UI:**
   - Attempting to build Tab 1 (Parser Inspector) before Tab 0 (Plumbing & Contracts) leads to blind debugging of Next.js proxy timeouts, serialization drift, VRAM contention, and Unicode offset mismatches directly inside complex parser UI state.
2. **Critical Guardrails Identified:**
   - **Unicode Offset Parity:** Python code points vs. JavaScript UTF-16 code units. Provide dual-span representations (`codepoint_span` and `utf16_span`) on canonical normalized text to prevent highlight shifting on emojis, smart quotes, and em-dashes.
   - **Strict Schema Pinning:** Enforce Pydantic v2 `ConfigDict(extra="forbid", frozen=True)` and reject `NaN`/`Infinity`.
   - **Unified Error Envelope:** Normalize all upstream errors (422, unhandled 500, ECONNREFUSED, timeout AbortError) into a deterministic `ApiErrorEnvelope` with `X-Trace-ID`.
   - **Cancellation & Resource Management:** Combine client `AbortSignal` with explicit timeouts so cancelled requests trigger FastAPI connection closure and release held compute/VRAM locks.
   - **No Naive Wildcard Proxy:** Avoid open `/api/proxy/[...slug]`; use explicit route handlers with `X-Bridge-Secret` authentication.

---

## 3. Sprint 1 Execution Plan Breakdown

### Stage 0: Canonical Contracts & Wire Protocol
- Pydantic v2 schemas: `ApiErrorEnvelope`, `SpanRange`, `DependencyHealth`, `SystemHealthResponse`, `ContractManifestResponse`, `ParseInspectResponse`.
- Export OpenAPI JSON and compute SHA-256 `contract_hash`.

### Stage 1: Tab 0 Endpoints & Next.js Typed Proxy
- FastAPI endpoints:
  - `GET /api/v1/testbench/health` (SQLite FTS5, VRAM Mutual Eviction lock state, worker ping).
  - `GET /api/v1/testbench/contracts` (`contract_hash`, Pydantic schema version, limits).
  - `POST /api/v1/testbench/echo-validate` (Unicode roundtrip, UTF-16 vs code-point length, timing telemetry).
- Next.js server client (`frontend/src/lib/bridge/server-client.ts`) with `forwardToFastAPI()`.
- Testbench Shell & Tab 0 UI component (`Tab0PlumbingContracts.tsx`).

### Stage 2: Tab 1 Parser Inspector Endpoints & UI
- FastAPI endpoints:
  - `GET /api/v1/parser/presets` (Parser structural profiles & chunk limits).
  - `POST /api/v1/parser/inspect` (Dry-run parser + FTS5 sanitization preview + dual-span AST).
- Next.js Tab 1 UI component (`Tab1ParserInspector.tsx`):
  - Left Rail: Fixtures & parameters.
  - Center: Collapsible AST tree.
  - Right: Synchronized source view with exact `utf16_span` highlighting and FTS5 token diff.

---

## 4. Definition of Done & Exit Gates
- [ ] `pytest` passes with 100% contract schema validation and Unicode offset parity tests.
- [ ] Next.js `tsc --noEmit` and `next build` pass with zero errors.
- [ ] Contract hash match verified between FastAPI and Next.js frontend.
- [ ] Master tracker updated in `docs/MASTER_TASKS_AND_SUBTASKS.md`.
