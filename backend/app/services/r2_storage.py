"""
Cloudflare R2 Blob Lake Storage Service.
Provides uniform S3-compatible API for raw books, chapter markdown,
scene JSON checkpoints, and compiled database artifacts.
Transparently falls back to local disk storage lake if cloud credentials are not supplied.
"""

from __future__ import annotations

import io
import json
import os
import shutil
from pathlib import Path
from typing import List, Optional, Union, Dict, Any

from dotenv import load_dotenv

# Resolve project paths
SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[3]

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "backend" / ".env")
load_dotenv(PROJECT_ROOT / "frontend" / ".env")
load_dotenv(PROJECT_ROOT / "frontend" / ".env.local")

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    _BOTO3_AVAILABLE = True
except ImportError:
    _BOTO3_AVAILABLE = False


class R2StorageService:
    """Manages blob storage operations against Cloudflare R2 (or local disk fallback)."""

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

        # Determine cloud vs local disk lake
        has_cloud_creds = bool(self.endpoint_url and self.access_key_id and self.secret_access_key)
        self.is_cloud = bool(has_cloud_creds and _BOTO3_AVAILABLE)

        if self.is_cloud:
            self.s3 = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                config=Config(signature_version="s3v4"),
                region_name="auto",
            )
            self.storage_mode = "cloudflare_r2"
        else:
            # Local disk lake fallback
            self.s3 = None
            if Path("/app/data/r2_lake").exists():
                self.local_root = Path("/app/data/r2_lake")
            else:
                self.local_root = PROJECT_ROOT / "data" / "r2_lake"
            self.local_root.mkdir(parents=True, exist_ok=True)
            self.storage_mode = "local_lake"

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
        clean_key = key.lstrip("/")
        if self.is_cloud:
            self.s3.put_object(
                Bucket=self.bucket_name,
                Key=clean_key,
                Body=data,
                ContentType=content_type,
            )
        else:
            p = self.local_root / clean_key
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        return clean_key

    def put_text(self, key: str, text: str, content_type: str = "text/plain; charset=utf-8") -> str:
        return self.put_bytes(key, text.encode("utf-8"), content_type=content_type)

    def put_json(self, key: str, data: Union[Dict[str, Any], List[Any]]) -> str:
        body = json.dumps(data, indent=2, ensure_ascii=False)
        return self.put_text(key, body, content_type="application/json; charset=utf-8")

    def get_bytes(self, key: str) -> bytes:
        clean_key = key.lstrip("/")
        if self.is_cloud:
            res = self.s3.get_object(Bucket=self.bucket_name, Key=clean_key)
            return res["Body"].read()
        else:
            p = self.local_root / clean_key
            if not p.exists():
                raise FileNotFoundError(f"Key not found in R2 storage: {clean_key}")
            return p.read_bytes()

    def get_text(self, key: str) -> str:
        return self.get_bytes(key).decode("utf-8")

    def get_json(self, key: str) -> Any:
        raw = self.get_text(key)
        return json.loads(raw)

    def upload_file(self, local_path: Union[str, Path], key: str, content_type: Optional[str] = None) -> str:
        p = Path(local_path)
        if not p.exists():
            raise FileNotFoundError(f"Local file does not exist: {local_path}")

        clean_key = key.lstrip("/")
        if self.is_cloud:
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

            self.s3.upload_file(str(p), self.bucket_name, clean_key, ExtraArgs=extra_args or None)
        else:
            target = self.local_root / clean_key
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(p), str(target))
        return clean_key

    def exists(self, key: str) -> bool:
        clean_key = key.lstrip("/")
        if self.is_cloud:
            try:
                self.s3.head_object(Bucket=self.bucket_name, Key=clean_key)
                return True
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
                    return False
                raise
        else:
            return (self.local_root / clean_key).exists()

    def file_exists(self, key: str) -> bool:
        return self.exists(key)

    def list_keys(self, prefix: str = "") -> List[str]:
        clean_prefix = prefix.lstrip("/")
        if self.is_cloud:
            keys = []
            paginator = self.s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=clean_prefix):
                for obj in page.get("Contents", []):
                    keys.append(obj["Key"])
            return sorted(keys)
        else:
            if not self.local_root.exists():
                return []
            keys = []
            for item in self.local_root.rglob("*"):
                if item.is_file():
                    rel = str(item.relative_to(self.local_root)).replace("\\", "/")
                    if not clean_prefix or rel.startswith(clean_prefix):
                        keys.append(rel)
            return sorted(keys)

    def delete_key(self, key: str) -> None:
        clean_key = key.lstrip("/")
        if self.is_cloud:
            self.s3.delete_object(Bucket=self.bucket_name, Key=clean_key)
        else:
            p = self.local_root / clean_key
            if p.exists():
                p.unlink()


# Global singleton instance helper
_instance: Optional[R2StorageService] = None

def get_r2_storage() -> R2StorageService:
    global _instance
    if _instance is None:
        _instance = R2StorageService()
    return _instance
