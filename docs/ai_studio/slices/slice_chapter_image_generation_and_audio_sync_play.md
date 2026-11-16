# SCRIPT CONTEXT SLICE: FULL CHAPTER IMAGE GENERATION & AUDIO SYNC PLAY
## Target: Multi-Model Orchestrator & Audio-Visual Producer
## Infrastructure: Dual Kaggle VMs (Local Qwen Swarm) + Google Flow Extension + AI Studio TTS
## Status: IMPLEMENTATION SPECIFICATION & CONTRACT DEFINITION

---

### 1. Dual Kaggle VM Swarm Allocation

Scriptoria coordinates 2 dedicated Kaggle Dual-T4 virtual machines for zero-cost, unmetered fiction reasoning:

| VM Target | Account Handle | Hardware Spec | Internal / Public Tunnel | Assigned Story Brain Role |
| :--- | :--- | :--- | :--- | :--- |
| **Kaggle VM 1** | `himanshukr7532` (Acc 1) | Dual NVIDIA T4 (32GB VRAM) | `https://gpu0.krhimanshu.in` (Port 8190) | **Narrative Director Agent**: Chapter tension analysis, 5–8 scene cuts, frame budget allocation. |
| **Kaggle VM 2** | `krhimanshu001` (Acc 2) | Dual NVIDIA T4 (32GB VRAM) | `https://gpu1.krhimanshu.in` (Port 8191) | **Cinematographer & Continuity Agent**: 80–100 micro-beats, camera lenses, lighting ratios, wardrobe & prop latching. |

#### Swarm Protocol
```json
{
  "chapter_id": "ch_036_the_quarter_deck",
  "word_count": 2150,
  "director_node": "https://gpu0.krhimanshu.in/v1",
  "cinematographer_node": "https://gpu1.krhimanshu.in/v1",
  "model": "qwen2.5:14b-instruct-q4_K_M"
}
```

---

### 2. Google Flow Extension Batch Dispatch

The 80–100 compiled prompts are queued into the Scriptoria Flow Bridge:
- **WebSocket Route**: `ws://127.0.0.1:8000/api/v1/flow-bridge/ws` (Local) / `wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws` (Production)
- **Task Schema**:
```json
{
  "task_id": "flow-task-001",
  "project_id": "book-moby-dick",
  "chapter_id": "ch_036",
  "frame_index": 1,
  "prompt": "establishing wide angle of Ahab ascending the cabin gangway...",
  "aspect_ratio": "16:9",
  "model_engine": "nano_banana"
}
```
The browser companion extension drives `https://flow.google/` or `https://labs.google/fx/` sequentially, captures completed media buffers, and streams them back to the R2 Storage Lake.

---

### 3. AI Studio TTS Generation & Timestamp Alignment

The chapter audio is generated via `backend/app/services/flow_tts_service.py` using `gemini-2.5-pro-preview-tts` (or Kokoro TTS fallback):
- **Output**: Broadcast-grade 24kHz master WAV audio file.
- **Timestamp Map**:
```json
[
  {
    "frame_index": 1,
    "sentence_span": "It was not a great while after the affair of the pipe...",
    "audio_start_sec": 0.0,
    "audio_end_sec": 6.42,
    "audio_duration_sec": 6.42
  },
  {
    "frame_index": 2,
    "sentence_span": "Soon his steady, ivory stride was heard pacing his rounds...",
    "audio_start_sec": 6.42,
    "audio_end_sec": 13.15,
    "audio_duration_sec": 6.73
  }
]
```

---

### 4. Interactive AV Sync Player ("Theater Mode")

The frontend UI embeds a synchronized audio-visual player:
1. Audio element plays master chapter audio.
2. Synchronized canvas transitions smoothly between the 80–100 frames as timestamps elapse.
3. Subtitle overlay renders verbatim sentence text with active karaoke speech tracking.
4. Bottom filmstrip allows instant scrubbing to any of the 100 frames.
5. "Export MP4" triggers FFmpeg headless muxing via `flow_av_pipeline.py`.
