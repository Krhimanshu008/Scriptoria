import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const manifestKey = `parsed/${id}/manifest.json`;
    const data = await runPipelineBridge("r2_get", [manifestKey], undefined, 10000);
    return NextResponse.json(data.json || data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch manifest" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const updatedManifest = await req.json();
    const manifestStr = JSON.stringify(updatedManifest, null, 2);
    const result = await runPipelineBridge("save_manifest", [id, "-"], manifestStr, 10000);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to update manifest" },
      { status: 500 }
    );
  }
}
