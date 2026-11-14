"""
Cloudflare R2 Blob Lake Storage Service.
Provides uniform S3-compatible API for raw books, chapter markdown,
scene JSON checkpoints, and compiled database artifacts.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import List, Optional, Union, Dict, Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()


class R2StorageService:
    """Manages blob storage operations against Cloudflare R2."""

    def __init__(
        self,
        endpoint_url: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        bucket_name: Optional[str] = None,
    ) -> None:
        self.endpoint_url = endpoint_url or os.getenv("R2_ENDPOINT_URL")
        self.access_key_id = access_key_id or os.getenv("R2_ACCESS_KEY_ID")
        self.secret_access_key = secret_access_key or os.getenv("R2_SECRET_ACCESS_KEY")
        self.bucket_name = bucket_name or os.getenv("R2_BUCKET_NAME", "scriptoria")

        if not (self.endpoint_url and self.access_key_id and self.secret_access_key):
            raise ValueError("Missing Cloudflare R2 credentials in environment variables")

        self.s3 = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    # -----------------------------------------------------------------------
    # Canonical Key Builders
    # -----------------------------------------------------------------------
    @staticmethod
    def key_raw(book_id: str, filename: str) -> str:
        return f"raw/{book_id}/{filename}"

    @staticmethod
    def key_parsed_manifest(book_id: str) -> str:
        return f"parsed/{book_id}/manifest.json"

    @staticmethod
    def key_parsed_chapter(book_id: str, chapter_number: int) -> str:
        return f"parsed/{book_id}/ch_{chapter_number:03d}.md"

    @staticmethod
    def key_extracted_observation(book_id: str, chapter_number: int) -> str:
        return f"extracted/{book_id}/ch_{chapter_number:03d}_obs.json"

    @staticmethod
    def key_rolling_glossary(book_id: str) -> str:
        return f"extracted/{book_id}/rolling_glossary.json"

    @staticmethod
    def key_compiled_db(book_id: str) -> str:
        return f"compiled/{book_id}/book.db"

    # -----------------------------------------------------------------------
    # Basic Blob Operations
    # -----------------------------------------------------------------------
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self.s3.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return key

    def put_text(self, key: str, text: str, content_type: str = "text/plain; charset=utf-8") -> str:
        return self.put_bytes(key, text.encode("utf-8"), content_type=content_type)

    def put_json(self, key: str, data: Union[Dict[str, Any], List[Any]]) -> str:
        body = json.dumps(data, indent=2, ensure_ascii=False)
        return self.put_text(key, body, content_type="application/json; charset=utf-8")

    def get_bytes(self, key: str) -> bytes:
        res = self.s3.get_object(Bucket=self.bucket_name, Key=key)
        return res["Body"].read()

    def get_text(self, key: str) -> str:
        return self.get_bytes(key).decode("utf-8")

    def get_json(self, key: str) -> Any:
        raw = self.get_text(key)
        return json.loads(raw)

    def upload_file(self, local_path: Union[str, Path], key: str, content_type: Optional[str] = None) -> str:
        p = Path(local_path)
        if not p.exists():
            raise FileNotFoundError(f"Local file does not exist: {local_path}")
        
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        elif p.suffix.lower() == ".epub":
            extra_args["ContentType"] = "application/epub+zip"
        elif p.suffix.lower() == ".pdf":
            extra_args["ContentType"] = "application/pdf"
        elif p.suffix.lower() == ".md":
            extra_args["ContentType"] = "text/markdown; charset=utf-8"
        elif p.suffix.lower() == ".json":
            extra_args["ContentType"] = "application/json; charset=utf-8"

        self.s3.upload_file(str(p), self.bucket_name, key, ExtraArgs=extra_args or None)
        return key

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "404":
                return False
            raise

    def list_keys(self, prefix: str) -> List[str]:
        keys = []
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return sorted(keys)

    def delete_key(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket_name, Key=key)


# Global singleton instance helper
_instance: Optional[R2StorageService] = None

def get_r2_storage() -> R2StorageService:
    global _instance
    if _instance is None:
        _instance = R2StorageService()
    return _instance
