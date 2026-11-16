from __future__ import annotations

import logging
from typing import Any, List, Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

try:
    from scripts.pipeline_bridge import dispatch_command, upload_book_bytes
except ImportError:
    from backend.scripts.pipeline_bridge import dispatch_command, upload_book_bytes

logger = logging.getLogger("scriptoria.bridge_runner")
router = APIRouter(prefix="/bridge", tags=["Pipeline Bridge Runner"])


class BridgeExecRequest(BaseModel):
    command: str
    args: List[str] = []
    stdin_data: Optional[str] = None


@router.post("/exec")
async def execute_bridge(req: BridgeExecRequest) -> Any:
    try:
        return dispatch_command(req.command, req.args, req.stdin_data)
    except Exception as exc:
        logger.exception("Error executing bridge command: %s", req.command)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/upload-book")
async def upload_book_endpoint(
    file: UploadFile = File(...),
    title: str = Form("Untitled Book"),
    author: str = Form("Unknown"),
) -> Any:
    try:
        file_bytes = await file.read()
        filename = file.filename or "book.epub"
        return upload_book_bytes(file_bytes, filename, title, author)
    except Exception as exc:
        logger.exception("Error uploading book via bridge: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
