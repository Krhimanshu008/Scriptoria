# app/core/database.py
import os
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.core.config import settings, default_postgres_url

raw_db_url = settings.DATABASE_URL
if not raw_db_url.startswith("postgresql"):
    DATABASE_URL = default_postgres_url
else:
    DATABASE_URL = raw_db_url


engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    connect_args={"ssl": "require"},
)


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    pass

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

async def init_db_extensions():
    """Ensures required schemas and extensions exist during local testing."""
    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "vector";'))
        await conn.execute(text('CREATE SCHEMA IF NOT EXISTS core_sources;'))
        await conn.execute(text('CREATE SCHEMA IF NOT EXISTS core_knowledge;'))
        await conn.execute(text('CREATE SCHEMA IF NOT EXISTS domain_fiction;'))
        await conn.execute(text('CREATE SCHEMA IF NOT EXISTS domain_education;'))
        await conn.execute(text('CREATE SCHEMA IF NOT EXISTS core_production;'))
