# SPRINT CONTEXT SLICE: GOOGLE AI FLOW COMPANION & ASSET ORCHESTRATION ENGINE
## Target: Chief AI Architect (Gemini 4 Argon / Hydrogen) via Google AI Studio
## Thinking Mode: HIGH | Role: Principal Systems Architect, Codebase Auditor, and Deep Reasoning Engine

---

### 1. Project Context & Subproject Mandate
- **Core Repository:** https://github.com/Krhimanshu008/Scriptoria.git
- **Core Technology Stack:** Next.js 16 (App Router + Turbopack), React 19, Tailwind CSS v4, `@base-ui/react`, TanStack Query, Prisma v6 -> Turso libSQL, FastAPI (Python 3.11+, Pydantic v2 `StrictModel`), Cloud GPU (Kaggle Dual-T4 & Colab T4 for ComfyUI / llama-server).
- **Subproject Goal:** Connect Scriptoria directly to **Google AI Flow** (`flow.google.com`) through a dedicated, resilient **Browser Companion Bridge (Chrome Extension + Local WebSocket/HTTP Router)** to generate consistent character, location, item imagery, visual beats, and storyboard videos (powered by Nano Banana, Veo, and Imagen 3) without risk of bot bans, CAPTCHAs, or CLI friction.

---

### 2. High-Level Subproject Architecture

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      User's Google Chrome Browser                      │
 │                                                                        │
 │   flow.google.com (Normal Authenticated User Session)                  │
 │    ├── Flow Workspace (Characters, Ingredients, Scenebuilder)          │
 │    │        ▲                                                          │
 │    │        │ DOM input typing & @ingredient chip selection            │
 │    │   ┌────┴──────────────────────────────────────────────────────┐   │
 │    └───┤  Scriptoria Flow Companion (Manifest V3 Chrome Extension) │   │
 │        │  - Injected Script (hooks window.fetch for raw JSON)      │   │
 │        │  - Content Script (DOM automation & event dispatch)      │   │
 │        │  - Background Service Worker (WebSocket / Polling)        │   │
 │        └────┬──────────────────────────────────────────────────────┘   │
 └─────────────┼──────────────────────────────────────────────────────────┘
               │ Local Bidirectional WebSocket: ws://127.0.0.1:8000/api/v1/flow-bridge/ws
               ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   Scriptoria FastAPI Backend & Queue                   │
 │   backend/app/routers/flow_bridge.py                                   │
 │    ├── WebSocket Connection Manager & Heartbeat Guard                  │
 │    ├── Strict Pydantic v2 Flow Contracts (backend/app/schemas/flow_*)   │
 │    ├── Asynchronous FIFO Job Dispatcher & Rate Limiter                 │
 │    └── In-Band Asset Ingester (Streams images/videos to local /output) │
 └─────────────┬──────────────────────────────────────────────────────────┘
               │ Prisma Client / REST / SSE
               ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                 Database & Frontend Testbench Studio                   │
 │   Turso libSQL / Prisma: FlowProjectBinding, FlowIngredient, FlowAsset │
 │   Next.js 16 Frontend: Tab 2 Extraction & Tab 4 Flow Generation        │
 │    - "Sync Character as @Ingredient"                                   │
 │    - "Dispatch Visual Beat to Google Flow"                             │
 │    - Companion Status Indicator (🟢 Connected / 🔴 Offline)            │
 └────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Key Workstreams & Deliverables

#### Workstream F1: Canonical Contracts & Wire Models (`backend/app/schemas/flow_contracts.py`)
- Must adhere to `StrictModel` (`ConfigDict(extra='forbid', frozen=True)`).
- Wire models needed:
  1. `FlowCompanionStatus`: `connected: bool`, `active_tab_url: str | None`, `flow_project_id: str | None`, `active_ingredients_count: int`, `queue_pending_count: int`.
  2. `FlowIngredientSync`: `entity_id: str`, `canonical_name: str`, `ingredient_tag: str` (e.g. `@Eldrin`), `entity_type: Literal['CHARACTER', 'LOCATION', 'ITEM']`, `ref_image_url: str | None`, `visual_summary: str`.
  3. `FlowGenerationTask`: `task_id: str`, `scene_id: str`, `beat_order: int`, `prompt: str`, `referenced_ingredients: list[str]`, `aspect_ratio: Literal['16:9', '9:16', '1:1', '4:3']`, `media_type: Literal['IMAGE', 'VIDEO']`, `model_target: Literal['NANO_BANANA', 'VEO_FAST', 'VEO_HD', 'IMAGEN_3']`.
  4. `FlowMediaResultEvent`: `task_id: str`, `source_url: str`, `local_filepath: str | None`, `seed: int | None`, `media_type: str`, `width: int | None`, `height: int | None`, `generation_duration_s: float`.
  5. `FlowQueueAction`: `action: Literal['ENQUEUE', 'CANCEL', 'RETRY', 'CLEAR']`, `task_id: str | None`.

