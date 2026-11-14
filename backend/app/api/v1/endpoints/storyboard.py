import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from app.core.database import AsyncSessionLocal
from app.models.core_sources import DocumentUnit
from app.models.domain_fiction import FictionScene, FictionShot
from app.services.phase3_visual.batch_orchestrator import ContinuousBatchOrchestrator

logger = logging.getLogger(__name__)
router = APIRouter()

class RenderRequest(BaseModel):
    chapter_number: int = 2
    start_shot: int = 1
    count: Optional[int] = 10

@router.get("/chapters")
async def list_chapters() -> List[Dict[str, Any]]:
    """List all ingested chapters with progress metrics via single aggregated query."""
    async with AsyncSessionLocal() as session:
        stmt = (
            select(
                DocumentUnit.unit_id,
                DocumentUnit.unit_number,
                DocumentUnit.title,
                func.count(func.distinct(FictionScene.scene_id)).label("scene_count"),
                func.count(FictionShot.shot_id).label("total_shots"),
                func.count(FictionShot.shot_id).filter(FictionShot.render_status == "COMPLETED").label("completed_shots"),
                func.count(FictionShot.shot_id).filter(FictionShot.render_status == "PENDING").label("pending_shots"),
                func.count(FictionShot.shot_id).filter(FictionShot.render_status == "FAILED").label("failed_shots"),
            )
            .outerjoin(FictionScene, FictionScene.chapter_unit_id == DocumentUnit.unit_id)
            .outerjoin(FictionShot, FictionShot.scene_id == FictionScene.scene_id)
            .group_by(DocumentUnit.unit_id, DocumentUnit.unit_number, DocumentUnit.title)
            .order_by(DocumentUnit.unit_number)
        )
        rows = (await session.execute(stmt)).all()

        return [
            {
                "unit_id": str(r.unit_id),
                "chapter_number": r.unit_number,
                "title": r.title,
                "scene_count": r.scene_count or 0,
                "total_shots": r.total_shots or 0,
                "completed_shots": r.completed_shots or 0,
                "pending_shots": r.pending_shots or 0,
                "failed_shots": r.failed_shots or 0,
            }
            for r in rows
        ]

@router.get("/chapters/{chapter_number}")
async def get_chapter_storyboard(chapter_number: int) -> Dict[str, Any]:
    """Retrieve full storyboard with all scenes and shots for a chapter."""
    async with AsyncSessionLocal() as session:
        stmt_doc = select(DocumentUnit).where(DocumentUnit.unit_number == chapter_number)
        doc = (await session.execute(stmt_doc)).scalars().first()
        if not doc:
            raise HTTPException(status_code=404, detail=f"Chapter {chapter_number} not found")

        stmt_scenes = select(FictionScene).where(FictionScene.chapter_unit_id == doc.unit_id).order_by(FictionScene.scene_number)
        scenes = (await session.execute(stmt_scenes)).scalars().all()
        scene_ids = [s.scene_id for s in scenes]

        stmt_shots = (
            select(FictionShot)
            .where(FictionShot.scene_id.in_(scene_ids))
            .order_by(FictionShot.shot_number_in_chapter)
        )
        shots = (await session.execute(stmt_shots)).scalars().all()

        shots_output_dir = Path("output/shots").resolve()
        shot_list = []
        for sh in shots:
            img_url = None
            if sh.rendered_image_path:
                p = Path(sh.rendered_image_path).resolve()
                try:
                    rel = p.relative_to(shots_output_dir).as_posix()
                    img_url = f"/media/shots/{rel}"
                except ValueError:
                    img_url = f"/media/shots/{p.name}"

            shot_list.append({
                "shot_id": str(sh.shot_id),
                "scene_id": str(sh.scene_id),
                "shot_number": sh.shot_number_in_chapter or sh.shot_number,
                "camera_framing": sh.camera_framing,
                "camera_angle": sh.camera_angle,
                "action_description": sh.action_description,
                "lighting_and_atmosphere": sh.lighting_and_atmosphere,
                "dialogue_snippet": sh.dialogue_snippet,
                "image_url": img_url,
                "render_status": sh.render_status,
                "narrative_tick": sh.narrative_tick,
                "story_tick": sh.story_tick,
            })

        return {
            "chapter_number": doc.unit_number,
            "title": doc.title,
            "scenes": [
                {
                    "scene_id": str(s.scene_id),
                    "scene_number": s.scene_number,
                    "start_narrative_tick": s.start_narrative_tick,
                    "end_narrative_tick": s.end_narrative_tick,
                }
                for s in scenes
            ],
            "shots": shot_list,
        }

