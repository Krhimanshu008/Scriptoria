from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.middleware.bridge_guard import resolve_trace_id
from app.schemas.testbench_contracts import (
    DiagnosticSeverity,
    DocumentNode,
    DocumentNodeType,
    ParseDiagnostic,
    ParseInspectRequest,
    ParseInspectResponse,
    ParsedChunk,
    StrictModel,
    compute_utf16_span,
)

router = APIRouter(prefix="/parser", tags=["parser-inspector"])

MAX_CHUNK_WORDS = 4_500
DEFAULT_CHUNK_TOKEN_CAP = 6_000
SUPPORTED_EXTENSIONS: tuple[str, ...] = (".epub", ".pdf", ".md", ".txt")

LIGATURE_MAP: dict[str, str] = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}

_CHAPTER_HEADER_RE = re.compile(
    r"^(?:#\s+(?P<h1_title>.+?)|##\s+(?P<h2_title>(?:Chapter|Prologue|Epilogue)\b.*?))\s*$",
    re.IGNORECASE,
)
_SCENE_BREAK_RE = re.compile(r"^<\s*SCENE_BREAK\s*/\s*>\s*$", re.IGNORECASE)


class ParserProfile(StrictModel):
    """Named preset configuration exposed to the Tab 1 Parser Inspector."""

    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    max_chunk_words: int = Field(..., gt=0)
    max_chunk_tokens: int = Field(..., gt=0)
    normalize_ligatures: bool
    scene_break_min_blank_lines: int = Field(..., ge=1)


class ParserPresetsResponse(StrictModel):
    """Preset profiles, caps, and supported ingestion extensions."""

    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    default_profile_id: str
    default_word_cap: int = Field(..., gt=0)
    default_token_cap: int = Field(..., gt=0)
    supported_extensions: list[str]
    ligature_map: dict[str, str]
    profiles: list[ParserProfile]


@dataclass(frozen=True)
class _LineSlice:
    start: int
    end: int
    content: str


@dataclass
class _SceneBuffer:
    paragraphs: list[tuple[int, int]]


@dataclass
class _ChapterBuffer:
    title: str | None
    start: int
    end: int
    elements: list[tuple[Literal["scene", "scene_break"], AnyElement]]


AnyElement = _SceneBuffer | tuple[int, int]


def _normalize_text_with_map(
    raw_text: str,
    *,
    normalize_ligatures: bool,
) -> tuple[str, str, list[int]]:
    """Normalize line endings and optional ligatures while maintaining exact raw offset mapping."""
    lf_raw = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalize_ligatures:
        return lf_raw, lf_raw, list(range(len(lf_raw) + 1))

    norm_parts: list[str] = []
    norm_to_raw: list[int] = [0]

    for raw_idx, ch in enumerate(lf_raw):
        replacement = LIGATURE_MAP.get(ch, ch)
        norm_parts.append(replacement)
        for rep_idx in range(len(replacement)):
            if rep_idx > 0:
                norm_to_raw.append(raw_idx)
        norm_to_raw.append(raw_idx + 1)

    return lf_raw, "".join(norm_parts), norm_to_raw


def _iter_line_slices(text: str) -> list[_LineSlice]:
    lines: list[_LineSlice] = []
    cursor = 0
    for raw_line in text.splitlines(keepends=True):
        content = raw_line[:-1] if raw_line.endswith("\n") else raw_line
        lines.append(_LineSlice(start=cursor, end=cursor + len(content), content=content))
        cursor += len(raw_line)
    return lines


def _line_and_col(text: str, cp_offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, cp_offset) + 1
    last_nl = text.rfind("\n", 0, cp_offset)
    col = cp_offset - last_nl
    return line, col


def _has_unclosed_quotes(text: str) -> bool:
    if text.count('"') % 2 != 0:
        return True

    curly_balance = 0
    for ch in text:
        if ch == "\u201c":
            curly_balance += 1
        elif ch == "\u201d":
            curly_balance -= 1
            if curly_balance < 0:
                return True
    return curly_balance != 0


