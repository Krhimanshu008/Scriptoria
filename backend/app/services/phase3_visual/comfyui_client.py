"""ComfyUI Multi-GPU Cluster Client.

Manages remote ComfyUI workers (e.g. Kaggle Dual-GPU cluster), handles
workflow parameter injection, async dispatch, job tracking, and image retrieval.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class GPUNodeStatus:
    url: str
    is_online: bool
    has_checkpoints: bool = True
    queue_running: int = 0
    queue_pending: int = 0
    vram_free_mb: Optional[int] = None


class ComfyClusterClient:
    """Async client managing ComfyUI GPU cluster nodes."""

    def __init__(self, node_urls: Optional[List[str]] = None, timeout: float = 30.0) -> None:
        if node_urls is None:
            urls = []
            if getattr(settings, "COMFYUI_GPU0_URL", None):
                urls.append(settings.COMFYUI_GPU0_URL.rstrip("/"))
            if getattr(settings, "COMFYUI_GPU1_URL", None):
                urls.append(settings.COMFYUI_GPU1_URL.rstrip("/"))
            if not urls:
                urls = [getattr(settings, "COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")]
            self.node_urls = list(dict.fromkeys(urls))  # deduplicate preserving order
        else:
            self.node_urls = [u.rstrip("/") for u in node_urls]

        self.timeout = timeout
        self.workflow_dir = Path(__file__).resolve().parents[2] / "workflows"

    async def get_node_status(self, url: str) -> GPUNodeStatus:
        """Pings a ComfyUI node and returns its live queue, VRAM, and model readiness status."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res_q = await client.get(f"{url}/queue")
                if res_q.status_code != 200:
                    return GPUNodeStatus(url=url, is_online=False, has_checkpoints=False)
                q_data = res_q.json()
                running = len(q_data.get("queue_running", []))
                pending = len(q_data.get("queue_pending", []))

                # Check system stats for VRAM
                res_stats = await client.get(f"{url}/system_stats")
                vram_free = None
                if res_stats.status_code == 200:
                    s_data = res_stats.json()
                    devices = s_data.get("devices", [])
                    if devices:
                        vram_free = int(devices[0].get("vram_free", 0) / (1024 * 1024))

                # Check if diffusion models are loaded
                has_ckpts = True
                try:
                    res_ckpts = await client.get(f"{url}/object_info/CheckpointLoaderSimple")
                    if res_ckpts.status_code == 200:
                        ck_list = res_ckpts.json().get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get("ckpt_name", [[]])[0]
                        has_ckpts = bool(ck_list)
                except Exception:
                    pass

                return GPUNodeStatus(
                    url=url,
                    is_online=True,
                    has_checkpoints=has_ckpts,
                    queue_running=running,
                    queue_pending=pending,
                    vram_free_mb=vram_free,
                )
        except Exception as e:
            logger.warning(f"Health check failed for node {url}: {e}")
            return GPUNodeStatus(url=url, is_online=False, has_checkpoints=False)

    async def select_best_gpu(self) -> str:
        """Selects the online GPU with available checkpoints and the smallest queue load."""
        statuses = await asyncio.gather(*(self.get_node_status(u) for u in self.node_urls))
        ready = [s for s in statuses if s.is_online and s.has_checkpoints]
        if not ready:
            # Fallback to any online node if none reported checkpoints
            ready = [s for s in statuses if s.is_online]
        if not ready:
            raise ConnectionError(f"No ComfyUI cluster nodes are reachable: {self.node_urls}")

        # Sort by (queue_running + queue_pending) ascending, then vram_free descending
        ready.sort(key=lambda s: (s.queue_running + s.queue_pending, -(s.vram_free_mb or 0)))
        return ready[0].url

    def load_workflow_template(self, template_name: str) -> dict:
        """Loads a workflow JSON template from disk."""
        if not template_name.endswith(".json"):
            template_name += ".json"
        wf_path = self.workflow_dir / template_name
        if not wf_path.exists():
            raise FileNotFoundError(f"Workflow template {template_name} not found in {self.workflow_dir}")
        with open(wf_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def inject_parameters(self, workflow: dict, overrides: Dict[str, Any], target_gpu_url: Optional[str] = None) -> dict:
        """Injects dynamic prompts, seeds, denoise, and file inputs into workflow nodes."""
        wf = copy.deepcopy(workflow)

        pos_prompt = overrides.get("positive_prompt")
        neg_prompt = overrides.get("negative_prompt")
        seed = overrides.get("seed")
        prefix = overrides.get("filename_prefix")
        ref_image = overrides.get("character_ref_image")
        plate_image = overrides.get("location_plate_image")
        is_colab = bool(target_gpu_url and "gcgpu" in target_gpu_url.lower())

        for nid, node in list(wf.items()):
            ctype = node.get("class_type")
            inputs = node.get("inputs", {})

            # Multi-Node Model Path Adaptation (Colab vs Kaggle)
            if is_colab:
                if ctype == "CheckpointLoaderSimple":
                    curr_ckpt = inputs.get("ckpt_name", "")
                    if "illustrious" in curr_ckpt.lower():
                        inputs["ckpt_name"] = "sdxl/illustrious/waiNSFWIllustrious_v110.safetensors"
                elif ctype == "IPAdapterModelLoader":
                    curr_ip = inputs.get("ipadapter_file", "")
                    if "face" in curr_ip.lower():
                        inputs["ipadapter_file"] = "sdxl/plus/ip-adapter-plus-face_sdxl_vit-h.safetensors"
                    elif "plus" in curr_ip.lower():
                        inputs["ipadapter_file"] = "sdxl/plus/ip-adapter-plus_sdxl_vit-h.safetensors"
                elif ctype == "ControlNetLoader":
                    inputs["control_net_name"] = "controlnet-union-sdxl-1.0-promax.safetensors"

            # 1. CLIPTextEncode prompt injection
            if ctype == "CLIPTextEncode":
                # In standard workflows, node '5' is positive, node '6' is negative (or node '4' / '5')
                # Alternatively inspect current text:
                curr_text = str(inputs.get("text", "")).lower()
                is_neg = (
                    "worst quality" in curr_text
                    or "low quality" in curr_text
                    or "bad anatomy" in curr_text
                    or nid in ("6", "7") and neg_prompt
                )
                if is_neg and neg_prompt:
                    inputs["text"] = neg_prompt
                elif not is_neg and pos_prompt:
                    inputs["text"] = pos_prompt

            # 2. KSampler seed & params
            elif ctype == "KSampler":
                if seed is not None:
                    inputs["seed"] = seed
                if "steps" in overrides:
                    inputs["steps"] = overrides["steps"]
                if "cfg" in overrides:
                    inputs["cfg"] = overrides["cfg"]
                if "denoise" in overrides:
                    inputs["denoise"] = overrides["denoise"]

            # 3. FaceDetailer seed
            elif ctype == "FaceDetailer":
                if seed is not None:
                    inputs["seed"] = seed + 1

            # 4. SaveImage filename prefix
            elif ctype == "SaveImage":
                if prefix:
                    inputs["filename_prefix"] = prefix

            # 5. LoadImage reference injection
            elif ctype == "LoadImage":
                curr_img = str(inputs.get("image", ""))
                if "character" in curr_img.lower() or "char" in curr_img.lower() or nid in ("8", "9"):
                    if ref_image:
                        inputs["image"] = ref_image
                elif "location" in curr_img.lower() or "loc" in curr_img.lower() or nid in ("11", "3"):
                    if plate_image:
                        inputs["image"] = plate_image

            # 6. Dimensions
            elif ctype == "EmptyLatentImage":
                if "width" in overrides:
                    inputs["width"] = overrides["width"]
                if "height" in overrides:
                    inputs["height"] = overrides["height"]

        # On Colab (gcgpu), bypass FaceDetailer / UltralyticsDetectorProvider if missing detector weights
        if is_colab:
            face_detailer_ids = [nid for nid, n in wf.items() if n.get("class_type") == "FaceDetailer"]
            detector_ids = [nid for nid, n in wf.items() if n.get("class_type") == "UltralyticsDetectorProvider"]

            for fd_id in face_detailer_ids:
                fd_image_source = wf[fd_id].get("inputs", {}).get("image")
                if fd_image_source:
                    for target_id, target_node in wf.items():
                        t_inputs = target_node.get("inputs", {})
                        for k, v in t_inputs.items():
                            if isinstance(v, list) and len(v) == 2 and str(v[0]) == str(fd_id):
                                target_node["inputs"][k] = fd_image_source
                del wf[fd_id]

            for det_id in detector_ids:
                if det_id in wf:
                    del wf[det_id]

        return wf

    async def upload_image(self, image_path: Path | str, target_gpu_url: Optional[str] = None) -> str:
        """Uploads an image to the remote ComfyUI input folder via /upload/image."""
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"File to upload not found: {path}")

        url = target_gpu_url or await self.select_best_gpu()
        upload_endpoint = f"{url}/upload/image"

        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(path, "rb") as f:
                files = {"image": (path.name, f, "image/png")}
                res = await client.post(upload_endpoint, files=files, data={"overwrite": "true"})
                res.raise_for_status()
                data = res.json()
                uploaded_name = data.get("name", path.name)
                logger.info(f"Uploaded {path.name} to {url} as {uploaded_name}")
                return uploaded_name

    async def submit_prompt(self, workflow: dict, target_gpu_url: Optional[str] = None) -> Tuple[str, str]:
        """Dispatches a prompt workflow graph to ComfyUI. Returns (prompt_id, gpu_url)."""
        url = target_gpu_url or await self.select_best_gpu()
        client_id = str(uuid.uuid4())
        payload = {"prompt": workflow, "client_id": client_id}

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(f"{url}/prompt", json=payload)
            res.raise_for_status()
            data = res.json()
            prompt_id = data["prompt_id"]
            logger.info(f"Dispatched job {prompt_id} to {url}")
            return prompt_id, url

    async def wait_for_completion(
        self, prompt_id: str, gpu_url: str, timeout_sec: int = 300, poll_interval: float = 2.0
    ) -> Dict[str, Any]:
        """Polls /history/{prompt_id} until execution finishes, raising on node errors."""
        history_url = f"{gpu_url}/history/{prompt_id}"
        elapsed = 0.0

        async with httpx.AsyncClient(timeout=10.0) as client:
            while elapsed < timeout_sec:
                res = await client.get(history_url)
                if res.status_code == 200:
                    data = res.json()
                    if prompt_id in data:
                        job_entry = data[prompt_id]
                        status = job_entry.get("status", {})
                        if status.get("status_str") == "error":
                            messages = status.get("messages", [])
                            raise RuntimeError(f"ComfyUI execution error for {prompt_id}: {messages}")
                        if status.get("completed", False) or "outputs" in job_entry:
                            logger.info(f"Job {prompt_id} completed successfully on {gpu_url}")
                            return job_entry

                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

        raise TimeoutError(f"ComfyUI job {prompt_id} timed out after {timeout_sec}s on {gpu_url}")

    async def download_outputs(
        self, job_entry: Dict[str, Any], gpu_url: str, output_dir: Path | str
    ) -> List[Path]:
        """Downloads all images generated by SaveImage nodes to the local output folder."""
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        downloaded = []

        outputs = job_entry.get("outputs", {})
        async with httpx.AsyncClient(timeout=60.0) as client:
            for node_id, node_out in outputs.items():
                images = node_out.get("images", [])
                for img_info in images:
                    filename = img_info["filename"]
                    subfolder = img_info.get("subfolder", "")
                    img_type = img_info.get("type", "output")

                    view_url = f"{gpu_url}/view"
                    params = {"filename": filename, "subfolder": subfolder, "type": img_type}

                    res = await client.get(view_url, params=params)
                    res.raise_for_status()

                    local_file = out_path / filename
                    with open(local_file, "wb") as f:
                        f.write(res.content)

                    logger.info(f"Downloaded output {filename} to {local_file}")
                    downloaded.append(local_file)

        return downloaded

    async def render_workflow(
        self,
        template_name: str,
        overrides: Dict[str, Any],
        target_gpu_url: Optional[str] = None,
        output_dir: Path | str = "output/shots",
    ) -> List[Path]:
        """Full end-to-end execution: loads template, injects overrides, dispatches, polls, and downloads."""
        raw_wf = self.load_workflow_template(template_name)
        injected_wf = self.inject_parameters(raw_wf, overrides, target_gpu_url=target_gpu_url)

        prompt_id, gpu_url = await self.submit_prompt(injected_wf, target_gpu_url=target_gpu_url)
        history = await self.wait_for_completion(prompt_id, gpu_url)
        return await self.download_outputs(history, gpu_url, output_dir)

