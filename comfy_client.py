"""
ComfyUI Client & Workflow Dispatcher
Handles /prompt dispatch, /history tracking, and downloading generated images from remote VMs.
"""

from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import time
import urllib.parse
from typing import Any, List, Optional
import httpx

from config import settings
from log_broker import log_broker

logger = logging.getLogger("comfy_client")

class ComfyClient:
    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None

    @property
    def http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=60.0, follow_redirects=True)
        return self._http_client

    async def get_catalog(self, target: str) -> dict[str, Any]:
        cfg = settings.ENDPOINTS.get(target)
        if not cfg:
            raise ValueError(f"Unknown target: {target}")

        base_url = cfg["url"]
        log_broker.log(f"📥 Fetching live node & model catalog from {base_url}/object_info ...", category="COMFYUI")
        resp = await self.http_client.get(f"{base_url}/object_info", timeout=30.0)
        resp.raise_for_status()
        obj_info = resp.json()

        catalog = {
            "target": target,
            "base_url": base_url,
            "models": {
                "checkpoints": obj_info.get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get("ckpt_name", [[]])[0],
                "vaes": obj_info.get("VAELoader", {}).get("input", {}).get("required", {}).get("vae_name", [[]])[0],
                "loras": obj_info.get("LoraLoader", {}).get("input", {}).get("required", {}).get("lora_name", [[]])[0],
                "controlnets": obj_info.get("ControlNetLoader", {}).get("input", {}).get("required", {}).get("control_net_name", [[]])[0],
                "ipadapters": obj_info.get("IPAdapterModelLoader", {}).get("input", {}).get("required", {}).get("ipadapter_file", [[]])[0],
                "clip_vision": obj_info.get("CLIPVisionLoader", {}).get("input", {}).get("required", {}).get("clip_name", [[]])[0],
            },
            "total_nodes_available": len(obj_info),
            "fetched_at": datetime.now(timezone.utc).isoformat()
        }
        log_broker.log(f"✅ Catalog synced for {target}! Found {len(obj_info)} nodes.", category="COMFYUI", level="SUCCESS")
        return catalog

    async def execute_prompt(self, api_prompt: dict, target: str) -> list[str]:
        cfg = settings.ENDPOINTS.get(target)
        if not cfg:
            raise ValueError(f"Unknown target: {target}")

        base_url = cfg["url"]
        log_broker.log(f"🚀 Queuing prompt on {target} ({base_url})...", category="COMFYUI")
        resp = await self.http_client.post(f"{base_url}/prompt", json={"prompt": api_prompt})
        resp.raise_for_status()
        res_data = resp.json()
        prompt_id = res_data.get("prompt_id")
        log_broker.log(f"⏳ Prompt queued! ID: {prompt_id}. Waiting for GPU execution...", category="COMFYUI")

        saved_files = []
        out_dir = settings.OUTPUTS_DIR
        out_dir.mkdir(parents=True, exist_ok=True)

        # Poll history
        for attempt in range(120):
            await asyncio.sleep(2.0)
            hist_resp = await self.http_client.get(f"{base_url}/history/{prompt_id}")
            if hist_resp.status_code == 200:
                hist_data = hist_resp.json()
                if prompt_id in hist_data:
                    outputs = hist_data[prompt_id].get("outputs", {})
                    for node_id, node_out in outputs.items():
                        for img in node_out.get("images", []):
                            fn = img["filename"]
                            sub = img.get("subfolder", "")
                            itype = img.get("type", "output")
                            q = urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": itype})
                            img_url = f"{base_url}/view?{q}"
                            local_img = out_dir / fn

                            img_resp = await self.http_client.get(img_url)
                            if img_resp.status_code == 200:
                                local_img.write_bytes(img_resp.content)
                                saved_files.append(fn)
                                log_broker.log(f"🖼️ Downloaded generated image: {fn}", category="SUCCESS", level="SUCCESS")

                    log_broker.log(f"🎉 Job completed! Saved {len(saved_files)} image(s) to local workspace.", category="COMFYUI", level="SUCCESS")
                    return saved_files

        raise TimeoutError(f"Prompt {prompt_id} timed out waiting for generation.")

comfy_client = ComfyClient()