def _collect_nfc_diagnostics(normalized_text: str) -> list[ParseDiagnostic]:
    diagnostics: list[ParseDiagnostic] = []
    for line_slice in _iter_line_slices(normalized_text):
        if unicodedata.normalize("NFC", line_slice.content) != line_slice.content:
            line_num, col_num = _line_and_col(normalized_text, line_slice.start)
            diagnostics.append(
                ParseDiagnostic(
                    code="NON_NFC_UNICODE",
                    severity=DiagnosticSeverity.warning,
                    message=(
                        f"Line {line_num} contains non-NFC decomposed Unicode characters "
                        "that differ under unicodedata.normalize('NFC', text)."
                    ),
                    span=compute_utf16_span(
                        normalized_text,
                        line_slice.start,
                        line_slice.end,
                    ),
                    line=line_num,
                    column=col_num,
                )
            )
    return diagnostics


@router.get("/presets", response_model=ParserPresetsResponse)
async def get_parser_presets(request: Request) -> ParserPresetsResponse:
    """Return parser profiles, word/token caps, and supported document extensions."""
    trace_id = resolve_trace_id(request)
    return ParserPresetsResponse(
        trace_id=trace_id,
        default_profile_id="fiction_standard",
        default_word_cap=MAX_CHUNK_WORDS,
        default_token_cap=DEFAULT_CHUNK_TOKEN_CAP,
        supported_extensions=list(SUPPORTED_EXTENSIONS),
        ligature_map=dict(LIGATURE_MAP),
        profiles=[
            ParserProfile(
                id="fiction_standard",
                label="Fiction Standard",
                description=(
                    "Standard long-form fiction parser with typographic ligature normalization, "
                    "chapter header splitting, and <SCENE_BREAK /> detection."
                ),
                max_chunk_words=MAX_CHUNK_WORDS,
                max_chunk_tokens=DEFAULT_CHUNK_TOKEN_CAP,
                normalize_ligatures=True,
                scene_break_min_blank_lines=2,
            ),
            ParserProfile(
                id="fiction_strict",
                label="Fiction Strict (Local VRAM)",
                description=(
                    "Tighter chunk caps tailored for single-pass local 8B-14B extraction workers."
                ),
                max_chunk_words=3_000,
                max_chunk_tokens=4_000,
                normalize_ligatures=True,
                scene_break_min_blank_lines=2,
            ),
            ParserProfile(
                id="raw_passthrough",
                label="Raw Offset Passthrough",
                description=(
                    "Preserves typographic ligatures to inspect raw Unicode vs UTF-16 span alignment."
                ),
                max_chunk_words=MAX_CHUNK_WORDS,
                max_chunk_tokens=DEFAULT_CHUNK_TOKEN_CAP,
                normalize_ligatures=False,
                scene_break_min_blank_lines=2,
            ),
        ],
    )


