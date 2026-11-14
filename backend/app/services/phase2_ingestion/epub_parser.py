"""EPUB Ingestion Service.

Parses EPUB novel collections, cleanly extracting chapter metadata,
hierarchy, and prose text for the downstream beat chunker and agentic studio.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from bs4 import BeautifulSoup


@dataclass(frozen=True)
class ChapterMetadata:
    """Metadata and raw text for a parsed novel chapter."""
    chapter_number: int
    title: str
    filename: str
    word_count: int
    raw_text: str


class EPUBParser:
    """Extracts chapters and text from EPUB novel archives."""

    def __init__(self, epub_path: str | Path) -> None:
        self.epub_path = Path(epub_path)
        if not self.epub_path.exists():
            raise FileNotFoundError(f"EPUB file not found: {self.epub_path}")

    def list_chapters(self) -> List[dict]:
        """Scans the EPUB and returns an ordered catalog of chapters."""
        chapters = []
        with zipfile.ZipFile(self.epub_path, "r") as z:
            for item in z.filelist:
                fname = item.filename
                if not (fname.endswith(".xhtml") or fname.endswith(".html")):
                    continue
                if "cover" in fname.lower() or "title" in fname.lower() or "toc" in fname.lower():
                    continue

                # Pattern matching like 0001_1_Nightmare_Begins.xhtml
                match = re.search(r"(\d+)_(?:(\d+)_)?(.+)\.xhtml$", fname)
                if match:
                    ch_num = int(match.group(2) or match.group(1))
                    raw_title = match.group(3).replace("_", " ")
                    chapters.append({
                        "chapter_number": ch_num,
                        "title": raw_title,
                        "filename": fname,
                    })

        chapters.sort(key=lambda x: x["chapter_number"])
        return chapters

    def extract_chapter(self, chapter_number: int) -> Optional[ChapterMetadata]:
        """Extracts and cleans the text of a specific chapter number."""
        chapters = self.list_chapters()
        target = next((c for c in chapters if c["chapter_number"] == chapter_number), None)
        if not target:
            return None

        with zipfile.ZipFile(self.epub_path, "r") as z:
            raw_html = z.read(target["filename"]).decode("utf-8", errors="ignore")

        soup = BeautifulSoup(raw_html, "html.parser")

        # Strip header elements if duplicated
        for h in soup.find_all(["h1", "h2", "h3"]):
            h.decompose()

        # Extract text paragraph by paragraph
        paragraphs = []
        for p in soup.find_all("p"):
            text = p.get_text().strip()
            if text:
                paragraphs.append(text)

        full_text = "\n\n".join(paragraphs)
        if not full_text:
            # Fallback to entire body text
            full_text = soup.get_text().strip()

        # Clean multiple spaces / newlines
        full_text = re.sub(r"\n{3,}", "\n\n", full_text)
        words = len(full_text.split())

        return ChapterMetadata(
            chapter_number=chapter_number,
            title=target["title"],
            filename=target["filename"],
            word_count=words,
            raw_text=full_text,
        )

