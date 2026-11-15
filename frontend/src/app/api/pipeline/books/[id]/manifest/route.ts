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
    const parsed = data?.json || (data?.text ? JSON.parse(data.text) : null);
    if (!parsed || !Array.isArray(parsed.sections)) {
      return NextResponse.json({
        book_id: id,
        total_sections: 0,
        total_story_chapters: 0,
        sections: [],
      });
    }
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({
      book_id: "",
      total_sections: 0,
      total_story_chapters: 0,
      sections: [],
    });
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