@router.post("/inspect", response_model=ParseInspectResponse)
async def inspect_parsed_document(
    req: ParseInspectRequest,
    request: Request,
) -> ParseInspectResponse:
    """Deterministically normalize, parse, chunk, and diagnose fiction text with dual spans."""
    trace_id = resolve_trace_id(request)

    raw_codepoint_length = len(req.raw_text)
    raw_utf16_length = len(req.raw_text.encode("utf-16-le")) // 2

    lf_raw, normalized_markdown, norm_to_raw = _normalize_text_with_map(
        req.raw_text,
        normalize_ligatures=req.normalize_ligatures,
    )
    norm_codepoint_length = len(normalized_markdown)
    norm_utf16_length = len(normalized_markdown.encode("utf-16-le")) // 2

    chapters: list[_ChapterBuffer] = []
    current_chapter: _ChapterBuffer | None = None
    current_scene_paragraphs: list[tuple[int, int]] = []
    current_para_start: int | None = None
    current_para_end: int | None = None
    blank_run = 0

    def ensure_chapter(start: int, end: int, title: str | None = None) -> _ChapterBuffer:
        nonlocal current_chapter
        if current_chapter is None:
            current_chapter = _ChapterBuffer(title=title, start=start, end=end, elements=[])
            chapters.append(current_chapter)
        return current_chapter

    def flush_paragraph() -> None:
        nonlocal current_para_start, current_para_end
        if current_para_start is not None and current_para_end is not None:
            current_scene_paragraphs.append((current_para_start, current_para_end))
            if current_chapter is not None:
                current_chapter.end = max(current_chapter.end, current_para_end)
            current_para_start = None
            current_para_end = None

    def flush_scene() -> None:
        nonlocal current_scene_paragraphs
        flush_paragraph()
        if current_scene_paragraphs and current_chapter is not None:
            current_chapter.elements.append(
                ("scene", _SceneBuffer(paragraphs=current_scene_paragraphs))
            )
            current_chapter.end = max(current_chapter.end, current_scene_paragraphs[-1][1])
            current_scene_paragraphs = []

    for line_slice in _iter_line_slices(normalized_markdown):
        stripped = line_slice.content.strip()

        chapter_match = _CHAPTER_HEADER_RE.match(line_slice.content)
        if chapter_match:
            flush_scene()
            title = (
                chapter_match.group("h1_title") or chapter_match.group("h2_title") or ""
            ).strip()
            current_chapter = _ChapterBuffer(
                title=title or None,
                start=line_slice.start,
                end=line_slice.end,
                elements=[],
            )
            chapters.append(current_chapter)
            blank_run = 0
            continue

        if _SCENE_BREAK_RE.match(stripped):
            flush_scene()
            chapter = ensure_chapter(line_slice.start, line_slice.end)
            chapter.elements.append(("scene_break", (line_slice.start, line_slice.end)))
            chapter.end = max(chapter.end, line_slice.end)
            blank_run = 0
            continue

        if not stripped:
            flush_paragraph()
            blank_run += 1
            if blank_run >= 2 and current_scene_paragraphs:
                flush_scene()
            continue

        blank_run = 0
        chapter = ensure_chapter(line_slice.start, line_slice.end)
        if current_para_start is None:
            current_para_start = line_slice.start
        current_para_end = line_slice.end
        chapter.end = max(chapter.end, line_slice.end)

    flush_scene()

    diagnostics: list[ParseDiagnostic] = _collect_nfc_diagnostics(normalized_markdown)
    chapter_nodes: list[DocumentNode] = []
    chunks: list[ParsedChunk] = []
    total_scene_count = 0
    global_chunk_index = 0

    for ch_idx, ch_buf in enumerate(chapters):
        ch_children: list[DocumentNode] = []
        sc_idx = 0

        for elem_order, (elem_kind, elem_payload) in enumerate(ch_buf.elements):
            if elem_kind == "scene_break":
                sb_start, sb_end = elem_payload  # type: ignore[misc]
                if req.include_ast:
                    ch_children.append(
                        DocumentNode(
                            node_id=f"ch-{ch_idx}-sb-{elem_order}",
                            node_type=DocumentNodeType.scene_break,
                            title="<SCENE_BREAK />",
                            order_index=elem_order,
                            span=compute_utf16_span(normalized_markdown, sb_start, sb_end),
                            children=[],
                        )
                    )
                continue

            scene_buf = elem_payload
            assert isinstance(scene_buf, _SceneBuffer)
            sc_start = scene_buf.paragraphs[0][0]
            sc_end = scene_buf.paragraphs[-1][1]
            scene_span = compute_utf16_span(normalized_markdown, sc_start, sc_end)

            if req.include_ast:
                para_nodes = [
                    DocumentNode(
                        node_id=f"ch-{ch_idx}-sc-{sc_idx}-p-{p_idx}",
                        node_type=DocumentNodeType.paragraph,
                        title=None,
                        order_index=p_idx,
                        span=compute_utf16_span(normalized_markdown, p_start, p_end),
                        children=[],
                    )
                    for p_idx, (p_start, p_end) in enumerate(scene_buf.paragraphs)
                ]
                ch_children.append(
                    DocumentNode(
                        node_id=f"ch-{ch_idx}-sc-{sc_idx}",
                        node_type=DocumentNodeType.scene,
                        title=f"Scene {sc_idx + 1}",
                        order_index=elem_order,
                        span=scene_span,
                        children=para_nodes,
                    )
                )

            chunk_norm_text = normalized_markdown[sc_start:sc_end]
            chunk_raw_text = lf_raw[norm_to_raw[sc_start] : norm_to_raw[sc_end]]
            chunk_id = f"chunk-{ch_idx}-{sc_idx}-{global_chunk_index}"

            chunk_line, chunk_col = _line_and_col(normalized_markdown, sc_start)
            word_count = len(chunk_norm_text.split())
            if word_count > MAX_CHUNK_WORDS:
                diagnostics.append(
                    ParseDiagnostic(
                        code="OVERSIZED_CHUNK",
                        severity=DiagnosticSeverity.warning,
                        message=(
                            f"Chunk {chunk_id} has {word_count} words, exceeding the "
                            f"{MAX_CHUNK_WORDS}-word cap."
                        ),
                        span=scene_span,
                        line=chunk_line,
                        column=chunk_col,
                    )
                )

            if _has_unclosed_quotes(chunk_norm_text):
                diagnostics.append(
                    ParseDiagnostic(
                        code="UNCLOSED_QUOTE",
                        severity=DiagnosticSeverity.warning,
                        message=f"Unbalanced or unclosed quotation marks detected in {chunk_id}.",
                        span=scene_span,
                        line=chunk_line,
                        column=chunk_col,
                    )
                )

            if req.include_chunks:
                chunks.append(
                    ParsedChunk(
                        chunk_id=chunk_id,
                        chapter_index=ch_idx,
                        scene_index=sc_idx,
                        chunk_index=global_chunk_index,
                        raw_text=chunk_raw_text,
                        normalized_text=chunk_norm_text,
                        span=scene_span,
                        codepoint_length=len(chunk_norm_text),
                        utf16_length=scene_span.utf16_end - scene_span.utf16_start,
                        sha256=hashlib.sha256(chunk_norm_text.encode("utf-8")).hexdigest(),
                    )
                )

            sc_idx += 1
            total_scene_count += 1
            global_chunk_index += 1

        if req.include_ast:
            chapter_nodes.append(
                DocumentNode(
                    node_id=f"ch-{ch_idx}",
                    node_type=DocumentNodeType.chapter,
                    title=ch_buf.title,
                    order_index=ch_idx,
                    span=compute_utf16_span(normalized_markdown, ch_buf.start, ch_buf.end),
                    children=ch_children,
                )
            )

    document_tree = (
        DocumentNode(
            node_id="doc-0",
            node_type=DocumentNodeType.document,
            title=req.source_name,
            order_index=0,
            span=compute_utf16_span(normalized_markdown, 0, norm_codepoint_length),
            children=chapter_nodes,
        )
        if req.include_ast
        else None
    )

    return ParseInspectResponse(
        trace_id=trace_id,
        source_name=req.source_name,
        normalized_markdown=normalized_markdown,
        raw_codepoint_length=raw_codepoint_length,
        raw_utf16_length=raw_utf16_length,
        normalized_codepoint_length=norm_codepoint_length,
        normalized_utf16_length=norm_utf16_length,
        chapter_count=len(chapters),
        scene_count=total_scene_count,
        document_tree=document_tree,
        chunks=chunks,
        diagnostics=diagnostics,
    )
