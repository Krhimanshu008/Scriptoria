# app/models/core_staging.py
import enum
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import String, Integer, BigInteger, Float, Text, ForeignKey, Enum, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StagingProcessingStatus(str, enum.Enum):
    EXTRACTED = "EXTRACTED"
    VALIDATED = "VALIDATED"
    IN_RESEARCH = "IN_RESEARCH"
    IN_CINEMATOGRAPHY = "IN_CINEMATOGRAPHY"
    READY_FOR_RENDER = "READY_FOR_RENDER"
    FLAGGED_FOR_REVIEW = "FLAGGED_FOR_REVIEW"


class StagingEntityStatus(str, enum.Enum):
    DISCOVERED = "DISCOVERED"
    APPROVED = "APPROVED"
    SUPERSEDED = "SUPERSEDED"
    REJECTED = "REJECTED"


class StagedScene(Base):
    __tablename__ = "staged_scenes"
    __table_args__ = {"schema": "staging_ingest"}

    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    book_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    scene_order_in_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    
    temporal_tick_start: Mapped[int] = mapped_column(BigInteger, default=0)
    temporal_tick_end: Mapped[int] = mapped_column(BigInteger, default=0)
    time_of_day: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    scene_type: Mapped[str] = mapped_column(String(50), default="DIALOGUE")
    scene_heading: Mapped[str] = mapped_column(String(255), default="")
    raw_text_chunk: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0)

    processing_status: Mapped[StagingProcessingStatus] = mapped_column(
        Enum(StagingProcessingStatus, name="staging_processing_status", schema="staging_ingest", create_type=False),
        default=StagingProcessingStatus.EXTRACTED,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    beats: Mapped[List["StagedBeat"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", order_by="StagedBeat.passage_order"
    )
    characters: Mapped[List["StagedCharacter"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan"
    )
    locations: Mapped[List["StagedLocation"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan"
    )
    environment: Mapped[Optional["StagedEnvironment"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", uselist=False
    )


class StagedBeat(Base):
    __tablename__ = "staged_beats"
    __table_args__ = {"schema": "staging_ingest"}

    beat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staging_ingest.staged_scenes.scene_id", ondelete="CASCADE"), nullable=False
    )
    passage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    narrative_tick: Mapped[int] = mapped_column(BigInteger, default=0)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    kinetic_intensity: Mapped[float] = mapped_column(Float, default=0.0)
    dialogue_density: Mapped[float] = mapped_column(Float, default=0.0)
    is_flashback: Mapped[bool] = mapped_column(default=False)
    time_of_day_hint: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    scene: Mapped["StagedScene"] = relationship(back_populates="beats")


class StagedCharacter(Base):
    __tablename__ = "staged_characters"
    __table_args__ = {"schema": "staging_ingest"}

    mention_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staging_ingest.staged_scenes.scene_id", ondelete="CASCADE"), nullable=False
    )
    raw_name: Mapped[str] = mapped_column(String(100), nullable=False)
    canonical_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tier: Mapped[str] = mapped_column(String(20), default="MAIN")
    emotional_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    physical_condition: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    active_posture: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    dialogue_snippets: Mapped[List[str]] = mapped_column(JSONB, default=list)

    status: Mapped[StagingEntityStatus] = mapped_column(
        Enum(StagingEntityStatus, name="staging_entity_status", schema="staging_ingest", create_type=False),
        default=StagingEntityStatus.DISCOVERED,
    )

    scene: Mapped["StagedScene"] = relationship(back_populates="characters")
    costumes: Mapped[List["StagedCostume"]] = relationship(
        back_populates="character", cascade="all, delete-orphan"
    )


class StagedCostume(Base):
    __tablename__ = "staged_costumes"
    __table_args__ = {"schema": "staging_ingest"}

    costume_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    character_mention_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staging_ingest.staged_characters.mention_id", ondelete="CASCADE"), nullable=False
    )
    headwear: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    upper_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lower_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    footwear: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    accessories_and_jewelry: Mapped[List[str]] = mapped_column(JSONB, default=list)
    equipped_weapon: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    equipped_shield: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color_palette: Mapped[List[str]] = mapped_column(JSONB, default=list)
    wear_tear_level: Mapped[str] = mapped_column(String(50), default="PRISTINE")

    character: Mapped["StagedCharacter"] = relationship(back_populates="costumes")


class StagedLocation(Base):
    __tablename__ = "staged_locations"
    __table_args__ = {"schema": "staging_ingest"}

    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staging_ingest.staged_scenes.scene_id", ondelete="CASCADE"), nullable=False
    )
    location_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="INTERIOR")
    architectural_style: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    spatial_dimensions: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    key_landmarks: Mapped[List[str]] = mapped_column(JSONB, default=list)
    floor_surface: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    status: Mapped[StagingEntityStatus] = mapped_column(
        Enum(StagingEntityStatus, name="staging_entity_status", schema="staging_ingest", create_type=False),
        default=StagingEntityStatus.DISCOVERED,
    )

    scene: Mapped["StagedScene"] = relationship(back_populates="locations")


class StagedEnvironment(Base):
    __tablename__ = "staged_environments"
    __table_args__ = {"schema": "staging_ingest"}

    env_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staging_ingest.staged_scenes.scene_id", ondelete="CASCADE"), nullable=False
    )
    primary_light_source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    lighting_quality: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    color_cast: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    weather: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    atmospheric_particles: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    wind_intensity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    audio_ambience: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    scene: Mapped["StagedScene"] = relationship(back_populates="environment")

