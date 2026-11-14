import os
import sys
import json
import time
import re
import urllib.request
from dotenv import load_dotenv

# Load backend env
load_dotenv('backend/.env')

from backend.app.services.r2_storage import R2StorageService
from backend.app.models.canonical_protocol import ChapterObservation

TUNNEL = os.environ.get("VM_TUNNEL_URL", "https://chelsea-powerseller-beverly-carries.trycloudflare.com")
SECRET = os.environ.get("VM_SECRET", "eeb288702cd3eb78f228691342fd46319ee50a94ddcdc54e")
BOOK_ID = "21af9bba-9158-5e28-8da9-589130815b6a"
CHAPTER_KEY = f"parsed/{BOOK_ID}/ch_001.md"
TARGET_PORT = "8191"  # Qwen 3.5-4B Extractor

EXTRACTION_SYSTEM_PROMPT = """You are Scriptoria's Canonical Narrative Extraction Engine.
Analyze the provided novel chapter text and extract a strict structured ChapterObservation JSON object.

Output MUST be a single raw JSON object conforming exactly to this structure:
{
  "schema_version": "1.0.0",
  "book_id": "<book_id>",
  "chapter_index": 1,
  "chapter_title": "Chapter 1",
  "raw_text_r2_key": "<raw_text_r2_key>",
  "scenes": [
    {
      "scene_id": "ch001_sc01",
      "scene_order_in_chapter": 1,
      "start_char_offset": 0,
      "end_char_offset": <int>,
      "verbatim_excerpt_summary": "1-2 sentence neutral summary of scene",
      "setting": {
        "location_id": "loc_abandoned_church",
        "location_name": "Abandoned Church Sacristy",
        "time_of_day": "dusk",
        "weather_atmosphere": "clear, starry night",
        "lighting": "starlight through half-destroyed roof",
        "color_palette": ["#1A1A2E", "#E2B714"]
      },
      "characters_present": [
        {
          "entity_id": "char_santiago",
          "name_in_scene": "The boy",
          "action": "reaching church, drinking wine, digging at sycamore root",
          "emotional_state": "peaceful, reflective, determined",
          "visual_changes": "dressed in tatters",
          "clothing_mention": "tatters"
        }
      ],
      "items_interacted": [
        {
          "item_id": "item_shovel",
          "item_name": "shovel",
          "held_by_entity_id": "char_santiago",
          "condition": "intact"
        }
      ],
      "key_visual_beats": [
        {
          "beat_order": 1,
          "shot_suggestion": "Wide shot of solitary boy arriving at ruined church under starry sky",
          "focal_elements": ["ruined church", "sycamore tree", "stars", "boy with shovel"],
          "quote_anchor": "The boy reached the small, abandoned church just as night was falling."
        }
      ],
      "time_clue": {
        "raw_text": "just as night was falling",
        "time_type": "PRESENT",
        "delta_hint": "dusk"
      }
    }
  ],
  "discovered_entities": [
    {
      "entity_id": "char_santiago",
      "canonical_name": "Santiago",
      "aliases": ["The boy"],
      "entity_type": "CHARACTER",
      "static_traits": "young Andalusian shepherd boy with recurrent dreams",
      "chapter_state_delta": {
        "outfit": "tatters",
        "wealth": "chest of Spanish gold coins, masks, and jewels"
      }
    }
  ],
  "time_clues": [
    {
      "raw_text": "just as night was falling",
      "time_type": "PRESENT",
      "delta_hint": "dusk"
    }
  ],
  "location_clues": [
    {
      "raw_text": "small, abandoned church... sycamore was still there in the sacristy",
      "parent_hint": "Andalusia",
      "environment_tags": ["exterior", "abandoned", "ruin", "sycamore"]
    }
  ]
}

CRITICAL RULES:
1. Output ONLY the JSON object. Do NOT wrap in markdown fences. Do NOT add commentary.
2. Character offsets must accurately reference the chapter text.
3. Every scene MUST have at least 1 key visual beat.
4. Use valid enum values: time_type in ["PRESENT", "FLASHBACK", "DREAM", "TIME_SKIP", "PARALLEL_POV"].
5. entity_type in ["CHARACTER", "LOCATION", "ITEM", "FACTION"].
"""

