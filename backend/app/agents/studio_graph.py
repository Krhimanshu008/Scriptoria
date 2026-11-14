# app/agents/studio_graph.py
from typing import TypedDict, Annotated, List, Dict, Any, Literal, Optional
import operator
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from app.services.phase3_visual.shot_decomposer import CinematicShotSpec


# ============================================================================
# 1. SHARED BLACKBOARD AGENT STATE
# ============================================================================

class ContinuityAuditReport(BaseModel):
    is_approved: bool = Field(
        description="True ONLY if zero canon, equipment, timeline, or camera-grammar violations exist."
    )
    flagged_shot_numbers: List[int] = Field(
        default_factory=list,
        description="List of shot_number_in_chapter that violated canon or cinematography rules."
    )
    critique_directives: List[str] = Field(
        default_factory=list,
        description="Specific instructions for the Director Agent to fix each flagged shot."
    )


class StudioGraphState(TypedDict):
    # Input Context
    workspace_id: str
    book_id: str
    book_number: int
    chapter_number: int
    raw_chapter_text: str
    starting_story_tick: int

    # Blackboard Memory (Populated by Agents across turns)
    parsed_scenes: List[Dict[str, Any]]
    shot_budget_allocation: Dict[int, int]
    active_entities_registry: List[Dict[str, Any]]
    pending_new_asset_designs: List[Dict[str, Any]]
    retcon_inpaint_queue: Annotated[List[Dict[str, Any]], operator.add]

    # Cinematography & Adversarial Critique State
    draft_chapter_shots: List[Dict[str, Any]]
    continuity_audit: Optional[Dict[str, Any]]
    dop_revision_count: int
    max_dop_revisions: int

    # Governance & Audit Log
    human_approval_granted: bool
    agent_execution_log: Annotated[List[str], operator.add]


# ============================================================================
# 2. MULTI-AGENT NODE DEFINITIONS
# ============================================================================

