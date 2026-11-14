# app/models/domain_fiction.py
import uuid
from enum import Enum
from typing import Optional, List
from sqlalchemy import String, Integer, BigInteger, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.core.database import Base

class CameraFraming(str, Enum):
    EXTREME_WIDE_ESTABLISHING = "EXTREME_WIDE_ESTABLISHING"
    WIDE_MASTER = "WIDE_MASTER"
    MEDIUM_FULL = "MEDIUM_FULL"
    COWBOY_SHOT = "COWBOY_SHOT"
    MEDIUM_CLOSE_UP = "MEDIUM_CLOSE_UP"
    CLOSE_UP = "CLOSE_UP"
    EXTREME_CLOSE_UP_INSERT = "EXTREME_CLOSE_UP_INSERT"
    OVER_THE_SHOULDER = "OVER_THE_SHOULDER"
    LOW_ANGLE_HERO = "LOW_ANGLE_HERO"
    HIGH_ANGLE_VULNERABLE = "HIGH_ANGLE_VULNERABLE"
    DUTCH_ANGLE_TENSION = "DUTCH_ANGLE_TENSION"
    POV_FIRST_PERSON = "POV_FIRST_PERSON"


class StoryArc(Base):
    __tablename__ = "arcs"
    __table_args__ = {"schema": "domain_fiction"}

    arc_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=False
    )
    arc_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class StoryThread(Base):
    __tablename__ = "story_threads"
    __table_args__ = {"schema": "domain_fiction"}

    thread_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    arc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("domain_fiction.arcs.arc_id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    importance_tier: Mapped[str] = mapped_column(String, default="MAIN")

class FictionScene(Base):
    __tablename__ = "scenes"
    __table_args__ = {"schema": "domain_fiction"}

    scene_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.workspaces.workspace_id", ondelete="CASCADE"), nullable=True
    )
    chapter_unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.document_units.unit_id", ondelete="SET NULL"), nullable=True
    )
    scene_number: Mapped[int] = mapped_column(Integer, nullable=False)
    location_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id"), nullable=True
    )
    scene_start_tick: Mapped[Optional[int]] = mapped_column(BigInteger, default=0, nullable=True)
    scene_end_tick: Mapped[Optional[int]] = mapped_column(BigInteger, default=0, nullable=True)
    start_narrative_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    end_narrative_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    start_story_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    end_story_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

class FictionShot(Base):
    __tablename__ = "shots"
    __table_args__ = {"schema": "domain_fiction"}

    shot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("domain_fiction.scenes.scene_id", ondelete="CASCADE"), nullable=False
    )
    source_passage_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_sources.source_passages.passage_id", ondelete="SET NULL"), nullable=True
    )
    shot_number: Mapped[Optional[int]] = mapped_column(Integer, default=1, nullable=True)
    shot_number_in_chapter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    shot_tick: Mapped[Optional[int]] = mapped_column(BigInteger, default=0, nullable=True)
    narrative_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    story_tick: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    shot_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    camera_framing: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    lighting_and_atmosphere: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    action_description: Mapped[str] = mapped_column(Text, nullable=False)
    dialogue_snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    camera_angle: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    emotional_tone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    audio_ambience: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    rendered_image_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    render_status: Mapped[str] = mapped_column(String, default="PENDING")

class StateLoadout(Base):
    __tablename__ = "state_loadouts"
    __table_args__ = {"schema": "domain_fiction"}

    loadout_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    holder_state_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.node_states.state_id", ondelete="CASCADE"), nullable=False
    )
    slot: Mapped[str] = mapped_column(String, nullable=False)
    equipped_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    equipped_state_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.node_states.state_id", ondelete="CASCADE"), nullable=True
    )

class ShotParticipant(Base):
    __tablename__ = "shot_participants"
    __table_args__ = {"schema": "domain_fiction"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("domain_fiction.shots.shot_id", ondelete="CASCADE"), nullable=False
    )
    participant_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=True
    )
    character_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.nodes.node_id", ondelete="CASCADE"), nullable=True
    )
    participant_state_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.node_states.state_id"), nullable=True
    )
    resolved_state_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("core_knowledge.node_states.state_id"), nullable=True
    )
    current_action_in_shot: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    spatial_position: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    expression: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pose_action: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    transient_modifiers: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)

# Aliases
Scene = FictionScene
Shot = FictionShot
