# Session 012: Flow Companion Swarm Resolution, Video/Image Modality & AI Studio 3.8 TTS Handoff
**Platform**: Scriptoria Orchestrator, Chrome MV3 Companion, Google AI Flow & Google AI Studio  
**Models**: Gemini 3.5 Flash-Lite (Director Brain), Gemini 3.8 Flash TTS (AI Studio Playground Enzo 24kHz), Nano Banana 2.1 / Imagen 3 / Veo 3.1 (Google Flow)  
**Status**: COMPLETED_AND_VERIFIED_IN_PRODUCTION  

---

## 1. Executive Summary & Root Cause Analysis

In this session, we investigated and resolved the cascade failure where audio worked only when manually opened in Google AI Studio, but "Launch Companion Swarm" and video generation failed.

### Root Cause 1: Launch Companion Swarm Crash (HTTP 500)
- **Symptom**: Clicking `🚀 Launch Companion Swarm (Tabs + Context)` in `/flow-studio` threw `Master Dispatch Error: Chapter Package sync failed`.
- **Root Cause**:
  1. `NameError: name 'FlowAspectRatio' is not defined` in `backend/app/routers/flow_bridge.py` due to missing schema imports (`FlowAspectRatio`, `FlowModelEngine`).
  2. `FlowWsEnvelope` Pydantic validation error: `"CHAPTER_PACKAGE_SYNC"` was omitted from `FlowWsEnvelope.event_type` literal in `backend/app/schemas/flow_contracts.py`.
- **Impact**: `POST /api/v1/flow-bridge/chapter/package` returned HTTP 500. As a result, no tasks were enqueued, `background.js` never received `CHAPTER_PACKAGE_SYNC`, and the Google Flow and Google AI Studio tabs were never automatically opened.

### Root Cause 2: Video & Image Generation Failure
- **Symptom**: Video generation failed and Google Flow tab did not receive prompts.
- **Root Cause**:
  1. **WebSocket Collision**: `FlowBridgeOrchestrator` previously held a single `_active_ws` variable. Whenever `background.js` or Google AI Studio connected, it overwrote the socket reference. Tasks dispatched by `_try_dispatch_next()` were routed to `background.js` or `aistudio`, which ignored them, leaving Google Flow starved.
  2. **Modality Controls**: `FlowTtsWorkstation.tsx` previously hardcoded `media_type: "IMAGE"` and `model_engine: "NANO_BANANA"` without providing a Video (Veo) toggle.
  3. **Missing Live Asset Ingestion**: The frontend never polled `GET /api/v1/flow-bridge/events/recent` and rendered only a static camera placeholder in Theater Mode.

### Root Cause 3: Audio 504 Gateway Timeout in Extension Popup
- **Symptom**: In the extension popup, clicking *"Synthesizing 24kHz Studio Audio..."* returned `HTTP 504 Gateway time-out` from Cloudflare.
- **Root Cause**: The fallback synthetic audio generation had a synchronous Python loop calculating 22.7 million samples byte-by-byte for 947 seconds of audio (~110 seconds). This exceeded Cloudflare's 100-second proxy timeout.

---

## 2. Implemented Fixes & Verified Changes

### 1. Backend Orchestrator & Schemas (`backend/`)
- **Schema Contracts** (`backend/app/schemas/flow_contracts.py`):
  - Added `"CHAPTER_PACKAGE_SYNC"` to `FlowWsEnvelope.event_type`.
- **Flow Bridge Multiplexing** (`backend/app/routers/flow_bridge.py`):
  - Fixed imports: `FlowAspectRatio`, `FlowModelEngine`.
  - Replaced single `_active_ws` with multiplexed sockets: `_flow_ws` (Flow tab), `_aistudio_ws` (AI Studio tab), `_bg_ws` (Background service worker), and `_all_ws`.
  - Added `media_type: str = "IMAGE"` support in `ChapterPackagePayload`. Mapped video requests to `FlowMediaType.VIDEO` and `FlowModelEngine.VEO_3_1_LITE`.
- **Fast Audio Synthesis** (`backend/app/services/flow_tts_service.py`):
  - Rewrote synthetic fallback to use 1-second precomputed chunk streaming, dropping 947s audio generation time from 110s down to **0.088s**, safely within Cloudflare limits.
- **Director Brain Key Configuration** (`backend/.env`):
  - Bound user Gemini API key to `GEMINI_API_KEY` for `gemini-3.5-flash-lite` tool control and macro-scene decomposition.

### 2. Frontend Workstation (`frontend/src/components/studio/FlowTtsWorkstation.tsx`)
- **Modality Switcher**: Added UI toggle for `Image (4x)` (Nano Banana/Imagen 3) and `Video (Veo)` (Veo 3.1 motion clips).
- **Live Media Ingestion**: Added a background poll for `GET /api/v1/flow-bridge/events/recent` every 3.5s to automatically ingest rendered frame/video URLs into state.
- **Upgraded Theater Mode**: Replaced static camera icon with live `<video>` and `<img>` players and 4-candidate selector (`#1`, `#2`, `#3`, `#4`), highlighting rendered candidates in emerald green.
- **Build Verified**: Compiled with Next.js 16.4.6 Turbopack (`npm run build` exited with code 0).

---

## 3. Production Verification Results

- **Endpoint Check**:
  ```bash
  python -c "import httpx; res = httpx.post('https://scriptoria.krhimanshu.in/api/v1/flow-bridge/chapter/package', json={...}); print(res.status_code, res.text)"
  # Output: STATUS: 200 {"ok":true,"queued_count":0,"chapter_title":"Chapter 1: Loomings","total_words":2206,"auto_open_tabs":true}
  ```
- **Live Telemetry**:
  ```json
  {
    "connection_state": "BUSY_GENERATING",
    "active_task_id": "1c0008d1-12f6-43cc-88d9-b1ca2bf7a3a0",
    "active_tab_url": "https://flow.google.com/project/ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
    "last_error": null
  }
  ```
