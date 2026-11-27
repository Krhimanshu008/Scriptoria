import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/api-token";
import { fetchGDriveFileStream } from "@/lib/gdrive/client";
import { readLocalOutputFile } from "@/lib/orchestrator/local-vault";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId } = await params;
    if (!fileId) {
      return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
    }

    if (fileId.startsWith("local-")) {
      const localFile = await readLocalOutputFile(auth.userId, fileId);
      if (!localFile) {
        return NextResponse.json({ error: "Local output artifact not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(localFile.bytes), {
        status: 200,
        headers: {
          "Content-Type": localFile.contentType,
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": `inline; filename="${localFile.filename}"`,
        },
      });
    }

    const driveRes = await fetchGDriveFileStream(auth.userId, fileId);
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

