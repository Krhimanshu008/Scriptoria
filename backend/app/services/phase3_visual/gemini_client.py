# app/services/phase3_visual/gemini_client.py
"""
Production Gemini 3.5 Client using the official `google-genai` SDK.
Powers the autonomous agent pods (Showrunner, DoP, Critic) with
high-speed structured inference.
"""

from typing import Type, TypeVar, Optional, List, Dict, Any
from pydantic import BaseModel
from google import genai
from google.genai import types

from app.core.config import settings

T = TypeVar("T", bound=BaseModel)


class GeminiStudioClient:
    """Singleton-style wrapper around Google GenAI client for structured agent calls."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        key = api_key or settings.GOOGLE_API_KEY or settings.GEMINI_API_KEY
        if not key:
            raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY must be configured in .env")
        self.client = genai.Client(api_key=key)
        self.model = model_name or settings.GEMINI_MODEL or "gemini-3.5-flash"

    async def generate_structured(
        self,
        prompt: str,
        response_schema: Type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.3,
    ) -> T:
        """Invokes Gemini 3.5 with strict Pydantic structured output validation."""
        config_kwargs: Dict[str, Any] = {
            "response_mime_type": "application/json",
            "response_schema": response_schema,
            "temperature": temperature,
        }
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction

        config = types.GenerateContentConfig(**config_kwargs)

        response = self.client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=config,
        )

        # Parse and return validated Pydantic model
        return response_schema.model_validate_json(response.text)

    async def generate_text(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """Invokes Gemini for freeform narrative or reasoning generation."""
        config_kwargs: Dict[str, Any] = {"temperature": temperature}
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction

        config = types.GenerateContentConfig(**config_kwargs)

        response = self.client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=config,
        )
        return response.text.strip()

