# app/services/phase2_ingestion/beat_chunker.py
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core_sources import DocumentUnit, SourcePassage
from app.models.domain_fiction import FictionScene
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator

# --- Discourse & Heuristic Regex Patterns ---
EXPLICIT_SCENE_BREAK_RE = re.compile(
    r"^\s*(?:[\*\-~#_]{3,}|\*\s+\*\s+\*|~+\s*~+|###+|\[SCENE\s*BREAK\])\s*$",
    re.IGNORECASE,
)

TEMPORAL_SPATIAL_SHIFT_RE = re.compile(
    r"^\s*(?:"
    r"(?:Two|Three|Four|Five|Six|Seven|Several|Many|A\s+few)\s+(?:hours|days|weeks|months|years)\s+(?:later|passed|earlier|ago)|"
    r"The\s+(?:next|following)\s+(?:morning|day|night|dawn|evening|week)|"
    r"By\s+the\s+time\s+(?:dawn|morning|night|dusk)\s+(?:broke|fell|arrived)|"
    r"Meanwhile\b|Elsewhere\b|Miles\s+away\b|Across\s+the\s+(?:city|kingdom|continent|sea|hall)|"
    r"Hours\s+later\b|Dawn\s+broke\b|Night\s+fell\b"
    r")\b",
    re.IGNORECASE,
)

FLASHBACK_MARKER_RE = re.compile(
    r"\b(?:years\s+ago|in\s+his\s+memories|he\s+remembered\s+when|flashback|ten\s+years\s+earlier|back\s+when\s+he\s+was\s+a\s+child)\b",
    re.IGNORECASE,
)

TIME_OF_DAY_RE = {
    "Dawn": re.compile(r"\b(?:dawn|sunrise|first\s+light|daybreak)\b", re.IGNORECASE),
    "Morning": re.compile(r"\b(?:morning|mid-morning|forenoon)\b", re.IGNORECASE),
    "Noon": re.compile(r"\b(?:noon|midday|high\s+sun)\b", re.IGNORECASE),
    "Dusk": re.compile(r"\b(?:dusk|sunset|twilight|evening|sundown)\b", re.IGNORECASE),
    "Night": re.compile(r"\b(?:night|midnight|moonlight|starlight|torchlight)\b", re.IGNORECASE),
}

DIALOGUE_QUOTE_RE = re.compile(r'["“”«»]|(?:^|\s)[\'‘](?:[A-Z])')
SPEECH_ATTRIBUTION_RE = re.compile(
    r"\b(?:said|asked|whispered|shouted|murmured|replied|snapped|growled|called|cried|muttered|answered|demanded|hissed)\b",
    re.IGNORECASE,
)

KINETIC_ACTION_LEXICON = {
    "lunged", "parried", "slashed", "dodged", "sprinted", "leapt", "shattered",
    "exploded", "struck", "blade", "sword", "dagger", "spear", "shield", "impact",
    "blood", "crashed", "whirled", "ducked", "pivoted", "blocked", "recoiled",
    "shockwave", "arrow", "bolt", "cleaved", "thrust", "kick", "fist", "slammed",
    "momentum", "sparks", "steel", "roared", "staggered", "charged", "ambush"
}


@dataclass
class ParagraphAtom:
    index: int
    text: str
    word_count: int
    has_dialogue: bool
    ends_with_setup_punct: bool
    kinetic_score: float       # 0.0 to 1.0
    dialogue_density: float    # 0.0 to 1.0
    is_temporal_shift: bool
    is_flashback_hint: bool


@dataclass
class BeatPassageSpec:
    passage_order_in_chapter: int
    passage_order_in_scene: int
    text: str
    word_count: int
    kinetic_intensity: float
    dialogue_intensity: float
    paragraph_indices: List[int] = field(default_factory=list)


@dataclass
class SceneSegmentSpec:
    scene_number: int
    inferred_time_of_day: str
    is_flashback: bool
    total_words: int
    beats: List[BeatPassageSpec] = field(default_factory=list)


