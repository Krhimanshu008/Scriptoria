import { NextResponse, type NextRequest } from "next/server";
import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const upstreamPath = `/api/v1/flow-bridge/${path.join("/")}`;
  return forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const upstreamPath = `/api/v1/flow-bridge/${path.join("/")}`;
  return forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath,
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
