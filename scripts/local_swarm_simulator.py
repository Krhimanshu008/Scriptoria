#!/usr/bin/env python3
"""
Local Swarm Simulator & Bridge for Scriptoria
Listens on http://127.0.0.1:8188 and simulates the 5-model lightweight swarm
(Qwen3.5-4B Extractor, MiniCPM-V 1B Tagger, Qwen3.5-9B QC VLM, RAG) with realistic
streaming tokens/sec speeds and JSON schemas for local UI testing.
"""

import time
import json
import uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HOST = "127.0.0.1"
PORT = 8188

MOCK_EXTRACTION_JSON = {
    "characters": [
        {
            "name": "Sunny",
            "visual_tags": ["messy silver hair", "tattered dark grey cloak", "jagged cheek scar", "worn leather gloves"],
            "weapon": "Midnight Shard",
            "action": "pulling cloak tighter against the sub-zero chill"
        },
        {
            "name": "Nephis",
            "visual_tags": ["pale golden eyes", "unblinking stare", "pristine white tunic"],
            "weapon": "Silver Rapier",
            "action": "staring down into the abyssal gorge"
        }
    ],
    "environment": {
        "location": "Forgotten Peak, mountain pass",
        "weather": "howling blizzard, sub-zero temperature",
        "lighting": "dim moonlight through storm clouds"
    },
    "story_state": {
        "aspect_dormant": False,
        "true_name_discovered": False
    }
}

MOCK_TAGS = (
    "cinematic wide establishing shot, cold desolate mountain peak, howling blizzard, "
    "obsidian rock formations, deep snowdrifts, moonlight rim lighting, 8k resolution, photorealistic, masterpiece"
)

MOCK_QC_AUDIT = (
    "<think>\n"
    "Analyzing visual discrepancy between prompt and reference:\n"
    "1. Character hair: Reference specifies messy silver hair with frost. The candidate prompt matches.\n"
    "2. Facial scar: Left cheek scar confirmed present.\n"
    "3. Clothing: Dark grey cloak and worn gloves match canonical chapter state.\n"
    "4. Weapon: Midnight Shard hilt geometry conforms to standard blade specification.\n"
    "Conclusion: No continuity violations detected.\n"
    "</think>\n"
    "{\n"
    '  "is_visually_consistent": true,\n'
    '  "confidence": 0.98,\n'
    '  "canon_compliance": "PASSED",\n'
    '  "detected_discrepancies": [],\n'
    '  "requires_sam2_inpaint": false,\n'
    '  "co_director_note": "Visual continuity verified. Shot is approved for frame rendering."\n'
    "}"
)

class SwarmSimulatorHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/v1/health"):
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "mode": "local_swarm_sim"}')
            return

        if self.path in ("/v1/swarm/health", "/v1/swarm/status"):
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status = {
                "status": "ok",
                "services": {
                    "qc_9b": True,
                    "extract_4b": True,
                    "tag_1b": True,
                    "rag_0.6b": True
                },
                "devices": [
                    {"name": "NVIDIA GeForce RTX (CUDA 0)", "vram_total": 16 * 1024**3, "vram_free": 9 * 1024**3},
                    {"name": "NVIDIA GeForce RTX (CUDA 1)", "vram_total": 16 * 1024**3, "vram_free": 11 * 1024**3}
                ]
            }
            self.wfile.write(json.dumps(status).encode("utf-8"))
            return

        if self.path in ("/v1/models", "/models"):
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            models_resp = {
                "object": "list",
                "data": [
                    {"id": "qwen3.5-9b", "object": "model", "owned_by": "unsloth"},
                    {"id": "qwen3.5-4b", "object": "model", "owned_by": "unsloth"},
                    {"id": "minicpm-v-1b", "object": "model", "owned_by": "openbmb"}
                ]
            }
            self.wfile.write(json.dumps(models_resp).encode("utf-8"))
            return

        if self.path == "/system_stats":
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            stats = {
                "devices": [
                    {"name": "Tesla T4 · CUDA 0 (Qwen 9B + WeMM)", "vram_total": 16 * 1024**3, "vram_free": 7.8 * 1024**3},
                    {"name": "Tesla T4 · CUDA 1 (Qwen 4B + MiniCPM + RAG)", "vram_total": 16 * 1024**3, "vram_free": 9.2 * 1024**3}
                ]
            }
            self.wfile.write(json.dumps(stats).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            req_data = json.loads(body.decode("utf-8"))
        except Exception:
            req_data = {}

        target_service = (self.headers.get("X-Target-Service") or "").lower().strip()
        if self.path.startswith("/v1/extract"):
            target_service = "extract"
        elif self.path.startswith("/v1/tag"):
            target_service = "tag"
        elif self.path.startswith("/v1/qc"):
            target_service = "qc"

        # Determine response type and speed
        if target_service == "extract":
            model_name = "qwen3.5-4b"
            full_text = json.dumps(MOCK_EXTRACTION_JSON, indent=2)
            tok_delay = 0.009  # ~110 tokens/sec
        elif target_service == "tag":
            model_name = "minicpm-v-1b"
            full_text = MOCK_TAGS
            tok_delay = 0.005  # ~190 tokens/sec
        else:
            model_name = "qwen3.5-9b"
            full_text = MOCK_QC_AUDIT
            tok_delay = 0.020  # ~50 tokens/sec

        is_streaming = req_data.get("stream", False)

        if is_streaming:
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            # Stream word by word simulating token stream
            words = full_text.split(" ")
            req_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"

            for i, word in enumerate(words):
                time.sleep(tok_delay)
                piece = word + (" " if i < len(words) - 1 else "")
                chunk = {
                    "id": req_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": piece},
                            "finish_reason": None if i < len(words) - 1 else "stop"
                        }
                    ]
                }
                line = f"data: {json.dumps(chunk)}\n\n"
                self.wfile.write(line.encode("utf-8"))
                self.wfile.flush()

            # Final usage chunk
            usage_chunk = {
                "id": req_id,
                "object": "chat.completion.chunk",
                "model": model_name,
                "usage": {
                    "prompt_tokens": 128,
                    "completion_tokens": len(words) * 2,
                    "total_tokens": 128 + len(words) * 2
                }
            }
            self.wfile.write(f"data: {json.dumps(usage_chunk)}\n\n".encode("utf-8"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = {
                "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model_name,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": full_text},
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": 128,
                    "completion_tokens": len(full_text.split()) * 2,
                    "total_tokens": 128 + len(full_text.split()) * 2
                }
            }
            self.wfile.write(json.dumps(resp).encode("utf-8"))

    def log_message(self, format, *args):
        return

def run():
    server = ThreadingHTTPServer((HOST, PORT), SwarmSimulatorHandler)
    print(f"[✓] Scriptoria Swarm Simulator active on http://{HOST}:{PORT}")
    print(f"    - /v1/extract -> Qwen3.5-4B (~110 tok/s)")
    print(f"    - /v1/tag     -> MiniCPM-V 1B (~190 tok/s)")
    print(f"    - /v1/qc      -> Qwen3.5-9B (~50 tok/s)")
    print(f"    - /health & /v1/swarm/health ready")
    server.serve_forever()

if __name__ == "__main__":
    run()

