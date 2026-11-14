# app/models/core_knowledge.py
import enum
import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Float, BigInteger, Text, ForeignKey, Enum, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.core.database import Base

class NodeCategory(str, enum.Enum):
    PERSON_OR_CHARACTER = "PERSON_OR_CHARACTER"
    LOCATION = "LOCATION"
    ITEM_OR_ARTIFACT = "ITEM_OR_ARTIFACT"
    OUTFIT_OR_ARMOR = "OUTFIT_OR_ARMOR"
    ENVIRONMENT = "ENVIRONMENT"
    FACTION = "FACTION"
    CONCEPT_OR_THEORY = "CONCEPT_OR_THEORY"
    MATHEMATICAL_FORMULA = "MATHEMATICAL_FORMULA"
    SYSTEM_OR_COMPONENT = "SYSTEM_OR_COMPONENT"
    PROCESS_OR_ALGORITHM = "PROCESS_OR_ALGORITHM"
    HISTORICAL_EVENT = "HISTORICAL_EVENT"

class EpistemicStatus(str, enum.Enum):
    EXPLICIT_SOURCE_FACT = "EXPLICIT_SOURCE_FACT"
    LOGICAL_INFERENCE = "LOGICAL_INFERENCE"
    CREATIVE_INTERPRETATION = "CREATIVE_INTERPRETATION"
    SIMPLIFIED_ASSUMPTION = "SIMPLIFIED_ASSUMPTION"
    ALTERNATIVE_FORMULATION = "ALTERNATIVE_FORMULATION"
    DISPUTED_CLAIM = "DISPUTED_CLAIM"
    UNRESOLVED = "UNRESOLVED"

class KnowledgeNode(Base):
    __tablename__ = "nodes"
    __table_args__ = {"schema": "core_knowledge"}

    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=False
    )
    node_code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    category: Mapped[NodeCategory] = mapped_column(
        Enum(NodeCategory, name="node_category", schema="core_knowledge", create_type=False),
        nullable=False
    )
    canonical_name: Mapped[str] = mapped_column(String, nullable=False)
    aliases: Mapped[List[str]] = mapped_column(ARRAY(Text), default=list)
    parent_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(

        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id"), nullable=True
    )
    canonical_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    claims: Mapped[List["KnowledgeClaim"]] = relationship(back_populates="node", cascade="all, delete-orphan")
    states: Mapped[List["NodeState"]] = relationship(back_populates="node", cascade="all, delete-orphan")

class KnowledgeClaim(Base):
    __tablename__ = "claims"
    __table_args__ = {"schema": "core_knowledge"}

    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    attribute_or_aspect: Mapped[str] = mapped_column(String, nullable=False)
    claim_value: Mapped[str] = mapped_column(Text, nullable=False)
    epistemic_status: Mapped[EpistemicStatus] = mapped_column(
        Enum(EpistemicStatus, name="epistemic_status", schema="core_knowledge", create_type=False),
        nullable=False
    )
    assumptions_or_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_passage_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.source_passages.passage_id"), nullable=True
    )
    book_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.books.book_id"), nullable=True
    )
    confidence_score: Mapped[float] = mapped_column(Float, default=1.0)
    approval_status: Mapped[str] = mapped_column(String, default="PROPOSED_BY_AI")  # PROPOSED_BY_AI, APPROVED, SUPERSEDED, REJECTED

    node: Mapped["KnowledgeNode"] = relationship(back_populates="claims")

class KnowledgeEdge(Base):
    __tablename__ = "edges"
    __table_args__ = {"schema": "core_knowledge"}

    edge_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=False
    )
    source_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    target_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    relationship_type: Mapped[str] = mapped_column(String, nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    edge_metadata: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)

class NodeState(Base):
    __tablename__ = "node_states"
    __table_args__ = {"schema": "core_knowledge"}

    state_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    state_code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    state_label: Mapped[str] = mapped_column(String, nullable=False)
    compiled_specification: Mapped[dict] = mapped_column(JSONB, default=dict)
    valid_from_tick: Mapped[int] = mapped_column(BigInteger, default=0)
    valid_to_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    revealed_at_tick: Mapped[int] = mapped_column(BigInteger, default=0)
    approval_status: Mapped[str] = mapped_column(String, default="PROPOSED_BY_AI")

    node: Mapped["KnowledgeNode"] = relationship(back_populates="states")

NodeClaim = KnowledgeClaim

