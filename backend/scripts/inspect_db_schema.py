import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as session:
        res = await session.execute(text("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'domain_fiction' AND table_name = 'shots'
            ORDER BY ordinal_position;
        """))
        print("domain_fiction.shots columns:")
        for r in res.fetchall():
            print(f"  {r[0]}: {r[1]}")

asyncio.run(check())

