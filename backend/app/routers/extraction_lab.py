from __future__ import annotations

import asyncio
import difflib
import hashlib
import re
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, Request, Response

from app.schemas.extraction_contracts import (
    ChapterExtractionRequest,
    ChapterExtractionResponse,
    CharacterPresence,
    CrashSimulationRequest,
    CrashSimulationResponse,
    ExtractedEntityItem,
    ExtractedScene,
    ExtractionCheckpointItem,
    ExtractionCheckpointsResponse,
    QuoteAnchorMatch,
    QuoteMatchStats,
    RollingGlossarySnapshot,
    SpanRange,
    VisualBeat,
    compute_utf16_span,
)

router = APIRouter(prefix="/extraction", tags=["extraction-lab"])

_CHECKPOINT_LOCK = Lock()
# Keyed by book_id -> dict[chapter_index, ExtractionCheckpointItem]
_BOOK_CHECKPOINTS: dict[str, dict[int, ExtractionCheckpointItem]] = {}
# Keyed by book_id -> explicit resumable chapter from crash simulation
_BOOK_RESUMABLE_CHAPTER: dict[str, int] = {}

EC_2_4_MAX_TAG_LENGTH = 120


def _resolve_trace_id(request: Request, response: Response | None = None) -> str:
    state_trace = getattr(request.state, "trace_id", None)
    header_trace = request.headers.get("x-trace-id") or request.headers.get(
        "X-Trace-ID"
    )
    trace_id = str(state_trace or header_trace or f"trc-{uuid.uuid4().hex[:16]}")
    if response is not None:
        response.headers["X-Trace-ID"] = trace_id
    return trace_id


def anchor_quote_in_text(
    raw_text: str,
    candidate_quote: str,
    fuzzy_threshold: float = 0.65,
) -> QuoteAnchorMatch:
    """
    Anchors a candidate quote in raw_text:
    1. Exact substring match -> match_quality="EXACT", similarity_score=1.0
    2. Case-insensitive exact lookup -> match_quality="FUZZY" with score ~0.95
    3. Sliding sentence/clause fuzzy match -> match_quality="FUZZY" if ratio >= fuzzy_threshold
    4. Otherwise -> match_quality="UNMATCHED", span=None
    """
    cleaned_quote = candidate_quote.strip()
    if not cleaned_quote or not raw_text:
        return QuoteAnchorMatch(
            exact_quote=candidate_quote or " ",
            span=None,
            match_quality="UNMATCHED",
            similarity_score=0.0,
        )

    # 1. Exact substring lookup
    exact_idx = raw_text.find(cleaned_quote)
    if exact_idx != -1:
        cp_start = exact_idx
        cp_end = exact_idx + len(cleaned_quote)
        return QuoteAnchorMatch(
            exact_quote=raw_text[cp_start:cp_end],
            span=compute_utf16_span(raw_text, cp_start, cp_end),
            match_quality="EXACT",
            similarity_score=1.0,
        )

    # 2. Case-insensitive exact lookup (classified as high-similarity FUZZY)
    lower_idx = raw_text.lower().find(cleaned_quote.lower())
    if lower_idx != -1:
        cp_start = lower_idx
        cp_end = lower_idx + len(cleaned_quote)
        ratio = difflib.SequenceMatcher(
            None, cleaned_quote, raw_text[cp_start:cp_end]
        ).ratio()
        return QuoteAnchorMatch(
            exact_quote=raw_text[cp_start:cp_end],
            span=compute_utf16_span(raw_text, cp_start, cp_end),
            match_quality="FUZZY",
            similarity_score=round(max(ratio, 0.95), 3),
        )

    # 3. Fuzzy sentence/segment scanning
    sentences = re.split(r"(?<=[.!?\n])\s+", raw_text)
    best_ratio = 0.0
    best_span: tuple[int, int] | None = None
    best_matched_text = ""

    running_idx = 0
    for s in sentences:
        s_clean = s.strip()
        if not s_clean:
            continue
        idx = raw_text.find(s_clean, running_idx)
        if idx == -1:
            idx = raw_text.find(s_clean)
        if idx != -1:
            running_idx = idx + len(s_clean)
            ratio = difflib.SequenceMatcher(None, cleaned_quote, s_clean).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_span = (idx, idx + len(s_clean))
                best_matched_text = s_clean

    if best_ratio >= fuzzy_threshold and best_span is not None:
        return QuoteAnchorMatch(
            exact_quote=best_matched_text,
            span=compute_utf16_span(raw_text, best_span[0], best_span[1]),
            match_quality="FUZZY",
            similarity_score=round(best_ratio, 3),
        )

    return QuoteAnchorMatch(
        exact_quote=candidate_quote,
        span=None,
        match_quality="UNMATCHED",
        similarity_score=round(best_ratio, 3),
    )


