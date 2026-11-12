# Context Transfer — Scriptoria & Book Visualiser Workspace

## 1. Repository, Environment & Git State

- **Workspace Root:** `c:\Users\5480\Desktop\Automation\Book_Visualiser`
  - Contains `Scriptoria/` (Git repo) and `Book Graph/` (Python FastAPI + Supabase novel-to-images backend, intentionally not a Git repo).
  - Top-level workspace memory: [`MEMORY.md`](file:///c:/Users/5480/Desktop/Automation/Book_Visualiser/MEMORY.md).
- **Scriptoria Repo:** `c:\Users\5480\Desktop\Automation\Book_Visualiser\Scriptoria`
  - **Git Remote:** `origin` -> `https://github.com/Krhimanshu008/Scriptoria.git` (`main`)
  - **Current HEAD:** `6a4e67c` (synced & pushed to `origin/main`, deployed at `https://scriptoria.krhimanshu.in`)
  - **Git Status:** Working tree clean, `Memory.md` tracked and synced with GitHub.
- **Tech Stack (`Scriptoria/frontend`):**
  - Next.js `16.4.6` (App Router + Turbopack), React 19 (React Compiler ESLint rules active), Tailwind CSS v4 (`cn` without `tailwind-merge`), `@base-ui/react`, TanStack React Query, Prisma `v6.19.3` -> Turso libSQL (`libsql://scriptoria-prod-krhimanshu.aws-ap-south-1.turso.io`), Vercel deployment target.
- **ENCRYPTION_KEY Rule:**
  - All 12 Vault credentials in Turso are encrypted with Vercel's `ENCRYPTION_KEY` (verified live on `https://scriptoria.krhimanshu.in`). Never rotate Vercel's `ENCRYPTION_KEY` while using those rows. Ensure local `Scriptoria/frontend/.env` uses the exact same `ENCRYPTION_KEY` before running Vault decryption locally.

---

## 2. Recent Commit History (`origin/main`)

1. `0b98cdb` — `fix(llm): align llama-server with DFlash2 CUDA1 pin, asymmetric 55/45 split, ngld 99 and cache_prompt`
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

## 5. Planned Next Work

See [`MEMORY.md`](file:///c:/Users/5480/Desktop/Automation/Book_Visualiser/MEMORY.md) for the full cross-repo plan:
1. Run end-to-end **`Book Graph`** chapter ingestion, Knowledge Graph extraction, Foundry plate rendering (`ACC1`), and Batch VLM Shot QA (`ACC2` Qwen 27B `/v1`).
2. Verify Scriptoria `ApiToken` bridge (`/api/v1/llm-endpoint`, `/api/v1/ingest`, `/api/v1/batch`) with `Book Graph`.
3. Optionally cache Qwen 27B GGUF + `llama-server` binaries to Google Drive to cut cold-boot time from ~4.5 min to <1 min.
