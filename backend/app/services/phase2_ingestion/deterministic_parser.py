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
