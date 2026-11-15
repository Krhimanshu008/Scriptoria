from __future__ import annotations

import contextvars
import logging
import os
import re
import secrets
import time
import uuid
from typing import Any, Iterable, Sequence

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.status import (
    HTTP_401_UNAUTHORIZED,
    HTTP_403_FORBIDDEN,
    HTTP_413_CONTENT_TOO_LARGE,
    HTTP_422_UNPROCESSABLE_CONTENT,
    HTTP_500_INTERNAL_SERVER_ERROR,
)
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.schemas.testbench_contracts import (
    ApiErrorBody,
    ApiErrorEnvelope,
    ErrorCode,
    ErrorDetail,
    ErrorStage,
)

logger = logging.getLogger("scriptoria.bridge")

TRACE_ID_HEADER = "X-Trace-ID"
BRIDGE_SECRET_HEADER = "X-Bridge-Secret"
BRIDGE_SECRET_ENV = "SCRIPTORIA_BRIDGE_SECRET"

_TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
_trace_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "scriptoria_trace_id",
    default=None,
)


def mint_trace_id() -> str:
    """Mint an RFC 9562 UUIDv7 trace identifier (uses stdlib uuid7 on Python 3.14+)."""
    uuid7_fn = getattr(uuid, "uuid7", None)
    if callable(uuid7_fn):
        return str(uuid7_fn())

    unix_ts_ms = time.time_ns() // 1_000_000
    rand_bytes = os.urandom(10)
    rand_a = int.from_bytes(rand_bytes[:2], "big") & 0x0FFF
    rand_b = int.from_bytes(rand_bytes[2:], "big") & ((1 << 62) - 1)

    value = (
        ((unix_ts_ms & ((1 << 48) - 1)) << 80)
        | (0x7 << 76)
        | (rand_a << 64)
        | (0b10 << 62)
        | rand_b
    )
    return str(uuid.UUID(int=value))


def get_trace_id() -> str | None:
    """Return the active request's trace ID from contextvars, if present."""
    return _trace_id_ctx.get()


def _sanitize_incoming_trace_id(raw_value: str | None) -> str:
    if raw_value:
        candidate = raw_value.strip()
        if _TRACE_ID_PATTERN.fullmatch(candidate):
            return candidate
    return mint_trace_id()


def resolve_trace_id(request: Request) -> str:
    """Resolve trace ID reliably across contextvars, request.state, headers, or minting."""
    ctx_trace_id = _trace_id_ctx.get()
    if ctx_trace_id:
        return ctx_trace_id

    state_trace_id = getattr(request.state, "trace_id", None)
    if isinstance(state_trace_id, str) and state_trace_id:
        return state_trace_id

    return _sanitize_incoming_trace_id(request.headers.get(TRACE_ID_HEADER))


def _extract_header(headers: Sequence[tuple[bytes, bytes]], name: str) -> str | None:
    target = name.lower().encode("latin-1")
    for raw_key, raw_val in headers:
        if raw_key.lower() == target:
            try:
                return raw_val.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None


def _build_error_response(
    *,
    status_code: int,
    code: ErrorCode,
    stage: ErrorStage,
    message: str,
    trace_id: str,
    retryable: bool = False,
    retry_after_ms: int | None = None,
    details: list[ErrorDetail] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    envelope = ApiErrorEnvelope(
        error=ApiErrorBody(
            code=code,
            stage=stage,
            message=message,
            trace_id=trace_id,
            retryable=retryable,
            retry_after_ms=retry_after_ms,
            details=details or [],
        )
    )
    headers = dict(extra_headers or {})
    headers[TRACE_ID_HEADER] = trace_id
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(mode="json"),
        headers=headers,
    )