@router.post("/render")
async def trigger_render_batch(req: RenderRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Trigger background batch rendering on Kaggle GPU 0 & GPU 1."""
    orchestrator = ContinuousBatchOrchestrator()
    background_tasks.add_task(
        orchestrator.run_chapter_batch,
        chapter_number=req.chapter_number,
        start_from_shot=req.start_shot,
        max_shots=req.count,
    )
    return {
        "status": "QUEUED",
        "chapter_number": req.chapter_number,
        "start_shot": req.start_shot,
        "count": req.count,
        "message": f"Dispatched continuous batch render for Chapter {req.chapter_number} to remote dual-GPU cluster",
    }

@router.get("/stream/{chapter_number}")
async def stream_chapter_progress(chapter_number: int):
    """Server-Sent Events (SSE) stream broadcasting storyboard generation updates."""
    async def event_generator():
        last_completed_count = -1
        while True:
            async with AsyncSessionLocal() as session:
                stmt_doc = select(DocumentUnit).where(DocumentUnit.unit_number == chapter_number)
                doc = (await session.execute(stmt_doc)).scalars().first()
                if not doc:
                    yield f"data: {json.dumps({'error': 'Chapter not found'})}\n\n"
                    break

                stmt_shots = (
                    select(
                        func.count(FictionShot.shot_id).label("total"),
                        func.count(FictionShot.shot_id).filter(FictionShot.render_status == "COMPLETED").label("completed"),
                    )
                    .join(FictionScene, FictionShot.scene_id == FictionScene.scene_id)
                    .where(FictionScene.chapter_unit_id == doc.unit_id)
                )
                stats = (await session.execute(stmt_shots)).first()
                curr_completed = stats.completed if stats else 0
                total = stats.total if stats else 0

                if curr_completed != last_completed_count:
                    last_completed_count = curr_completed
                    # Fetch recently completed shots
                    stmt_recent = (
                        select(FictionShot)
                        .join(FictionScene, FictionShot.scene_id == FictionScene.scene_id)
                        .where(FictionScene.chapter_unit_id == doc.unit_id, FictionShot.render_status == "COMPLETED")
                        .order_by(FictionShot.shot_number_in_chapter.desc())
                        .limit(5)
                    )
                    recent_shots = (await session.execute(stmt_recent)).scalars().all()

                    def get_img_url(p_str):
                        if not p_str: return None
                        p = Path(p_str).resolve()
                        try:
                            return f"/media/shots/{p.relative_to(shots_output_dir).as_posix()}"
                        except ValueError:
                            return f"/media/shots/{p.name}"

                    payload = {
                        "chapter_number": chapter_number,
                        "total_shots": total,
                        "completed_shots": curr_completed,
                        "progress_percent": round((curr_completed / max(total, 1)) * 100, 1),
                        "recent_completed": [
                            {
                                "shot_number": s.shot_number_in_chapter,
                                "image_url": get_img_url(s.rendered_image_path),
                                "action_description": s.action_description[:80],
                            }
                            for s in recent_shots
                        ],
                    }
                    yield f"data: {json.dumps(payload)}\n\n"

            await asyncio.sleep(3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
