import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { fetchGDriveFileStream } from "@/lib/gdrive/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId } = await params;
    if (!fileId) {
      return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
    }

    const driveRes = await fetchGDriveFileStream(user.userId, fileId);
    if (!driveRes.ok || !driveRes.body) {
      return NextResponse.json(
        { error: `Failed to fetch file from Google Drive (${driveRes.status})` },
        { status: driveRes.status === 404 ? 404 : 502 }
      );
    }

    const contentType = driveRes.headers.get("content-type") || "image/png";
    return new NextResponse(driveRes.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stream Google Drive output";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

