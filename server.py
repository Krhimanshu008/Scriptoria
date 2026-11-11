"""
FastAPI Server & Web Dashboard for Cloud GPU VM Orchestration
Provides REST API, WebSockets live streaming, and static UI assets.
"""

from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import random
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import settings
from log_broker import log_broker
from vm_manager import vm_manager
from comfy_client import comfy_client
from notebook_generator import build_kaggle_kernel_bundle, build_colab_bundle

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("vm_server")

IS_SERVERLESS = bool(
    os.environ.get("VERCEL") or
    os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or
    os.environ.get("VERCEL_ENV")
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not IS_SERVERLESS:
        logger.info("🚀 Starting Cloud VM Orchestrator Server...")
        log_broker.log("System initialized. Starting background health monitoring...", category="SYSTEM")
        vm_manager.start_background_monitoring()
    yield
    if not IS_SERVERLESS:
        logger.info("🛑 Shutting down server...")

app = FastAPI(title="Cloud GPU VM Orchestrator", lifespan=None if IS_SERVERLESS else lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def catch_exceptions_middleware(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        import traceback
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "traceback": traceback.format_exc()}
        )

# Static assets & outputs
STATIC_DIR = settings.WORKSPACE_DIR / "static"
OUTPUTS_DIR = Path("/tmp/outputs") if IS_SERVERLESS else settings.OUTPUTS_DIR

try:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

if not IS_SERVERLESS and STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
@app.get("/api", response_class=HTMLResponse)
@app.get("/api/index", response_class=HTMLResponse)
async def get_index():
    candidates = [
        STATIC_DIR / "index.html",
        Path(__file__).resolve().parent / "static" / "index.html",
        Path(__file__).resolve().parent / "api" / "static" / "index.html",
        Path("/var/task/static/index.html"),
        Path("/var/task/api/static/index.html"),
        Path(__file__).resolve().parent.parent / "static" / "index.html",
    ]
    for c in candidates:
        if c.exists():
            return HTMLResponse(content=c.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>Scriptoria Cloud VM Orchestrator</h1><p>static/index.html not found</p>")

@app.get("/outputs/{filename}")
async def get_output_file(filename: str):
    file_path = OUTPUTS_DIR / filename
    if file_path.exists():
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/api/status")
async def get_status():
    if IS_SERVERLESS:
        await vm_manager.check_all_health()
    return await vm_manager.get_all_status()

@app.get("/api/logs")
async def get_logs(limit: int = 100):
    return log_broker.get_recent(limit=limit)

@app.post("/api/vm/{target}/toggle")
async def toggle_vm_endpoint(target: str):
    if target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {target} not recognized")
    return await vm_manager.toggle(target)

@app.post("/api/vm/{target}/start")
async def start_vm_endpoint(target: str):
    if target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {target} not recognized")
    return await vm_manager.start_vm(target)

@app.post("/api/vm/{target}/stop")
async def stop_vm_endpoint(target: str):
    if target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {target} not recognized")
    return await vm_manager.stop_vm(target)

@app.get("/api/notebook/colab/download")
async def download_colab_notebook():
    nb_path = build_colab_bundle()
    if nb_path.exists():
        return FileResponse(nb_path, filename="gcgpu-comfyui-runner.ipynb", media_type="application/x-ipynb+json")
    raise HTTPException(status_code=404, detail="Colab notebook bundle could not be found")

@app.get("/api/catalog/{target}")
async def get_catalog_endpoint(target: str):
    if target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {target} not recognized")
    try:
        return await comfy_client.get_catalog(target)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

class ModelFetchRequest(BaseModel):
    target: str = "gpu0"
    category: str = "checkpoints"
    name: str = "Wai_Illustrious_v16.safetensors"

@app.post("/api/models/fetch")
async def fetch_model_endpoint(req: ModelFetchRequest):
    if req.target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {req.target} not recognized")
    base_url = settings.ENDPOINTS[req.target]["url"]
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{base_url}/fetch-model", json={"category": req.category, "name": req.name})
            log_broker.log(f"Initiated on-demand model stream for {req.name} ({req.category}) on {req.target}", category="RCLONE")
            return resp.json()
    except Exception as e:
        log_broker.log(f"Model fetch error: {e}", category="ERROR", level="ERROR")
        raise HTTPException(status_code=502, detail=str(e))

@app.get("/api/models/fetch-status/{target}")
async def fetch_status_endpoint(target: str):
    if target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {target} not recognized")
    base_url = settings.ENDPOINTS[target]["url"]
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/fetch-status")
            return resp.json()
    except Exception as e:
        return {"status": "offline", "error": str(e)}

class PromptRequest(BaseModel):
    target: str = "gpu0"
    prompt: str
    negative_prompt: Optional[str] = "bad quality, blurry, deformed"
    checkpoint: Optional[str] = "Wai_Illustrious_v16.safetensors"
    width: Optional[int] = 1024
    height: Optional[int] = 1024
    steps: Optional[int] = 25
    cfg: Optional[float] = 6.0

@app.post("/api/workflow/run")
async def run_workflow_endpoint(req: PromptRequest):
    if req.target not in settings.ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Target {req.target} not recognized")

    # Fetch available checkpoints from the target
    catalog = await comfy_client.get_catalog(req.target)
    avail_ckpts = catalog.get("models", {}).get("checkpoints", [])
    if not avail_ckpts:
        raise HTTPException(
            status_code=400,
            detail="No checkpoints are currently loaded on this GPU. Please fetch a checkpoint first."
        )

    ckpt_to_use = req.checkpoint if req.checkpoint in avail_ckpts else avail_ckpts[0]
    log_broker.log(f"Using checkpoint: {ckpt_to_use} for prompt on {req.target}", category="COMFYUI")

    # Generate standard SDXL text-to-image API prompt graph
    seed = random.randint(100000, 999999999)
    api_prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt_to_use}},
        "2": {"class_type": "EmptyLatentImage", "inputs": {"width": req.width, "height": req.height, "batch_size": 1}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": req.prompt, "clip": ["1", 1]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": req.negative_prompt, "clip": ["1", 1]}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": req.steps, "cfg": req.cfg,
                "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0,
                "model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0], "latent_image": ["2", 0]
            }
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": f"TEST_{req.target}"}}
    }

    try:
        images = await comfy_client.execute_prompt(api_prompt, req.target)
        return {"status": "success", "images": images}
    except Exception as e:
        log_broker.log(f"Execution error: {e}", category="ERROR", level="ERROR")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def websocket_logs_endpoint(websocket: WebSocket):
    await websocket.accept()
    await log_broker.register(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle client-side commands if any
    except WebSocketDisconnect:
        await log_broker.unregister(websocket)
    except Exception:
        await log_broker.unregister(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host=settings.HOST, port=settings.PORT, reload=False)