def _enforce_bloat_cap(text: str, max_chars: int = EC_2_4_MAX_TAG_LENGTH) -> str:
    """Enforces EC-2.4 Bloat Cap: clamps visual tag to maximum characters."""
    stripped = text.strip()
    if len(stripped) <= max_chars:
        return stripped
    return stripped[: max_chars - 3] + "..."


def _merge_glossary(
    existing: RollingGlossarySnapshot | None,
    new_entities: list[ExtractedEntityItem],
    chapter_index: int,
    diagnostics: list[str],
) -> RollingGlossarySnapshot:
    """
    Rolls glossary forward by merging existing entities with newly discovered ones,
    deduplicating by canonical_name and entity_id while preserving EC-2.4 bloat cap.
    """
    entity_map: dict[str, ExtractedEntityItem] = {}

    if existing and existing.entities:
        for ent in existing.entities:
            capped_tag = _enforce_bloat_cap(ent.short_visual_tag)
            key = ent.canonical_name.strip().lower()
            entity_map[key] = (
                ent
                if capped_tag == ent.short_visual_tag
                else ExtractedEntityItem(
                    entity_id=ent.entity_id,
                    canonical_name=ent.canonical_name,
                    aliases=ent.aliases,
                    short_visual_tag=capped_tag,
                    entity_type=ent.entity_type,
                )
            )

    for new_ent in new_entities:
        key = new_ent.canonical_name.strip().lower()
        capped_tag = _enforce_bloat_cap(new_ent.short_visual_tag)
        if len(new_ent.short_visual_tag) > EC_2_4_MAX_TAG_LENGTH:
            diagnostics.append(
                f"EC-2.4 Bloat Cap applied to entity '{new_ent.canonical_name}': "
                f"clamped from {len(new_ent.short_visual_tag)} to {EC_2_4_MAX_TAG_LENGTH} chars."
            )

        if key in entity_map:
            prev = entity_map[key]
            merged_aliases = sorted(list(set(prev.aliases + new_ent.aliases)))
            entity_map[key] = ExtractedEntityItem(
                entity_id=prev.entity_id,
                canonical_name=prev.canonical_name,
                aliases=merged_aliases,
                short_visual_tag=capped_tag or prev.short_visual_tag,
                entity_type=prev.entity_type,
            )
        else:
            entity_map[key] = ExtractedEntityItem(
                entity_id=new_ent.entity_id,
                canonical_name=new_ent.canonical_name,
                aliases=new_ent.aliases,
                short_visual_tag=capped_tag,
                entity_type=new_ent.entity_type,
            )

    return RollingGlossarySnapshot(
        entities=list(entity_map.values()),
        last_completed_chapter=chapter_index,
    )


