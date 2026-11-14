# app/services/phase1_core/tick_calculator.py

class BiTemporalTickCalculator:
    """
    Calculates deterministic coordinates for both:
    1. Narrative Tick (Reader Discovery Order)
    2. Story Tick (Chronological Universe Order, gap-buffered by 1000 for flashback insertion)
    """

    @staticmethod
    def compute_narrative_tick(book_num: int, chapter_num: int, scene_num: int, shot_num: int) -> int:
        if not (1 <= chapter_num <= 9999 and 1 <= scene_num <= 99 and 1 <= shot_num <= 999):
            raise ValueError("Coordinate bounds exceeded for deterministic tick packing.")
        return (book_num * 1_000_000_000) + (chapter_num * 100_000) + (scene_num * 1_000) + shot_num

    @staticmethod
    def compute_linear_story_tick(previous_max_story_tick: int) -> int:
        """Standard present-day chronological progression leaves a gap of 1000 ticks."""
        return previous_max_story_tick + 1000

    @staticmethod
    def compute_flashback_story_tick(
        after_chronological_tick: int,
        before_chronological_tick: int,
        shot_offset: int = 1,
        total_flashback_shots: int = 10
    ) -> int:
        """
        Inserts a flashback cleanly between two historical story ticks without re-indexing the DB.
        """
        gap = before_chronological_tick - after_chronological_tick
        if gap <= total_flashback_shots:
            raise ValueError("Tick gap exhausted; run background tick-rebalancing job.")
        step = gap // (total_flashback_shots + 1)
        return after_chronological_tick + (step * shot_offset)
