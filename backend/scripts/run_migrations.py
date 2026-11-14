import asyncio
import os
import asyncpg
from app.core.config import settings

async def run_ddl():
    db_url = settings.DATABASE_URL
    if "[YOUR_PASSWORD]" in db_url:
        print("ERROR: Please replace [YOUR_PASSWORD] in your .env file with your actual Supabase database password.")
        return False

    # Convert SQLAlchemy URL (postgresql+asyncpg://) to standard asyncpg URL (postgresql://)
    clean_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    
    sql_path = os.path.join(os.path.dirname(__file__), "init_db.sql")
    if not os.path.exists(sql_path):
        print(f"ERROR: DDL script not found at {sql_path}")
        return False

    with open(sql_path, "r", encoding="utf-8") as f:
        ddl_script = f.read()

    print(f"Connecting to database at {clean_url.split('@')[-1]}...")
    try:
        conn = await asyncpg.connect(clean_url, ssl="require")
        print("Connected successfully! Executing Master DDL...")
        await conn.execute(ddl_script)
        print("Master DDL executed successfully!")

        # Verify tables created
        rows = await conn.fetch("""
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema IN ('core_sources', 'core_knowledge', 'domain_fiction', 'domain_education', 'core_production')
            ORDER BY table_schema, table_name;
        """)
        print(f"\nVerification: {len(rows)} tables verified across all schemas:")
        for r in rows:
            print(f"  - {r['table_schema']}.{r['table_name']}")

        await conn.close()
        return True
    except Exception as e:
        print(f"Database error: {e}")
        return False

if __name__ == "__main__":
    asyncio.run(run_ddl())

