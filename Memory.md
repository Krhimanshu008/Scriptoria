# Context Transfer — Scriptoria & Book Visualiser Workspace

## 1. Repository, Environment & Git State

- **Workspace Root:** `c:\Users\5480\Desktop\Automation\Book_Visualiser`
  - Contains `Scriptoria/` (Git repo) and `Book Graph/` (Python FastAPI + Supabase novel-to-images backend, intentionally not a Git repo).
  - Top-level workspace memory: [`MEMORY.md`](file:///c:/Users/5480/Desktop/Automation/Book_Visualiser/MEMORY.md).
- **Scriptoria Repo:** `c:\Users\Himan\OneDrive\Desktop\Himanshu\Scriptoria`
  - **Git Remote:** `origin` -> `https://github.com/Krhimanshu008/Scriptoria.git` (`main`)
  - **Current HEAD:** `cdd83a0` (synced & pushed to `origin/main`, deployed at `https://scriptoria.krhimanshu.in`)
  - **Git Status:** All `.md` architecture specs and memory files tracked and synced.
- **Tech Stack (`Scriptoria/frontend`):**
  - Next.js `16.4.6` (App Router + Turbopack), React 19 (React Compiler ESLint rules active), Tailwind CSS v4 (`cn` without `tailwind-merge`), `@base-ui/react`, TanStack React Query, Prisma `v6.19.3` -> Turso libSQL (`libsql://scriptoria-prod-krhimanshu.aws-ap-south-1.turso.io`), Vercel deployment target.
- **ENCRYPTION_KEY Rule:**
  - All 12 Vault credentials in Turso are encrypted with Vercel's `ENCRYPTION_KEY` (verified live on `https://scriptoria.krhimanshu.in`). Never rotate Vercel's `ENCRYPTION_KEY` while using those rows. Ensure local `Scriptoria/frontend/.env` uses the exact same `ENCRYPTION_KEY` before running Vault decryption locally.

---

## 2. Recent Commit History (`origin/main`)

1. `[NEXT]` — `feat(workers): add pull-based worker lease API and activate DFlash2 speculative drafting`
   - Added 4 pull-queue endpoints: `POST /api/v1/workers/claim` (5-min lease, capability matching, auto-reaper), `/complete`, `/fail` (with retry count), and `/heartbeat`.
   - Updated `notebook-builder.ts` with DFlash2 speculative drafter (`z-lab/Qwen3.8-27B-DFlash2-GGUF`), offloaded with `-ngld 99`, pinned to `-devd CUDA1`, `-ctkd q8_0 -ctvd q8_0`, and `--spec-draft-n-max 5`.
   - Built `Book Graph/scripts/worker.py` universal worker client with double-buffered asset prefetching and local ComfyUI dispatch.
   - Verified clean production `next build` (56/56 routes) and 0 ESLint errors.
2. `cdd83a0` — `fix(ui): resolve React Compiler purity and effect setState lint errors in TPU and LLM Studio`
   - Resolved React Compiler ESLint errors (`react-hooks/set-state-in-effect`, `react-hooks/purity` on Date.now in render, and unused imports).
   - Production `next build` passes with 0 errors across 52 routes.
2. `08b2c46` — `fix(llm): remove invalid --no-mmap, isolate profile directories to prevent mmproj collisions, disable default thinking, and guard MTP`
   - Removed `--no-mmap` flag rejected by llama-server (exit code 1).
   - Profile-isolated storage paths (`qwen3_vl_8b`, `qwen36_35b_moe`, `qwen38_27b`), eliminating cross-model `mmproj-F16.gguf` collisions and tensor mismatches.
   - Guarded MTP so it never runs on 8B (no MTP layers) or when `--mmproj` vision is active (preventing graph reallocation stalls).
   - Added `--chat-template-kwargs '{"enable_thinking":false}'` so simple prompt replies stream in <500ms instead of 135s in `<think>` mode.
2. `40a9fa3` — `fix(llm): optimize boot to <45s, add aria2c binary fetch, enable --no-mmap DMA loading, fix corrupted tokens, and add Qwen-8B-Fast profile`
   - Added `LLM_QWEN_FAST_8B` profile (~5.1 GB weights, 15s boot, ~45-60 tok/s).
   - Replaced single-threaded GitHub binary fetch with 16-connection `aria2c` (~3s) + Google Drive FastBoot snapshot (`llama_server_t4_v1.tar.gz`) for 1.5s restore.
   - Removed incompatible DFlash2 external drafter which corrupted tokens ("ispers", "refr").
3. `7fc4956` — `feat(llm): implement Path 4 - Qwen 35B-A3B Vision MoE profile for 80-120 tok/s on Dual-T4`
   - Added `LLM_QWEN_MOE_35B` profile using `unsloth/Qwen3.6-35B-A3B-GGUF` (35B total, only 3B active parameters per token).
4. `3279674` — `feat(llm): activate embedded MTP speculative decoding and disable thinking on low/none reasoning`
5. `3f60329` — `feat(llm): resolve HTTP 524 timeout, enable unbuffered SSE bridge, and optimize Dual-T4 boot to <60s`
   - Rewrote Python `_LlmBridgeHandler` with immediate HTTP 200 chunked headers and line-by-line SSE flushing.
   - Optimized KV cache to Q8 (`-ctk q8_0 -ctv q8_0`) to eliminate PCIe memory bus stalls.
6. `4802602` — `feat(tpu): dedicated TPU cluster page, navigation, and isolated slot architecture`
   - Dedicated `/tpu-cluster` route and `TpuClusterCard` for 8-chip TPU v5e-8 compute.
7. `0b98cdb` — `fix(llm): align llama-server with DFlash2 CUDA1 pin, asymmetric 55/45 split, ngld 99 and cache_prompt`
   - Fixed 5 critical hardware & VLM bugs from `MO updated.md`: `-ngld 99`, `-dev CUDA0,CUDA1 -devd CUDA1`, `--tensor-split 55,45`, `--fit off`, `-ctkd q8_0 -ctvd q8_0`, `--kv-unified`, and tuned `--spec-draft-n-max 5`.
   - Added DFlash2 GGUF fallback to `z-lab/Qwen3.8-27B-DFlash2-GGUF` and `Akicou/Qwen3.8-27B-DFlash2-GGUF`.
   - Enabled `cache_prompt: true` across LLM Studio and Book Graph client.
2. `4e88179` — `feat(llm): add dual worker profiles QWEN-LLM and QWEN-TURBO with DFlash2 speculative decoding`
   - Added dual selectable LLM profiles in `/vms`: `QWEN-LLM` (`LLM_QWEN_VLM` — Vision + LLM with `mmproj`, 35–85 tok/s) and `QWEN-TURBO` (`LLM_QWEN_TEXT_TURBO` — Ultra Text with pure DFlash2 drafting, up to 154 tok/s for 100s of chapters).
   - Added `isLlmWorkerProfile` helper across scheduler, agent client, `/api/v1/llm-endpoint`, LLM Studio health & chat, and VM cluster card.
   - Upgraded `notebook-builder.ts` with DFlash2 GGUF drafter (`incoai/Qwen3.8-27B-DFlash2-GGUF`), layer-split (`--split-mode layer --tensor-split 1,1`), `--batch-size 512`, `--ubatch-size 128`/`64`, and auto-backup to Google Drive.
3. `16426ab` — `feat(llm-studio): add LLM Studio UI/API, SSE streaming, official llama.cpp release & safe vault decrypt`
   - Built **LLM Studio** tab in `/studio` (`src/components/studio/LlmStudioTab.tsx`, `AgenticStudioDashboard.tsx`), health probe (`/api/llm-studio/health`), and SSE `stream: true` chat aggregation (`/api/llm-studio/chat`) to avoid Vercel 524 timeouts during Qwen 27B reasoning/VLM inference.
   - Added `QWEN-LLM` routing in `src/lib/agent/llm-client.ts`.
   - Updated `src/lib/orchestrator/notebook-builder.ts` to fetch official `ggml-org/llama.cpp` Ubuntu CUDA-12 + `cudart-llama-*` binaries and allow Hugging Face Qwen 27B boot without requiring Google Drive decryption.
   - Added defensive Vault decrypt error reporting in `/api/vm/accounts`, `/api/vm/[target]/toggle`, and `LLM_QWEN_VLM` response support in `/api/vm/[target]/catalog`.
4. `c8fca52` — `feat(llm): add LLM_QWEN_VLM Dual-T4 worker profile and /api/v1/llm-endpoint`
   - Added `LLM_QWEN_VLM` in `src/lib/catalog/worker-profiles.ts` (`Dual-T4` `llama-server` Q4_K_M + `mmproj` OpenAI-compatible `/v1` server).
   - Excluded `LLM_QWEN_VLM` targets from ComfyUI task scheduling in `src/lib/batch/scheduler.ts`.
   - Added `/api/v1/llm-endpoint/route.ts` for external clients (`Book Graph`) and `/v1` copy button in `src/components/gpu/VmClusterCard.tsx`.
5. `2e34847` — `fix(ui): rebuild output lightbox viewer and allow wide modal sizing`
   - Fixed `src/components/ui/dialog.tsx` (`hasCustomMaxWidth`) and rebuilt `/history` split-pane Lightbox Viewer.
4. `248414a` — `refactor(ui): collapsible left sidebar, flat obsidian console & compact tables`
   - Matte `#09090b` / `#111114` Precision Console UI + collapsible `DashboardShell.tsx`.
5. `a8af6ed` — `feat(ai): multi-key failover, Groq provider, live free model fetcher & Gemini schema fix`
6. `6283b9e` — `feat(v2): add Agentic Co-Director, Smart Workflow Creator, 5TB Drive AI Review & Multi-GPU Batch /v1 API`
7. `49810b5`, `00c74af`, `466087a` — Dedicated `/vms`, unified `/settings` Vault + Readiness Matrix + `ApiToken`s, `ModelAsset` catalog, Rclone Drive mirror, FastBoot v2.

---

## 3. Live Verified Cluster State (2026-11-12 18:34 IST)

Verified live on `https://scriptoria.krhimanshu.in/vms`:
- **Online Slots:** `4 / 6` | **Active VRAM:** `59G (17.1G used)`
- **Kaggle ACC1 (`@himanshukr7532`, `gpu0`, `gpu1`):** `2xT4 ON`, `BASE_COMFY`, `23h 00m / 30h 00m left` — ComfyUI rendering nodes.
- **Kaggle ACC2 (`@krhimanshu001`, `gpu2`, `gpu3`):** `2xT4 ON`, `LLM_QWEN_VLM`, `27h 24m / 30h 00m left` (`8.6/15G` + `8.4/15G`) — serving `Qwen3.8-27B-UD-Q4_K_M.gguf` + `mmproj-F16.gguf` via `llama-server` `/v1`.

---

## 4. Technical Guardrails & Conventions to Preserve

- **Tailwind CSS v4 + `cn`:** `src/components/ui/*` uses plain concatenation `cn`, not `tailwind-merge` (`dialog.tsx` handles width override carefully).
- **React Compiler ESLint:** Enforce `react-hooks/preserve-manual-memoization`.
- **SSE on Vercel:** Keep `stream: true` server-side aggregation in `/api/llm-studio/chat` so long Qwen 27B / VLM completions do not hit HTTP 524 idle timeouts.
- **T4 GPU Safety:** Preserve `sdxl_vae_fp16_fix.safetensors` auto-injection and 16 GB VRAM budget checks.
- **Database Migrations:** Update both `prisma/schema.prisma` and `src/lib/db/ensure-schema.ts` / `prisma/turso-init.sql`.

---

## 5. Performance & Feature Upgrades (Verified 2026-11-13)

1. **Step-by-Step Boot Timers:** VM heartbeat now reports `stepDurations`, `currentStepElapsed`, and `totalBootElapsed`. `VmClusterCard` and `AccountClusterCard` render 5-segment live countdown/countup bars with real-time timers and final elapsed seconds per step.
2. **Hugging Face CDN Multi-Stream & Real-Time Download Speed:** Inverted download priority to check local disk $\rightarrow$ Hugging Face CDN (via `aria2c -x 16 -s 16` reaching 150–220 MB/s) $\rightarrow$ Google Drive fallback. Completed downloads are mirrored to Google Drive in a non-blocking background daemon thread.
3. **Dedicated LLM Studio Sidebar & Route:** Added `/llm-studio` to left navigation under "Intelligence & Studio" with dedicated page at `src/app/(dashboard)/llm-studio/page.tsx`.
4. **Persistent Chat Session History in LLM Studio:** Added `LlmChatSession` and `LlmChatMessage` tables to Prisma and Turso schemas. Implemented `/api/llm-studio/sessions` & `[id]` endpoints, session switcher drawer in `LlmStudioTab`, auto-save on turn completion, and `localStorage` instant recovery.
5. **Multi-GPU Simultaneous Prompt Dispatch:** Added "Fan-Out" mode to `StudioWorkspace.tsx`, enabling multi-selection of online GPUs and concurrent prompt dispatching with randomized seed variations via `Promise.all`.
6. **Token Speed (<10 tok/s) & Latency Fix:** Switched from CPU-emulated `q8_0` KV cache to native FP16 tensor core cache (`-ctk f16 -ctv f16`), tuned speculative drafting to `--spec-draft-n-max 3`, and increased `--ubatch-size 256` for faster prompt evaluation.
7. **Cloudflare HTTP 524 Timeout Fix:** Eliminated 0-byte buffering `resp.read()` in `_LlmBridgeHandler` in favor of unbuffered chunked transfer streaming (`Transfer-Encoding: chunked`), paired with Caddy `flush_interval -1`.
8. **AI Studio Controller:** Added `dispatch_multi_gpu_prompt` in `src/lib/agent/tools.ts`, connected to conversational AI Controller panels in both `/studio` and `/llm-studio`.
9. **Dedicated TPU Cluster Page & Isolated Architecture:** Added `/tpu-cluster` route and `TpuClusterCard.tsx` with dedicated `tpu0`–`tpu3` slots, dual-pool Kaggle quota tracking (`gpuQuota` + `tpuQuota`), independent session group management, and token quote sanitization.
10. **Qwen 35B-A3B Vision MoE Profile (`LLM_QWEN_MOE_35B`):** Added 35B MoE with 3B active parameters per token, bypassing the single-T4 bandwidth bottleneck and achieving ~35–55 tok/s with sub-second prompt replies on 2x T4.
11. **Qwen 8B Fast Vision Profile (`LLM_QWEN_FAST_8B`):** Added lightweight ~5.1 GB model profile (`unsloth/Qwen3-VL-8B-Instruct-GGUF`) that boots in 15–20s and decodes at ~45–60 tok/s on Dual-T4.
12. **Sub-45s Boot & Stability Optimizations:**
    - Accelerated binary retrieval from 190s to 3s using 16-connection `aria2c` with background Google Drive FastBoot snapshot (`llama_server_t4_v1.tar.gz`) for 1.5s restore.
    - Isolated local and remote model storage paths (`qwen3_vl_8b`, `qwen36_35b_moe`, `qwen38_27b`), eliminating cross-model `mmproj-F16.gguf` collisions.
    - Removed incompatible DFlash2 external drafter that corrupted English tokens.
    - Set default `--chat-template-kwargs '{"enable_thinking":false}'` so simple prompt replies stream in <500ms instead of 135s in `<think>` mode.
    - Guarded MTP so it never runs on 8B or when `--mmproj` vision is active.

---

## 6. Planned Next Work

See [`MEMORY.md`](file:///c:/Users/5480/Desktop/Automation/Book_Visualiser/MEMORY.md) for the full cross-repo plan:
1. Run end-to-end **`Book Graph`** chapter ingestion, Knowledge Graph extraction, Foundry plate rendering (`ACC1`), and Batch VLM Shot QA (`ACC2` Qwen 27B `/v1`).
2. Verify Scriptoria `ApiToken` bridge (`/api/v1/llm-endpoint`, `/api/v1/ingest`, `/api/v1/batch`) with `Book Graph`.
3. Optionally cache Qwen 27B GGUF + `llama-server` binaries to Google Drive to cut cold-boot time from ~4.5 min to <1 min.
