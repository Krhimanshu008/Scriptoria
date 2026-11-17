import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.flow_contracts import (
    FlowAspectRatio,
    FlowCompanionStatus,
    FlowConnectionState,
    FlowGenerationTask,
    FlowIngredientCategory,
    FlowIngredientRef,
    FlowIngredientSync,
    FlowIngredientSyncItem,
    FlowMediaCandidate,
    FlowMediaResultEvent,
    FlowMediaType,
    FlowModelEngine,
    FlowQueueAction,
    FlowQueueActionType,
    FlowTaskStatus,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_flow_companion_status_contract():
    status = FlowCompanionStatus()
    assert status.connection_state == FlowConnectionState.DISCONNECTED
    assert status.flow_project_id == "ea1ed436-e578-4327-9c9b-4f6b2e7e551d"
    assert status.queued_tasks_count == 0


def test_flow_ingredient_ref_sanitization():
    ref = FlowIngredientRef(
        ingredient_id="ing_1",
        mention_handle="@Detective_Kael",
        category=FlowIngredientCategory.CHARACTER,
    )
    assert ref.mention_handle == "Detective_Kael"

    with pytest.raises(ValidationError):
        FlowIngredientRef(ingredient_id="ing_2", mention_handle="  @   ")


def test_flow_media_result_event_validation():
    # Success requires candidate
    with pytest.raises(ValidationError):
        FlowMediaResultEvent(
            task_id="t1",
            project_id="p1",
            status="COMPLETED",
            prompt_used="test prompt",
            candidates=(),
        )

    # Success with candidate passes
    cand = FlowMediaCandidate(remote_url="https://lh3.googleusercontent.com/test.png")
    event = FlowMediaResultEvent(
        task_id="t1",
        project_id="p1",
        status="COMPLETED",
        prompt_used="test prompt",
        candidates=(cand,),
    )
    assert len(event.candidates) == 1

    # Failed status requires error message
    with pytest.raises(ValidationError):
        FlowMediaResultEvent(
            task_id="t2",
            project_id="p1",
            status="FAILED",
            prompt_used="failed prompt",
            error_message=None,
        )


def test_flow_queue_action_validation():
    with pytest.raises(ValidationError):
        FlowQueueAction(action=FlowQueueActionType.CANCEL_TASK, target_task_id=None)

    action = FlowQueueAction(action=FlowQueueActionType.CANCEL_TASK, target_task_id="task_123")
    assert action.target_task_id == "task_123"


def test_flow_bridge_status_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    response = client.get("/api/v1/flow-bridge/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "connection_state" in data
    assert "flow_project_id" in data


def test_flow_bridge_task_queue_and_action(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    task_payload = {
        "project_id": "proj_demo",
        "flow_project_id": "ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        "prompt": "@Detective_Kael standing in rain in cyberpunk alley",
        "media_type": "IMAGE",
        "model_engine": "NANO_BANANA",
        "aspect_ratio": "16:9",
    }
    create_resp = client.post("/api/v1/flow-bridge/tasks", json=task_payload, headers=headers)
    assert create_resp.status_code == 202
    task_data = create_resp.json()
    assert task_data["status"] == "QUEUED"
    assert "task_id" in task_data

    # Cancel task action
    action_payload = {
        "action": "CANCEL_TASK",
        "target_task_id": task_data["task_id"],
    }
    action_resp = client.post("/api/v1/flow-bridge/queue/action", json=action_payload, headers=headers)
    assert action_resp.status_code == 200
    action_data = action_resp.json()
    assert "connection_state" in action_data
    assert action_data["queued_tasks_count"] == 0


def test_flow_deck_configure_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "modelEngine": "NANO_BANANA_PRO",
        "aspectRatio": "16:9",
        "thinkingLevel": "HIGH",
        "candidateCount": 4,
    }
    resp = client.post("/api/v1/flow-bridge/deck/configure", json=payload, headers=headers)
    # Companion disconnected returns 503
    assert resp.status_code == 503
    data = resp.json()
    msg = data.get("detail") or data.get("error", {}).get("message", "")
    assert "not currently connected" in msg.lower()


def test_flow_character_sync_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "mention_handle": "CaptainAhab",
        "visual_prompt": "Bronze-complexioned whaling captain with livid scar and ivory leg",
        "generate_portrait": True,
    }
    resp = client.post("/api/v1/flow-bridge/character/sync", json=payload, headers=headers)
    assert resp.status_code == 503


def test_flow_scene_orchestrate_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "scene_id": "scene_001",
        "chapter_title": "Chapter 133: The Chase",
        "beats": [{"prompt": "Whale breaches near boat"}],
    }
    resp = client.post("/api/v1/flow-bridge/scene/orchestrate", json=payload, headers=headers)
    assert resp.status_code == 503