class DiscourseBeatChunker:
    """
    Parses a 4,000-6,000 word novel chapter into 3-5 SceneSegments and ~18-25
    cohesive Narrative Beat Passages (~150-300 words) while preserving dialogue
    exchanges and continuous combat/action sequences.
    """

    def __init__(
        self,
        target_beat_words: int = 220,
        min_beat_words: int = 130,
        max_beat_words: int = 320,
        hard_max_beat_words: int = 390,
        min_scene_words: int = 350,
    ):
        self.target_words = target_beat_words
        self.min_words = min_beat_words
        self.max_words = max_beat_words
        self.hard_max_words = hard_max_beat_words
        self.min_scene_words = min_scene_words

    def parse_chapter_text(self, raw_chapter_text: str) -> List[SceneSegmentSpec]:
        # Step 1: Split into raw blocks and detect explicit scene dividers
        raw_Macro_blocks = self._split_into_macro_scene_blocks(raw_chapter_text)

        # Step 2: Refine scene boundaries using spatio-temporal shift heuristics
        scene_paragraph_groups: List[List[ParagraphAtom]] = []
        for block in raw_Macro_blocks:
            atoms = self._tokenize_paragraphs(block)
            if not atoms:
                continue
            sub_scenes = self._split_by_temporal_shifts(atoms)
            scene_paragraph_groups.extend(sub_scenes)

        # Merge any micro-scenes that fall below min_scene_words
        scene_paragraph_groups = self._merge_undersized_scenes(scene_paragraph_groups)

        # Step 3: Run Dynamic Programming Beat Segmentation inside each Scene
        scenes_output: List[SceneSegmentSpec] = []
        global_passage_counter = 1

        for scene_idx, atoms in enumerate(scene_paragraph_groups, start=1):
            scene_text = "\n\n".join(a.text for a in atoms)
            time_of_day = self._infer_time_of_day(scene_text)
            is_flashback = any(a.is_flashback_hint for a in atoms[:2])

            raw_beats = self._segment_scene_into_beats_dp(atoms)
            beat_specs: List[BeatPassageSpec] = []

            for local_idx, beat_atoms in enumerate(raw_beats, start=1):
                beat_text = "\n\n".join(a.text for a in beat_atoms)
                total_w = sum(a.word_count for a in beat_atoms)
                avg_kinetic = sum(a.kinetic_score * a.word_count for a in beat_atoms) / max(1, total_w)
                avg_dialogue = sum(a.dialogue_density * a.word_count for a in beat_atoms) / max(1, total_w)

                beat_specs.append(
                    BeatPassageSpec(
                        passage_order_in_chapter=global_passage_counter,
                        passage_order_in_scene=local_idx,
                        text=beat_text,
                        word_count=total_w,
                        kinetic_intensity=round(avg_kinetic, 3),
                        dialogue_intensity=round(avg_dialogue, 3),
                        paragraph_indices=[a.index for a in beat_atoms],
                    )
                )
                global_passage_counter += 1

            scenes_output.append(
                SceneSegmentSpec(
                    scene_number=scene_idx,
                    inferred_time_of_day=time_of_day,
                    is_flashback=is_flashback,
                    total_words=sum(b.word_count for b in beat_specs),
                    beats=beat_specs,
                )
            )

        return scenes_output

    def _split_into_macro_scene_blocks(self, raw_text: str) -> List[str]:
        normalized = raw_text.replace("\r\n", "\n")
        # Split on explicit typographic scene breaks or 3+ consecutive blank lines
        lines = normalized.split("\n")
        blocks: List[str] = []
        current_lines: List[str] = []
        blank_streak = 0

        for line in lines:
            if EXPLICIT_SCENE_BREAK_RE.match(line):
                if current_lines:
                    blocks.append("\n".join(current_lines).strip())
                    current_lines = []
                blank_streak = 0
                continue

            if not line.strip():
                blank_streak += 1
                if blank_streak >= 3 and current_lines:
                    blocks.append("\n".join(current_lines).strip())
                    current_lines = []
                else:
                    current_lines.append(line)
            else:
                blank_streak = 0
                current_lines.append(line)

        if current_lines and "\n".join(current_lines).strip():
            blocks.append("\n".join(current_lines).strip())

        return [b for b in blocks if b]

    def _tokenize_paragraphs(self, block_text: str) -> List[ParagraphAtom]:
        raw_paras = [p.strip() for p in re.split(r"\n\s*\n", block_text) if p.strip()]
        atoms: List[ParagraphAtom] = []

        for idx, p in enumerate(raw_paras):
            words = re.findall(r"\b[\w'-]+\b", p.lower())
            word_count = max(1, len(words))

            has_quotes = bool(DIALOGUE_QUOTE_RE.search(p))
            has_attr = bool(SPEECH_ATTRIBUTION_RE.search(p))
            has_dialogue = has_quotes or (has_attr and word_count < 45)

            # Calculate dialogue density
            quote_spans = re.findall(r'["“][^"”]*["”]', p)
            quoted_words = sum(len(q.split()) for q in quote_spans)
            dialogue_density = min(1.0, (quoted_words / word_count) + (0.25 if has_dialogue else 0.0))

            # Calculate kinetic combat/action density
            kinetic_hits = sum(1 for w in words if w in KINETIC_ACTION_LEXICON)
            short_sentence_bonus = 0.15 if (p.count(".") + p.count("!")) / word_count > 0.08 else 0.0
            kinetic_score = min(1.0, (kinetic_hits / max(4.0, word_count * 0.09)) + short_sentence_bonus)

            ends_setup = p.endswith(":") or p.endswith(",") or p.endswith("—")
            is_shift = bool(TEMPORAL_SPATIAL_SHIFT_RE.search(p))
            is_flashback = bool(FLASHBACK_MARKER_RE.search(p))

            atoms.append(
                ParagraphAtom(
                    index=idx,
                    text=p,
                    word_count=word_count,
                    has_dialogue=has_dialogue,
                    ends_with_setup_punct=ends_setup,
                    kinetic_score=kinetic_score,
                    dialogue_density=dialogue_density,
                    is_temporal_shift=is_shift,
                    is_flashback_hint=is_flashback,
                )
            )
        return atoms

    def _split_by_temporal_shifts(self, atoms: List[ParagraphAtom]) -> List[List[ParagraphAtom]]:
        scenes: List[List[ParagraphAtom]] = []
        current_scene: List[ParagraphAtom] = []
        current_words = 0

        for atom in atoms:
            if atom.is_temporal_shift and current_words >= self.min_scene_words:
                scenes.append(current_scene)
                current_scene = [atom]
                current_words = atom.word_count
            else:
                current_scene.append(atom)
                current_words += atom.word_count

        if current_scene:
            scenes.append(current_scene)
        return scenes

    def _merge_undersized_scenes(self, groups: List[List[ParagraphAtom]]) -> List[List[ParagraphAtom]]:
        if len(groups) <= 1:
            return groups
        merged: List[List[ParagraphAtom]] = []
        for g in groups:
            g_words = sum(a.word_count for a in g)
            if merged and g_words < self.min_scene_words:
                merged[-1].extend(g)
            else:
                merged.append(g)
        return merged

    def _segment_scene_into_beats_dp(self, atoms: List[ParagraphAtom]) -> List[List[ParagraphAtom]]:
        """
        Dynamic Programming optimal paragraph grouping.
        Finds partition points 0 = i_0 < i_1 < ... < i_k = N minimizing:
        Sum of length deviation penalties + boundary cohesion penalties.
        """
        n = len(atoms)
        if n == 0:
            return []

        prefix_words = [0] * (n + 1)
        for i in range(n):
            prefix_words[i + 1] = prefix_words[i] + atoms[i].word_count

        # Precompute boundary cut penalty after atom[j - 1] (between j-1 and j)
        cut_penalty = [0.0] * (n + 1)
        for j in range(1, n):
            prev_a = atoms[j - 1]
            next_a = atoms[j]
            penalty = 0.0

            # 1. Never cut immediately after a setup colon/comma
            if prev_a.ends_with_setup_punct:
                penalty += 500.0

            # 2. Dialogue Integrity: Avoid slicing across active back-and-forth speaker turns
            if prev_a.has_dialogue and next_a.has_dialogue:
                penalty += 65.0
            elif prev_a.has_dialogue and next_a.word_count < 25:
                penalty += 30.0

            # 3. Continuous Action Integrity: Keep high-kinetic combat sequences together
            if prev_a.kinetic_score >= 0.35 and next_a.kinetic_score >= 0.35:
                penalty += 50.0

            cut_penalty[j] = penalty

        INF = 1e12
        dp = [INF] * (n + 1)
        parent = [-1] * (n + 1)
        dp[0] = 0.0

        for j in range(1, n + 1):
            for i in range(j - 1, -1, -1):
                chunk_words = prefix_words[j] - prefix_words[i]

                if chunk_words > self.hard_max_words and (j - i) > 1:
                    break

                # Length penalty relative to target (220 words)
                deviation = (chunk_words - self.target_words) / float(self.target_words)
                length_cost = 40.0 * (deviation ** 2)

                if chunk_words < self.min_words and j < n:
                    length_cost += 85.0 * ((self.min_words - chunk_words) / float(self.min_words))
                elif chunk_words > self.max_words:
                    length_cost += 70.0 * ((chunk_words - self.max_words) / float(self.max_words))

                boundary_cost = cut_penalty[j] if j < n else 0.0
                total_cost = dp[i] + length_cost + boundary_cost

                if total_cost < dp[j]:
                    dp[j] = total_cost
                    parent[j] = i

        # Backtrack to reconstruct optimal beat passages
        beats: List[List[ParagraphAtom]] = []
        curr = n
        while curr > 0:
            prev = parent[curr]
            if prev == -1:
                prev = 0
            beats.append(atoms[prev:curr])
            curr = prev

        beats.reverse()
        return beats

    def _infer_time_of_day(self, scene_text: str) -> str:
        sample = scene_text[:1500]
        for label, pattern in TIME_OF_DAY_RE.items():
            if pattern.search(sample):
                return label
        return "Unspecified"

    async def ingest_chapter_beats_to_db(
        self,
        session: AsyncSession,
        book_id: UUID,
        chapter_unit_id: UUID,
        book_number: int,
        chapter_number: int,
        raw_chapter_text: str,
        starting_story_tick: int,
        embedding_client=None,
    ) -> Tuple[List[FictionScene], List[SourcePassage]]:
        """
        Persists the parsed SceneSegments into `domain_fiction.scenes` and
        BeatPassageSpecs into `core_sources.source_passages`.
        """
        scene_specs = self.parse_chapter_text(raw_chapter_text)
        db_scenes: List[FictionScene] = []
        db_passages: List[SourcePassage] = []

        current_story_tick = starting_story_tick

        for s_spec in scene_specs:
            # Estimate tick bounds for the scene (will be refined when shots are decomposed)
            start_n_tick = BiTemporalTickCalculator.compute_narrative_tick(
                book_number, chapter_number, s_spec.scene_number, 1
            )
            end_n_tick = BiTemporalTickCalculator.compute_narrative_tick(
                book_number, chapter_number, s_spec.scene_number, 99
            )
            scene_start_s_tick = current_story_tick
            scene_end_s_tick = current_story_tick + (len(s_spec.beats) * 1000)

            db_scene = FictionScene(
                chapter_unit_id=chapter_unit_id,
                scene_number=s_spec.scene_number,
                time_of_day=s_spec.inferred_time_of_day,
                is_flashback=s_spec.is_flashback,
                start_narrative_tick=start_n_tick,
                end_narrative_tick=end_n_tick,
                start_story_tick=scene_start_s_tick,
                end_story_tick=scene_end_s_tick,
            )
            session.add(db_scene)
            db_scenes.append(db_scene)
            current_story_tick = scene_end_s_tick

            for b_spec in s_spec.beats:
                vec = None
                if embedding_client:
                    vec = await embedding_client.get_embedding(b_spec.text)

                passage = SourcePassage(
                    unit_id=chapter_unit_id,
                    book_id=book_id,
                    passage_order=b_spec.passage_order_in_chapter,
                    exact_quote=b_spec.text,
                    embedding=vec,
                )
                session.add(passage)
                db_passages.append(passage)

        await session.flush()
        return db_scenes, db_passages
