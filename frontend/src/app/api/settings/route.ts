import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { isValidWorkerProfile } from "@/lib/catalog/worker-profiles";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { appendSystemLog } from "@/lib/logs/logger";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getOrCreateWorkspaceSettings(user.userId);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    await getOrCreateWorkspaceSettings(user.userId);

    const updateData: Record<string, unknown> = {};

    if (body.defaultDashboard !== undefined) {
      const dash = String(body.defaultDashboard).trim().toLowerCase();
      if (dash !== "vms" && dash !== "studio") {
        return NextResponse.json(
          { error: "defaultDashboard must be 'vms' or 'studio'." },
          { status: 400 }
        );
      }
      updateData.defaultDashboard = dash;
    }

    if (body.gdriveBaseFolder !== undefined) {
      const folder = String(body.gdriveBaseFolder).trim().replace(/^\/+|\/+$/g, "");
      if (!folder) {
        return NextResponse.json(
          { error: "gdriveBaseFolder cannot be empty." },
          { status: 400 }
        );
      }
      updateData.gdriveBaseFolder = folder;
    }

    if (typeof body.autoBackupToDrive === "boolean") {
      updateData.autoBackupToDrive = body.autoBackupToDrive;
    }

    if (body.diskCleanupThresholdGb !== undefined) {
      const threshold = Number(body.diskCleanupThresholdGb);
      if (!Number.isFinite(threshold) || threshold < 1 || threshold > 40) {
        return NextResponse.json(
          { error: "diskCleanupThresholdGb must be between 1 and 40 GB." },
          { status: 400 }
        );
      }
      updateData.diskCleanupThresholdGb = threshold;
    }

    if (body.idleTimeoutMinutes !== undefined) {
      const mins = Math.round(Number(body.idleTimeoutMinutes));
      if (!Number.isFinite(mins) || (mins !== 0 && (mins < 5 || mins > 240))) {
        return NextResponse.json(
          { error: "idleTimeoutMinutes must be 0 (disabled) or between 5 and 240 minutes." },
          { status: 400 }
        );
      }
      updateData.idleTimeoutMinutes = mins;
    }

    if (body.defaultWorkerProfile !== undefined) {
      const profile = String(body.defaultWorkerProfile).trim();
      if (!isValidWorkerProfile(profile)) {
        return NextResponse.json(
          { error: `Invalid defaultWorkerProfile '${profile}'.` },
          { status: 400 }
        );
      }
      updateData.defaultWorkerProfile = profile;
    }

    if (typeof body.autoVaeFixSdxl === "boolean") {
      updateData.autoVaeFixSdxl = body.autoVaeFixSdxl;
    }

    if (body.preferredLlmProvider !== undefined) {
      updateData.preferredLlmProvider =
        String(body.preferredLlmProvider).trim().toLowerCase() || "gemini";
    }

    if (body.preferredLlmModel !== undefined) {
      updateData.preferredLlmModel = String(body.preferredLlmModel).trim() || "gemini-2.5-flash";
    }

    if (body.agentMode !== undefined) {
      const mode = String(body.agentMode).trim().toUpperCase();
      if (mode !== "COPILOT" && mode !== "AUTONOMOUS") {
        return NextResponse.json(
          { error: "agentMode must be 'COPILOT' or 'AUTONOMOUS'." },
          { status: 400 }
        );
      }
      updateData.agentMode = mode;
    }

    if (body.systemInstructions !== undefined) {
      updateData.systemInstructions = String(body.systemInstructions).slice(0, 4000);
    }

    await prisma.workspaceSettings.update({
      where: { userId: user.userId },
      data: updateData,
    });

    if (typeof updateData.gdriveBaseFolder === "string") {
      const gdriveCreds = await prisma.credential.findMany({
        where: { userId: user.userId, provider: "gdrive" },
      });
      for (const cred of gdriveCreds) {
        let meta: Record<string, unknown> = {};
        if (cred.metadataJson) {
          try {
            meta = JSON.parse(cred.metadataJson) as Record<string, unknown>;
          } catch {
            meta = {};
          }
        }
        meta.baseFolder = updateData.gdriveBaseFolder;
        await prisma.credential.update({
          where: { id: cred.id },
          data: { metadataJson: JSON.stringify(meta) },
        });
      }
    }

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "INFO",
      message: `Updated Workspace Settings (${Object.keys(updateData).join(", ") || "no-op"}).`,
    });

    const settings = await getOrCreateWorkspaceSettings(user.userId);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save workspace settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
