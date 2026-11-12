import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { isValidWorkerProfile, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { sanitizeVmForClient, sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const body = await req.json();
    const applyToGroup = body.applyToGroup !== false;

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm) {
      return NextResponse.json({ error: `VM target '${target}' not found.` }, { status: 404 });
    }

    const updateData: {
      workerProfile?: string;
      displayName?: string;
      idleTimeoutMinutes?: number | null;
      prewarmModelsJson?: string | null;
    } = {};

    if (body.workerProfile !== undefined) {
      const workerProfile = String(body.workerProfile || "").trim();
      if (!isValidWorkerProfile(workerProfile)) {
        return NextResponse.json(
          { error: `Invalid workerProfile '${workerProfile}'.` },
          { status: 400 }
        );
      }
      updateData.workerProfile = workerProfile;
    }

    if (body.displayName !== undefined) {
      const name = String(body.displayName || "").trim().slice(0, 40);
      updateData.displayName = name;
    }

    if (body.idleTimeoutMinutes !== undefined) {
      if (body.idleTimeoutMinutes === null || body.idleTimeoutMinutes === "") {
        updateData.idleTimeoutMinutes = null;
      } else {
        const mins = Math.round(Number(body.idleTimeoutMinutes));
        if (!Number.isFinite(mins) || (mins !== 0 && (mins < 5 || mins > 240))) {
          return NextResponse.json(
            { error: "idleTimeoutMinutes must be null, 0, or 5–240 minutes." },
            { status: 400 }
          );
        }
        updateData.idleTimeoutMinutes = mins;
      }
    }

    if (body.prewarmModels !== undefined) {
      if (Array.isArray(body.prewarmModels)) {
        const clean = (body.prewarmModels as unknown[])
          .filter(
            (m): m is { slug?: string; category: string; filename: string } =>
              Boolean(
                m &&
                  typeof m === "object" &&
                  typeof (m as { category?: unknown }).category === "string" &&
                  typeof (m as { filename?: unknown }).filename === "string"
              )
          )
          .slice(0, 3)
          .map((m) => ({
            slug: m.slug,
            category: m.category,
            filename: m.filename,
          }));
        updateData.prewarmModelsJson = clean.length > 0 ? JSON.stringify(clean) : null;
      } else if (body.prewarmModels === null) {
        updateData.prewarmModelsJson = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid boot configuration fields supplied." }, { status: 400 });
    }

    if (applyToGroup) {
      // displayName is always per-target; group settings (profile, timeout, prewarm) apply to shared container
      const { displayName, ...groupData } = updateData;
      if (Object.keys(groupData).length > 0) {
        await prisma.vmInstance.updateMany({
          where: { userId: user.userId, sessionGroup: vm.sessionGroup },
          data: groupData,
        });
      }
      if (displayName !== undefined) {
        await prisma.vmInstance.update({
          where: { id: vm.id },
          data: { displayName },
        });
      }
    } else {
      await prisma.vmInstance.update({
        where: { id: vm.id },
        data: updateData,
      });
    }

    const effectiveProfile = updateData.workerProfile || vm.workerProfile;
    const profile = getWorkerProfile(effectiveProfile);
    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "ACTION",
      level: "INFO",
      message: `Updated ${target} boot config (${[
        updateData.workerProfile ? `profile=${profile.shortTag}` : null,
        updateData.idleTimeoutMinutes !== undefined
          ? `idle=${updateData.idleTimeoutMinutes ?? "global"}m`
          : null,
        updateData.prewarmModelsJson !== undefined ? "prewarm updated" : null,
        updateData.displayName !== undefined ? `name=${updateData.displayName}` : null,
      ]
        .filter(Boolean)
        .join(", ")}).`,
    });

    const refreshed = await prisma.vmInstance.findMany({
      where: { userId: user.userId, sessionGroup: vm.sessionGroup },
    });

    return NextResponse.json({
      ok: true,
      workerProfile: effectiveProfile,
      groupVms: sortVmsByCanonicalTarget(refreshed).map(sanitizeVmForClient),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update worker profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

