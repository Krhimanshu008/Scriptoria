import { NextRequest, NextResponse } from "next/server";

import {
  type ApiErrorEnvelope,
  type ErrorCode,
  type ErrorDetail,
  isApiErrorEnvelope,
} from "@/types/testbench-contracts";

export const runtime = "nodejs";

const DEFAULT_FASTAPI_URL = "http://127.0.0.1:8000";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 10_485_760; // 10 MiB
const TRACE_ID_REGEX = /^[A-Za-z0-9._-]{8,128}$/;

export interface BridgeCallOptions {
  req: NextRequest;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  upstreamPath: string;
  timeoutMs?: number;
  maxPayloadBytes?: number;
}

function resolveTraceId(req: NextRequest): string {
  const incoming = req.headers.get("x-trace-id")?.trim();
  if (incoming && TRACE_ID_REGEX.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

function resolveFastApiBaseUrl(): string {
  const raw = process.env.SCRIPTORIA_FASTAPI_URL ?? DEFAULT_FASTAPI_URL;
  return raw.replace(/\/+$/, "");
}

function buildErrorEnvelope(params: {
  code: ErrorCode;
  message: string;
  traceId: string;
  retryable?: boolean;
  retryAfterMs?: number | null;
  details?: ErrorDetail[];
}): ApiErrorEnvelope {
  return {
    ok: false,
    error: {
      code: params.code,
      stage: "nextjs_proxy",
      message: params.message,
      trace_id: params.traceId,
      retryable: params.retryable ?? false,
      retry_after_ms: params.retryAfterMs ?? null,
      details: params.details ?? [],
    },
  };
}

function errorJsonResponse(params: {
  status: number;
  code: ErrorCode;
  message: string;
  traceId: string;
  retryable?: boolean;
  retryAfterMs?: number | null;
  details?: ErrorDetail[];
}): NextResponse {
  const envelope = buildErrorEnvelope({
    code: params.code,
    message: params.message,
    traceId: params.traceId,
    retryable: params.retryable,
    retryAfterMs: params.retryAfterMs,
    details: params.details,
  });

  return NextResponse.json(envelope, {
    status: params.status,
    headers: {
      "X-Trace-ID": params.traceId,
      "Cache-Control": "no-store",
    },
  });
}

async function readBoundedBody(
  req: NextRequest,
  maxBytes: number,
): Promise<{ ok: true; body: Uint8Array } | { ok: false; actualBytes: number }> {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const parsedLength = Number(contentLengthHeader);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false, actualBytes: parsedLength };
    }
  }

  if (req.body === null) {
    return { ok: true, body: new Uint8Array(0) };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel("Payload exceeds bridge maxPayloadBytes cap");
          return { ok: false, actualBytes: totalBytes };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, body: combined };
}

function extractNetworkErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string" && record.code.length > 0) {
      return record.code;
    }
    current = record.cause;
  }
  return null;
}

function classifyFetchFailure(params: {
  err: unknown;
  reqSignal: AbortSignal;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
  traceId: string;
}): NextResponse {
  const { err, reqSignal, timeoutSignal, timeoutMs, traceId } = params;

  const isTimeoutDomException =
    err instanceof DOMException && err.name === "TimeoutError";
  const networkCode = extractNetworkErrorCode(err);

  if (
    timeoutSignal.aborted ||
    isTimeoutDomException ||
    networkCode === "UND_ERR_CONNECT_TIMEOUT" ||
    networkCode === "ETIMEDOUT"
  ) {
    return errorJsonResponse({
      status: 504,
      code: "UPSTREAM_TIMEOUT",
      message: `FastAPI upstream timed out after ${timeoutMs}ms.`,
      traceId,
      retryable: true,
      retryAfterMs: 1_000,
    });
  }

  if (
    reqSignal.aborted ||
    (err instanceof DOMException && err.name === "AbortError")
  ) {
    return errorJsonResponse({
      status: 499,
      code: "UPSTREAM_TIMEOUT",
      message: "Client closed connection before upstream completed.",
      traceId,
      retryable: false,
    });
  }

  const detailCode = networkCode ?? (err instanceof Error ? err.name : "FETCH_FAILED");
  return errorJsonResponse({
    status: 503,
    code: "UPSTREAM_UNAVAILABLE",
    message: "FastAPI backend is unreachable.",
    traceId,
    retryable: true,
    retryAfterMs: 2_000,
    details: [
      {
        field: "upstream",
        message: "Failed to establish or maintain HTTP connection to FastAPI.",
        code: detailCode,
      },
    ],
  });
}

