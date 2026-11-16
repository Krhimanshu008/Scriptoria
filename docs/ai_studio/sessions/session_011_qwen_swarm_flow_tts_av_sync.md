# Session 011: Local Qwen Swarm (2 Kaggle VMs), Flow Extension Batch Generation & AI Studio TTS AV Sync
**Platform**: Scriptoria Orchestrator & Google AI Studio  
**Models**: Qwen 2.5 14B/32B (Dual Kaggle VMs) + Gemini 2.5 Pro TTS (Google AI Studio)  
**Status**: PLANNING_COMPLETED_IMPLEMENTATION_READY  

---

## 1. Architecture Overview

This session integrates:
1. **Local Qwen Swarm across 2 Kaggle VMs**:
   - `https://gpu0.krhimanshu.in` (Account 1 - Dual T4): Runs Director Agent.
   - `https://gpu1.krhimanshu.in` (Account 2 - Dual T4): Runs Cinematographer & Continuity Agent.
2. **Google Flow Extension Batch Image Generation**:
   - Automates generation of 80 to 100 images in Google Flow using modular prompts.
3. **AI Studio TTS Audio Synthesis & Sync**:
   - Broadcast-grade 24kHz speech generation with sentence timestamps.
4. **Interactive Theater Mode Player**:
   - Web player synchronizing audio playback with frame cuts and subtitles.

---

## 2. API Endpoints Specification

1. `POST /api/v1/storyboard/decompose`:
   - Engine: `"qwen_swarm"` (routes through Kaggle GPU tunnels)
   - Computes `audio_start_sec`, `audio_end_sec`, and `audio_duration_sec` per frame.
2. `POST /api/v1/storyboard/flow/dispatch`:
   - Batch pushes all 80–100 compiled prompts to the Flow Bridge task queue.
3. `POST /api/v1/flow-bridge/audio/generate`:
   - Synthesizes 24kHz chapter audio using Google AI Studio TTS.
