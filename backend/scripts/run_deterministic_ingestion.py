"""
Deterministic Ingestion Pipeline Runner (Checkpoint 1).
Parses a book from Books/, uploads raw/parsed assets to Cloudflare R2,
and tracks progress in Supabase PostgreSQL catalog.
"""

import os
import sys
import json
import uuid
import asyncio
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.phase2_ingestion.deterministic_parser import DeterministicNovelParser
from app.services.r2_storage import get_r2_storage

load_dotenv("backend/.env")


async def ingest_book(epub_or_pdf_path: str, custom_slug: Optional[str] = None):
    p = Path(epub_or_pdf_path)
    if not p.exists():
        print(f"❌ File not found: {p}")
        return

    slug = custom_slug or p.stem.lower().replace(" ", "-").replace("(", "").replace(")", "").replace(".", "-")[:50]
    title = p.stem.replace("_", " ")

    print(f"\n=======================================================")
    print(f"📖 Starting Deterministic Ingestion: {title}")
    print(f"🔑 Slug: {slug}")
    print(f"📁 Path: {p}")
    print(f"=======================================================\n")

    # 1. Parse Chapters
    print("⏳ Stage 1: Deterministic Parsing (Zero-LLM CPU)...")
    parser = DeterministicNovelParser(p)
    chapters = parser.parse()
    real_chapters = [c for c in chapters if not c.is_frontmatter]
    print(f"✅ Found {len(chapters)} total sections ({len(real_chapters)} story chapters, {len(chapters) - len(real_chapters)} front/backmatter).")

    # 2. Upload to Cloudflare R2
    print("\n⏳ Stage 2: Uploading Raw & Parsed Artifacts to Cloudflare R2...")
    r2 = get_r2_storage()
    book_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, slug))

    raw_key = r2.key_raw(book_id, p.name)
    r2.upload_file(p, raw_key)
    print(f"  ☁️ Uploaded raw file -> R2: {raw_key}")

    manifest_chapters = []
    for ch in chapters:
        ch_key = r2.key_parsed_chapter(book_id, ch.chapter_index)
        r2.put_text(ch_key, ch.markdown, content_type="text/markdown; charset=utf-8")
        manifest_chapters.append({
            "chapter_index": ch.chapter_index,
            "title": ch.title,
            "filename": ch.filename,
            "r2_key": ch_key,
            "word_count": ch.word_count,
            "char_count": ch.char_count,
            "is_frontmatter": ch.is_frontmatter,
            "has_scene_breaks": ch.has_scene_breaks,
            "sub_parts_count": len(ch.sub_parts)
        })

    manifest = {
        "book_id": book_id,
        "slug": slug,
        "title": title,
        "source_filename": p.name,
        "format": parser.format.upper(),
        "total_sections": len(chapters),
        "total_story_chapters": len(real_chapters),
        "total_words": sum(c.word_count for c in chapters),
        "chapters": manifest_chapters
    }

    manifest_key = r2.key_parsed_manifest(book_id)
    r2.put_json(manifest_key, manifest)
    print(f"  ☁️ Uploaded manifest ({len(chapters)} chapters) -> R2: {manifest_key}")

    # 3. Register in Supabase
    print("\n⏳ Stage 3: Upserting Book in Supabase books_catalog & creating Ingestion Job...")
    db_url = os.getenv("DATABASE_URL")
    engine = create_async_engine(db_url, echo=False)
    
    async with engine.begin() as conn:
        # Upsert into books_catalog
        upsert_query = text("""
            INSERT INTO public.books_catalog (
                book_id, slug, title, author, source_filename, format,
                total_chapters, status, r2_raw_key, r2_manifest_key, metadata_json, updated_at
            ) VALUES (
                :book_id, :slug, :title, :author, :source_filename, :format,
                :total_chapters, 'PARSED', :r2_raw_key, :r2_manifest_key, :metadata_json, NOW()
            )
            ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title,
                total_chapters = EXCLUDED.total_chapters,
                status = 'PARSED',
                r2_raw_key = EXCLUDED.r2_raw_key,
                r2_manifest_key = EXCLUDED.r2_manifest_key,
                metadata_json = EXCLUDED.metadata_json,
                updated_at = NOW()
            RETURNING book_id;
        """)
        
        await conn.execute(upsert_query, {
            "book_id": book_id,
            "slug": slug,
            "title": title,
            "author": "Unknown",
            "source_filename": p.name,
            "format": parser.format.upper(),
            "total_chapters": len(real_chapters),
            "r2_raw_key": raw_key,
            "r2_manifest_key": manifest_key,
            "metadata_json": json.dumps({"total_words": manifest["total_words"]})
        })

        # Insert or reset job
        job_query = text("""
            INSERT INTO public.ingestion_jobs (
                book_id, status, current_step, last_completed_chapter, glossary_r2_key, started_at
            ) VALUES (
                :book_id, 'PENDING', 'EXTRACTION', 0, :glossary_r2_key, NOW()
            )
            RETURNING job_id;
        """)
        job_res = await conn.execute(job_query, {
            "book_id": book_id,
            "glossary_r2_key": r2.key_rolling_glossary(book_id)
        })
        job_id = job_res.scalar()

    await engine.dispose()
    print(f"✅ Supabase Catalog updated: Book ID = {book_id}")
    print(f"✅ Ingestion Job initialized: Job ID = {job_id} (Status: PENDING for EXTRACTION)")
    print(f"\n🎉 CHECKPOINT 1 COMPLETED SUCCESSFULLY FOR: {title}")


if __name__ == "__main__":
    test_path = "Books/The Alchemist (25th Anniversary ed.) by Paulo Coelho.epub"
    if len(sys.argv) > 1:
        test_path = sys.argv[1]
    asyncio.run(ingest_book(test_path))
