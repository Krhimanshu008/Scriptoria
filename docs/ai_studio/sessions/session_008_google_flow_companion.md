# AI Studio Session 008: Subproject Google AI Flow Companion Architecture via Gemini 4 Argon

- **Session ID:** `session_008_google_flow_companion`
- **Topic:** Planning, Designing, Architecture, Data Management, Database & Companion Engine for Google AI Flow
- **Timestamp:** `2026-11-16T10:55:00+05:30`
- **Platform:** Google AI Studio Playground (Multi-Tab / Multi-Model Execution)
- **Account:** `himanshu20031225@gmail.com`
- **Model:** `gemini-4-argon` (Thinking: `High`)
- **Tools Active:** `Grounding with Google Search`, `URL Context` on `https://github.com/Krhimanshu008/Scriptoria.git`
- **Context Slice:** [`slice_subproject_google_flow_companion.md`](file:///c:/Users/Himan/OneDrive/Desktop/Himanshu/Scriptoria/docs/ai_studio/slices/slice_subproject_google_flow_companion.md)
- **Status:** `INITIALIZED_READY_FOR_EXECUTION`

---

## 1. High-Thinking Architectural Objectives

1. **System Topology & Communication Layer:**
   - Chrome Extension (Manifest V3) running on `flow.google.com` in authentic user session.
   - Local bidirectional WebSocket (`ws://127.0.0.1:8000/api/v1/flow-bridge/ws`) connecting extension to Scriptoria FastAPI backend.
   - Dual-mode completion detection: Primary via `window.fetch` response interception in page context (`injected.js`), secondary via DOM mutation observation.

2. **Data Management & Contracts:**
   - Immutable, extra-forbidding Pydantic v2 schemas (`StrictModel`) in `backend/app/schemas/flow_contracts.py`.
   - Clear contract boundaries for Character Ingredients, Location References, Item Props, Prompt Dispatch, and Asset Provenance.

3. **Database Architecture (Prisma + Turso libSQL):**
   - `FlowProjectBinding`: Mapping Scriptoria novel projects to Google Flow projects.
   - `FlowIngredient`: Character & item `@` tags with locked reference image URLs.
   - `FlowAsset`: Generated visual assets with seeds, prompts, models (Nano Banana, Veo, Imagen 3), aspect ratios, and local storage caches.

4. **Integration with Scriptoria Testbench:**
   - Tab 2 (Extraction Lab): One-click sync of extracted characters to Flow Ingredients.
   - Tab 4 / Storyboard Studio: One-click dispatch of visual beats to Google Flow with live progress tracking.