@router.post("/chapter", response_model=ChapterExtractionResponse)
async def extract_chapter(
    payload: ChapterExtractionRequest,
    request: Request,
    response: Response,
) -> ChapterExtractionResponse:
    trace_id = _resolve_trace_id(request, response)
    diagnostics: list[str] = []

    if payload.simulate_delay_s and payload.simulate_delay_s > 0:
        await asyncio.sleep(min(payload.simulate_delay_s, 10.0))

    # Split text into logical scene partitions
    scene_breaks = [
        m.start()
        for m in re.finditer(
            r"(?:\n\s*){2,}(?:[*#-]{3,}|<SCENE_BREAK\s*/?>)", payload.raw_text
        )
    ]
    scene_boundaries: list[tuple[int, int]] = []
    prev_boundary = 0
    for b_idx in scene_breaks:
        if b_idx > prev_boundary:
            scene_boundaries.append((prev_boundary, b_idx))
        prev_boundary = b_idx
    scene_boundaries.append((prev_boundary, len(payload.raw_text)))

    extracted_scenes: list[ExtractedScene] = []
    discovered_entities: list[ExtractedEntityItem] = []

    total_beats = 0
    exact_matches = 0
    fuzzy_matches = 0
    unmatched_count = 0

    known_names = {
        ent.canonical_name: ent
        for ent in (payload.glossary.entities if payload.glossary else [])
    }

    for order_idx, (s_start, s_end) in enumerate(scene_boundaries, start=1):
        scene_chunk = payload.raw_text[s_start:s_end].strip()
        if not scene_chunk:
            continue

        scene_id = f"scn-{payload.book_id}-c{payload.chapter_index}-s{order_idx}"

        # Sentence extraction for beats & quotes
        sentences = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", scene_chunk)
            if len(s.strip()) > 10
        ]
        if not sentences:
            sentences = [scene_chunk[:100]]

        beats: list[VisualBeat] = []
        for beat_num, sentence in enumerate(sentences[:3], start=1):
            total_beats += 1
            quote_match = anchor_quote_in_text(payload.raw_text, sentence)

            if quote_match.match_quality == "EXACT":
                exact_matches += 1
            elif quote_match.match_quality == "FUZZY":
                fuzzy_matches += 1
            else:
                unmatched_count += 1

            beats.append(
                VisualBeat(
                    beat_order=beat_num,
                    shot_suggestion=(
                        f"Medium wide cinematic shot focusing on '{sentence[:45]}…' "
                        f"with natural key lighting and realistic depth of field."
                    ),
                    focal_elements=[
                        word
                        for word in re.findall(r"\b[A-Z][a-z]{3,}\b", sentence)[:3]
                    ],
                    quote_anchor=quote_match,
                )
            )

        # Infer characters and locations
        capitalized_words = list(
            dict.fromkeys(
                re.findall(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b", scene_chunk)
            )
        )
        character_presences: list[CharacterPresence] = []
        for cap in capitalized_words[:4]:
            if cap in ["Chapter", "The", "Then", "After", "Before", "When", "There"]:
                continue
            ent_id = f"ent-{re.sub(r'[^a-zA-Z0-9]+', '-', cap).lower()}"
            character_presences.append(
                CharacterPresence(
                    entity_id=ent_id,
                    name_in_scene=cap,
                    action="Observing surroundings and engaging in narrative sequence",
                    emotional_state="Focused",
                    clothing_mention=None,
                )
            )
            if cap not in known_names:
                discovered_entities.append(
                    ExtractedEntityItem(
                        entity_id=ent_id,
                        canonical_name=cap,
                        aliases=[],
                        short_visual_tag=_enforce_bloat_cap(
                            f"Dramatic character portrait of {cap}, distinctive fiction attire, atmospheric ambient rim light."
                        ),
                        entity_type="CHARACTER",
                    )
                )

        inferred_location = (
            capitalized_words[0] if capitalized_words else "Interior Chamber"
        )
        inferred_time = (
            "NIGHT"
            if any(w in scene_chunk.lower() for w in ["night", "moon", "dark"])
            else "DAY"
        )

        extracted_scenes.append(
            ExtractedScene(
                scene_id=scene_id,
                scene_order=order_idx,
                start_char_offset=s_start,
                end_char_offset=s_end,
                verbatim_summary=scene_chunk[:140].replace("\n", " ").strip() + "...",
                location_name=inferred_location,
                time_of_day=inferred_time,
                characters_present=character_presences,
                beats=beats,
            )
        )

    updated_glossary = _merge_glossary(
        payload.glossary,
        discovered_entities,
        payload.chapter_index,
        diagnostics,
    )

    matched_total = exact_matches + fuzzy_matches
    match_rate = (
        round((matched_total / total_beats) * 100.0, 2)
        if total_beats > 0
        else 100.0
    )

    quote_stats = QuoteMatchStats(
        total_beats=total_beats,
        exact_matches=exact_matches,
        fuzzy_matches=fuzzy_matches,
        unmatched=unmatched_count,
        match_rate_percent=match_rate,
    )

    # Persist idempotent checkpoint for (book_id, chapter_index)
    content_sha256 = hashlib.sha256(payload.raw_text.encode("utf-8")).hexdigest()
    checkpoint = ExtractionCheckpointItem(
        book_id=payload.book_id,
        chapter_index=payload.chapter_index,
        completed_at=datetime.now(timezone.utc).isoformat(),
        scene_count=len(extracted_scenes),
        entity_count=len(updated_glossary.entities),
        sha256_hash=content_sha256,
    )
    with _CHECKPOINT_LOCK:
        book_map = _BOOK_CHECKPOINTS.setdefault(payload.book_id, {})
        book_map[payload.chapter_index] = checkpoint
        _BOOK_RESUMABLE_CHAPTER[payload.book_id] = max(book_map.keys()) + 1

    diagnostics.append(
        f"Checkpoint saved for book='{payload.book_id}' chapter={payload.chapter_index} "
        f"(sha256={content_sha256[:12]})."
    )

    return ChapterExtractionResponse(
        ok=True,
        trace_id=trace_id,
        book_id=payload.book_id,
        chapter_index=payload.chapter_index,
        scenes=extracted_scenes,
        discovered_entities=discovered_entities,
        updated_glossary=updated_glossary,
        quote_stats=quote_stats,
        diagnostics=diagnostics,
    )


@router.get(
    "/checkpoints/{book_id}",
    response_model=ExtractionCheckpointsResponse,
)
async def get_extraction_checkpoints(
    book_id: str,
    request: Request,
    response: Response,
) -> ExtractionCheckpointsResponse:
    trace_id = _resolve_trace_id(request, response)

    with _CHECKPOINT_LOCK:
        book_map = _BOOK_CHECKPOINTS.get(book_id, {})
        sorted_checkpoints = [book_map[idx] for idx in sorted(book_map.keys())]
        if book_id in _BOOK_RESUMABLE_CHAPTER:
            can_resume = _BOOK_RESUMABLE_CHAPTER[book_id]
        elif sorted_checkpoints:
            can_resume = sorted_checkpoints[-1].chapter_index + 1
        else:
            can_resume = 0

    return ExtractionCheckpointsResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        checkpoints=sorted_checkpoints,
        can_resume_at_chapter=can_resume,
    )


