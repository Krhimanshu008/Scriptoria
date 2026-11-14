import { NextRequest, NextResponse } from "next/server";

const FASTAPI_BASE_URL = process.env.FASTAPI_BASE_URL || "http://127.0.0.1:8000";

async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const targetPath = path.join("/");
  const targetUrl = new URL(`/api/v1/lab/${targetPath}`, FASTAPI_BASE_URL);

  // Copy query parameters
  request.nextUrl.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val);
  });

  const headers = new Headers();
  request.headers.forEach((val, key) => {
    const k = key.toLowerCase();
    if (!["host", "connection", "content-length", "expect", "transfer-encoding", "keep-alive"].includes(k)) {
      headers.set(key, val);
    }
  });

  let body: BodyInit | null = null;
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      body = await request.formData();
      headers.delete("content-type");
    } else {
      body = await request.text();
    }
  }

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: headers,
      body: body,
    };
    if (body instanceof ReadableStream) {
      // @ts-expect-error Next fetch duplex option for streaming
      fetchOptions.duplex = "half";
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);

    const resHeaders = new Headers();
    response.headers.forEach((val, key) => {
      resHeaders.set(key, val);
    });

    // Pass through SSE event streams in real time
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    }

    const data = await response.arrayBuffer();
    return new NextResponse(data, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders,
    });
  } catch (error: unknown) {
    const err = error as { message?: string; cause?: unknown };
    console.error("Lab proxy error:", error);
    return NextResponse.json(
      {
        error: "Failed to connect to FastAPI Test Lab backend at http://127.0.0.1:8000",
        details: err?.message || String(error),
        cause: err?.cause ? String(err.cause) : undefined,
      },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;

