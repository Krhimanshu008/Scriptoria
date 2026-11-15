"""
AI Studio Session Logger & Metadata Manager for Scriptoria
Logs prompts, responses, thinking traces, timestamps, and git status.
"""

import os
import sys
import json
import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DOCS_AI_STUDIO = BASE_DIR / "docs" / "ai_studio"
SESSIONS_DIR = DOCS_AI_STUDIO / "sessions"
MANIFEST_FILE = DOCS_AI_STUDIO / "sessions_manifest.json"
ACTIVE_SESSION_FILE = DOCS_AI_STUDIO / "ACTIVE_SESSION.json"

def ensure_dirs():
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

def record_session_turn(session_id: str, topic: str, prompt: str, response: str, model="gemini-4-hydrogen", thinking_level="High", extra_meta=None):
    ensure_dirs()
    timestamp = datetime.datetime.now().astimezone().isoformat()
    
    session_data = {
        "session_id": session_id,
        "topic": topic,
        "timestamp": timestamp,
        "model": model,
        "thinking_level": thinking_level,
        "prompt": prompt,
        "response": response,
        "metadata": extra_meta or {}
    }
    
    # 1. Save JSON
    json_path = SESSIONS_DIR / f"{session_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=2, ensure_ascii=False)
        
    # 2. Save Markdown transcript
    md_path = SESSIONS_DIR / f"{session_id}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# AI Studio Session: {topic}\n\n")
        f.write(f"- **Session ID:** `{session_id}`\n")
        f.write(f"- **Timestamp:** {timestamp}\n")
        f.write(f"- **Model:** `{model}` (Thinking: `{thinking_level}`)\n\n")
        f.write("## 1. Prompt Sent to Gemini 4 Hydrogen\n\n")
        f.write("```markdown\n")
        f.write(prompt.strip())
        f.write("\n```\n\n")
        f.write("## 2. Gemini 4 Hydrogen Response\n\n")
        f.write(response.strip())
        f.write("\n\n---\n")
        
    # 3. Update manifest
    manifest = {"project": "Scriptoria", "sessions": []}
    if MANIFEST_FILE.exists():
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            pass
            
    manifest["last_updated"] = timestamp
    manifest["active_session_id"] = session_id
    
    # Update or append session record
    sessions = manifest.get("sessions", [])
    existing = next((s for s in sessions if s.get("session_id") == session_id), None)
    summary_entry = {
        "session_id": session_id,
        "topic": topic,
        "last_timestamp": timestamp,
        "model": model,
        "json_path": str(json_path.relative_to(BASE_DIR)).replace("\\", "/"),
        "md_path": str(md_path.relative_to(BASE_DIR)).replace("\\", "/")
    }
    if existing:
        existing.update(summary_entry)
    else:
        sessions.append(summary_entry)
    manifest["sessions"] = sessions
    
    with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        
    # 4. Update ACTIVE_SESSION.json
    active_data = {
        "active_session_id": session_id,
        "topic": topic,
        "last_updated": timestamp,
        "status": "ACTIVE",
        "model": model,
        "thinking_level": thinking_level
    }
    with open(ACTIVE_SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump(active_data, f, indent=2, ensure_ascii=False)
        
    print(f"Recorded session {session_id} successfully to {json_path} and {md_path}")

if __name__ == "__main__":
    ensure_dirs()
    print("AI Studio session logger initialized.")