export async function forwardToFastAPI(opts: BridgeCallOptions): Promise<NextResponse> {
  const traceId = resolveTraceId(opts.req);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPayloadBytes = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;

  const hasBody = opts.method !== "GET";
  let requestBodyBytes: Uint8Array | undefined;

  if (hasBody) {
    let bodyResult: { ok: true; body: Uint8Array } | { ok: false; actualBytes: number };
    try {
      bodyResult = await readBoundedBody(opts.req, maxPayloadBytes);
    } catch (err) {
      if (opts.req.signal.aborted) {
        return errorJsonResponse({
          status: 499,
          code: "UPSTREAM_TIMEOUT",
          message: "Client aborted while streaming request body.",
          traceId,
        });
      }
      return errorJsonResponse({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Failed to read incoming request body.",
        traceId,
        details: [
          {
            field: "body",
            message: err instanceof Error ? err.message : "Unreadable request stream.",
            code: "body_read_error",
          },
        ],
      });
    }

    if (!bodyResult.ok) {
      return errorJsonResponse({
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: `Request payload (${bodyResult.actualBytes} bytes) exceeds ${maxPayloadBytes}-byte limit.`,
        traceId,
        details: [
          {
            field: "body",
            message: `Maximum allowed payload size is ${maxPayloadBytes} bytes.`,
            code: "payload_too_large",
          },
        ],
      });
    }

    requestBodyBytes = bodyResult.body;
  }

  const baseUrl = resolveFastApiBaseUrl();
  const normalizedPath = opts.upstreamPath.startsWith("/")
    ? opts.upstreamPath
    : `/${opts.upstreamPath}`;
  const targetUrl = `${baseUrl}${normalizedPath}${opts.req.nextUrl.search}`;

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("Accept", "application/json");
  upstreamHeaders.set("X-Trace-ID", traceId);

  const bridgeSecret = process.env.SCRIPTORIA_BRIDGE_SECRET;
  if (bridgeSecret && bridgeSecret.length > 0) {
    upstreamHeaders.set("X-Bridge-Secret", bridgeSecret);
  }

  if (hasBody) {
    const incomingContentType = opts.req.headers.get("content-type");
    upstreamHeaders.set(
      "Content-Type",
      incomingContentType ?? "application/json",
    );
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([opts.req.signal, timeoutSignal]);

  let upstreamRes: Response;
  let rawResponseText: string;

  try {
    upstreamRes = await fetch(targetUrl, {
      method: opts.method,
      headers: upstreamHeaders,
      body:
        requestBodyBytes !== undefined
          ? Buffer.from(requestBodyBytes)
          : undefined,
      signal: combinedSignal,
      cache: "no-store",
    });

    rawResponseText = await upstreamRes.text();
  } catch (err) {
    return classifyFetchFailure({
      err,
      reqSignal: opts.req.signal,
      timeoutSignal,
      timeoutMs,
      traceId,
    });
  }

  const responseTraceId =
    upstreamRes.headers.get("x-trace-id")?.trim() || traceId;

  let parsedBody: unknown;
  try {
    parsedBody = rawResponseText.length > 0 ? JSON.parse(rawResponseText) : null;
  } catch {
    return errorJsonResponse({
      status: upstreamRes.status >= 500 ? upstreamRes.status : 502,
      code: upstreamRes.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "CONTRACT_MISMATCH",
      message: `FastAPI returned non-JSON response (HTTP ${upstreamRes.status}).`,
      traceId: responseTraceId,
      retryable: upstreamRes.status >= 500,
      details: [
        {
          field: "response.body",
          message: "Expected application/json payload from upstream.",
          code: "invalid_upstream_json",
        },
      ],
    });
  }

  if (isApiErrorEnvelope(parsedBody)) {
    return NextResponse.json(parsedBody, {
      status: upstreamRes.status >= 400 ? upstreamRes.status : 502,
      headers: {
        "X-Trace-ID": parsedBody.error.trace_id || responseTraceId,
        "Cache-Control": "no-store",
      },
    });
  }

  if (!upstreamRes.ok) {
    return errorJsonResponse({
      status: upstreamRes.status,
      code: "CONTRACT_MISMATCH",
      message: `Upstream returned HTTP ${upstreamRes.status} without canonical ApiErrorEnvelope.`,
      traceId: responseTraceId,
      retryable: upstreamRes.status >= 500,
      details: [
        {
          field: "response",
          message: "Upstream error payload failed ApiErrorEnvelope contract check.",
          code: "non_canonical_error",
        },
      ],
    });
  }

  if (parsedBody === null || typeof parsedBody !== "object") {
    return errorJsonResponse({
      status: 502,
      code: "CONTRACT_MISMATCH",
      message: "Upstream returned empty or scalar JSON payload.",
      traceId: responseTraceId,
    });
  }

  return NextResponse.json(parsedBody, {
    status: upstreamRes.status,
    headers: {
      "X-Trace-ID": responseTraceId,
      "Cache-Control": "no-store",
    },
  });
}