class BridgeGuardMiddleware:
    """Pure-ASGI middleware enforcing X-Trace-ID propagation and X-Bridge-Secret verification."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        bridge_secret: str | None = None,
        exempt_paths: Iterable[str] = (),
    ) -> None:
        self.app = app
        self._explicit_secret = bridge_secret
        self._exempt_paths = frozenset(exempt_paths)

    def _resolve_expected_secret(self) -> str:
        if self._explicit_secret is not None:
            return self._explicit_secret
        return os.getenv(BRIDGE_SECRET_ENV, "")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers: list[tuple[bytes, bytes]] = list(scope.get("headers", ()))
        trace_id = _sanitize_incoming_trace_id(_extract_header(headers, TRACE_ID_HEADER))

        state = scope.setdefault("state", {})
        state["trace_id"] = trace_id
        token = _trace_id_ctx.set(trace_id)

        try:
            expected_secret = self._resolve_expected_secret()
            request_path = scope.get("path", "")

            if expected_secret and request_path not in self._exempt_paths:
                provided_secret = _extract_header(headers, BRIDGE_SECRET_HEADER)
                if not provided_secret:
                    response = _build_error_response(
                        status_code=HTTP_401_UNAUTHORIZED,
                        code=ErrorCode.CONTRACT_MISMATCH,
                        stage=ErrorStage.fastapi_validation,
                        message="Missing required X-Bridge-Secret header.",
                        trace_id=trace_id,
                        details=[
                            ErrorDetail(
                                field=f"header.{BRIDGE_SECRET_HEADER}",
                                message="Bridge secret header is required when bridge auth is enabled.",
                                code="missing_bridge_secret",
                            )
                        ],
                    )
                    await response(scope, receive, send)
                    return

                # Encode to UTF-8 bytes before compare_digest so non-ASCII headers never raise TypeError.
                if not secrets.compare_digest(
                    provided_secret.encode("utf-8"),
                    expected_secret.encode("utf-8"),
                ):
                    response = _build_error_response(
                        status_code=HTTP_403_FORBIDDEN,
                        code=ErrorCode.CONTRACT_MISMATCH,
                        stage=ErrorStage.fastapi_validation,
                        message="Invalid X-Bridge-Secret credential.",
                        trace_id=trace_id,
                        details=[
                            ErrorDetail(
                                field=f"header.{BRIDGE_SECRET_HEADER}",
                                message="Provided bridge secret failed verification.",
                                code="invalid_bridge_secret",
                            )
                        ],
                    )
                    await response(scope, receive, send)
                    return

            async def send_with_trace_id(message: Message) -> None:
                if message["type"] == "http.response.start":
                    raw_headers: list[tuple[bytes, bytes]] = [
                        (k, v)
                        for k, v in message.get("headers", ())
                        if k.lower() != b"x-trace-id"
                    ]
                    raw_headers.append((b"x-trace-id", trace_id.encode("latin-1")))
                    message = {**message, "headers": raw_headers}
                await send(message)

            await self.app(scope, receive, send_with_trace_id)
        finally:
            _trace_id_ctx.reset(token)


def _format_loc(loc: Sequence[Any]) -> str:
    return ".".join(str(part) for part in loc) if loc else "request"


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Normalize FastAPI/Pydantic RequestValidationError into ApiErrorEnvelope."""
    trace_id = resolve_trace_id(request)
    details: list[ErrorDetail] = []

    for err in exc.errors():
        raw_input = err.get("input")
        input_type = type(raw_input).__name__ if "input" in err else None
        details.append(
            ErrorDetail(
                field=_format_loc(err.get("loc", ())),
                message=str(err.get("msg", "Validation failed")),
                code=str(err.get("type")) if err.get("type") else None,
                input_type=input_type,
            )
        )

    return _build_error_response(
        status_code=HTTP_422_UNPROCESSABLE_CONTENT,
        code=ErrorCode.VALIDATION_ERROR,
        stage=ErrorStage.fastapi_validation,
        message="Request failed schema validation.",
        trace_id=trace_id,
        retryable=False,
        details=details,
    )


