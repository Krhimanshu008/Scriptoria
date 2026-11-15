"""
Generate targeted context slice for Sprint 2: Tab 2 (VM Swarm & Extraction Lab).
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLICES_DIR = ROOT / "docs" / "ai_studio" / "slices"
SLICES_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE = SLICES_DIR / "slice_sprint2_extraction_lab.md"

def read_rel(rel_path: str) -> str:
    p = ROOT / rel_path
    if not p.exists():
        return f"<!-- MISSING: {rel_path} -->"
    return p.read_text(encoding="utf-8", errors="replace")

def main():
    content = []
    content.append("# SPRINT 2 CONTEXT SLICE: TAB 2 (VM SWARM & ROLLING EXTRACTION LAB)")
    content.append("## Target: Chief AI Architect (Gemini 4 Hydrogen / Argon) via Google AI Studio\n")
    content.append("### Project Context:")
    content.append("- Public Repository: https://github.com/Krhimanshu008/Scriptoria.git")
    content.append("- Sprint 1 Contract Hash: `b9f84ad7eac059f176856cb7494625e513693aed0a26dbd224bc4e54ffb1881a`")
    content.append("- Sprint 1 Exit Gate: 11/11 pytest passing, zero contract drift, tsc clean.\n")

    content.append("### SPRINT 2 OBJECTIVES:")
    content.append("1. **Workstream 2A: Canonical Extraction & VM Contracts (`backend/app/schemas/extraction_contracts.py`)**")
    content.append("   - `StrictModel` (`ConfigDict(extra='forbid', frozen=True)`).")
    content.append("   - `QuoteAnchorMatch`: `exact_quote`, `span: SpanRange` (`codepoint_start/end`, `utf16_start/end`), `match_quality: Literal['EXACT', 'FUZZY', 'UNMATCHED']`, `similarity_score: float`.")
    content.append("   - `VisualBeat`: `beat_order`, `shot_suggestion`, `focal_elements: list[str]`, `quote_anchor: QuoteAnchorMatch`.")
    content.append("   - `ExtractedScene`: `scene_id`, `scene_order`, `verbatim_summary`, `setting`, `characters_present`, `beats: list[VisualBeat]`.")
    content.append("   - `ExtractedEntityItem`: `entity_id`, `canonical_name`, `aliases: list[str]`, `short_visual_tag: str` (EC-2.4 max 120 chars), `entity_type: str`.")
    content.append("   - `RollingGlossarySnapshot`: `entities: list[ExtractedEntityItem]`, `last_completed_chapter: int`.")
    content.append("   - `ChapterExtractionRequest`: `book_id: str`, `chapter_index: int`, `raw_text: str`, `glossary: RollingGlossarySnapshot | None`, `worker_target: str`, `simulate_delay_s: float | None`.")
    content.append("   - `ChapterExtractionResponse`: `ok: Literal[True]`, `trace_id: str`, `book_id: str`, `chapter_index: int`, `scenes: list[ExtractedScene]`, `discovered_entities: list[ExtractedEntityItem]`, `updated_glossary: RollingGlossarySnapshot`, `quote_stats: dict`.")
    content.append("   - `VramEvictionState`: `active_mode: Literal['IDLE', 'EXTRACTION_SWARM', 'IMAGE_GEN_COMFYUI']`, `lock_holder: str | None`, `vram_allocated_mb: float`, `gpu_name: str | None`.\n")

    content.append("2. **Workstream 2B: FastAPI Endpoints (`backend/app/routers/vm_swarm_control.py` & `extraction_lab.py`)**")
    content.append("   - `GET /api/v1/vm/swarm/status`: Target status, active tunnel ports (:8190/:8191/:8192/:9999), VRAM lock status.")
    content.append("   - `POST /api/v1/vm/vram/lock`: Acquire / release mutual eviction lock.")
    content.append("   - `POST /api/v1/extraction/chapter`: Executes chapter extraction against real text or dry-run, computes exact quote anchor spans against source prose, checks EC-2.4 bloat limits.")
    content.append("   - `GET /api/v1/extraction/checkpoints/{book_id}`: Returns list of completed checkpoints for EC-2.3 sudden-death resume simulation.")
    content.append("   - `POST /api/v1/extraction/crash-simulate`: Simulates mid-extraction crash at chapter N and returns resume checkpoint.\n")

    content.append("3. **Workstream 2C: Next.js Typed Proxy Bridge & TypeScript Types**")
    content.append("   - `frontend/src/types/extraction-contracts.ts` (or appended to `testbench-contracts.ts`).")
    content.append("   - Route handlers: `/api/testbench/vm/swarm/status`, `/api/testbench/vm/vram/lock`, `/api/testbench/extraction/chapter`, `/api/testbench/extraction/checkpoints/[bookId]`.\n")

    content.append("4. **Workstream 2D: Tab 2 UI Polish (`Tab2Extraction.tsx`)**")
    content.append("   - Wire Column A (prose with interactive quote anchor highlights), Column B (beat cards with exact match badges), and Column C (glossary out with bloat limits).")
    content.append("   - Connect sudden-death crash & idempotent resume simulator (`EC-2.3`).\n")

    content.append("### EXISTING CODE REFERENCES:\n")

    content.append("#### 1. `backend/app/schemas/testbench_contracts.py` (Existing Core Contracts)")
    content.append("```python")
    content.append(read_rel("backend/app/schemas/testbench_contracts.py"))
    content.append("```\n")

    content.append("#### 2. Key Extracts from `backend/app/services/phase2_ingestion/rolling_extractor.py`")
    content.append("```python")
    rolling_lines = read_rel("backend/app/services/phase2_ingestion/rolling_extractor.py").splitlines()
    content.append("\n".join(rolling_lines[22:132]))
    content.append("```\n")

    OUT_FILE.write_text("\n".join(content), encoding="utf-8")
    print(f"Generated Sprint 2 context slice: {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
