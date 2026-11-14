import os
import asyncio
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv("backend/.env")

DDL = """
CREATE TABLE IF NOT EXISTS public.books_catalog (
    book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    source_filename TEXT,
    format TEXT DEFAULT 'EPUB',
    total_chapters INT DEFAULT 0,
    status TEXT DEFAULT 'REGISTERED',
    turso_db_url TEXT,
    r2_raw_key TEXT,
    r2_manifest_key TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID NOT NULL REFERENCES public.books_catalog(book_id) ON DELETE CASCADE,
    status TEXT DEFAULT 'PENDING',
    current_step TEXT DEFAULT 'PARSING',
    last_completed_chapter INT DEFAULT 0,
    glossary_r2_key TEXT,
    assigned_vm_target TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_catalog_slug ON public.books_catalog(slug);
CREATE INDEX IF NOT EXISTS idx_books_catalog_status ON public.books_catalog(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_book ON public.ingestion_jobs(book_id, status);
"""

async def apply_ddl():
    db_url = os.getenv("DATABASE_URL")
    engine = create_async_engine(db_url, echo=False)
    async with engine.begin() as conn:
        for stmt in DDL.strip().split(";"):
            clean = stmt.strip()
            if clean:
                await conn.execute(text(clean))
        print("✅ Supabase catalog tables created successfully!")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(apply_ddl())
