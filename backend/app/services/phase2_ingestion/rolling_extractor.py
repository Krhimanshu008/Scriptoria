"""
Rolling Context Extraction Engine (v1.0.0) for Scriptoria Phase-2 Ingestion.
Coordinates sequential chapter extraction across Cloud GPU LLM workers,
maintaining an evolving RollingEntityGlossary, enforcing Pydantic canonical
protocols, validating quote anchor fidelity, and supporting sudden-death resumption.
"""

from __future__ import annotations

import os
import sys
import json
import time
import re
import logging
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional, Tuple, Callable

from pydantic import ValidationError

from backend.app.services.r2_storage import R2StorageService
from backend.app.models.canonical_protocol import (
    ChapterObservation,
    SceneObservation,
    EntityObservation,
    EntityType,
    RollingEntityGlossary,
    RollingEntityGlossaryItem,
    TimeClueType,
)

logger = logging.getLogger("Scriptoria.RollingExtractor")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

DEFAULT_SYSTEM_PROMPT = """You are Scriptoria's Canonical Narrative Extraction Engine.
Analyze the provided novel chapter text and extract a strict structured ChapterObservation JSON object.

Output MUST be a single raw JSON object conforming exactly to this structure:
{
  "schema_version": "1.0.0",
  "book_id": "<book_id>",
  "chapter_index": <int>,
  "chapter_title": "<title>",
  "raw_text_r2_key": "<raw_text_r2_key>",
  "scenes": [
    {
      "scene_id": "ch<index>_sc<order>",
      "scene_order_in_chapter": 1,
      "start_char_offset": 0,
      "end_char_offset": <int>,
      "verbatim_excerpt_summary": "1-2 sentence neutral summary of scene",
      "setting": {
        "location_id": "loc_<name>",
        "location_name": "<name>",
        "time_of_day": "<time>",
        "weather_atmosphere": "<weather>",
        "lighting": "<lighting>",
        "color_palette": ["#1A1A2E", "#E2B714"]
      },
      "characters_present": [
        {
          "entity_id": "char_<id>",
          "name_in_scene": "<name>",
          "action": "<action>",
          "emotional_state": "<state>",
          "visual_changes": "<changes or null>",
          "clothing_mention": "<clothing or null>"
        }
      ],
      "items_interacted": [
        {
          "item_id": "item_<id>",
          "item_name": "<name>",
          "held_by_entity_id": "char_<id>",
          "condition": "intact"
        }
      ],
      "key_visual_beats": [
        {
          "beat_order": 1,
          "shot_suggestion": "Cinematographic shot description",
          "focal_elements": ["element1", "element2"],
          "quote_anchor": "Exact verbatim quote from the text anchoring this shot."
        }
      ],
      "time_clue": {
        "raw_text": "<text indicating time>",
        "time_type": "PRESENT",
        "delta_hint": "<hint>"
      }
    }
  ],
  "discovered_entities": [
    {
      "entity_id": "char_<id>",
      "canonical_name": "<name>",
      "aliases": ["<alias1>"],
      "entity_type": "CHARACTER",
      "static_traits": "<traits>",
      "chapter_state_delta": {
        "outfit": "<outfit>",
        "status": "<status>"
      }
    }
  ],
  "time_clues": [
    {
      "raw_text": "<text>",
      "time_type": "PRESENT",
      "delta_hint": "<hint>"
    }
  ],
  "location_clues": [
    {
      "raw_text": "<text>",
      "parent_hint": "<parent>",
      "environment_tags": ["exterior", "ruin"]
    }
  ]
}

CRITICAL RULES:
1. Output ONLY the JSON object. Do NOT wrap in markdown fences (no ```json). Do NOT add conversational commentary.
2. Character offsets must accurately reference the chapter text.
3. Every scene MUST have at least 1 key visual beat.
4. Every visual beat MUST have an exact verbatim quote_anchor excerpted from the text.
5. Use valid enum values: time_type in ["PRESENT", "FLASHBACK", "DREAM", "TIME_SKIP", "PARALLEL_POV"].
6. entity_type in ["CHARACTER", "LOCATION", "ITEM", "FACTION"].
"""


