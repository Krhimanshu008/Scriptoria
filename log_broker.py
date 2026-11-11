"""
Real-time Log Broker for VM Toggle & CLI Dashboard
Streams logs over WebSockets with ANSI/category formatting and in-memory replay.
"""

from __future__ import annotations
import asyncio
from collections import deque
from datetime import datetime, timezone
import json
import logging
from typing import Any, List, Optional
from fastapi import WebSocket

logger = logging.getLogger("vm_log_broker")

class LogEntry:
    def __init__(self, message: str, category: str = "INFO", level: str = "INFO", details: Optional[dict] = None):
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self.message = message.strip()
        self.category = category.upper()
        self.level = level.upper()
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "log",
            "timestamp": self.timestamp,
            "category": self.category,
            "level": self.level,
            "message": self.message,
            "details": self.details,
        }

class LogBroker:
    def __init__(self, max_history: int = 1000):
        self.history: deque[LogEntry] = deque(maxlen=max_history)
        self.connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def register(self, websocket: WebSocket) -> None:
        await self._lock.acquire()
        try:
            self.connections.append(websocket)
        finally:
            self._lock.release()

        # Replay latest 150 entries to the newly connected client
        for entry in list(self.history)[-150:]:
            try:
                await websocket.send_text(json.dumps(entry.to_dict()))
            except Exception:
                break

    async def unregister(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.connections:
                self.connections.remove(websocket)

    def log(self, message: str, category: str = "INFO", level: str = "INFO", details: Optional[dict] = None) -> None:
        """Synchronously queue a log entry and schedule async broadcast."""
        entry = LogEntry(message, category, level, details)
        self.history.append(entry)
        print(f"[{entry.category}][{entry.level}] {entry.message}")

        # Schedule broadcast on the active event loop if running
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                asyncio.create_task(self.broadcast(entry))
        except RuntimeError:
            pass

    async def broadcast(self, entry: LogEntry) -> None:
        msg_str = json.dumps(entry.to_dict())
        dead_conns = []
        for ws in self.connections:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead_conns.append(ws)

        if dead_conns:
            async with self._lock:
                for ws in dead_conns:
                    if ws in self.connections:
                        self.connections.remove(ws)

    async def broadcast_status(self, status_payload: dict[str, Any]) -> None:
        """Broadcast live VM state changes (online/offline/metrics) to all dashboards."""
        msg_str = json.dumps({"type": "status_update", "data": status_payload})
        dead_conns = []
        for ws in self.connections:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead_conns.append(ws)

        if dead_conns:
            async with self._lock:
                for ws in dead_conns:
                    if ws in self.connections:
                        self.connections.remove(ws)

log_broker = LogBroker()

