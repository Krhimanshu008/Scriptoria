"""
Generate targeted context slice for Sprint 3: Tab 3 (Graph & Timeline Studio).
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLICES_DIR = ROOT / "docs" / "ai_studio" / "slices"
SLICES_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE = SLICES_DIR / "slice_sprint3_graph_studio.md"

def read_rel(rel_path: str) -> str:
    p = ROOT / rel_path
    if not p.exists():
        return f"<!-- MISSING: {rel_path} -->"
    return p.read_text(encoding="utf-8", errors="replace")

def main():
    content = []
    content.append("# SPRINT 3 CONTEXT SLICE: TAB 3 (GRAPH & TIMELINE STUDIO)")
    content.append("## Target: Chief AI Architect (Gemini 4 Hydrogen / Argon) via Google AI Studio\n")
    content.append("### Project Context:")
    content.append("- Public Repository: https://github.com/Krhimanshu008/Scriptoria.git")
    content.append("- Active Contract Hash: `08e0a0b8a38adab857ec8d2c933dfd88fbbed1e0036ff675f0a18b165f036292`")
    content.append("- Sprints 1 & 2 100% verified (17/17 pytest passing, zero contract drift, tsc clean).\n")

    content.append("### SPRINT 3 OBJECTIVES:")
    content.append("1. **Workstream 3A: Stage-2 Compiler Contracts (`backend/app/schemas/compiler_contracts.py`)**")
    content.append("   - `StrictModel` (`ConfigDict(extra='forbid', frozen=True)`).")
    content.append("   - `CompiledEntitySummary`: entity_id, canonical_name, aliases, entity_type, visual_tier ('TIER_1_CORE', 'TIER_2', 'TIER_3'), importance_score, base_anatomy, first_seen_chapter.")
    content.append("   - `CompiledLocationSummary`: location_id, canonical_name, parent_location_id, materialized_path, environment_tags.")
    content.append("   - `TimelineTickSummary`: tick_index, narrative_seq, story_time_tick, chapter_index, scene_id, time_type, is_flashback (EC-3.1), location_id, characters_present, summary.")
    content.append("   - `GraphEdgeSummary`: source_id, target_id, edge_type, weight, bidirectional.")
    content.append("   - `CompiledBookGraphResponse`: ok, trace_id, book_id, total_chapters, total_scenes, total_beats, entities dict, locations dict, timeline list, edges list, has_cycles_detected, cycle_break_count.")
    content.append("   - `CompileBookRequest`: book_id, observations list or None (for dry-run demo compile).\n")

    content.append("2. **Workstream 3B: FastAPI Compiler Router (`backend/app/routers/graph_studio.py`)**")
    content.append("   - Prefix: `/compiler`")
    content.append("   - `POST /api/v1/compiler/compile`: Deterministic Stage-2 compiler execution with alias resolution, cycle-free location hierarchy, dual-timeline with flashback isolation, and importance scoring.")
    content.append("   - `GET /api/v1/compiler/graph/{book_id}`: Returns complete compiled graph.")
    content.append("   - `GET /api/v1/compiler/timeline/{book_id}`: Returns timeline events.")
    content.append("   - `GET /api/v1/compiler/characters/{book_id}`: Returns character tier matrix.")
    content.append("   - `GET /api/v1/compiler/locations/{book_id}`: Returns location tree.\n")

    content.append("### EXISTING CODE REFERENCES:")
    content.append("#### `backend/app/services/phase3_compiler/book_compiler.py` (Excerpts)")
    content.append("```python")
    compiler_lines = read_rel("backend/app/services/phase3_compiler/book_compiler.py").splitlines()
    content.append("\n".join(compiler_lines[:120]))
    content.append("```\n")

    OUT_FILE.write_text("\n".join(content), encoding="utf-8")
    print(f"Generated Sprint 3 context slice: {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
