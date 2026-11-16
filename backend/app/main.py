import logging
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.api.v1.api import api_router
from app.core.config import settings
from app.middleware.bridge_guard import install_bridge_guard
from app.routers import (
    extraction_lab,
    flow_bridge,
    graph_studio,
    parser_inspector,
    rag_workbench,
    scorecard_stepper,
    testbench_system,
    vm_swarm_control,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("novel_visualiser")

app = FastAPI(
    title="Novel Visualiser & Storyboard Studio",
    description="Neuro-Symbolic Agentic AI Platform for Fiction Novel Storyboarding and Continuous Cluster Rendering",
    version="1.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Install Scriptoria Bridge Guard (X-Trace-ID, X-Bridge-Secret, and ApiErrorEnvelope exception handlers)
install_bridge_guard(
    app,
    exempt_paths={"/", "/health", "/docs", "/openapi.json", "/redoc"},
)

# Include API Routers
app.include_router(api_router, prefix="/api/v1")
app.include_router(testbench_system.router, prefix="/api/v1")
app.include_router(parser_inspector.router, prefix="/api/v1")
app.include_router(vm_swarm_control.router, prefix="/api/v1")
app.include_router(extraction_lab.router, prefix="/api/v1")
app.include_router(graph_studio.router, prefix="/api/v1")
app.include_router(rag_workbench.router, prefix="/api/v1")
app.include_router(scorecard_stepper.router, prefix="/api/v1")
app.include_router(flow_bridge.router)

# Static media mounts
shots_dir = Path("output/shots")
shots_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/shots", StaticFiles(directory=str(shots_dir)), name="shots")

foundry_dir = Path("output/foundry")
foundry_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/foundry", StaticFiles(directory=str(foundry_dir)), name="foundry")

flow_assets_dir = Path("output/flow_assets")
flow_assets_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/flow_assets", StaticFiles(directory=str(flow_assets_dir)), name="flow_assets")

# Static UI mount
static_ui_dir = Path("app/static")
static_ui_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_ui_dir)), name="static")

@app.get("/")
async def serve_index():
    index_file = static_ui_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "Novel Visualiser API is running. Go to /docs for interactive Swagger API."}

@app.get("/health")
async def health_check():
    return {
        "status": "ONLINE",
        "gpu0": settings.COMFYUI_GPU0_URL,
        "gpu1": settings.COMFYUI_GPU1_URL,
        "gcgpu": settings.COMFYUI_COLAB_URL,
        "database": "Supabase PostgreSQL (Asyncpg)",
    }

