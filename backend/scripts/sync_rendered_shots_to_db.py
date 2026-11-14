import asyncio
import os
from pathlib import Path
from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.models.core_sources import DocumentUnit
from app.models.domain_fiction import FictionScene, FictionShot

async def sync():
    async with AsyncSessionLocal() as session:
        # 1. Update Chapter 1 shots
        doc1 = (await session.execute(select(DocumentUnit).where(DocumentUnit.unit_number == 1))).scalars().first()
        if doc1:
            scenes1 = (await session.execute(select(FictionScene).where(FictionScene.chapter_unit_id == doc1.unit_id))).scalars().all()
            shots1 = (await session.execute(select(FictionShot).where(FictionShot.scene_id.in_([s.scene_id for s in scenes1])).order_by(FictionShot.shot_number_in_chapter))).scalars().all()
            
            ch1_files = {
                1: "output/shots/SHOT_001_SUNNY_BENCH_00001_.png",
                2: "output/shots/chapter_001/SHOT_002_SUNNY_ENTRANCE_00001_.png",
                3: "output/shots/chapter_001/SHOT_003_LOBBY_ENTRANCE_00001_.png",
                4: "output/shots/chapter_001/SHOT_004_OFFICER_PANIC_00001_.png",
                5: "output/shots/chapter_001/SHOT_005_CODE_BLACK_STROBE_00001_.png",
                6: "output/shots/chapter_001/SHOT_006_SPELL_LORE_VISTA_00001_.png",
                7: "output/shots/chapter_001/SHOT_007_NIGHTMARE_BEAST_SHADOW_00001_.png",
                8: "output/shots/chapter_001/SHOT_008_TACTICAL_ESCORT_00001_.png",
                9: "output/shots/chapter_001/SHOT_009_RESTRAINED_CHAIR_00001_.png",
                10: "output/shots/chapter_001/SHOT_010_OBSERVATION_GLASS_00001_.png",
                11: "output/shots/chapter_001/SHOT_011_SLUMBER_CLOSEUP_00001_.png",
                12: "output/shots/chapter_001/SHOT_012_SPELL_VOID_AWAKENING_00001_.png",
            }
            for s in shots1:
                num = s.shot_number_in_chapter or s.shot_number
                if num in ch1_files and os.path.exists(ch1_files[num]):
                    s.rendered_image_path = ch1_files[num]
                    s.render_status = "COMPLETED"
                    print(f"Synced Ch1 Shot #{num} -> {ch1_files[num]}")
        
        # 2. Update Chapter 2 shots
        doc2 = (await session.execute(select(DocumentUnit).where(DocumentUnit.unit_number == 2))).scalars().first()
        if doc2:
            scenes2 = (await session.execute(select(FictionScene).where(FictionScene.chapter_unit_id == doc2.unit_id))).scalars().all()
            shots2 = (await session.execute(select(FictionShot).where(FictionShot.scene_id.in_([s.scene_id for s in scenes2])).order_by(FictionShot.shot_number_in_chapter))).scalars().all()
            
            ch2_files = {
                1: "output/shots/chapter_002/CH2_SHOT_001_MOUNTAIN_PEAK_00001_.png",
                2: "output/shots/chapter_002/CH2_SHOT_002_SLAVE_COLUMN_MARCH_00001_.png",
                3: "output/shots/chapter_002/CH2_SHOT_003_SUNNY_BLEEDING_CHAINS_00001_.png",
                4: "output/shots/chapter_002/CH2_SHOT_004_TEMPLE_SLAVE_RUNES_00001_.png",
                5: "output/shots/chapter_002/CH2_SHOT_005_HERO_SOLDIER_WATER_00001_.png",
                6: "output/shots/chapter_002/CH2_SHOT_006_WHIP_STRIKE_CLIMAX_00001_.png",
            }
            for s in shots2:
                num = s.shot_number_in_chapter or s.shot_number
                if num in ch2_files and os.path.exists(ch2_files[num]):
                    s.rendered_image_path = ch2_files[num]
                    s.render_status = "COMPLETED"
                    print(f"Synced Ch2 Shot #{num} -> {ch2_files[num]}")

        await session.commit()
        print("Done syncing shots to DB!")

if __name__ == "__main__":
    asyncio.run(sync())

