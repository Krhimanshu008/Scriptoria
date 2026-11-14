# app/core/config.py
import os
from pathlib import Path
from typing import Optional
from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BACKEND_DIR / ".env"

backend_env_vals = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
default_postgres_url = (
    backend_env_vals.get("DATABASE_URL")
    or "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"
)

class Settings(BaseSettings):
    # Supabase credentials
    SUPABASE_PROJECT_REF: str = "avwolouaxhjprevyskfk"
    SUPABASE_URL: str = "https://avwolouaxhjprevyskfk.supabase.co"
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"

    # Google Gemini Settings
    GOOGLE_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-3.5-flash"
    GOOGLE_API_KEY_SECONDARY: Optional[str] = None

    # Groq Settings
    GROQ_API_KEY: Optional[str] = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # OpenRouter Settings
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_MODEL: str = "nvidia/nemotron-3.5-lightning:free"

    # Embeddings
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIMENSION: int = 1536

    # ComfyUI GPU Endpoints
    COMFYUI_URL: str = "https://gpu0.krhimanshu.in"
    COMFYUI_GPU0_URL: str = "https://gpu0.krhimanshu.in"
    COMFYUI_GPU1_URL: str = "https://gpu1.krhimanshu.in"
    COMFYUI_COLAB_URL: Optional[str] = "https://gcgpu.krhimanshu.in"
    COMFYUI_HOST: str = "127.0.0.1"
    COMFYUI_PORT: int = 8188
    COMFYUI_USE_SSL: bool = False
    COMFYUI_CLIENT_ID: str = "novel_visualiser"
    COMFYUI_TIMEOUT_SECONDS: int = 600

    # App Environment
    APP_ENV: str = "development"
    DEBUG: bool = True

    model_config = SettingsConfigDict(
        env_file=(str(ENV_PATH), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
