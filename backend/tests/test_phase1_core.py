# tests/test_phase1_core.py
import pytest
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, WorkspaceDomain, Book
from app.models.core_knowledge import KnowledgeNode, NodeCategory, EpistemicStatus
from app.services.phase1_core.node_resolver import NodeResolutionService
from app.services.phase1_core.claim_governance import ClaimGovernanceService

class MockEmbedder:
    async def get_embedding(self, text: str) -> list[float]:
        # Deterministic mock 1536-dim vector for unit testing without API calls
        vec = [0.01] * 1536
        if "newton" in text.lower() or "acceleration" in text.lower():
            vec[0] = 0.99
        return vec

class MockLLMArbitrator:
    async def verify_entity_identity(self, **kwargs) -> bool:
        return True

@pytest.mark.asyncio
async def test_multi_book_physics_deduplication_and_provenance():
    async with AsyncSessionLocal() as session:
        # 1. Create Physics Subject Workspace & 2 Textbooks
        ws = Workspace(code="SUBJ-PHY-101", title="Classical Mechanics", domain=WorkspaceDomain.ACADEMIC_SUBJECT)
        session.add(ws)
        await session.flush()

        book_a = Book(workspace_id=ws.workspace_id, title="Fundamentals of Physics", authors=["Halliday", "Resnick"], edition="10th")
        book_b = Book(workspace_id=ws.workspace_id, title="An Introduction to Mechanics", authors=["Kleppner", "Kolenkow"], edition="2nd")
        session.add_all([book_a, book_b])
        await session.flush()

        resolver = NodeResolutionService(session, MockEmbedder(), MockLLMArbitrator())
        governance = ClaimGovernanceService(session)

        # 2. Extract Concept from Book A
        node_a = await resolver.resolve_or_create_node(
            workspace_id=ws.workspace_id,
            category=NodeCategory.CONCEPT_OR_THEORY.value,
            proposed_name="Newton's Second Law",
            proposed_aliases=["Law of Force and Acceleration"],
            proposed_summary="Relates net force on a body to its mass and acceleration."
        )

        # 3. Extract Same Concept under Alias from Book B -> Must resolve to the EXACT same node_id!
        node_b = await resolver.resolve_or_create_node(
            workspace_id=ws.workspace_id,
            category=NodeCategory.CONCEPT_OR_THEORY.value,
            proposed_name="Law of Force and Acceleration",
            proposed_aliases=["Second Law of Motion"],
            proposed_summary="Momentum time-derivative formulation of force."
        )
        assert node_a.node_id == node_b.node_id

        # 4. Attach Book A's simplified formula and Book B's general momentum formula
        outcome_a = await governance.record_claim(
            workspace_id=ws.workspace_id,
            node_id=node_a.node_id,
            attribute_or_aspect="mathematical_formula",
            claim_value="F_net = m * a",
            epistemic_status=EpistemicStatus.SIMPLIFIED_ASSUMPTION,
            book_id=book_a.book_id,
            assumptions_or_context="Constant mass system"
        )
        outcome_b = await governance.record_claim(
            workspace_id=ws.workspace_id,
            node_id=node_a.node_id,
            attribute_or_aspect="mathematical_formula",
            claim_value="F_net = dp / dt",
            epistemic_status=EpistemicStatus.EXPLICIT_SOURCE_FACT,
            book_id=book_b.book_id,
            assumptions_or_context="General variable-mass system"
        )

        assert outcome_a.action_taken == "CREATED"
        assert outcome_b.action_taken == "MULTI_BOOK_VARIANT_ADDED"
        assert outcome_b.variance_notice is not None
        await session.rollback()

@pytest.mark.asyncio
async def test_fiction_canon_protection_retcon_and_state_evolution():
    async with AsyncSessionLocal() as session:
        # 1. Create Novel Workspace & Protagonist Node
        ws = Workspace(code="NOVEL-SHADOW-01", title="Shadow Awakening", domain=WorkspaceDomain.FICTION_UNIVERSE)
        session.add(ws)
        await session.flush()

        char_node = KnowledgeNode(
            workspace_id=ws.workspace_id,
            node_code="CHAR-0001",
            category=NodeCategory.PERSON_OR_CHARACTER,
            canonical_name="Arthur Pendragon",
            aliases=["Arthur"]
        )
        session.add(char_node)
        await session.flush()

        governance = ClaimGovernanceService(session)

        # 2. Initialize Chapter 1 State (Tick 1000)
        state_v1 = await governance.evolve_node_state(
            node_id=char_node.node_id,
            new_state_code="CHAR-0001-S01",
            new_state_label="Chapter 1 Apprentice State",
            transition_story_tick=1000,
            revealed_narrative_tick=1000101001,
            attribute_deltas={"outfit": "linen tunic"}
        )

        # 3. Chapter 1: AI invents 'blue eyes' because author didn't mention eye color yet
        guess_outcome = await governance.record_claim(
            workspace_id=ws.workspace_id,
            node_id=char_node.node_id,
            attribute_or_aspect="eye_color",
            claim_value="blue",
            epistemic_status=EpistemicStatus.CREATIVE_INTERPRETATION,
            current_story_tick=1000
        )
        assert guess_outcome.action_taken == "CREATED"

        # 4. Chapter 14: Author explicitly writes "his emerald green eyes" -> Triggers Retcon!
        retcon_outcome = await governance.record_claim(
            workspace_id=ws.workspace_id,
            node_id=char_node.node_id,
            attribute_or_aspect="eye_color",
            claim_value="emerald green",
            epistemic_status=EpistemicStatus.EXPLICIT_SOURCE_FACT,
            current_story_tick=14000
        )
        assert retcon_outcome.action_taken == "RETCON_SUPERSEDED"
        assert retcon_outcome.superseded_claim_id == guess_outcome.claim.claim_id

        # 5. Later AI hallucination tries to set eye_color to 'brown' -> Blocked by Canon!
        blocked_outcome = await governance.record_claim(
            workspace_id=ws.workspace_id,
            node_id=char_node.node_id,
            attribute_or_aspect="eye_color",
            claim_value="brown",
            epistemic_status=EpistemicStatus.CREATIVE_INTERPRETATION,
            current_story_tick=15000
        )
        assert blocked_outcome.action_taken == "REJECTED_BY_CANON"
        assert blocked_outcome.claim.claim_value == "emerald green"

        # 6. Chapter 12 Armor Upgrade at Story Tick 12000 -> Closes State 1 at 11999, Opens State 2 at 12000
        state_v2 = await governance.evolve_node_state(
            node_id=char_node.node_id,
            new_state_code="CHAR-0001-S02",
            new_state_label="Obsidian Knight Armor State",
            transition_story_tick=12000,
            revealed_narrative_tick=1001201001,
            attribute_deltas={"outfit": "obsidian plate armor", "scars": "slash across left cheek"}
        )
        assert state_v1.valid_to_tick == 11999
        assert state_v2.valid_from_tick == 12000
        assert state_v2.compiled_specification["eye_color"] == "emerald green"
        assert state_v2.compiled_specification["outfit"] == "obsidian plate armor"
        await session.rollback()

