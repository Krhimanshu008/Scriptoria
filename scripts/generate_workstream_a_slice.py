"""
Generate targeted slice for Workstream A: Canonical Contracts & FastAPI Bridge
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SLICES_DIR = BASE_DIR / "docs" / "ai_studio" / "slices"
SLICES_DIR.mkdir(parents=True, exist_ok=True)
SLICE_FILE = SLICES_DIR / "slice_workstream_a_contracts.md"

TARGET_FILES = [
    "backend/app/models/canonical_protocol.py",
    "backend/app/services/phase2_ingestion/deterministic_parser.py",
    "backend/app/main.py",
]

with open(SLICE_FILE, "w", encoding="utf-8") as out:
    out.write("# Scriptoria Targeted Codebase Slice: Workstream A (Contracts & Bridge)\n\n")
    out.write("This slice contains only the essential files required for implementing canonical contracts, ")
    out.write("Unicode dual-span offsets, and FastAPI testbench bridge foundation.\n\n")

    for rel_path in TARGET_FILES:
        full_path = BASE_DIR / rel_path
        if full_path.exists():
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            ext = full_path.suffix.lstrip(".")
            lang = "python" if ext == "py" else "typescript" if ext in ("ts", "tsx") else ""
            out.write(f"\n---\n## File: `{rel_path}`\n```{lang}\n{content.strip()}\n```\n")

size_kb = SLICE_FILE.stat().st_size / 1024
print(f"Generated {SLICE_FILE} ({size_kb:.1f} KB)")
