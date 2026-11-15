# Scriptoria Targeted Codebase Slice: Workstream A (Contracts & Bridge)

This slice contains only the essential files required for implementing canonical contracts, Unicode dual-span offsets, and FastAPI testbench bridge foundation.


---
## File: `backend/app/models/canonical_protocol.py`
```python
"""
Canonical Protocol Schemas (v1.0.0) for Scriptoria
Enforces strict contracts across Deterministic Parsing, LLM Extraction,
Knowledge Graph Compilation, and Downstream Retrieval.
"""

from __future__ import annotations

import enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator


class TimeClueType(str, enum.Enum):
    PRESENT = "PRESENT"
    FLASHBACK = "FLASHBACK"
    DREAM = "DREAM"
    TIME_SKIP = "TIME_SKIP"
    PARALLEL_POV = "PARALLEL_POV"


class EntityType(str, enum.Enum):
    CHARACTER = "CHARACTER"
    LOCATION = "LOCATION"
    ITEM = "ITEM"
    FACTION = "FACTION"


# ---------------------------------------------------------------------------
# Layer B: Visual Scene Breakdown & Narrative Clues
# ---------------------------------------------------------------------------

class TimeClue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str = Field(..., description="Exact textual excerpt indicating time (e.g., 'Three days later', 'Ten years earlier')")
    time_type: TimeClueType = Field(default=TimeClueType.PRESENT, description="Temporal classification")
    delta_hint: Optional[str] = Field(None, description="Inferred delta like '+3 days', '-10 years', 'same afternoon'")


class LocationClue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str = Field(..., description="Exact textual excerpt describing location hierarchy or movement")
    parent_hint: Optional[str] = Field(None, description="Inferred parent container (e.g., 'Vance Manor' for 'the cellar')")
    environment_tags: List[str] = Field(default_factory=list, description="Visual environmental attributes: interior, stormy, cavernous")


class CharacterMention(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str = Field(..., description="Normalized entity ID, e.g. 'char_mira_vance'")
    name_in_scene: str = Field(..., description="Name or designation used in this scene, e.g. 'the hooded stranger' or 'Mira'")
    action: str = Field(..., description="Physical action currently being performed in the scene")
    emotional_state: str = Field(..., description="Observed emotional/psychological state")
    visual_changes: Optional[str] = Field(None, description="Any injuries, scars, soot, blood, or physical markers discovered in this scene")
    clothing_mention: Optional[str] = Field(None, description="Specific clothing explicitly mentioned in this scene, or null if unmentioned")


class ItemMention(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(..., description="Normalized item ID, e.g. 'item_cracked_brass_lantern'")
    item_name: str = Field(..., description="Name of the item in scene")
    held_by_entity_id: Optional[str] = Field(None, description="Character currently in custody of this item")
    condition: str = Field(default="intact", description="Physical state: intact, broken, glowing, ignited, stained")


class SettingObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: str = Field(..., description="Normalized location ID, e.g. 'loc_glass_forge'")
    location_name: str = Field(..., description="Canonical or descriptive name of the setting")
    time_of_day: str = Field(default="unknown", description="dusk, dawn, noon, midnight, afternoon, etc.")
    weather_atmosphere: str = Field(default="clear", description="Atmospheric condition, e.g. 'howling blizzard, sub-zero chill'")
    lighting: str = Field(default="natural", description="Lighting source and quality, e.g. 'flickering amber embers, heavy shadows'")
    color_palette: List[str] = Field(default_factory=list, description="Dominant visual colors (e.g., ['#1C1917', '#B45309'])")


class VisualBeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beat_order: int = Field(..., ge=1, description="Sequential order within the scene (1, 2, 3...)")
    shot_suggestion: str = Field(..., description="Cinematographic suggestion, e.g. 'Wide establishing shot of cavernous forge with glowing cracks'")
    focal_elements: List[str] = Field(..., description="Key elements to anchor visual generation")
    quote_anchor: str = Field(..., description="Verbatim prose excerpt anchoring this visual beat to the text")


class SceneObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(..., description="Unique scene identifier, e.g. 'ch001_sc01'")
    scene_order_in_chapter: int = Field(..., ge=1, description="Order of the scene within the chapter")
    start_char_offset: int = Field(..., ge=0, description="Start character offset in source markdown")
    end_char_offset: int = Field(..., ge=0, description="End character offset in source markdown")
    verbatim_excerpt_summary: str = Field(..., description="1-2 sentence neutral summary of what occurs")
    setting: SettingObservation = Field(..., description="Setting, atmosphere, and lighting")
    characters_present: List[CharacterMention] = Field(default_factory=list, description="Characters physically present in this scene")
    items_interacted: List[ItemMention] = Field(default_factory=list, description="Key items and artifacts used or referenced")
    key_visual_beats: List[VisualBeat] = Field(..., min_length=1, description="Chronological visual shots for illustration")
    time_clue: Optional[TimeClue] = Field(None, description="Any explicit time jump or narrative shift")

    @field_validator("end_char_offset")
    @classmethod
    def validate_offsets(cls, v: int, info):
        start = info.data.get("start_char_offset")
        if start is not None and v < start:
            raise ValueError(f"end_char_offset ({v}) cannot be less than start_char_offset ({start})")
        return v


# ---------------------------------------------------------------------------
# Layer C: Entity Continuity Registry (Observations)
# ---------------------------------------------------------------------------

class EntityObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str = Field(..., description="Unique identifier, e.g. 'char_sunny'")
    canonical_name: str = Field(..., description="Most recognized canonical name")
    aliases: List[str] = Field(default_factory=list, description="Alternative names, titles, pronouns used")
    entity_type: EntityType = Field(..., description="CHARACTER, LOCATION, ITEM, or FACTION")
    static_traits: str = Field(..., description="Permanent visual/physical traits (height, eyes, hair, species, scars)")
    chapter_state_delta: Dict[str, Any] = Field(
        default_factory=dict,
        description="State changes introduced in this chapter: clothing, injuries, weapons equipped, custody changes"
    )


# ---------------------------------------------------------------------------
# Layer A: Verbatim & Chapter Checkpoint Protocol
# ---------------------------------------------------------------------------

class ChapterObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="1.0.0", description="Contract schema version")
    book_id: str = Field(..., description="UUID or unique slug of the book")
    chapter_index: int = Field(..., ge=1, description="1-indexed chapter number")
    chapter_title: str = Field(..., description="Chapter title as found in source")
    raw_text_r2_key: str = Field(..., description="R2 object path to cleaned chapter markdown")
    scenes: List[SceneObservation] = Field(default_factory=list, description="Extracted visual scenes")
    discovered_entities: List[EntityObservation] = Field(default_factory=list, description="New or updated entities from this chapter")
    time_clues: List[TimeClue] = Field(default_factory=list, description="All time indicators detected in the chapter")
    location_clues: List[LocationClue] = Field(default_factory=list, description="All spatial cues detected in the chapter")


class RollingEntityGlossaryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    canonical_name: str
    aliases: List[str] = Field(default_factory=list)
    short_visual_tag: str = Field(..., description="Minimal concise tag (e.g. 'mid-20s, dark braids, amber eyes') to preserve context tokens")
    entity_type: EntityType


class RollingEntityGlossary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    book_id: str
    last_completed_chapter: int = Field(default=0)
    entities: List[RollingEntityGlossaryItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer D: Stage-2 Compiled Temporal Knowledge Graph Protocols
# ---------------------------------------------------------------------------

class EntityVisualTier(str, enum.Enum):
    TIER_1_CORE = "TIER_1_CORE"
    TIER_2_SUPPORTING = "TIER_2_SUPPORTING"
    TIER_3_EXTRAS = "TIER_3_EXTRAS"


class EntityStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_tick: int = Field(..., description="Chronological story tick")
    narrative_seq: int = Field(..., description="Sequential reader discovery order")
    scene_id: str = Field(..., description="Scene in which state was observed or updated")
    outfit: Optional[str] = Field(None, description="Clothing worn")
    physical_condition: Optional[str] = Field(None, description="Physical state e.g. exhausted, wounded, energetic")
    injuries: List[str] = Field(default_factory=list, description="Active wounds, scars, burns")
    items_held: List[str] = Field(default_factory=list, description="Items currently in custody")
    is_stale: bool = Field(default=False, description="Flagged true when a time-skip invalidates ephemeral state")


class CompiledEntity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    canonical_name: str
    aliases: List[str] = Field(default_factory=list)
    entity_type: EntityType
    static_traits: str
    visual_tier: EntityVisualTier
    importance_score: float = Field(..., ge=0.0, le=1.0)
    presence_score: float = Field(default=0.0)
    agency_score: float = Field(default=0.0)
    centrality_score: float = Field(default=0.0)
    detail_density: float = Field(default=0.0)
    state_history: List[EntityStateSnapshot] = Field(default_factory=list)


class CompiledLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: str
    canonical_name: str
    parent_location_id: Optional[str] = Field(None, description="Direct parent container location ID")
    materialized_path: str = Field(..., description="Hierarchical tree path e.g. /andalusia/church/sacristy")
    environment_tags: List[str] = Field(default_factory=list)


class CompiledTimelineTick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    narrative_seq: int = Field(..., ge=1, description="Sequential reading order (1, 2, 3...)")
    story_time_tick: int = Field(..., description="Chronological story timeline tick")
    chapter_index: int
    scene_id: str
    time_type: TimeClueType
    time_delta_hint: Optional[str] = None
    location_id: str
    active_characters: List[str] = Field(default_factory=list)
    active_items: List[str] = Field(default_factory=list)


class CompiledGraphEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    target_id: str
    relationship_type: str
    weight: float = Field(default=1.0)
    narrative_seq: Optional[int] = None


class CompiledBookGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="1.0.0")
    book_id: str
    total_chapters: int
    total_scenes: int
    total_beats: int
    timeline: List[CompiledTimelineTick] = Field(default_factory=list)
    entities: Dict[str, CompiledEntity] = Field(default_factory=dict)
    locations: Dict[str, CompiledLocation] = Field(default_factory=dict)
    edges: List[CompiledGraphEdge] = Field(default_factory=list)
```

