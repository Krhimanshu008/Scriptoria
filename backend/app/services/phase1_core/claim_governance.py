# app/services/phase1_core/claim_governance.py
from dataclasses import dataclass, field
from typing import Optional, List
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core_sources import Workspace, WorkspaceDomain
from app.models.core_knowledge import KnowledgeNode, KnowledgeClaim, EpistemicStatus, NodeState
from app.models.domain_fiction import ShotParticipant

@dataclass
class ClaimResolutionOutcome:
    claim: KnowledgeClaim
    action_taken: str  # CREATED, CORROBORATED, REJECTED_BY_CANON, RETCON_SUPERSEDED, MULTI_BOOK_VARIANT_ADDED
    superseded_claim_id: Optional[UUID] = None
    affected_fiction_shot_ids: List[UUID] = field(default_factory=list)
    variance_notice: Optional[str] = None

class ClaimGovernanceService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def record_claim(
        self,
        workspace_id: UUID,
        node_id: UUID,
        attribute_or_aspect: str,
        claim_value: str,
        epistemic_status: EpistemicStatus,
        source_passage_id: Optional[UUID] = None,
        book_id: Optional[UUID] = None,
        assumptions_or_context: Optional[str] = None,
        current_story_tick: int = 0,
        current_narrative_tick: int = 0,
    ) -> ClaimResolutionOutcome:
        # 1. Fetch Workspace Domain
        ws = await self.session.get(Workspace, workspace_id)
        if not ws:
            raise ValueError(f"Workspace {workspace_id} not found")

        # 2. Fetch existing active claims for this node + attribute
        stmt = select(KnowledgeClaim).where(
            KnowledgeClaim.node_id == node_id,
            KnowledgeClaim.attribute_or_aspect == attribute_or_aspect.lower().strip(),
            KnowledgeClaim.approval_status.in_(["PROPOSED_BY_AI", "APPROVED"])
        )
        existing_claims = list((await self.session.execute(stmt)).scalars().all())

        if ws.domain == WorkspaceDomain.FICTION_UNIVERSE:
            return await self._govern_fiction_claim(
                node_id=node_id,
                attribute=attribute_or_aspect.lower().strip(),
                new_value=claim_value.strip(),
                new_status=epistemic_status,
                existing_claims=existing_claims,
                source_passage_id=source_passage_id,
                book_id=book_id,
                context=assumptions_or_context,
                story_tick=current_story_tick,
            )
        else:
            return await self._govern_academic_or_technical_claim(
                node_id=node_id,
                attribute=attribute_or_aspect.lower().strip(),
                new_value=claim_value.strip(),
                new_status=epistemic_status,
                existing_claims=existing_claims,
                source_passage_id=source_passage_id,
                book_id=book_id,
                context=assumptions_or_context,
            )

    async def _govern_fiction_claim(
        self,
        node_id: UUID,
        attribute: str,
        new_value: str,
        new_status: EpistemicStatus,
        existing_claims: List[KnowledgeClaim],
        source_passage_id: Optional[UUID],
        book_id: Optional[UUID],
        context: Optional[str],
        story_tick: int,
    ) -> ClaimResolutionOutcome:
        for existing in existing_claims:
            # Exact same value -> Corroborate
            if existing.claim_value.lower() == new_value.lower():
                if new_status == EpistemicStatus.EXPLICIT_SOURCE_FACT:
                    existing.epistemic_status = EpistemicStatus.EXPLICIT_SOURCE_FACT
                    existing.approval_status = "APPROVED"
                await self.session.flush()
                return ClaimResolutionOutcome(claim=existing, action_taken="CORROBORATED")

            # RULE 1: Canon Protection — Block AI Creative Interpretation from overriding Confirmed Canon
            if (
                existing.epistemic_status == EpistemicStatus.EXPLICIT_SOURCE_FACT
                and new_status == EpistemicStatus.CREATIVE_INTERPRETATION
            ):
                return ClaimResolutionOutcome(
                    claim=existing,
                    action_taken="REJECTED_BY_CANON"
                )

            # RULE 2: Canonical Retcon — Explicit novel text overrides earlier AI Creative Interpretation
            if (
                existing.epistemic_status == EpistemicStatus.CREATIVE_INTERPRETATION
                and new_status == EpistemicStatus.EXPLICIT_SOURCE_FACT
            ):
                existing.approval_status = "SUPERSEDED"
                new_claim = KnowledgeClaim(
                    node_id=node_id,
                    attribute_or_aspect=attribute,
                    claim_value=new_value,
                    epistemic_status=new_status,
                    assumptions_or_context=context,
                    source_passage_id=source_passage_id,
                    book_id=book_id,
                    approval_status="APPROVED",
                )
                self.session.add(new_claim)
                await self._update_active_node_state_spec(node_id, attribute, new_value, story_tick)

                # Identify past shots where this character appeared so UI can flag them for selective inpainting
                stmt_shots = select(ShotParticipant.shot_id).where(
                    ShotParticipant.character_node_id == node_id
                )
                affected_shots = list((await self.session.execute(stmt_shots)).scalars().all())
                await self.session.flush()

                return ClaimResolutionOutcome(
                    claim=new_claim,
                    action_taken="RETCON_SUPERSEDED",
                    superseded_claim_id=existing.claim_id,
                    affected_fiction_shot_ids=affected_shots,
                )

        # No conflict -> Insert new claim
        approval = "APPROVED" if new_status == EpistemicStatus.EXPLICIT_SOURCE_FACT else "PROPOSED_BY_AI"
        new_claim = KnowledgeClaim(
            node_id=node_id,
            attribute_or_aspect=attribute,
            claim_value=new_value,
            epistemic_status=new_status,
            assumptions_or_context=context,
            source_passage_id=source_passage_id,
            book_id=book_id,
            approval_status=approval,
        )
        self.session.add(new_claim)
        await self._update_active_node_state_spec(node_id, attribute, new_value, story_tick)
        await self.session.flush()
        return ClaimResolutionOutcome(claim=new_claim, action_taken="CREATED")

    async def _govern_academic_or_technical_claim(
        self,
        node_id: UUID,
        attribute: str,
        new_value: str,
        new_status: EpistemicStatus,
        existing_claims: List[KnowledgeClaim],
        source_passage_id: Optional[UUID],
        book_id: Optional[UUID],
        context: Optional[str],
    ) -> ClaimResolutionOutcome:
        """
        Education & Research Rule: NEVER overwrite claims from different books.
        Preserve book provenance, assumptions, and alternative formulations side-by-side.
        """
        variance_notice = None
        if existing_claims:
            different_values = [c for c in existing_claims if c.claim_value.strip() != new_value.strip()]
            if different_values:
                variance_notice = (
                    f"Multi-source formulation detected for '{attribute}': "
                    f"Existing='{different_values[0].claim_value}' vs New='{new_value}'"
                )

        new_claim = KnowledgeClaim(
            node_id=node_id,
            attribute_or_aspect=attribute,
            claim_value=new_value,
            epistemic_status=new_status,
            assumptions_or_context=context,
            source_passage_id=source_passage_id,
            book_id=book_id,
            approval_status="APPROVED",
        )
        self.session.add(new_claim)
        await self.session.flush()

        action = "MULTI_BOOK_VARIANT_ADDED" if variance_notice else "CREATED"
        return ClaimResolutionOutcome(
            claim=new_claim,
            action_taken=action,
            variance_notice=variance_notice
        )

    async def evolve_node_state(
        self,
        node_id: UUID,
        new_state_code: str,
        new_state_label: str,
        transition_story_tick: int,
        revealed_narrative_tick: int,
        attribute_deltas: dict,
    ) -> NodeState:
        """
        Creates a new versioned state on the timeline (e.g., Character Armor Upgrade at Ch 12
        or Semiconductor Wafer Step 3), closing the previous state at (transition_story_tick - 1).
        """
        stmt = (
            select(NodeState)
            .where(
                NodeState.node_id == node_id,
                NodeState.valid_to_tick.is_(None)
            )
            .order_by(NodeState.valid_from_tick.desc())
        )
        current_state = (await self.session.execute(stmt)).scalars().first()

        base_spec = {}
        if current_state:
            current_state.valid_to_tick = transition_story_tick - 1
            base_spec = dict(current_state.compiled_specification or {})

        base_spec.update(attribute_deltas)

        new_state = NodeState(
            node_id=node_id,
            state_code=new_state_code,
            state_label=new_state_label,
            compiled_specification=base_spec,
            valid_from_tick=transition_story_tick,
            valid_to_tick=None,
            revealed_at_tick=revealed_narrative_tick,
            approval_status="APPROVED",
        )
        self.session.add(new_state)
        await self.session.flush()
        return new_state

    async def _update_active_node_state_spec(
        self, node_id: UUID, attribute: str, value: str, story_tick: int
    ):
        stmt = (
            select(NodeState)
            .where(
                NodeState.node_id == node_id,
                NodeState.valid_from_tick <= story_tick,
                (NodeState.valid_to_tick.is_(None)) | (NodeState.valid_to_tick >= story_tick)
            )
        )
        active_states = (await self.session.execute(stmt)).scalars().all()
        for state in active_states:
            spec = dict(state.compiled_specification or {})
            spec[attribute] = value
            state.compiled_specification = spec
