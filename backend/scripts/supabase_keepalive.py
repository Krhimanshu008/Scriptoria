"""
Supabase Free-Tier Idle Guard.
Pings the database with a lightweight SELECT 1 to ensure
the free-tier project never pauses due to 7 days of inactivity.
"""

import os
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv("backend/.env")

async def ping():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set.")
        return
    engine = create_async_engine(db_url, echo=False)
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT 1 AS alive"))
        val = res.scalar()
        print(f"[{datetime.now(timezone.utc).isoformat()}] Supabase keep-alive check: ALIVE={val == 1}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(ping())