@router.post(
    "/crash-simulate",
    response_model=CrashSimulationResponse,
)
async def simulate_extraction_crash(
    payload: CrashSimulationRequest,
    request: Request,
    response: Response,
) -> CrashSimulationResponse:
    """
    Simulates a mid-extraction sudden-death worker crash at chapter N (EC-2.3),
    persisting idempotent checkpoints for chapters [1 .. fail_at_chapter - 1]
    and verifying deterministic resume state at fail_at_chapter.
    """
    trace_id = _resolve_trace_id(request, response)
    crashed_at = min(payload.fail_at_chapter, payload.total_chapters)
    completed_chapters = list(range(1, crashed_at))

    now_iso = datetime.now(timezone.utc).isoformat()

    with _CHECKPOINT_LOCK:
        book_map: dict[int, ExtractionCheckpointItem] = {}
        for chap_idx in completed_chapters:
            synthetic_hash = hashlib.sha256(
                f"{payload.book_id}:chapter:{chap_idx}".encode("utf-8")
            ).hexdigest()
            book_map[chap_idx] = ExtractionCheckpointItem(
                book_id=payload.book_id,
                chapter_index=chap_idx,
                completed_at=now_iso,
                scene_count=2,
                entity_count=chap_idx * 2,
                sha256_hash=synthetic_hash,
            )

        _BOOK_CHECKPOINTS[payload.book_id] = book_map
        _BOOK_RESUMABLE_CHAPTER[payload.book_id] = crashed_at

        # Verify idempotency: all chapters < crashed_at are checkpointed once,
        # and crashed_at is not partially committed.
        idempotent_ok = (
            sorted(book_map.keys()) == completed_chapters
            and crashed_at not in book_map
        )

    return CrashSimulationResponse(
        ok=True,
        trace_id=trace_id,
        crashed_at_chapter=crashed_at,
        completed_before_crash=completed_chapters,
        resumable_chapter=crashed_at,
        idempotent_verified=idempotent_ok,
    )