#### Workstream F2: Database Modeling (Prisma & Turso libSQL)
Extend `frontend/prisma/schema.prisma` with:
```prisma
model FlowProjectBinding {
  id              String           @id @default(cuid())
  projectId       String           @unique
  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  flowProjectId   String?          // Google Flow remote project identifier
  flowProjectUrl  String?
  lastSyncedAt    DateTime?
  ingredients     FlowIngredient[]
  flowAssets      FlowAsset[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}

model FlowIngredient {
  id             String             @id @default(cuid())
  bindingId      String
  binding        FlowProjectBinding @relation(fields: [bindingId], references: [id], onDelete: Cascade)
  entityId       String             // Scriptoria Entity ID (Character or Item)
  tag            String             // e.g. "Eldrin" (used as @Eldrin)
  ingredientType String             // "CHARACTER", "LOCATION", "ITEM"
  flowRemoteId   String?            // Remote Flow asset/ingredient id
  refImageUrl    String?
  status         String             @default("SYNCED") // PENDING, SYNCED, ERROR
  createdAt      DateTime           @default(now())

  @@unique([bindingId, tag])
  @@index([bindingId, entityId])
}

model FlowAsset {
  id            String             @id @default(cuid())
  bindingId     String
  binding       FlowProjectBinding @relation(fields: [bindingId], references: [id], onDelete: Cascade)
  sceneId       String?
  beatOrder     Int?
  mediaType     String             @default("IMAGE") // IMAGE, VIDEO
  prompt        String
  ingredients   String             @default("[]") // JSON array of tags e.g. ["@Eldrin", "@Grimoire"]
  remoteUrl     String
  localPath     String?
  aspectRatio   String             @default("16:9")
  metadataJson  String?            // Seed, generation time, model used
  createdAt     DateTime           @default(now())

  @@index([bindingId, sceneId])
}
```

#### Workstream F3: Browser Companion Extension (`extension/scriptoria-flow-bridge/`)
- **`manifest.json`**: Chrome MV3. Permissions: `storage`, `activeTab`, `scripting`. Host permissions: `https://flow.google/*`.
- **`injected.js`**: Runs in page execution context. Monkeypatches `window.fetch` and `XMLHttpRequest` to sniff responses matching Google Flow media generation endpoints, extracting full-resolution Google Storage URLs (`*.googleusercontent.com/*`) and generation metadata before dispatching a custom DOM event `ScriptoriaFlowMediaCaptured`.
- **`content.js`**:
  - Connects to local WebSocket `ws://127.0.0.1:8000/api/v1/flow-bridge/ws` (with auto-reconnect backoff).
  - Handles incoming tasks:
    1. Focuses prompt textarea.
    2. Emulates realistic user typing with `@` ingredient chip selection.
    3. Triggers the Generate button.
    4. Listens for `ScriptoriaFlowMediaCaptured` or fallback DOM observer to confirm completion.
    5. Transmits result event back over WebSocket.
- **`popup.html` / `popup.js`**: Shows live bridge connection status, connected Scriptoria project, and recent generated thumbnails.

#### Workstream F4: FastAPI Bridge Router & WebSocket Hub (`backend/app/routers/flow_bridge.py`)
- WebSocket endpoint: `/api/v1/flow-bridge/ws`.
- Task dispatch queue with priority and retry logic.
- Background asset downloader daemon (`download_flow_asset`): streams media directly to `output/flow_assets/{project_id}/{task_id}.png` with cryptographic hash verification and zero memory bloat.

#### Workstream F5: Next.js Frontend Integration
- Dedicated companion status indicator pill in `DashboardShell.tsx` or Header (`<FlowCompanionBadge />`).
- In `Tab2Extraction.tsx` and Storyboard view:
  - Add button: *"Sync Characters to Flow Ingredients"*.
  - Add button per Visual Beat: *"Generate Beat in Flow"*.
  - Visual gallery displaying ComfyUI vs Google Flow output comparisons.

---

### 4. Technical Non-Negotiables (EC & Architectural Principles)
1. **Zero Bot Detection Footprint:** Never run synthetic drivers with `navigator.webdriver = true`. The extension must run purely in the user's authentic browser context.
2. **Defensive Network Sniffing:** Do not rely exclusively on brittle CSS selector scraping for generated images. The primary extraction mechanism MUST be network response interception via `injected.js`, with DOM mutation observation as a secondary fallback.
3. **Idempotency & Reconnection Safety:** If the WebSocket drops or the browser tab reloads, the bridge queue must remain consistent. Incomplete jobs must be requeued or reported gracefully without duplicate generations.
4. **Strict Schema Validation:** All payloads between Next.js, FastAPI, and the Chrome Extension must validate against the Pydantic v2 `StrictModel` contracts.
