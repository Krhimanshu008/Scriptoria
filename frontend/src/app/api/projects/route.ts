import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const projects = await prisma.project.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
      include: {
        characters: true,
        scenes: { orderBy: { orderIndex: "asc" } },
      },
    });

    return NextResponse.json({
      projects: projects.map((p) => ({
        ...p,
        scenes: p.scenes.map((s) => ({
          ...s,
          tracks: s.tracksJson ? JSON.parse(s.tracksJson) : {},
        })),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json()) as {
      action: "create_project" | "add_character" | "upsert_scene" | "delete_project";
      projectId?: string;
      sceneId?: string;
      title?: string;
      description?: string;
      stylePreset?: string;
      name?: string;
      triggerWords?: string;
      loraSlug?: string;
      voicePreset?: string;
      narration?: string;
      tracks?: Record<string, unknown>;
      orderIndex?: number;
    };

    if (body.action === "create_project") {
      const proj = await prisma.project.create({
        data: {
          userId: user.userId,
          title: String(body.title || "Untitled Storyboard Project").trim(),
          description: String(body.description || "").trim(),
          stylePreset: String(body.stylePreset || "Illustrious Anime"),
          scenes: {
            create: {
              orderIndex: 0,
              title: "Scene 1 · Opening",
              narration: "",
              tracksJson: JSON.stringify({
                visual: { prompt: "", width: 1344, height: 768 },
                audio_tts: { text: "", voice: "af_heart" },
                audio_sfx: { prompt: "" },
                audio_bgm: { mood: "" },
                video_i2v: { motionPrompt: "" },
              }),
            },
          },
        },
        include: { characters: true, scenes: true },
      });
      return NextResponse.json({ ok: true, project: proj });
    }

    if (body.action === "delete_project" && body.projectId) {
      await prisma.project.deleteMany({
        where: { id: body.projectId, userId: user.userId },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "add_character" && body.projectId) {
      const proj = await prisma.project.findFirst({
        where: { id: body.projectId, userId: user.userId },
      });
      if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      const ch = await prisma.characterProfile.create({
        data: {
          projectId: proj.id,
          name: String(body.name || "Character").trim(),
          triggerWords: String(body.triggerWords || "").trim(),
          loraSlug: body.loraSlug || null,
          voicePreset: String(body.voicePreset || "af_heart"),
        },
      });
      return NextResponse.json({ ok: true, character: ch });
    }

    if (body.action === "upsert_scene" && body.projectId) {
      const proj = await prisma.project.findFirst({
        where: { id: body.projectId, userId: user.userId },
      });
      if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      if (body.sceneId) {
        const updated = await prisma.scene.update({
          where: { id: body.sceneId },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.narration !== undefined ? { narration: body.narration } : {}),
            ...(body.tracks !== undefined ? { tracksJson: JSON.stringify(body.tracks) } : {}),
          },
        });
        return NextResponse.json({ ok: true, scene: updated });
      }

      const count = await prisma.scene.count({ where: { projectId: proj.id } });
      const created = await prisma.scene.create({
        data: {
          projectId: proj.id,
          orderIndex: body.orderIndex ?? count,
          title: String(body.title || `Scene ${count + 1}`),
          narration: String(body.narration || ""),
          tracksJson: JSON.stringify(
            body.tracks || {
              visual: { prompt: "", width: 1344, height: 768 },
              audio_tts: { text: "", voice: "af_heart" },
              audio_sfx: { prompt: "" },
              audio_bgm: { mood: "" },
              video_i2v: { motionPrompt: "" },
            }
          ),
        },
      });
      return NextResponse.json({ ok: true, scene: created });
    }

    return NextResponse.json({ error: "Unsupported project action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

