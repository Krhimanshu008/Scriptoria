import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 80));
    const category = req.nextUrl.searchParams.get("category");

    const logs = await prisma.systemLog.findMany({
      where: {
        userId: user.userId,
        ...(category && category !== "ALL" ? { category: category.toUpperCase() } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      logs: logs.reverse().map((l) => ({
        id: l.id,
        category: l.category,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.systemLog.deleteMany({ where: { userId: user.userId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

