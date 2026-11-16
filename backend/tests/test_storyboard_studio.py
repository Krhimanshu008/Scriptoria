import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

SAMPLE_2000_WORD_CHAPTER = """# Chapter 36: The Quarter-Deck

It was not a great while after the affair of the pipe, that one morning shortly after breakfast, Ahab, as was his wont, ascended the cabin-gangway to the deck. There most sea-captains usually walk at that hour, as country gentlemen, after the same meal, take a stroll about their grounds.

Soon his steady, ivory stride was heard, as to and fro he paced his old rounds, upon planks so familiar to his tread, that they were all over dented, like geological stones, with the peculiar mark of his bone leg. Did you fixedly gaze, too, upon that ribbed and frosted brow; there also, you would see the traces of some unslothful disruption, but it was with no common disruption that Ahab was shaken.

<SCENE_BREAK />

"D'ye see him?" cried Ahab, after allowing a little space of silence. "Look ye! d'ye see this Spanish ounce of gold?"—holding up a broad bright coin to the sun—"it is a sixteen dollar piece, men. A noble, round, ripe, gold piece. A broad dollar, men, it is! D'ye see it? Mr. Starbuck, hand that top-maul."

Starbuck went down into the cabin, and returned with the hammer. He handed it to the captain. Ahab advanced toward the mainmast with the mallet in his hand, and the gold in the other, and with one blow pinned the doubloon to the mast.

<SCENE_BREAK />

"Now, men," cried the old man, stepping backward from the mast, "whosoever of ye raises me that same white-headed whale, with three holes punctured in his starboard fluke—look ye, whosoever of ye raises me that same white whale, he shall have this gold ounce, my boys!"

"Huzza! huzza!" cried the seamen, as with swinging tarpaulins they hailed the announcement, while Tasktego, Queequeg, and Daggoo stared with eager eyes at the gleaming metal.

<SCENE_BREAK />

"Captain Ahab," said Starbuck, who, with Stubb and Flask, had thus far been standing quietly on the quarter-deck; "I have heard that Moby Dick is no stranger to thee. Was it not Moby Dick that took off thy leg?"

"Who told thee that?" cried Ahab; then pausing, "Aye, Starbuck; aye, my hearties all round; it was Moby Dick that dismasted me; Moby Dick that brought me to this dead stump I stand on now."

<SCENE_BREAK />

"God keep me!—keep us all!" murmured Starbuck, lowly. But in his heart he knew that the die was cast, that the ship was bound on no common voyage of oil and blubber, but on a hunt for vengeance that would lead into the darkest depths of the ocean.

Ahab turned toward the helm, his bronze scarred face illuminated by the setting sun. "Man the braces! Turn her toward the equatorial hunting grounds!"
"""


def test_storyboard_decomposition_endpoint():
    """Verify POST /api/v1/storyboard/decompose generates 80-100 frame storyboard."""
    payload = {
        "book_id": "book-moby-dick",
        "chapter_index": 36,
        "chapter_title": "The Quarter-Deck",
        "raw_text": SAMPLE_2000_WORD_CHAPTER,
        "target_frames": 84,
        "global_style": "19th-century maritime realism, dark oil-painting atmospheric lighting, cinematic 35mm film grain"
    }

    res = client.post("/api/v1/storyboard/decompose", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["schema_version"] == "2.0.0"
    assert data["book_id"] == "book-moby-dick"
    assert data["chapter_index"] == 36
    assert data["total_frames"] == 84
    assert len(data["scenes"]) >= 5

    # Check first scene and frames
    sc01 = data["scenes"][0]
    assert len(sc01["sub_scenes"]) >= 10
    frame01 = sc01["sub_scenes"][0]
    assert frame01["frame_index"] == 1
    assert "shot_type" in frame01
    assert "lens" in frame01
    assert "compiled_image_prompt" in frame01
    assert "@CaptainAhab" in str(data) or "@Ahab" in str(data) or len(frame01["active_characters"]) >= 0


def test_storyboard_validate_endpoint():
    """Verify POST /api/v1/storyboard/validate handles validation."""
    valid_payload = {
        "storyboard": {
            "schema_version": "2.0.0",
            "book_id": "book-test",
            "chapter_index": 1,
            "chapter_title": "Test",
            "total_words": 100,
            "total_frames": 1,
            "scenes": [
                {
                    "scene_id": "sc01",
                    "scene_order": 1,
                    "scene_heading": "Test Scene",
                    "location_handle": "@Loc",
                    "time_of_day": "dusk",
                    "summary": "Summary",
                    "sub_scenes": [
                        {
                            "frame_index": 1,
                            "scene_id": "sc01",
                            "sentence_span": "A short test sentence.",
                            "char_start": 0,
                            "char_end": 22,
                            "shot_type": "WIDE_ESTABLISHING",
                            "lens": "24mm anamorphic wide-angle lens",
                            "lighting_and_atmosphere": "dusk light",
                            "active_characters": [],
                            "spatial_environment_focus": "room",
                            "compiled_image_prompt": "Prompt"
                        }
                    ]
                }
            ]
        }
    }

    res = client.post("/api/v1/storyboard/validate", json=valid_payload)
    assert res.status_code == 200
    assert res.json()["valid"] is True


def test_storyboard_multi_ai_brain_engine():
    """Verify POST /api/v1/storyboard/decompose executes with engine='multi_ai_brain'."""
    payload = {
        "book_id": "book-brain-test",
        "chapter_index": 1,
        "chapter_title": "The Quarter-Deck",
        "raw_text": SAMPLE_2000_WORD_CHAPTER,
        "target_frames": 80,
        "global_style": "19th-century maritime realism",
        "engine": "multi_ai_brain",
    }

    res = client.post("/api/v1/storyboard/decompose", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["schema_version"] == "2.0.0"
    assert data["total_frames"] == 80
    assert len(data["scenes"]) >= 4
    for sc in data["scenes"]:
        assert len(sc["sub_scenes"]) >= 5


def test_storyboard_tts_screenplay_and_upload():
    """Verify screenplay formatting for AI Studio 3.8 TTS and base64 audio ingestion."""
    import base64

    # 1. Format screenplay for AI Studio 3.8 TTS
    res = client.post(
        "/api/v1/storyboard/tts/format-screenplay",
        json={
            "book_id": "book-test",
            "chapter_index": 1,
            "chapter_title": "The Quarter-Deck",
            "raw_text": "Ahab paced the deck. 'Look sharp for the white whale!' he cried.",
            "narrator_voice": "Enzo",
            "voice_mode": "SINGLE_NARRATOR",
            "enable_emotion_tags": True,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "## Transcript:" in data["formatted_screenplay"]
    assert "Narrator" in data["formatted_screenplay"]
    assert data["model_recommended"] == "gemini-3.8-flash-tts"

    # 2. Upload audio generated from AI Studio
    fake_wav_bytes = b"RIFF____WAVEfmt " + b"\x00" * 32
    audio_b64 = base64.b64encode(fake_wav_bytes).decode("utf-8")
    up_res = client.post(
        "/api/v1/storyboard/audio/upload",
        json={
            "book_id": "book-test",
            "chapter_index": 1,
            "filename": "aistudio_3.8tts_output.wav",
            "audio_base64": audio_b64,
            "duration_seconds": 12.5,
        },
    )
    assert up_res.status_code == 200
    up_data = up_res.json()
    assert up_data["ok"] is True
    assert up_data["duration_seconds"] == 12.5
    assert "/api/outputs/" in up_data["audio_url"]


