# app/agents/studio_tools.py
"""
Neuro-Symbolic Toolbelt for the Autonomous Novel Studio.
Wraps deterministic backend services into structured agent tools for
entity resolution, claim governance, temporal state lookups, and retcon repair.
"""

from typing import Dict, Any, List, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core_knowledge import NodeCategory, EpistemicStatus
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator
from app.services.phase1_core.node_resolver import NodeResolutionService
from app.services.phase1_core.claim_governance import ClaimGovernanceService, ClaimResolutionOutcome
from app.services.phase1_core.retcon_repair import RetconRepairEngine, ComfyUIInpaintingTask


class StudioToolbelt:
    """Provides structured tool methods for LLM agent pods."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.resolver = NodeResolutionService(session)
        self.governance = ClaimGovernanceService(session)
        self.retcon_engine = RetconRepairEngine(session)

    async def tool_resolve_or_create_entity(
        self,
        workspace_id: UUID,
        category: str,
        name: str,
        aliases: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolves an entity through 3-tier deduplication (node_code, name, vector similarity)."""
        cat_enum = NodeCategory(category) if isinstance(category, str) else category
        node = await self.resolver.resolve_or_create(
            workspace_id=workspace_id,
            category=cat_enum,
            name=name,
            aliases=aliases or [],
            description=description,
        )
        return {
            "node_id": str(node.node_id),
            "node_code": node.node_code,
            "canonical_name": node.canonical_name,
            "category": node.category.value,
        }

    async def tool_record_and_govern_claim(
        self,
        subject_node_id: UUID,
        predicate: str,
        object_value: str,
        epistemic_status: str,
        discovery_narrative_tick: int,
        valid_from_story_tick: int,
    ) -> Dict[str, Any]:
        """Submits a claim to the governance engine, checking for contradictions and canon protection."""
        status_enum = EpistemicStatus(epistemic_status)
        claim, outcome = await self.governance.process_incoming_claim(
            subject_node_id=subject_node_id,
            predicate=predicate,
            object_value=object_value,
            epistemic_status=status_enum,
            discovery_narrative_tick=discovery_narrative_tick,
            valid_from_story_tick=valid_from_story_tick,
        )
        return {
            "claim_id": str(claim.claim_id),
            "outcome": outcome.value,
            "is_canonical": claim.is_canonical,
        }

    async def tool_query_entity_state_at_tick(
        self,
        node_id: UUID,
        story_tick: int,
        narrative_tick: int,
    ) -> Dict[str, Any]:
        """Resolves the exact visual and physical DNA of an entity at a given bi-temporal coordinate."""
        state = await self.governance.resolve_state_at_tick(
            node_id=node_id,
            story_tick=story_tick,
            narrative_tick=narrative_tick,
        )
        if not state:
            return {"found": False, "node_id": str(node_id)}
        return {
            "found": True,
            "state_id": str(state.state_id),
            "state_code": state.state_code,
            "state_label": state.state_label,
            "attributes": state.attribute_deltas,
        }

    async def tool_trigger_retroactive_inpaint_queue(
        self,
        character_node_id: UUID,
        retconned_attribute: str,
        superseded_value: str,
        new_canonical_value: str,
        discovery_narrative_tick: int,
        valid_from_story_tick: int = 0,
    ) -> List[Dict[str, Any]]:
        """Traverses historical shots to generate surgical SAM2 inpainting tasks for retroactive retcons."""
        tasks = await self.retcon_engine.generate_retroactive_inpaint_queue(
            character_node_id=character_node_id,
            retconned_attribute=retconned_attribute,
            superseded_value=superseded_value,
            new_canonical_value=new_canonical_value,
            discovery_narrative_tick=discovery_narrative_tick,
            valid_from_story_tick=valid_from_story_tick,
        )
        return [
            {
                "shot_id": str(t.shot_id),
                "triage_decision": t.triage_decision.value,
                "sam2_prompt": t.sam2_segmentation_prompt,
                "positive_delta": t.inpaint_positive_prompt_delta,
                "negative_purge": t.inpaint_negative_prompt_purge,
                "denoise": t.recommended_denoise,
            }
            for t in tasks
        ]

    @staticmethod
    def tool_compute_narrative_tick(book: int, chapter: int, scene: int, shot: int) -> int:
        """Deterministic reader discovery order coordinate calculation."""
        return BiTemporalTickCalculator.compute_narrative_tick(book, chapter, scene, shot)