class RollingContextExtractor:
    """
    Orchestrates end-to-end chapter extraction with rolling context,
    state glossary propagation, validation, and zero-quota shutdown.
    """

    def __init__(
        self,
        r2: Optional[R2StorageService] = None,
        tunnel_url: Optional[str] = None,
        vm_secret: Optional[str] = None,
        target_port: str = "8191",
        auto_kill_vm: bool = False,
        llm_caller: Optional[Callable[[str, int], str]] = None,
    ):
        self.r2 = r2 or R2StorageService()
        self.tunnel_url = tunnel_url or os.environ.get("VM_TUNNEL_URL", "").rstrip("/")
        self.vm_secret = vm_secret or os.environ.get("VM_SECRET", "")
        self.target_port = target_port
        self.auto_kill_vm = auto_kill_vm
        self.custom_llm_caller = llm_caller

    def load_manifest(self, book_id: str) -> dict:
        """Loads the parsed book manifest from R2."""
        key = f"parsed/{book_id}/manifest.json"
        manifest = self.r2.get_json(key)
        if not manifest:
            raise FileNotFoundError(f"Manifest not found in R2: {key}")
        return manifest

    def clean_json_output(self, raw_text: str) -> str:
        """Cleans think blocks, code fences, and extracts JSON boundaries."""
        clean = raw_text.strip()
        # Remove thinking blocks if present
        if "<think>" in clean:
            clean = re.sub(r"<think>.*?</think>", "", clean, flags=re.DOTALL).strip()

        # Remove markdown fences
        if "```" in clean:
            clean = re.sub(r"^```(?:json)?\s*", "", clean)
            clean = re.sub(r"\s*```$", "", clean).strip()

        # Isolate outer braces
        first_brace = clean.find("{")
        last_brace = clean.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            clean = clean[first_brace : last_brace + 1]

        return clean

    def build_rolling_prompt(
        self,
        book_id: str,
        chapter_index: int,
        chapter_title: str,
        raw_text_r2_key: str,
        chapter_text: str,
        glossary: RollingEntityGlossary,
        trailing_excerpt: str = "",
    ) -> str:
        """
        Assembles rolling prompt adhering to EC-2.4 (Glossary Bloat Prevention):
        carries minimal concise tags for known entities + last 200 words trailing context.
        """
        # Format compact glossary to avoid context explosion
        glossary_lines = []
        for ent in glossary.entities:
            aliases_str = f" (aliases: {', '.join(ent.aliases)})" if ent.aliases else ""
            glossary_lines.append(f"- [{ent.entity_type.value}] {ent.canonical_name}{aliases_str}: {ent.short_visual_tag}")
        glossary_block = "\n".join(glossary_lines) if glossary_lines else "None (Beginning of story)"

        trailing_block = f"\nPRECEDING CHAPTER TRANSITION (Last 200 words):\n{trailing_excerpt}\n" if trailing_excerpt else ""

        user_content = f"""Extract the ChapterObservation for this novel chapter:
Book ID: {book_id}
Chapter Index: {chapter_index}
Chapter Title: {chapter_title}
R2 Key: {raw_text_r2_key}

CURRENT KNOWN ENTITY GLOSSARY (Preserve canonical IDs and traits):
{glossary_block}
{trailing_block}
CHAPTER TEXT:
{chapter_text}
"""
        # Prefill assistant turn with <think>\n</think>\n{ to force instant raw JSON
        return f"<|im_start|>system\n{DEFAULT_SYSTEM_PROMPT}<|im_end|>\n<|im_start|>user\n{user_content}<|im_end|>\n<|im_start|>assistant\n<think>\n</think>\n{{"

    def call_cloud_gpu(self, prompt: str, max_tokens: int = 2400) -> str:
        """Dispatches prompt to llama-server via Caddy tunnel with assistant prefill."""
        if self.custom_llm_caller:
            return self.custom_llm_caller(prompt, max_tokens)

        if not self.tunnel_url:
            raise ValueError("Tunnel URL not provided and VM_TUNNEL_URL not set in environment.")

        payload = {
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": 0.1,
            "stream": False,
        }

        headers = {
            "X-VM-Secret": self.vm_secret,
            "X-Target-Port": self.target_port,
            "Content-Type": "application/json",
        }

        req = urllib.request.Request(
            f"{self.tunnel_url}/completion",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode("utf-8"))
            content = "{" + data.get("content", "").strip()
            return content

    def verify_quote_anchors(self, chapter_text: str, obs: ChapterObservation) -> dict:
        """
        Verifies that quote anchors in visual beats match verbatim substrings in chapter_text (EC-2.2).
        Returns total beats, matched beats, and match rate percentage.
        """
        # Normalize whitespace in chapter text for robust substring matching
        norm_text = re.sub(r"\s+", " ", chapter_text).lower()

        total_beats = 0
        matched_beats = 0
        unmatched_quotes = []

        for scene in obs.scenes:
            for beat in scene.key_visual_beats:
                total_beats += 1
                anchor = beat.quote_anchor.strip()
                norm_anchor = re.sub(r"\s+", " ", anchor).lower()

                # Remove leading/trailing quotes/punctuation for resilient matching
                clean_anchor = norm_anchor.strip("\"'.,-;: ")
                if len(clean_anchor) >= 5 and clean_anchor in norm_text:
                    matched_beats += 1
                elif norm_anchor in norm_text:
                    matched_beats += 1
                else:
                    unmatched_quotes.append(anchor)

        match_rate = (matched_beats / total_beats * 100.0) if total_beats > 0 else 100.0
        return {
            "total_beats": total_beats,
            "matched_beats": matched_beats,
            "match_rate": round(match_rate, 2),
            "unmatched_quotes": unmatched_quotes,
        }

    def update_glossary(
        self, glossary: RollingEntityGlossary, observation: ChapterObservation
    ) -> RollingEntityGlossary:
        """
        Integrates newly discovered entities and updates existing entity aliases/traits.
        Enforces EC-2.4 (Glossary Bloat Prevention) by truncating tags to concise summaries.
        """
        entity_map = {e.entity_id: e for e in glossary.entities}

        for ent in observation.discovered_entities:
            # Enforce max 120 chars on short_visual_tag to prevent prompt bloat
            raw_tag = ent.static_traits
            if ent.chapter_state_delta.get("outfit"):
                raw_tag += f", wearing {ent.chapter_state_delta['outfit']}"
            short_tag = raw_tag[:120].strip()

            if ent.entity_id in entity_map:
                existing = entity_map[ent.entity_id]
                # Merge new aliases uniquely
                all_aliases = list(dict.fromkeys(existing.aliases + ent.aliases))
                existing.aliases = all_aliases[:5]  # Cap at top 5 aliases
                existing.short_visual_tag = short_tag
            else:
                item = RollingEntityGlossaryItem(
                    entity_id=ent.entity_id,
                    canonical_name=ent.canonical_name,
                    aliases=ent.aliases[:5],
                    short_visual_tag=short_tag,
                    entity_type=ent.entity_type,
                )
                glossary.entities.append(item)
                entity_map[ent.entity_id] = item

        glossary.last_completed_chapter = observation.chapter_index
        return glossary

    def extract_single_chapter(
        self,
        book_id: str,
        chapter_meta: dict,
        glossary: RollingEntityGlossary,
        trailing_excerpt: str = "",
        max_retries: int = 3,
    ) -> ChapterObservation:
        """
        Extracts, validates, verifies quotes, and uploads observation for a single chapter.
        Retries on validation failure (EC-2.1).
        """
        ch_idx = chapter_meta["chapter_index"]
        ch_title = chapter_meta.get("title", f"Chapter {ch_idx}")
        r2_key = chapter_meta["r2_key"]

        logger.info(f"--> Extracting Chapter {ch_idx}: '{ch_title}' from R2 ({r2_key})...")
        chapter_text = self.r2.get_text(r2_key)
        if not chapter_text:
            raise ValueError(f"Empty or missing chapter text at R2 key: {r2_key}")

        last_err: Optional[Exception] = None

        for attempt in range(1, max_retries + 1):
            logger.info(f"   [Attempt {attempt}/{max_retries}] Prompting Cloud LLM...")
            prompt = self.build_rolling_prompt(
                book_id=book_id,
                chapter_index=ch_idx,
                chapter_title=ch_title,
                raw_text_r2_key=r2_key,
                chapter_text=chapter_text,
                glossary=glossary,
                trailing_excerpt=trailing_excerpt,
            )

            raw_output = self.call_cloud_gpu(prompt)
            clean_json = self.clean_json_output(raw_output)

            try:
                parsed = json.loads(clean_json)
                obs = ChapterObservation.model_validate(parsed)

                # Validate quote anchor fidelity (EC-2.2)
                quote_stats = self.verify_quote_anchors(chapter_text, obs)
                logger.info(
                    f"   ✅ Chapter {ch_idx} Validated! Scenes: {len(obs.scenes)}, "
                    f"Beats: {quote_stats['total_beats']}, Quote Match: {quote_stats['match_rate']}%"
                )

                # Upload observation to R2
                out_key = f"extracted/{book_id}/ch_{ch_idx:03d}_obs.json"
                self.r2.put_json(out_key, obs.model_dump())
                logger.info(f"   Saved observation to R2: {out_key}")

                return obs

            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning(f"   ⚠️ Attempt {attempt} validation failed: {e}")
                last_err = e
                time.sleep(1.0)

        raise RuntimeError(f"Failed to extract Chapter {ch_idx} after {max_retries} attempts: {last_err}")

    def resume_or_run_book(
        self,
        book_id: str,
        start_chapter: int = 1,
        max_chapters: Optional[int] = None,
    ) -> RollingEntityGlossary:
        """
        Executes rolling extraction loop across all chapters in the book manifest.
        Implements EC-2.3 (Sudden-Death Resume):
        - Detects already extracted chapters in R2 (`extracted/{book_id}/ch_{n:03d}_obs.json`).
        - Restores RollingEntityGlossary and trailing excerpt up to that point.
        - Resumes seamlessly from the next unextracted chapter.
        - Automatically shuts down the VM at completion if auto_kill_vm=True.
        """
        manifest = self.load_manifest(book_id)
        chapters = manifest.get("chapters", [])
        story_chapters = [c for c in chapters if not c.get("is_frontmatter", False)]
        story_chapters = sorted(story_chapters, key=lambda c: c["chapter_index"])

        glossary = RollingEntityGlossary(book_id=book_id, last_completed_chapter=0)
        trailing_excerpt = ""

        # Step 1: Discover existing checkpoints in R2 (Sudden-Death Resume)
        logger.info(f"Checking existing checkpoints for book {book_id} in R2...")
        for meta in story_chapters:
            idx = meta["chapter_index"]
            out_key = f"extracted/{book_id}/ch_{idx:03d}_obs.json"
            if self.r2.file_exists(out_key):
                logger.info(f"   [RESUME] Found existing Chapter {idx} in R2. Rebuilding glossary...")
                existing_obs_dict = self.r2.get_json(out_key)
                existing_obs = ChapterObservation.model_validate(existing_obs_dict)
                self.update_glossary(glossary, existing_obs)

                # Update trailing excerpt from chapter text
                text = self.r2.get_text(meta["r2_key"])
                words = text.split()
                trailing_excerpt = " ".join(words[-200:]) if len(words) > 200 else text
            else:
                break  # Stop at first unextracted chapter

        logger.info(f"Resume state: Last completed chapter = {glossary.last_completed_chapter}")

        # Step 2: Process remaining chapters
        processed_count = 0
        try:
            for meta in story_chapters:
                idx = meta["chapter_index"]
                if idx <= glossary.last_completed_chapter:
                    continue
                if idx < start_chapter:
                    continue
                if max_chapters is not None and processed_count >= max_chapters:
                    logger.info(f"Reached max_chapters limit ({max_chapters}). Pausing loop.")
                    break

                obs = self.extract_single_chapter(
                    book_id=book_id,
                    chapter_meta=meta,
                    glossary=glossary,
                    trailing_excerpt=trailing_excerpt,
                )

                self.update_glossary(glossary, obs)

                # Save updated glossary snapshot to R2
                glossary_key = f"extracted/{book_id}/rolling_glossary.json"
                self.r2.put_json(glossary_key, glossary.model_dump())

                # Update trailing excerpt for next chapter
                text = self.r2.get_text(meta["r2_key"])
                words = text.split()
                trailing_excerpt = " ".join(words[-200:]) if len(words) > 200 else text

                processed_count += 1

        finally:
            if self.auto_kill_vm:
                self.kill_vm()

        logger.info(f"Extraction loop complete. Total new chapters processed: {processed_count}.")
        return glossary

    def kill_vm(self):
        """Dispatches /vm-kill to Sidecar (:9999) to conserve cloud GPU quota."""
        if not self.tunnel_url:
            return
        logger.info(f"Quota Safeguard: Dispatching /vm-kill to Sidecar ({self.tunnel_url}:9999)...")
        try:
            req = urllib.request.Request(
                f"{self.tunnel_url}/vm-kill",
                data=b"{}",
                headers={
                    "X-VM-Secret": self.vm_secret,
                    "X-Target-Port": "9999",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as res:
                logger.info(f"   ✅ VM Shutdown Confirmed: {res.read().decode()}")
        except Exception as e:
            logger.warning(f"   Note on VM shutdown request: {e}")