---
## File: `backend/app/services/phase2_ingestion/deterministic_parser.py`
```python
"""
Deterministic Novel Parser (Zero LLM).
Converts raw EPUBs and PDFs into normalized Chapter Markdown with:
- Standardized <SCENE_BREAK /> tokens
- Unicode & ligature normalization (fi, fl, etc.)
- Hyphenated line-wrap restoration (moon-\\nlight -> moonlight)
- Frontmatter detection (Copyright, TOC, Dedications)
- Safe chapter chunking for oversized chapters (>6,000 tokens)
"""

from __future__ import annotations

import os
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from bs4 import BeautifulSoup, NavigableString, Tag
try:
    import pymupdf as fitz
except ImportError:
    import fitz  # PyMuPDF


LIGATURES_MAP = {
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬀ": "ff",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "ft",
    "ﬆ": "st",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2014": "—",
    "\u2013": "–",
    "\u2026": "...",
}

FRONTMATTER_KEYWORDS = {
    "copyright", "table of contents", "contents", "dedication", "epigraph",
    "title page", "also by", "about the author", "acknowledgments",
    "acknowledgements", "prologue", "introduction", "preface", "foreword"
}

SCENE_BREAK_PATTERNS = [
    re.compile(r"^\s*(?:\*\s*){3,}\s*$"),                  # * * * or ***
    re.compile(r"^\s*(?:-\s*){3,}\s*$"),                  # - - - or ---
    re.compile(r"^\s*(?:#\s*){3,}\s*$"),                  # # # # or ###
    re.compile(r"^\s*(?:~\s*){3,}\s*$"),                  # ~ ~ ~
    re.compile(r"^\s*(?:_\s*){3,}\s*$"),                  # _ _ _
    re.compile(r"^\s*(?:♦|◆|❖|§|※|•|\*|†|‡)\s*$"),        # Single decorative glyph
    re.compile(r"^\s*<SCENE_BREAK\s*/>\s*$", re.IGNORECASE), # Already standardized
]


def normalize_text_unicode(text: str) -> str:
    """Normalize unicode characters, quotes, and ligatures."""
    for lig, rep in LIGATURES_MAP.items():
        text = text.replace(lig, rep)
    # NFKC normalizes compatibility characters while keeping standard Latin
    text = unicodedata.normalize("NFKC", text)
    return text


def repair_hyphenation(text: str) -> str:
    """
    Repairs broken line-wrap hyphens:
    'moon-\\nlight' -> 'moonlight'
    'infor-\\nmation' -> 'information'
    while keeping genuine compounds like 'well-\\nknown' or 'half-hearted'.
    """
    # Regex checks lowercase letter + hyphen + newline + lowercase letter
    def _repl(match):
        w1 = match.group(1)
        w2 = match.group(2)
        # If either part is very short (1-2 chars) or common prefix, join
        return f"{w1}{w2}"

    return re.sub(r"([a-z]{2,})-\s*\n\s*([a-z]{2,})", _repl, text)


@dataclass
class ParsedChapter:
    chapter_index: int
    title: str
    filename: str
    markdown: str
    word_count: int
    char_count: int
    is_frontmatter: bool
    has_scene_breaks: bool
    sub_parts: List[str] = field(default_factory=list)


class DeterministicNovelParser:
    """Zero-LLM deterministic novel parser for EPUB and PDF."""

    def __init__(self, file_path: Union[str, Path]) -> None:
        self.file_path = Path(file_path)
        if not self.file_path.exists():
            raise FileNotFoundError(f"File not found: {self.file_path}")
        self.format = self.file_path.suffix.lower().lstrip(".")

    def parse(self, max_words_per_part: int = 4500) -> List[ParsedChapter]:
        if self.format == "epub":
            return self._parse_epub(max_words_per_part)
        elif self.format == "pdf":
            return self._parse_pdf(max_words_per_part)
        else:
            raise ValueError(f"Unsupported format: {self.format}. Expected .epub or .pdf")

    # -----------------------------------------------------------------------
    # EPUB Parser
    # -----------------------------------------------------------------------
    def _parse_epub(self, max_words_per_part: int) -> List[ParsedChapter]:
        results: List[ParsedChapter] = []
        raw_items: List[Tuple[str, str]] = []

        with zipfile.ZipFile(self.file_path, "r") as z:
            # Order items logically from the spine / file list
            for item in z.filelist:
                fname = item.filename
                if not (fname.endswith(".xhtml") or fname.endswith(".html") or fname.endswith(".htm")):
                    continue
                # Skip css, media, nav
                if any(x in fname.lower() for x in ["nav.xhtml", "toc.xhtml", "cover.xhtml"]):
                    continue
                try:
                    content = z.read(fname).decode("utf-8", errors="ignore")
                    raw_items.append((fname, content))
                except Exception:
                    continue

        if not raw_items:
            raise ValueError(f"No valid xhtml/html chapters found in EPUB: {self.file_path}")

        chapter_counter = 1
        for fname, html in raw_items:
            soup = BeautifulSoup(html, "html.parser")

            # Extract title if present
            title = ""
            for h in soup.find_all(["h1", "h2", "h3", "h4"]):
                h_text = h.get_text().strip()
                if h_text and len(h_text) < 120:
                    title = h_text
                    h.decompose()
                    break

            if not title:
                # Infer from filename or default
                base = Path(fname).stem.replace("_", " ").replace("-", " ")
                title = base.title()

            # Process body elements preserving scene breaks
            paragraphs: List[str] = []
            has_scene_breaks = False

            for elem in soup.find_all(["p", "hr", "div", "blockquote"]):
                # Check for explicit hr or break classes
                classes = " ".join(elem.get("class", [])) if isinstance(elem.get("class"), list) else str(elem.get("class", ""))
                is_css_break = any(k in classes.lower() for k in ["break", "spacer", "scene", "divider", "asterisk", "ornament"])
                
                if elem.name == "hr" or is_css_break:
                    paragraphs.append("<SCENE_BREAK />")
                    has_scene_breaks = True
                    continue

                p_text = elem.get_text().strip()
                if not p_text:
                    continue

                # Check if paragraph text is a textual scene divider like * * * or ---
                is_text_break = any(pat.match(p_text) for pat in SCENE_BREAK_PATTERNS)
                if is_text_break:
                    paragraphs.append("<SCENE_BREAK />")
                    has_scene_breaks = True
                    continue

                paragraphs.append(p_text)

            if not paragraphs:
                continue

            full_text = "\n\n".join(paragraphs)
            full_text = normalize_text_unicode(full_text)
            full_text = repair_hyphenation(full_text)
            # Remove duplicated consecutive scene breaks
            full_text = re.sub(r"(?:<SCENE_BREAK />\s*\n*){2,}", "<SCENE_BREAK />\n\n", full_text)

            words = len(full_text.split())
            if words < 15 and not has_scene_breaks:
                # Likely empty placeholder or illustration page
                continue

            # Detect frontmatter
            lower_title = title.lower()
            is_frontmatter = any(kw in lower_title for kw in FRONTMATTER_KEYWORDS)
            if is_frontmatter:
                # Keep frontmatter separate
                idx = 0
            else:
                idx = chapter_counter
                chapter_counter += 1

            # Check if chapter exceeds word limit and needs deterministic safe splitting
            sub_parts = []
            if words > max_words_per_part:
                sub_parts = self._split_oversized_chapter(full_text, max_words_per_part)

            results.append(ParsedChapter(
                chapter_index=idx,
                title=title,
                filename=fname,
                markdown=full_text,
                word_count=words,
                char_count=len(full_text),
                is_frontmatter=is_frontmatter,
                has_scene_breaks=has_scene_breaks,
                sub_parts=sub_parts
            ))

        return results

    # -----------------------------------------------------------------------
    # PDF Parser
    # -----------------------------------------------------------------------
    def _parse_pdf(self, max_words_per_part: int) -> List[ParsedChapter]:
        doc = fitz.open(str(self.file_path))
        chapters: List[ParsedChapter] = []

        full_pages = []
        for pno in range(len(doc)):
            page = doc[pno]
            text = page.get_text("text")
            # Strip simple running headers & footers (e.g. Page 12 or Book Title)
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            if lines and re.match(r"^(?:page\s+)?\d+$", lines[0], re.IGNORECASE):
                lines = lines[1:]
            if lines and re.match(r"^(?:page\s+)?\d+$", lines[-1], re.IGNORECASE):
                lines = lines[:-1]
            page_text = "\n".join(lines)
            full_pages.append(page_text)

        doc.close()

        # Combine and segment based on "Chapter X" or large breaks
        combined = "\n\n".join(full_pages)
        combined = normalize_text_unicode(combined)
        combined = repair_hyphenation(combined)

        # Split on common chapter heading regexes
        ch_splits = re.split(r"(?:\n\s*|^)(Chapter\s+[\dIVXLCDM]+[^\n]*|\bAct\s+[\dIVXLCDM]+[^\n]*)", combined, flags=re.IGNORECASE)

        if len(ch_splits) <= 1:
            # Fallback to single or fixed-size chapters
            words = len(combined.split())
            chapters.append(ParsedChapter(
                chapter_index=1,
                title="Full Volume",
                filename=self.file_path.name,
                markdown=combined,
                word_count=words,
                char_count=len(combined),
                is_frontmatter=False,
                has_scene_breaks="<SCENE_BREAK />" in combined
            ))
            return chapters

        # Re-assemble split groups
        idx = 1
        for i in range(1, len(ch_splits), 2):
            title = ch_splits[i].strip()
            body = ch_splits[i+1].strip() if i+1 < len(ch_splits) else ""
            words = len(body.split())
            if words < 20:
                continue
            chapters.append(ParsedChapter(
                chapter_index=idx,
                title=title,
                filename=f"ch_{idx:03d}.pdf",
                markdown=body,
                word_count=words,
                char_count=len(body),
                is_frontmatter=False,
                has_scene_breaks="<SCENE_BREAK />" in body
            ))
            idx += 1

        return chapters

    # -----------------------------------------------------------------------
    # Safe Chunker (For >6,000 token chapters)
    # -----------------------------------------------------------------------
    def _split_oversized_chapter(self, text: str, max_words: int) -> List[str]:
        """
        Splits an oversized chapter only at <SCENE_BREAK /> tokens
        (or paragraph boundaries) to avoid mid-sentence cuts.
        """
        parts: List[str] = []
        if "<SCENE_BREAK />" in text:
            raw_scenes = text.split("<SCENE_BREAK />")
            current_chunk: List[str] = []
            current_words = 0
            for sc in raw_scenes:
                sc_words = len(sc.split())
                if current_words + sc_words > max_words and current_chunk:
                    parts.append("<SCENE_BREAK />".join(current_chunk).strip())
                    current_chunk = [sc]
                    current_words = sc_words
                else:
                    current_chunk.append(sc)
                    current_words += sc_words
            if current_chunk:
                parts.append("<SCENE_BREAK />".join(current_chunk).strip())
        else:
            # Paragraph split fallback
            paragraphs = text.split("\n\n")
            current_chunk = []
            current_words = 0
            for p in paragraphs:
                p_words = len(p.split())
                if current_words + p_words > max_words and current_chunk:
                    parts.append("\n\n".join(current_chunk).strip())
                    current_chunk = [p]
                    current_words = p_words
                else:
                    current_chunk.append(p)
                    current_words += p_words
            if current_chunk:
                parts.append("\n\n".join(current_chunk).strip())

        return parts
```

