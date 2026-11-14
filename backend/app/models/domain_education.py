# app/models/domain_education.py
import uuid
from typing import Optional, List
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class CurriculumNode(Base):
    __tablename__ = "curriculum_nodes"
    __table_args__ = {"schema": "domain_education"}

    curr_node_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=False
    )
    parent_curr_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("domain_education.curriculum_nodes.curr_node_id"), nullable=True
    )
    tier: Mapped[str] = mapped_column(String, nullable=False)  # COURSE, MODULE, UNIT, TOPIC
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    learning_objectives: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)

class ConceptLesson(Base):
    __tablename__ = "concept_lessons"
    __table_args__ = {"schema": "domain_education"}

    lesson_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    curr_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("domain_education.curriculum_nodes.curr_node_id", ondelete="CASCADE"), nullable=False
    )
    concept_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    difficulty_level: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    synthesized_explanation: Mapped[dict] = mapped_column(JSONB, default=dict)
    key_formulas: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
