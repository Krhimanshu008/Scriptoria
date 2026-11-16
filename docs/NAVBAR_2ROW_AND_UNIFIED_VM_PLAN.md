# Plan: Testbench 2-Row Navigation & Unified VM Compute Control

## 1. Problem Statement & Root Cause Analysis

### A. Tabs Overflowing & Hiding on Right Side of Screen
- **Current State:**
  - **Row 1 (`TestbenchTopBar`)** packed 11 disparate controls (Brand, Book Dropdown, Status Badge, Upload Button, Contract Hash, X-Trace-ID, Refresh, Cloud Lake Popover, Manage Swarm Button, Dynamic Boot/Kill Button) in a single flex row. On displays $<1600\text{px}$, Row 1 overflowed horizontally, pushing `Manage Swarm` and `Boot Swarm` offscreen.
  - **Row 2 (`TestbenchTabstrip`)** had 6 wide tabs each containing icon, number badge, long title, and sub-tag (`0. Plumbing & Contracts · R2 & Schemas`, etc.). On displays $<1440\text{px}$, Tab 5 (`E2E Stepper & Scorecard`) clipped off the right viewport margin, requiring horizontal scrolling.
- **Goal:**
  - Redesign into a strict, zero-clipping **2-Row Command & Navigation Deck**.
  - **Row 1:** Global Context (Book & Novel) + Unified VM Compute Controller + Cloud Health.
  - **Row 2:** 6 Checkpoint Tabs distributed evenly across 100% of viewport width (`grid-cols-6` or `flex-1`), guaranteeing all 6 tabs are visible simultaneously on any screen from $1024\text{px}$ to $4\text{K}$ without horizontal scrollbars.

---

### B. Multiple Confusing VM Boot Options
- **Current State:**
  - `TestbenchTopBar` had a primary `⚡ Boot Swarm` button.
  - `TestbenchTopBar` also had a `Manage Swarm` button that opened a modal with per-target boot buttons.
  - `CloudClusterPopover` had *another* embedded `⚡ BOOT` button inside its dropdown.
- **User Requirement:**
  > *"why there is multiples of option of boot vm , Just a a option to boot , kill and select vm and model to boot"*
- **Solution:**
  - Consolidate into **ONE single unified VM Compute Controller** directly on Row 1:
    1. **Target Selector:** Dropdown to choose target VM (`gpu0 - Primary`, `gpu1`, `colab0`, `colab1`) with live status indicator (`🟢 Online`, `🟡 Starting`, `⚪ Offline`).
    2. **Model/Profile Selector:** Dropdown to choose worker profile/model (`5N-SWARM Qwen 2.5 7B`, `Fast 8B VLM`, `Qwen 14B Deep`, `Base ComfyUI`).
    3. **Single Action Button:**
       - When selected VM is **OFFLINE**: `⚡ Boot [Target]` (amber).
       - When selected VM is **STARTING**: `⏳ Starting (step/5) · Cancel` (amber pulsing).
       - When selected VM is **ONLINE**: `⏹ Kill [Target]` (red).
  - Eliminate the redundant `Manage Swarm` modal button and remove the duplicate boot button from `CloudClusterPopover`.

---

## 2. Proposed Visual & Component Architecture