---
## File: `backend/app/main.py`
```python
import logging
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.api.v1.api import api_router
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("novel_visualiser")

app = FastAPI(
    title="Novel Visualiser & Storyboard Studio",
    description="Neuro-Symbolic Agentic AI Platform for Fiction Novel Storyboarding and Continuous Cluster Rendering",
    version="1.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Router
app.include_router(api_router, prefix="/api/v1")

# Static media mounts
shots_dir = Path("output/shots")
shots_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/shots", StaticFiles(directory=str(shots_dir)), name="shots")

foundry_dir = Path("output/foundry")
foundry_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/foundry", StaticFiles(directory=str(foundry_dir)), name="foundry")

# Static UI mount
static_ui_dir = Path("app/static")
static_ui_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_ui_dir)), name="static")

@app.get("/")
async def serve_index():
    index_file = static_ui_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "Novel Visualiser API is running. Go to /docs for interactive Swagger API."}

@app.get("/health")
async def health_check():
    return {
        "status": "ONLINE",
        "gpu0": settings.COMFYUI_GPU0_URL,
        "gpu1": settings.COMFYUI_GPU1_URL,
        "gcgpu": settings.COMFYUI_COLAB_URL,
        "database": "Supabase PostgreSQL (Asyncpg)",
    }
```