def test_flow_av_mux_pipeline_execution(client, tmp_path):
    from PIL import Image

    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    # Create a valid dummy image file
    dummy_img = tmp_path / "slide_1.jpg"
    img = Image.new("RGB", (128, 128), color=(20, 40, 80))
    img.save(dummy_img, format="JPEG")

    payload = {
        "project_id": "test_moby_dick",
        "chapter_id": "ch_133",
        "chapter_title": "Chapter 133: The Chase — First Day",
        "narration_text": "There she blows! there she blows! A hump like a snow-hill! It is Moby Dick!",
        "voice_preset": "am_adam",
        "visual_asset_paths": [str(dummy_img.resolve())],
    }
    resp = client.post("/api/v1/flow-bridge/av/mux", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == "test_moby_dick"
    assert data["chapter_id"] == "ch_133"
    assert data["duration_seconds"] > 0
    assert "narration_audio_path" in data
    assert data["mux_status"] in ("COMPLETED", "AUDIO_ONLY_FFMPEG_MISSING")


def test_flow_audio_default_single_narrator_fallback():
    from app.schemas.flow_contracts import FlowAudioConfig, FlowAudioVoiceMode
    from app.services.flow_tts_service import format_screenplay_transcript

    # 1. When config is default, verify it selects SINGLE_NARRATOR with Enzo
    default_config = FlowAudioConfig()
    assert default_config.voice_mode == FlowAudioVoiceMode.SINGLE_NARRATOR
    assert default_config.narrator_voice == "Enzo"

    raw_text = 'Ahab cried: "There she blows! A hump like a snow-hill!"'
    transcript, notice = format_screenplay_transcript(
        text=raw_text,
        config=default_config,
        chapter_title="Chapter 133",
    )
    assert "[Speaker: Narrator" in transcript
    assert "Using default single narrator voice: Enzo" in notice
    assert "Multi-speaker voiceover is disabled" in notice

    # 2. When SMART_MULTI_SPEAKER is chosen, verify dual speaker parsing
    multi_config = FlowAudioConfig(
        voice_mode=FlowAudioVoiceMode.SMART_MULTI_SPEAKER,
        narrator_voice="Enzo",
        character_voices={"Captain_Ahab": "Koda"},
    )
    multi_transcript, multi_notice = format_screenplay_transcript(
        text=raw_text,
        config=multi_config,
        chapter_title="Chapter 133",
    )
    assert "[Speaker: Captain_Ahab" in multi_transcript
    assert "Smart Multi-Speaker Voiceover active" in multi_notice


def test_flow_audio_generate_endpoint_contracts(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "project_id": "test_moby_dick",
        "chapter_id": "ch_133_intro",
        "chapter_title": "Chapter 133",
        "raw_text": "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse.",
        "config": {
            "model_name": "gemini-3.8-flash-lite-tts",
            "voice_mode": "SINGLE_NARRATOR",
            "narrator_voice": "Enzo",
            "language": "en",
        },
    }
    resp = client.post("/api/v1/flow-bridge/audio/generate", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == "test_moby_dick"
    assert data["chapter_id"] == "ch_133_intro"
    assert data["voice_used"] == "Enzo"
    assert data["voice_mode"] == "SINGLE_NARRATOR"
    assert any(k in data["user_notification"] for k in ("Synthesized chapter narration track", "TTS audio track", "Using default single narrator voice"))


def test_preflight_status_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    resp = client.get("/api/v1/flow-bridge/preflight/status?book_id=test_book", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "flow_project_id" in data
    assert "total_required_ingredients" in data
    assert "synced_ingredients" in data
    assert "missing_ingredients" in data
    assert "is_ready_for_storyboard_dispatch" in data
    assert len(data["ingredients"]) >= 3


def test_lookdev_generate_and_approve_lifecycle(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    gen_payload = {
        "book_id": "test_book",
        "character_id": "char_ahab",
        "canonical_name": "Captain Ahab",
        "mention_handle": "Ahab",
        "visual_tier": "TIER_1_CORE",
        "physical_description": "Grim 50s sea captain, white lightning scar, carved ivory leg",
        "wardrobe_description": "Dark wool naval coat, sea boots",
    }
    resp = client.post("/api/v1/flow-bridge/lookdev/generate", json=gen_payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["canonical_name"] == "Captain Ahab"
    assert data["mention_handle"] == "Ahab"
    assert data["tts_voice_id"] == "Fenrir"  # Automatically assigned for Ahab
    assert len(data["lookdev_poses"]) == 4

    # Test approve endpoint
    approve_payload = {
        "book_id": "test_book",
        "character_id": "char_ahab",
        "pose_name": "FRONT_PORTRAIT",
        "approved_image_url": "https://storage.googleapis.com/test/ahab_front.png",
    }
    resp2 = client.post("/api/v1/flow-bridge/lookdev/approve", json=approve_payload, headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    front_pose = next(p for p in data2["lookdev_poses"] if p["pose_name"] == "FRONT_PORTRAIT")
    assert front_pose["approved_by_user"] is True
    assert front_pose["rendered_image_url"] == "https://storage.googleapis.com/test/ahab_front.png"


def test_preflight_sync_all_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    resp = client.post("/api/v1/flow-bridge/preflight/sync-all?book_id=test_book", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "dispatched_count" in data or "message" in data


def test_extension_download_zip_endpoint(client):
    import io
    import zipfile

    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    resp = client.get("/api/v1/flow-bridge/extension/download-zip", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert "scriptoria-flow-companion.zip" in resp.headers.get("content-disposition", "")

    # Verify zip content
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    namelist = zf.namelist()
    assert "manifest.json" in namelist
    assert "config.js" in namelist
    assert "content.js" in namelist
    assert "popup.html" in namelist


def test_chapter_package_dispatch_telemetry(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "book_id": "test_book",
        "book_title": "Test Book",
        "chapter_index": 1,
        "chapter_title": "Chapter 1",
        "total_words": 500,
        "estimated_audio_duration_sec": 120,
        "screenplay_transcript": "Screenplay content",
        "narrator_voice": "Enzo",
        "media_type": "IMAGE",
        "model_engine": "NANO_BANANA",
        "aspect_ratio": "16:9",
        "candidate_count": 4,
        "total_frames": 2,
        "frames": [
            {"frame_index": 1, "scene_id": "sc01", "compiled_image_prompt": "Prompt 1"},
            {"frame_index": 2, "scene_id": "sc01", "compiled_image_prompt": "Prompt 2"},
        ],
        "characters": [],
        "auto_open_tabs": True,
    }
    resp = client.post("/api/v1/flow-bridge/chapter/package", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "connected_clients" in data
    assert "flow_connected" in data
    assert "aistudio_connected" in data


def test_sub_frame_forced_alignment_and_karaoke():
    from app.services.flow_av_pipeline import compute_sub_frame_forced_alignment

    sentence_spans = [
        "Call me Ishmael.",
        "Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
        "It is a way I have of driving off the spleen and regulating the circulation.",
    ]
    total_audio_sec = 24.5

    aligned_frames, ass_subtitles = compute_sub_frame_forced_alignment(sentence_spans, total_audio_sec)

    assert len(aligned_frames) == 3
    assert aligned_frames[0].audio_start_sec == 0.0
    assert aligned_frames[-1].audio_end_sec == total_audio_sec
    assert aligned_frames[0].audio_end_sec == aligned_frames[1].audio_start_sec
    assert aligned_frames[1].audio_end_sec == aligned_frames[2].audio_start_sec

    # Verify karaoke tokens
    assert len(aligned_frames[0].karaoke_tokens) == 3
    assert "{\\k" in ass_subtitles
    assert "[Script Info]" in ass_subtitles
    assert "PlayResY: 1080" in ass_subtitles


def test_align_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    payload = {
        "project_id": "test_moby",
        "chapter_id": "ch_001",
        "total_audio_duration_sec": 30.0,
        "sentence_spans": [
            "Call me Ishmael.",
            "Some years ago, I thought I would sail about a little.",
        ],
    }
    resp = client.post("/api/v1/flow-bridge/av/align", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_duration_sec"] == 30.0
    assert data["total_frames"] == 2
    assert len(data["frames"]) == 2
    assert "{\\k" in data["ass_subtitles_text"]