def _map_status_to_error_code(status_code: int) -> ErrorCode:
    if status_code == HTTP_413_CONTENT_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE
    if status_code in (400, 422):
        return ErrorCode.VALIDATION_ERROR
    if status_code in (401, 403, 404, 405, 409, 412, 415):
        return ErrorCode.CONTRACT_MISMATCH
    if status_code == 429:
        return ErrorCode.VRAM_BUSY
    if status_code == 504:
        return ErrorCode.UPSTREAM_TIMEOUT
    if status_code in (502, 503):
        return ErrorCode.UPSTREAM_UNAVAILABLE
    return ErrorCode.INTERNAL_ERROR


async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    """Normalize FastAPI and Starlette HTTPExceptions into ApiErrorEnvelope."""
    trace_id = resolve_trace_id(request)
    status_code = exc.status_code
    code = _map_status_to_error_code(status_code)
    stage = ErrorStage.fastapi_validation
    message = "Request failed."
    retryable = status_code in (429, 502, 503, 504)
    retry_after_ms: int | None = None
    details: list[ErrorDetail] = []

    raw_detail = exc.detail
    if isinstance(raw_detail, dict):
        if "code" in raw_detail:
            try:
                code = ErrorCode(raw_detail["code"])
            except ValueError:
                pass
        if "stage" in raw_detail:
            try:
                stage = ErrorStage(raw_detail["stage"])
            except ValueError:
                pass
        if isinstance(raw_detail.get("message"), str) and raw_detail["message"]:
            message = raw_detail["message"]
        if isinstance(raw_detail.get("retryable"), bool):
            retryable = raw_detail["retryable"]
        if isinstance(raw_detail.get("retry_after_ms"), int) and raw_detail["retry_after_ms"] >= 0:
            retry_after_ms = raw_detail["retry_after_ms"]
        if isinstance(raw_detail.get("details"), list):
            for item in raw_detail["details"]:
                if isinstance(item, ErrorDetail):
                    details.append(item)
                elif isinstance(item, dict) and isinstance(item.get("message"), str):
                    details.append(ErrorDetail(**item))
    elif isinstance(raw_detail, str) and raw_detail:
        message = raw_detail

    extra_headers: dict[str, str] = {}
    if exc.headers:
        for key, value in exc.headers.items():
            if key.lower() != TRACE_ID_HEADER.lower():
                extra_headers[key] = value

    return _build_error_response(
        status_code=status_code,
        code=code,
        stage=stage,
        message=message,
        trace_id=trace_id,
        retryable=retryable,
        retry_after_ms=retry_after_ms,
        details=details,
        extra_headers=extra_headers,
    )


async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Catch-all exception handler guaranteeing sanitized ApiErrorEnvelope responses."""
    trace_id = resolve_trace_id(request)
    logger.exception(
        "Unhandled exception during request %s %s [trace_id=%s]",
        request.method,
        request.url.path,
        trace_id,
        exc_info=exc,
    )
    return _build_error_response(
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        code=ErrorCode.INTERNAL_ERROR,
        stage=ErrorStage.fastapi_validation,
        message="An internal server error occurred.",
        trace_id=trace_id,
        retryable=False,
    )


def install_bridge_guard(
    app: FastAPI,
    *,
    bridge_secret: str | None = None,
    exempt_paths: Iterable[str] = (),
) -> None:
    """Install BridgeGuardMiddleware and global ApiErrorEnvelope exception handlers."""
    app.add_middleware(
        BridgeGuardMiddleware,
        bridge_secret=bridge_secret,
        exempt_paths=exempt_paths,
    )
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)


__all__ = [
    "BRIDGE_SECRET_ENV",
    "BRIDGE_SECRET_HEADER",
    "BridgeGuardMiddleware",
    "TRACE_ID_HEADER",
    "get_trace_id",
    "http_exception_handler",
    "install_bridge_guard",
    "mint_trace_id",
    "resolve_trace_id",
    "unhandled_exception_handler",
    "validation_exception_handler",
]
