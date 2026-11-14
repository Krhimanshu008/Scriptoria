import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def add_render_columns():
    async with AsyncSessionLocal() as session:
        print("Adding render columns to domain_fiction.shots if not exists...")
        await session.execute(text("""
            ALTER TABLE domain_fiction.shots 
            ADD COLUMN IF NOT EXISTS rendered_image_path TEXT NULL,
            ADD COLUMN IF NOT EXISTS render_status TEXT DEFAULT 'PENDING';
        """))
        await session.commit()
        print("Successfully added rendered_image_path and render_status to domain_fiction.shots!")

if __name__ == "__main__":
    asyncio.run(add_render_columns())