```text
+------------------------------------------------------------------------------------------------------------------------------------------+
| ROW 1: SCRIPTORIA COMMAND & VM COMPUTE CONTROLLER (Height: 48px · h-12 · Border-B)                                                       |
|                                                                                                                                          |
| [LEFT ZONE: Novel Corpus & Contracts]              [RIGHT ZONE: Unified VM Compute Controller & Lake Health]                             |
| [📖 Moby-Dick (147 CH) ▾] [+ Upload] [#f92dac5e ✓] | [🎯 VM: GPU 0 (Dual-T4) ▾] [🧠 Model: Qwen 2.5 7B ▾] [⚡ Boot GPU 0] [☁ Lake 3/3 ▾] [🔄] |
+------------------------------------------------------------------------------------------------------------------------------------------+
| ROW 2: 6-CHECKPOINT STUDIO RIBBON (Height: 40px · h-10 · Full Viewport Width · 6 Equal Columns)                                          |
|                                                                                                                                          |
| [ 0. Plumbing & R2 ] | [ 1. Parser AST ] | [ 2. VM Swarm ] | [ 3. Graph Studio ] | [ 4. Hybrid RAG ] | [ 5. E2E Scorecard ]              |
| (Active: Amber Glow)                                                                                       (Trace: 668bc7b4 on right)   |
+------------------------------------------------------------------------------------------------------------------------------------------+
| MAIN WORKSPACE VIEWPORT (100% Full Width · Zero Horizontal Clipping · Scroll Locked per Tab)                                            |
|                                                                                                                                          |
| Checkpoint Active Viewport (Tabs 0 through 5)                                                                                            |
+------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Detailed Implementation Steps

### Step 1: Build `UnifiedVmController.tsx`
Create a dedicated, compact component `frontend/src/components/testbench/UnifiedVmController.tsx`:
- **State Management:**
  - `selectedTarget`: defaults to primary configured VM (`gpu0` or first available).
  - `selectedProfile`: tracks currently chosen worker profile for the selected VM.
- **Controls:**
  1. `<select>` for VM target:
     - Iterates over `vms: PublicVmInstance[]`.
     - Displays canonical name, status dot (`🟢`, `🟡`, `⚪`), and VRAM.
  2. `<select>` for Model/Worker Profile:
     - Iterates over relevant profiles (`WORKER_PROFILES`):
       - `5N-SWARM` (Qwen 2.5 7B Extraction Swarm)
       - `LLM_QWEN_FAST_8B` (Qwen 8B Fast Vision)
       - `LLM_QWEN_TEXT_TURBO` (Qwen Text Turbo)
       - `BASE_COMFY` (Fast Base ComfyUI)
     - On change: updates target worker profile via `/api/vm/[target]/profile`.
  3. `<button>` for Boot / Cancel / Kill:
     - OFFLINE: `⚡ Boot [Target]` (amber). Calls `/api/vm/[target]/toggle`.
     - STARTING: `⏳ Starting ([step]/5)` (amber spinner). Calls `/api/vm/[target]/toggle` to cancel.
     - ONLINE: `⏹ Kill [Target]` (red). Calls `/api/vm/[target]/toggle` (or `/api/pipeline/vm/panic-kill`).

---

### Step 2: Clean Up `CloudClusterPopover.tsx`
- Remove the redundant embedded `⚡ BOOT` button next to Kaggle VM Swarm.
- Keep `CloudClusterPopover` strictly focused on telemetry:
  - Cloudflare R2 latency & object count
  - Supabase pgvector catalog sync & latency
  - Turso libSQL budget & WAL status
  - VM Swarm online worker telemetry (read-only metric badge)

---

### Step 3: Redesign `TestbenchTopBar.tsx` (Row 1)
- Reorganize into a clean flex layout with strict boundaries:
  - **Left Section:**
    - Brand pill: `Pipeline Testbench`
    - Book Selector dropdown (max-w-[200px] with ellipsis)
    - Status badge (`PARSED (147 CH)`)
    - Compact `+ Upload` button
    - `ContractHashBadge` (`#f92dac5e Verified`)
  - **Right Section:**
    - `<UnifiedVmController />`
    - `<CloudClusterPopover />`
    - Refresh health button
- Remove the redundant `Manage Swarm` button and `TestbenchVmModal`.

---

### Step 4: Redesign `TestbenchTabstrip.tsx` (Row 2)
- Re-architect from a variable-width flex row to a **responsive 6-column full-width grid** (`grid grid-cols-6 w-full gap-1 px-3`):
  - Every checkpoint tab receives equal $1/6\text{th}$ width ($16.66\%$).
  - Tab items use responsive text sizing:
    - Base: Icon + `0. Plumbing`, `1. Parser`, `2. Swarm`, `3. Graph`, `4. RAG`, `5. Scorecard`.
    - XL+ screens: Adds subtitle tags (`R2 & Lake`, `Dual-Span AST`, `3-Col Stream`, `Dual Clock`, `Safe SQL`, `15 Checks`).
  - Active tab highlighted with amber border, amber text, and bottom glow bar.
  - Zero overflow, zero clipping at any resolution from $1024\text{px}$ to $2560\text{px}$.

---

### Step 5: Verification & Quality Gates
- **Contract Verification:** Run `python backend/scripts/export_contracts.py --check` (must match canonical hash `sha256=f92dac5e...`).
- **TypeScript Strictness:** Run `cd frontend; npx tsc --noEmit` (zero errors).
- **Automated Tests:** Run `pytest backend/tests/test_testbench_endpoints.py backend/tests/test_testbench_contracts.py`.
- **Git Checkpoint:** Commit and push to `origin/main` for live Vercel deployment.
