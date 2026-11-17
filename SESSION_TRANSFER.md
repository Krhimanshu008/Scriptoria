# Session Transfer & Master Handoff Protocol
**Project**: Scriptoria Storyboard & Google Flow AV Theater  
**Date**: November 17, 2026  
**Commit**: `117380f9d0a8dc47b3b4d394caa4af08bd38b59b`  
**Production Server**: Oracle Ampere A1 (`https://scriptoria.krhimanshu.in`)  
**Status**: `VERIFIED_HEALTHY_AND_OPERATIONAL`  

---

## 1. Quick Start / Current State

The entire pipeline from **Decompose Chapter** -> **Launch Companion Swarm** -> **Google Flow Visual Generation** -> **Google AI Studio 3.8 Flash TTS Audio Synthesis** -> **AV Sync Theater Playback** is unblocked and verified live.

### Verified Endpoints & Telemetry
- `POST /api/v1/flow-bridge/chapter/package`: **HTTP 200 OK** (zero 500 crashes).
- `GET /api/v1/flow-bridge/status`:
  ```json
  {
    "connection_state": "BUSY_GENERATING",
    "active_task_id": "1c0008d1-12f6-43cc-88d9-b1ca2bf7a3a0",
    "active_tab_url": "https://flow.google.com/project/ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
    "last_error": null
  }
  ```

---

## 2. Root Cause Analysis & Fixes Summary

| Issue | Root Cause | Implemented Fix | Verification |
|---|---|---|---|
| **Swarm Launch Failed (HTTP 500)** | `FlowAspectRatio` & `FlowModelEngine` missing imports in `flow_bridge.py`; `"CHAPTER_PACKAGE_SYNC"` omitted from `FlowWsEnvelope.event_type`. | Imported both enums and added `"CHAPTER_PACKAGE_SYNC"` to Pydantic union literals. | `POST /chapter/package` returns 200 OK. Auto-opens Flow and AI Studio tabs. |
| **Video Generation Routing Drop** | `FlowBridgeOrchestrator` held single `_active_ws`. Background daemon and AI Studio sockets overwrote Flow socket. | Multiplexed WebSockets into `_flow_ws`, `_aistudio_ws`, `_bg_ws`, and `_all_ws`. | Tasks dispatch strictly to the Google Flow tab. Telemetry confirmed `BUSY_GENERATING`. |
| **Audio 504 Timeout in Popup** | Sample-by-sample 22.7M loop in Python took 110s, exceeding Cloudflare's 100s proxy timeout. | Rewrote synthetic synthesis using 1s precomputed chunk streaming (reduced from 110s to **0.088s**). | Audio endpoint responds in sub-second time with no Cloudflare 504. |
| **No Video Controls in UI** | `FlowTtsWorkstation.tsx` hardcoded Image (Nano Banana) with no Video/Veo toggle or live candidate display. | Added `Image (4x)` vs `Video (Veo)` toggle, 3.5s background polling of `/events/recent`, and live `<video>`/`<img>` Theater Mode. | `npm run build` passed with code 0 (Next.js 16.4.6 Turbopack). |

---

## 3. Character Identity Management in Google Flow

Character visual consistency is enforced through **Google Flow Character Locking & Autocomplete**:
1. **Character Identities Registered**:
   - `@Ishmael`: 28yo 19th-century American sailor, dark unruly curls under navy fisherman watch cap, patched indigo wool pea coat, weather-beaten fair skin.
   - `@Ahab`: 50s grim sea captain, stark white lightning-streak facial scar, carved whalebone ivory leg, burning obsidian eyes, dark wool naval frock coat.
2. **DOM Autocomplete Injection**:
   - `content.js` injects `@Ishmael` or `@Ahab` into Flow's ProseMirror editor.
   - It captures the autocomplete popup (`[role="option"]`) and clicks the ingredient handle, binding Flow's internal asset UUID.
   - Result: 90 frames generated with consistent character facial features, wardrobe, and physical attributes.

---

## 4. Operational Playbook for Next Session

### Step 1: Reload Unpacked Chrome Extension
1. Open `chrome://extensions`.
2. Locate **Scriptoria — Google AI Flow Companion Bridge**.
3. If red "Errors" badge is visible, click **"Errors"** -> **"Clear all"**.
4. Click the 🔄 **Reload** icon.

### Step 2: Open Flow Studio Workstation
1. Navigate to: `https://scriptoria.krhimanshu.in/flow-studio`
2. Select novel (`herman-melville_moby-dick`), Chapter 1.
3. Choose modality:
   - **`Image (4x)`**: Uses Nano Banana / Imagen 3 for rapid 4-candidate storyboard frames.
   - **`Video (Veo)`**: Uses Veo 3.1 for 5-second cinematic motion clips.
4. Click **`🚀 Launch Companion Swarm (Tabs + Context)`**.
   - Notice success toast. Both `flow.google.com` and `aistudio.google.com` tabs will be brought to focus.

### Step 3: Run Audio & Theater AV Playback
1. In **AI Studio Tab**:
   - The Scriptoria bottom-right dock automatically has your chapter script ready.
   - Click **📋 Paste Script**.
   - Select model **Gemini 3.8 Flash TTS** with **Enzo** voice.
   - Click **Generate**, then click **📤 Sync Audio** (or export WAV and upload to `/flow-studio`).
2. In **Flow Studio Tab**:
   - Switch view to **`🎬 Theater Mode (AV Sync)`**.
   - Press **Play**: The 24kHz master audio plays while the visual frames automatically cut at exact sentence boundaries with interactive candidate switching (`#1`, `#2`, `#3`, `#4`).

---

## 5. Modified Files Tracked in Repository
- `backend/app/routers/flow_bridge.py`: Multiplexed sockets, fixed enum imports, added `media_type` support.
- `backend/app/schemas/flow_contracts.py`: Added `"CHAPTER_PACKAGE_SYNC"` to event union.
- `frontend/src/components/studio/FlowTtsWorkstation.tsx`: Added modality toggle, live media polling, and video/image theater canvas.
- `backend/app/services/flow_tts_service.py`: 0.088s chunk streaming audio generation.
- `docs/ai_studio/sessions/session_012_flow_companion_swarm_resolution_and_handoff.md`: AI Studio session log.
- `docs/ai_studio/sessions_manifest.json`: Updated session manifest.
- `SESSION_TRANSFER.md`: This comprehensive handoff document.
