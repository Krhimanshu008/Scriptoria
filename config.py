"""
Configuration and Environment Settings for VM Toggle & Orchestrator
Loads environment variables from local or parent projects and defines VM endpoints.
"""

from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv

WORKSPACE_ROOT = Path(__file__).resolve().parent

# Search for candidate .env files (current workspace, or parent Novel Visualiser)
ENV_CANDIDATES = [
    WORKSPACE_ROOT / ".env",
    WORKSPACE_ROOT.parent / "Novel Visualiser" / ".env",
    WORKSPACE_ROOT.parent / ".env",
]

for env_path in ENV_CANDIDATES:
    if env_path.exists():
        load_dotenv(env_path, override=False)

class Settings:
    # Workspace directories
    WORKSPACE_DIR: Path = WORKSPACE_ROOT
    NOTEBOOKS_DIR: Path = WORKSPACE_ROOT / "notebooks"
    OUTPUTS_DIR: Path = WORKSPACE_ROOT / "outputs"
    TEMPLATES_DIR: Path = WORKSPACE_ROOT / "notebook_templates"

    # Server settings
    HOST: str = os.getenv("DASHBOARD_HOST", "127.0.0.1")
    PORT: int = int(os.getenv("DASHBOARD_PORT", "8000"))

    # Kaggle Multi-Account Credentials
    KAGGLE_ACC1_USERNAME: str = os.getenv("KAGGLE_ACC1_USERNAME", "himanshukr7532")
    KAGGLE_ACC1_KEY: str = os.getenv("KAGGLE_ACC1_KEY", "")
    KAGGLE_ACC2_USERNAME: str = os.getenv("KAGGLE_ACC2_USERNAME", "krhimanshu001")
    KAGGLE_ACC2_KEY: str = os.getenv("KAGGLE_ACC2_KEY", "")

    # Default active Kaggle
    KAGGLE_USERNAME: str = os.getenv("KAGGLE_USERNAME", "himanshukr7532")
    KAGGLE_KEY: str = os.getenv("KAGGLE_KEY", "")
    KAGGLE_API_TOKEN: str = os.getenv("KAGGLE_API_TOKEN", "")

    # Endpoints
    ENDPOINTS = {
        "gpu0": {
            "name": "Kaggle GPU 0 (CUDA:0)",
            "provider": "kaggle",
            "account": "acc1",
            "url": os.getenv("COMFYUI_GPU0_URL", "https://gpu0.krhimanshu.in").rstrip("/"),
            "slug": f"himanshukr7532/kaggle-dual-gpu-runner",
            "tunnel_token": os.getenv("CF_TOKEN_GPU0", os.getenv("CF_TOKEN_KAGGLE", "")),
            "accelerator": "nvidia-tesla-t4-2",  # T4 x2 Dual GPU
            "port": 8188,
        },
        "gpu1": {
            "name": "Kaggle GPU 1 (CUDA:1)",
            "provider": "kaggle",
            "account": "acc1",
            "url": os.getenv("COMFYUI_GPU1_URL", "https://gpu1.krhimanshu.in").rstrip("/"),
            "slug": f"himanshukr7532/kaggle-dual-gpu-runner",
            "tunnel_token": os.getenv("CF_TOKEN_GPU1", os.getenv("CF_TOKEN_KAGGLE", "")),
            "accelerator": "nvidia-tesla-t4-2",  # T4 x2 Dual GPU
            "port": 8189,
        },
        "gpu2": {
            "name": "Kaggle GPU 2 (CUDA:0, Acc 2)",
            "provider": "kaggle",
            "account": "acc2",
            "url": os.getenv("COMFYUI_GPU2_URL", "https://gpu2.krhimanshu.in").rstrip("/"),
            "slug": f"krhimanshu001/kaggle-dual-gpu-runner",
            "tunnel_token": os.getenv("CF_TOKEN_GPU2", os.getenv("CF_TOKEN_KAGGLE", "")),
            "accelerator": "nvidia-tesla-t4-2",  # T4 x2 Dual GPU
            "port": 8190,
        },
        "gpu3": {
            "name": "Kaggle GPU 3 (CUDA:1, Acc 2)",
            "provider": "kaggle",
            "account": "acc2",
            "url": os.getenv("COMFYUI_GPU3_URL", "https://gpu3.krhimanshu.in").rstrip("/"),
            "slug": f"krhimanshu001/kaggle-dual-gpu-runner",
            "tunnel_token": os.getenv("CF_TOKEN_GPU3", os.getenv("CF_TOKEN_KAGGLE", "")),
            "accelerator": "nvidia-tesla-t4-2",  # T4 x2 Dual GPU
            "port": 8191,
        },
        "gcgpu": {
            "name": "Google Colab GPU 0 (T4)",
            "provider": "colab",
            "account": "acc1",
            "url": os.getenv("COMFYUI_GCGPU_URL", "https://gcgpu.krhimanshu.in").rstrip("/"),
            "colab_url": os.getenv("COLAB_NOTEBOOK_URL", "https://colab.research.google.com/"),
            "tunnel_token": os.getenv("CF_TOKEN_GCGPU", ""),
            "accelerator": "t4",
            "port": 8188,
        },
        "gcgpu1": {
            "name": "Google Colab GPU 1 (T4, Acc 2)",
            "provider": "colab",
            "account": "acc2",
            "url": os.getenv("COMFYUI_GCGPU1_URL", "https://gcgpu1.krhimanshu.in").rstrip("/"),
            "colab_url": os.getenv("COLAB_NOTEBOOK_URL", "https://colab.research.google.com/"),
            "tunnel_token": os.getenv("CF_TOKEN_GCGPU", ""),
            "accelerator": "t4",
            "port": 8189,
        },
    }

    # Auto-shutdown idle timeout (in minutes) - 0 to disable
    IDLE_TIMEOUT_MINUTES: int = int(os.getenv("IDLE_TIMEOUT_MINUTES", "20"))

settings = Settings()

# Check for serverless read-only filesystem
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or os.environ.get("VERCEL_ENV"):
    settings.NOTEBOOKS_DIR = Path("/tmp/notebooks")
    settings.OUTPUTS_DIR = Path("/tmp/outputs")
    settings.TEMPLATES_DIR = Path("/tmp/templates")

# Safely ensure directories exist
try:
    settings.NOTEBOOKS_DIR.mkdir(parents=True, exist_ok=True)
    settings.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    settings.TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

