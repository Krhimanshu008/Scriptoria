# app/models/core_sources.py
import enum
import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, ForeignKey, Enum, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.core.database import Base

class WorkspaceDomain(str, enum.Enum):
    FICTION_UNIVERSE = "FICTION_UNIVERSE"
    ACADEMIC_SUBJECT = "ACADEMIC_SUBJECT"
    RESEARCH_SYNTHESIS = "RESEARCH_SYNTHESIS"
    TECHNICAL_SYSTEM = "TECHNICAL_SYSTEM"

class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = {"schema": "core_sources"}

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)

    domain: Mapped[WorkspaceDomain] = mapped_column(
        Enum(WorkspaceDomain, name="workspace_domain", schema="core_sources", create_type=False),
        nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    books: Mapped[List["Book"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")

class Book(Base):
    __tablename__ = "books"
    __table_args__ = {"schema": "core_sources"}

    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    authors: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    edition: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    publication_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    book_order_in_workspace: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    book_metadata: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)

    workspace: Mapped["Workspace"] = relationship(back_populates="books")
    units: Mapped[List["DocumentUnit"]] = relationship(back_populates="book", cascade="all, delete-orphan")

class DocumentUnit(Base):
    __tablename__ = "document_units"
    __table_args__ = {"schema": "core_sources"}

    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.books.book_id", ondelete="CASCADE"), nullable=False
    )
    parent_unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.document_units.unit_id", ondelete="CASCADE"), nullable=True
    )
    unit_type: Mapped[str] = mapped_column(String, nullable=False)  # PART, CHAPTER, SECTION, SUBSECTION
    unit_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    page_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    page_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processing_status: Mapped[str] = mapped_column(String, default="PENDING")

    book: Mapped["Book"] = relationship(back_populates="units")
    passages: Mapped[List["SourcePassage"]] = relationship(back_populates="unit", cascade="all, delete-orphan")

class SourcePassage(Base):
    __tablename__ = "source_passages"
    __table_args__ = {"schema": "core_sources"}

    passage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.document_units.unit_id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.books.book_id", ondelete="CASCADE"), nullable=False
    )
    passage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    exact_quote: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(1536), nullable=True)

    unit: Mapped["DocumentUnit"] = relationship(back_populates="passages")