class AutonomousNovelStudioGraph:
    def __init__(
        self,
        beat_chunker,
        pacing_allocator,
        lore_agent_runnable,
        art_director_runnable,
        dop_agent_runnable,
        critic_agent_runnable,
    ):
        self.chunker = beat_chunker
        self.allocator = pacing_allocator
        self.lore_agent = lore_agent_runnable
        self.art_director = art_director_runnable
        self.dop_agent = dop_agent_runnable
        self.critic_agent = critic_agent_runnable

    async def dramaturg_ingestion_node(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        Agent 1 (Dramaturg): Uses DiscourseBeatChunker & CinematicPacingAllocator
        to structure the chapter into Scenes, Beat Passages, and an exact 80-100 Shot Budget.
        """
        scenes = self.chunker.parse_chapter_text(state["raw_chapter_text"])
        budgets = self.allocator.allocate_shot_budgets(scenes)
        total_shots = sum(budgets.values())

        serialized_scenes = [
            {
                "scene_number": s.scene_number,
                "time_of_day": s.inferred_time_of_day,
                "is_flashback": s.is_flashback,
                "total_words": s.total_words,
                "beats": [
                    {
                        "passage_order_in_chapter": b.passage_order_in_chapter,
                        "passage_order_in_scene": b.passage_order_in_scene,
                        "text": b.text,
                        "word_count": b.word_count,
                        "kinetic_intensity": b.kinetic_intensity,
                        "dialogue_intensity": b.dialogue_intensity,
                        "allocated_shots": budgets[b.passage_order_in_chapter],
                    }
                    for b in s.beats
                ],
            }
            for s in scenes
        ]

        return {
            "parsed_scenes": serialized_scenes,
            "shot_budget_allocation": budgets,
            "agent_execution_log": [
                f"[Dramaturg Agent] Partitioned Ch.{state['chapter_number']} into {len(scenes)} Scenes "
                f"and {len(budgets)} Beats with {total_shots} allocated shots."
            ],
        }

    async def lore_and_retcon_detective_node(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        Agent 2 (Lore & Continuity Pod): Invokes MCP tools to update the Knowledge
        Graph and autonomously queue SAM2 inpainting if a retcon is discovered.
        """
        response = await self.lore_agent.ainvoke(
            {
                "workspace_id": state["workspace_id"],
                "chapter_number": state["chapter_number"],
                "parsed_scenes": state["parsed_scenes"],
                "starting_story_tick": state["starting_story_tick"],
            }
        )
        return {
            "active_entities_registry": response.get("entities", []),
            "pending_new_asset_designs": response.get("new_unapproved_assets", []),
            "retcon_inpaint_queue": response.get("retcon_tasks", []),
            "agent_execution_log": [
                f"[Lore & Retcon Agent] Synced {len(response.get('entities', []))} entities; "
                f"queued {len(response.get('retcon_tasks', []))} retroactive inpaint tasks."
            ],
        }

    async def art_department_preprod_node(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        Agent 3 (Pre-Production Art Pod): Designs reference sheet specs for any
        brand-new characters, upgraded outfits, or locations before shot composition begins.
        """
        if not state.get("pending_new_asset_designs"):
            return {
                "agent_execution_log": ["[Art Dept Agent] All chapter entities have locked canonical states."]
            }

        designed_assets = await self.art_director.ainvoke(
            {"pending_assets": state["pending_new_asset_designs"]}
        )
        return {
            "pending_new_asset_designs": designed_assets,
            "agent_execution_log": [
                f"[Art Dept Agent] Prepared {len(designed_assets)} master reference sheet specs for approval."
            ],
        }

    async def human_canon_approval_gate(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        HITL Checkpoint Node: Graph pauses before this node if new major assets were created,
        allowing human approval in the React dashboard before generating 80-100 shots.
        """
        return {
            "human_approval_granted": True,
            "agent_execution_log": ["[HITL Gate] Pre-production canonical states approved for shot production."],
        }

    async def director_of_photography_node(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        Agent 4 (DoP Agent): Generates or revises the 80-100 CinematicShotSpecs.
        If `continuity_audit` contains critiques from the Script Supervisor Agent,
        it selectively rewrites only the flagged shots!
        """
        audit = state.get("continuity_audit")
        revision_num = state.get("dop_revision_count", 0)

        shots_output: List[CinematicShotSpec] = await self.dop_agent.ainvoke(
            {
                "parsed_scenes": state["parsed_scenes"],
                "active_entities": state["active_entities_registry"],
                "previous_draft_shots": state.get("draft_chapter_shots", []),
                "critic_feedback": audit if (audit and not audit.get("is_approved")) else None,
            }
        )

        serialized_shots = [s.model_dump(mode="json") for s in shots_output]
        return {
            "draft_chapter_shots": serialized_shots,
            "dop_revision_count": revision_num + 1,
            "agent_execution_log": [
                f"[DoP Agent] Pass #{revision_num + 1}: Composed {len(serialized_shots)} cinematic shots."
            ],
        }

    async def script_supervisor_critic_node(self, state: StudioGraphState) -> Dict[str, Any]:
        """
        Agent 5 (Adversarial Continuity Critic): Audits the DoP Agent's draft shots against:
        1. Exact Bi-Temporal DB character states (`resolved_state_id`, scars, outfits, weapons).
        2. 180-degree camera rule and framing diversity (no 3 identical consecutive framings).
        3. Exact adherence to the 80-100 chapter shot budget.
        """
        audit_report: ContinuityAuditReport = await self.critic_agent.ainvoke(
            {
                "draft_shots": state["draft_chapter_shots"],
                "active_entities": state["active_entities_registry"],
                "expected_shot_count": sum(state["shot_budget_allocation"].values()),
            }
        )
        status_str = "APPROVED" if audit_report.is_approved else f"REJECTED ({len(audit_report.flagged_shot_numbers)} shots flagged)"
        return {
            "continuity_audit": audit_report.model_dump(mode="json"),
            "agent_execution_log": [
                f"[Script Supervisor Critic] Audit result: {status_str}."
            ],
        }

    # ========================================================================
    # 3. CONDITIONAL ROUTING EDGES (AUTONOMOUS DECISION GATES)
    # ========================================================================

    def route_after_art_dept(
        self, state: StudioGraphState
    ) -> Literal["human_canon_approval_gate", "director_of_photography"]:
        """Only pause for human approval if brand-new canonical states/designs were created."""
        if state.get("pending_new_asset_designs") and not state.get("human_approval_granted"):
            return "human_canon_approval_gate"
        return "director_of_photography"

    def route_after_critic_audit(
        self, state: StudioGraphState
    ) -> Literal["director_of_photography", "__end__"]:
        """
        Adversarial Self-Correction Loop:
        If the Script Supervisor rejects any shots and we haven't hit max_dop_revisions,
        route back to the Director of Photography Agent to fix the flagged shots.
        """
        audit = state.get("continuity_audit") or {}
        if audit.get("is_approved", False):
            return "__end__"
        if state.get("dop_revision_count", 0) >= state.get("max_dop_revisions", 3):
            return "__end__"
        return "director_of_photography"

    # ========================================================================
    # 4. COMPILE STATE GRAPH WITH CHECKPOINTING
    # ========================================================================

    def compile_graph(self, checkpointer=None, interrupt_for_human_approval: bool = True):
        workflow = StateGraph(StudioGraphState)

        workflow.add_node("dramaturg_ingestion", self.dramaturg_ingestion_node)
        workflow.add_node("lore_and_retcon_detective", self.lore_and_retcon_detective_node)
        workflow.add_node("art_department_preprod", self.art_department_preprod_node)
        workflow.add_node("human_canon_approval_gate", self.human_canon_approval_gate)
        workflow.add_node("director_of_photography", self.director_of_photography_node)
        workflow.add_node("script_supervisor_critic", self.script_supervisor_critic_node)

        workflow.add_edge(START, "dramaturg_ingestion")
        workflow.add_edge("dramaturg_ingestion", "lore_and_retcon_detective")
        workflow.add_edge("lore_and_retcon_detective", "art_department_preprod")

        workflow.add_conditional_edges(
            "art_department_preprod",
            self.route_after_art_dept,
            {
                "human_canon_approval_gate": "human_canon_approval_gate",
                "director_of_photography": "director_of_photography",
            },
        )
        workflow.add_edge("human_canon_approval_gate", "director_of_photography")
        workflow.add_edge("director_of_photography", "script_supervisor_critic")

        workflow.add_conditional_edges(
            "script_supervisor_critic",
            self.route_after_critic_audit,
            {
                "director_of_photography": "director_of_photography",
                "__end__": END,
            },
        )

        cp = checkpointer or MemorySaver()
        interrupts = ["human_canon_approval_gate"] if interrupt_for_human_approval else []
        return workflow.compile(checkpointer=cp, interrupt_before=interrupts)

