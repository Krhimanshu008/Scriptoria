import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 40));
    const jobs = await prisma.job.findMany({
      where: { userId: user.userId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const items = jobs.map((j) => {
      let outputs: Array<{ filename: string; gdriveFileId: string; gdrivePath: string; previewUrl: string }> = [];
      if (j.outputFiles) {
        try {
          outputs = JSON.parse(j.outputFiles);
        } catch {
          outputs = [];
        }
      }
      return {
        id: j.id,
        target: j.target,
        prompt: j.prompt,
        negativePrompt: j.negativePrompt,
        checkpoint: j.checkpoint,
        width: j.width,
        height: j.height,
        steps: j.steps,
        cfg: j.cfg,
        seed: j.seed,
        executionTimeMs: j.executionTimeMs,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
        outputs,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load outputs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

