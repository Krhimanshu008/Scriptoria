# app/services/phase1_core/node_resolver.py
from uuid import UUID
from typing import Optional, List, Protocol, Union
from sqlalchemy import select, func, or_, cast, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.core_knowledge import KnowledgeNode, NodeCategory


class EmbeddingClient(Protocol):
    async def get_embedding(self, text: str) -> list[float]:
        ...

class LLMArbitrator(Protocol):
    async def verify_entity_identity(
        self,
        existing_name: str,
        existing_summary: str,
        new_name: str,
        new_summary: str
    ) -> bool:
        ...

class NodeResolutionService:
    def __init__(
        self,
        session: AsyncSession,
        embedding_client: Optional[EmbeddingClient] = None,
        llm_arbitrator: Optional[LLMArbitrator] = None
    ):
        self.session = session
        self.embedder = embedding_client
        self.llm = llm_arbitrator

    async def resolve_or_create_node(
        self,
        workspace_id: UUID,
        category: Union[NodeCategory, str],
        proposed_name: str,
        proposed_aliases: List[str],
        proposed_summary: str,
    ) -> KnowledgeNode:
        cat_enum = category if isinstance(category, NodeCategory) else NodeCategory(category)
        cat_val = cat_enum.value

        """
        3-Tier Resolution:
        1. Exact / Alias Match (O(1) DB lookup)
        2. Vector Semantic Match via pgvector (Cosine Distance < 0.12)
        3. LLM Disambiguation for Gray-Zone Matches (Distance 0.12 to 0.25)
        """
        all_names = [proposed_name.lower().strip()] + [a.lower().strip() for a in proposed_aliases]

        # TIER 1: Exact Canonical Name or Alias Match
        stmt_exact = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == workspace_id,
            KnowledgeNode.category == cat_enum,
            or_(
                func.lower(KnowledgeNode.canonical_name).in_(all_names),
                KnowledgeNode.aliases.overlap(cast(proposed_aliases + [proposed_name], ARRAY(Text)))
            )
        )

        existing_node = (await self.session.execute(stmt_exact)).scalars().first()
        if existing_node:
            await self._merge_aliases(existing_node, proposed_name, proposed_aliases)
            return existing_node

        query_vector = None
        # TIER 2: Semantic Vector Similarity Search in pgvector
        if self.embedder:
            embed_text = f"{cat_val}: {proposed_name} | Aliases: {', '.join(proposed_aliases)} | {proposed_summary}"
            query_vector = await self.embedder.get_embedding(embed_text)

            distance_col = KnowledgeNode.embedding.cosine_distance(query_vector).label("distance")
            stmt_vector = (
                select(KnowledgeNode, distance_col)
                .where(
                    KnowledgeNode.workspace_id == workspace_id,
                    KnowledgeNode.category == cat_enum,
                    KnowledgeNode.embedding.isnot(None)
                )
                .order_by(distance_col.asc())
                .limit(3)
            )
            candidates = (await self.session.execute(stmt_vector)).all()

            if candidates:
                best_node, best_distance = candidates[0]
                # Auto-merge if high confidence semantic match
                if best_distance < 0.12:
                    await self._merge_aliases(best_node, proposed_name, proposed_aliases)
                    return best_node

                # TIER 3: Gray-Zone LLM Arbitrator (0.12 <= distance <= 0.25)
                if best_distance <= 0.25 and self.llm:
                    is_same = await self.llm.verify_entity_identity(
                        existing_name=best_node.canonical_name,
                        existing_summary=best_node.canonical_summary or "",
                        new_name=proposed_name,
                        new_summary=proposed_summary
                    )
                    if is_same:
                        await self._merge_aliases(best_node, proposed_name, proposed_aliases)
                        return best_node

        # No match found -> Create new Canonical Node
        new_code = await self._generate_node_code(workspace_id, cat_enum)
        new_node = KnowledgeNode(
            workspace_id=workspace_id,
            node_code=new_code,
            category=cat_enum,
            canonical_name=proposed_name,
            aliases=list(set(proposed_aliases)),
            canonical_summary=proposed_summary,
            embedding=query_vector
        )
        self.session.add(new_node)
        await self.session.flush()
        return new_node

    async def _merge_aliases(self, node: KnowledgeNode, new_name: str, new_aliases: List[str]):
        updated = set(node.aliases or [])
        if new_name.lower() != node.canonical_name.lower():
            updated.add(new_name)
        updated.update(new_aliases)
        node.aliases = list(updated)
        await self.session.flush()

    async def _generate_node_code(self, workspace_id: UUID, category: NodeCategory) -> str:
        prefix_map = {
            NodeCategory.PERSON_OR_CHARACTER: "CHAR",
            NodeCategory.LOCATION: "LOC",
            NodeCategory.ITEM_OR_ARTIFACT: "ITEM",
            NodeCategory.OUTFIT_OR_ARMOR: "OUTFIT",
            NodeCategory.ENVIRONMENT: "ENV",
            NodeCategory.FACTION: "FACT",
            NodeCategory.CONCEPT_OR_THEORY: "CON",
            NodeCategory.MATHEMATICAL_FORMULA: "FORM",
            NodeCategory.SYSTEM_OR_COMPONENT: "COMP",
            NodeCategory.PROCESS_OR_ALGORITHM: "PROC",
            NodeCategory.HISTORICAL_EVENT: "EVT",
        }
        prefix = prefix_map.get(category, "NODE")
        # Count existing nodes of this category in this workspace
        count_stmt = select(func.count(KnowledgeNode.node_id)).where(
            KnowledgeNode.workspace_id == workspace_id,
            KnowledgeNode.category == category
        )
        count = (await self.session.execute(count_stmt)).scalar() or 0
        return f"{prefix}-{count + 1:04d}"
