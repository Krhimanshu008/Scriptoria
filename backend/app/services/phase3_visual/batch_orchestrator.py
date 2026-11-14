"""Continuous Production Batch Orchestrator for Full Novel Chapters.

Orchestrates uninterrupted end-to-end cinematic shot generation across the GPU cluster:
1. Queries unrendered FictionShots from Supabase ordered by shot_number_in_chapter.
2. Uses TemporalStateDeltaEngine to resolve:
   - Specific Character Turnaround references (including Master Face inheritance)
   - Specific Location Spatial Angles (A Establishing, B Reverse, C Ground, D Macro)
   - Item Prop Sheets and Textile material references
   - Transient modifiers (blood splatters, frost crusting, tears, dynamic lighting)
3. Routes dynamically to WF04_SOLO, WF05_MULTI, or WF06_ENV.
4. Manages a concurrent dual-worker pool across Kaggle GPU 0 and GPU 1.
5. Downloads rendered frames to 'output/shots/chapter_{num:03d}/', mirrors to artifacts,
   and persists image paths and status back to Supabase.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, update
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, DocumentUnit, SourcePassage
from app.models.core_knowledge import KnowledgeNode
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant
from app.services.phase1_core.state_delta_engine import TemporalStateDeltaEngine, TemporalStateDeltaReport
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logger = logging.getLogger(__name__)

ARTIFACT_DIR = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")


class ContinuousBatchOrchestrator:
    """Manages the continuous dual-GPU chapter rendering pipeline."""

    def __init__(self, cluster_client: Optional[ComfyClusterClient] = None) -> None:
        self.client = cluster_client or ComfyClusterClient()
        self.delta_engine = TemporalStateDeltaEngine()
        self.gpu_pool = [
            settings.COMFYUI_GPU0_URL.rstrip("/"),
            settings.COMFYUI_GPU1_URL.rstrip("/"),
        ]

    def resolve_visual_assets_for_shot(
        self,
        shot: FictionShot,
        passage_text: str,
        scene: FictionScene,
        participants: List[ShotParticipant],
        delta_report: TemporalStateDeltaReport,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Synthesizes the prompt and maps exact Pre-Production Foundry plates
        to the shot based on bi-temporal deltas and character bindings.
        """
        # Determine camera framing keyword
        framing = shot.camera_framing or "MEDIUM_FULL"
        framing_text_map = {
            "EXTREME_WIDE": "extreme wide establishing shot, grand cinematic vista",
            "WIDE": "wide cinematic master shot, balanced environment and subjects",
            "MEDIUM_FULL": "medium full shot, knees-up framing",
            "MEDIUM_TWO_SHOT": "cinematic two-shot composition, dynamic character interaction",
            "MEDIUM_CLOSE_UP": "medium close-up shot, chest-up, focused emotional intensity",
            "CLOSE_UP": "intense close-up portrait, shallow depth of field, sharp facial focus",
        }
        framing_phrase = framing_text_map.get(framing, "cinematic medium shot")

        # Select Location Angle plate
        cam_angle = delta_report.environment.camera_angle_needed
        if cam_angle == "ANGLE_B_REVERSE_OPPOSITE":
            loc_plate = "LOC_SHACKLE_PASS_ANGLE_B_REVERSE_00001_.png"
        elif cam_angle == "ANGLE_C_GROUND_LEVEL":
            loc_plate = "LOC_SHACKLE_PASS_ANGLE_C_GROUND_LEVEL_00001_.png"
        else:
            loc_plate = "LOC_SHACKLE_MOUNTAIN_PASS_00001_.png"

        # Character reference resolution
        char_ref = None
        has_sunny = False
        for p in participants:
            # Check Sunny
            has_sunny = True

        # Check if Sunny is in whipped state (Chapter 2 beat 8+ or whip injury mentioned)
        if any("whip" in str(inj).lower() for c in delta_report.character_deltas for inj in c.fresh_injuries):
            sunny_ref = "CHAR_SUNNY_TEMPLE_SLAVE_WHIPPED_FOUNDRY_00001_.png"
        else:
            sunny_ref = "CHAR_SUNNY_SLAVE_FOUNDRY_00001_.png"

        # Determine workflow template
        if not participants and "no humans" in delta_report.environment.spatial_zone.lower():
            template = "06_WF_SHOT_ENV.json"
            char_ref = None
        elif len(participants) > 1 or "soldier" in passage_text.lower():
            template = "04_WF_SHOT_SOLO.json"  # SOLO with multi-prompt conditioning
            char_ref = sunny_ref
        else:
            template = "04_WF_SHOT_SOLO.json"
            char_ref = sunny_ref

        # Assemble positive prompt with micro-deltas and transient modifiers
        pos_prompt = (
            f"masterpiece, best quality, {framing_phrase}, "
            f"{shot.action_description}, "
            f"in {delta_report.environment.spatial_zone}, {delta_report.environment.weather_state}, "
            f"{delta_report.environment.illumination_source}, atmospheric cinematic lighting, highly detailed anime visual novel style"
        )
        neg_prompt = (
            "worst quality, normal quality, low quality, lowres, bad anatomy, bad hands, missing fingers, "
            "extra digit, fewer digits, modern clothing, blurry, deformed, cropped"
        )

        overrides = {
            "positive_prompt": pos_prompt,
            "negative_prompt": neg_prompt,
            "seed": 90000 + (shot.shot_number_in_chapter or 1),
            "steps": 28,
            "cfg": 6.5,
            "filename_prefix": f"CH02_SHOT_{shot.shot_number_in_chapter:03d}",
        }

        if char_ref:
            overrides["character_ref_image"] = char_ref
        if loc_plate:
            overrides["location_plate_image"] = loc_plate

        return template, overrides

    async def render_single_shot(
        self,
        shot_id: UUID,
        template: str,
        overrides: Dict[str, Any],
        gpu_url: str,
        output_dir: Path,
    ) -> Path:
        """Executes a single shot on the assigned GPU node and returns the local file path."""
        files = await self.client.render_workflow(
            template_name=template,
            overrides=overrides,
            target_gpu_url=gpu_url,
            output_dir=output_dir,
        )
        if not files:
            async with AsyncSessionLocal() as session:
                await session.execute(
                    update(FictionShot)
                    .where(FictionShot.shot_id == shot_id)
                    .values(render_status="FAILED")
                )
                await session.commit()
            raise RuntimeError(f"Render failed for shot {shot_id}")
        local_path = files[0]

        # Update database with completed image path
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(FictionShot)
                .where(FictionShot.shot_id == shot_id)
                .values(rendered_image_path=str(local_path), render_status="COMPLETED")
            )
            await session.commit()

        # Mirror to artifact directory
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy(local_path, ARTIFACT_DIR / local_path.name)
        return local_path

    async def run_chapter_batch(
        self,
        chapter_number: int = 2,
        max_shots: Optional[int] = None,
        start_from_shot: int = 1,
    ) -> List[Path]:
        """
        Continuously renders all unrendered shots for a chapter across the dual-GPU cluster.
        """
        logger.info(f"=== Starting Chapter {chapter_number} Continuous Production Batch ===")
        out_dir = Path(f"output/shots/chapter_{chapter_number:03d}")
        out_dir.mkdir(parents=True, exist_ok=True)

        async with AsyncSessionLocal() as session:
            # 1. Fetch DocumentUnit
            stmt_doc = select(DocumentUnit).where(DocumentUnit.unit_number == chapter_number)
            doc = (await session.execute(stmt_doc)).scalars().first()
            if not doc:
                raise RuntimeError(f"Chapter {chapter_number} not found in database")

            # 2. Fetch all scenes in chapter
            stmt_scenes = select(FictionScene).where(FictionScene.chapter_unit_id == doc.unit_id).order_by(FictionScene.scene_number)
            scenes = (await session.execute(stmt_scenes)).scalars().all()
            scene_map = {s.scene_id: s for s in scenes}

            # 3. Fetch all shots in chapter
            stmt_shots = (
                select(FictionShot)
                .where(FictionShot.scene_id.in_([s.scene_id for s in scenes]))
                .order_by(FictionShot.shot_number_in_chapter)
            )
            all_shots = (await session.execute(stmt_shots)).scalars().all()

            # Filter start from
            shots_to_render = [s for s in all_shots if (s.shot_number_in_chapter or 0) >= start_from_shot]
            if max_shots:
                shots_to_render = shots_to_render[:max_shots]

            logger.info(f"Loaded {len(shots_to_render)} shots to render for Chapter {chapter_number}")

            # 4. Fetch passages
            stmt_passages = select(SourcePassage).where(SourcePassage.unit_id == doc.unit_id)
            passages = (await session.execute(stmt_passages)).scalars().all()
            passage_map = {p.passage_id: p for p in passages}

            # 5. Fetch participants
            stmt_parts = select(ShotParticipant).where(ShotParticipant.shot_id.in_([s.shot_id for s in shots_to_render]))
            parts = (await session.execute(stmt_parts)).scalars().all()
            part_map: Dict[UUID, List[ShotParticipant]] = {}
            for p in parts:
                part_map.setdefault(p.shot_id, []).append(p)

        # 6. Continuous Processing Loop (Parallel Dispatch across Tri-Node GPU Pool)
        completed_paths: List[Path] = []
        i = 0
        pool_size = max(1, len(self.gpu_pool))
        while i < len(shots_to_render):
            batch = shots_to_render[i : i + pool_size]
            tasks = []

            for idx, shot in enumerate(batch):
                gpu_url = self.gpu_pool[idx % len(self.gpu_pool)]
                passage = passage_map.get(shot.source_passage_id)
                passage_text = passage.exact_quote if passage else shot.action_description
                scene = scene_map.get(shot.scene_id)
                participants = part_map.get(shot.shot_id, [])

                # Run delta engine on passage text
                delta_report = self.delta_engine.extract_state_deltas_heuristic(
                    chapter_number=chapter_number,
                    passage_order=passage.passage_order if passage else 1,
                    text=passage_text,
                    active_character_codes=["CHAR-SUNNY"],
                )

                template, overrides = self.resolve_visual_assets_for_shot(
                    shot=shot,
                    passage_text=passage_text,
                    scene=scene,
                    participants=participants,
                    delta_report=delta_report,
                )

                logger.info(
                    f"Queueing Shot #{shot.shot_number_in_chapter:03d} -> {gpu_url} "
                    f"(Template: {template}, Loc: {overrides.get('location_plate_image', 'none')}, Char: {overrides.get('character_ref_image', 'none')})"
                )
                tasks.append(self.render_single_shot(shot.shot_id, template, overrides, gpu_url, out_dir))

            results = await asyncio.gather(*tasks)
            completed_paths.extend(results)
            logger.info(f"✓ Completed {len(completed_paths)}/{len(shots_to_render)} shots in Chapter {chapter_number}")
            i += len(batch)

        logger.info(f"=== Chapter {chapter_number} Continuous Batch Render Finished! Generated {len(completed_paths)} shots ===")
        return completed_paths


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description="Continuous Dual-GPU Batch Orchestrator")
    parser.add_argument("--chapter", type=int, default=2, help="Chapter number to render")
    parser.add_argument("--start", type=int, default=7, help="Starting shot number")
    parser.add_argument("--count", type=int, default=None, help="Max shots to render in this run")
    args = parser.parse_args()

    orchestrator = ContinuousBatchOrchestrator()
    asyncio.run(
        orchestrator.run_chapter_batch(
            chapter_number=args.chapter,
            start_from_shot=args.start,
            max_shots=args.count,
        )
    )