def extract_chapter_observation():
    r2 = R2StorageService()
    print(f"1. Fetching chapter text from R2: {CHAPTER_KEY}...")
    chapter_text = r2.get_text(CHAPTER_KEY)
    print(f"   Loaded {len(chapter_text)} characters.")

    user_prompt = f"""Extract the ChapterObservation for this novel chapter:
Book ID: {BOOK_ID}
Chapter Index: 1
Chapter Title: Chapter 1
R2 Key: {CHAPTER_KEY}

CHAPTER TEXT:
{chapter_text}
"""

    prompt = f"<|im_start|>system\n{EXTRACTION_SYSTEM_PROMPT}<|im_end|>\n<|im_start|>user\n{user_prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n</think>\n{{"

    payload = {
        "prompt": prompt,
        "n_predict": 1800,
        "temperature": 0.1,
        "stream": False
    }

    headers = {
        "X-VM-Secret": SECRET,
        "X-Target-Port": TARGET_PORT,
        "Content-Type": "application/json"
    }

    print(f"\n2. Dispatching extraction request to Qwen 3.5-4B Extractor on Cloud GPU ({TUNNEL} -> port {TARGET_PORT})...")
    t0 = time.time()
    req = urllib.request.Request(
        f"{TUNNEL}/completion",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            dur = time.time() - t0
            raw_res = json.loads(res.read().decode("utf-8"))
            raw_content = "{" + raw_res.get("content", "").strip()
            timings = raw_res.get("timings", {})
            tok_s = timings.get("predicted_per_second", 0)
            n_tokens = timings.get("predicted_n", 0)
            print(f"   Inference completed in {round(dur, 2)}s ({n_tokens} tokens @ {round(tok_s, 1)} tok/s).")

            # Clean any stray <think> or markdown code blocks
            clean_json_str = raw_content
            if "<think>" in clean_json_str:
                clean_json_str = re.sub(r"<think>.*?</think>", "", clean_json_str, flags=re.DOTALL).strip()
            if "```" in clean_json_str:
                clean_json_str = re.sub(r"^```(?:json)?\s*", "", clean_json_str)
                clean_json_str = re.sub(r"\s*```$", "", clean_json_str).strip()

            # Find outer JSON bounds
            first_brace = clean_json_str.find("{")
            last_brace = clean_json_str.rfind("}")
            if first_brace != -1 and last_brace != -1:
                clean_json_str = clean_json_str[first_brace:last_brace+1]

            print("3. Validating JSON against Canonical Pydantic Protocol (ChapterObservation)...")
            parsed_dict = json.loads(clean_json_str)
            obs = ChapterObservation.model_validate(parsed_dict)
            print("   ✅ VALIDATION SUCCESS! Pydantic model successfully validated 100% compliant.")

            # 4. Upload validated observation to R2
            out_key = f"extracted/{BOOK_ID}/ch_001_obs.json"
            print(f"4. Uploading validated observation to Cloudflare R2: {out_key}...")
            r2.put_json(out_key, obs.model_dump())
            print(f"   ✅ Saved to R2: {out_key}")

            print("\n================ EXTRACTION SUMMARY ================")
            print(f"Book ID: {obs.book_id}")
            print(f"Scenes Extracted: {len(obs.scenes)}")
            for idx, sc in enumerate(obs.scenes):
                print(f"  Scene {idx+1}: {sc.setting.location_name} ({sc.setting.time_of_day})")
                print(f"    Summary: {sc.verbatim_excerpt_summary}")
                print(f"    Characters: {[c.name_in_scene for c in sc.characters_present]}")
                print(f"    Visual Beats: {len(sc.key_visual_beats)}")
            print(f"Entities Discovered: {len(obs.discovered_entities)} ({[e.canonical_name for e in obs.discovered_entities]})")
            print("====================================================")

            # 5. Zero-Quota Safeguard: Auto-kill the VM
            print("\n5. Invoking /vm-kill on Sidecar (:9999) to conserve Kaggle GPU quota...")
            try:
                kill_req = urllib.request.Request(
                    f"{TUNNEL}/vm-kill",
                    data=b"{}",
                    headers={"X-VM-Secret": SECRET, "X-Target-Port": "9999", "Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(kill_req, timeout=5) as k_res:
                    print(f"   ✅ VM Shutdown Signal Accepted: {k_res.read().decode()}")
            except Exception as ke:
                print(f"   Note on VM shutdown: {ke}")

            return True
    except Exception as e:
        print(f"❌ Extraction error: {e}")
        if 'raw_content' in locals():
            print(f"Raw Output Preview:\n{raw_content[:500]}")
        return False

if __name__ == "__main__":
    success = extract_chapter_observation()
    if success:
        print("\nAll checks passed for Subtask 2.7!")
    sys.exit(0 if success else 1)
