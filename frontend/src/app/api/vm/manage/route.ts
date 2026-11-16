import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { saveUserCredential } from "@/lib/crypto/credentials";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { getDecryptedCredential } from "@/lib/crypto/credentials";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vms = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
      orderBy: { target: "asc" },
    });

    const kaggleCreds = await prisma.credential.findMany({
      where: { userId: user.userId, provider: "kaggle" },
      select: { accountAlias: true, username: true },
    });

    const credMap = new Map(kaggleCreds.map((c) => [c.accountAlias, c.username]));

    return NextResponse.json({
      vms,
      credentials: Array.from(credMap.entries()).map(([alias, user]) => ({
        accountAlias: alias,
        username: user,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { accountAlias, username, apiKey, gpuType = "dual_t4", workerProfile = "LLM_LIGHTWEIGHT_SWARM" } = body;

    const cleanAlias = (accountAlias || "").trim().toLowerCase();
    if (!cleanAlias) {
      return NextResponse.json({ error: "Account alias is required (e.g. acc3, acc5)." }, { status: 400 });
    }

    // 1. If username and apiKey provided, save encrypted credential
    if (username && apiKey) {
      await saveUserCredential(user.userId, {
        provider: "kaggle",
        accountAlias: cleanAlias,
        username: username.trim(),
        rawSecret: apiKey.trim(),
      });
    }

    // 2. Determine target names for this account
    // Check existing targets to avoid collisions
    const existing = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
      select: { target: true },
    });
    const existingSet = new Set(existing.map((e) => e.target));

    // Try finding standard targets for alias (acc1 -> gpu0,1; acc2 -> gpu2,3; acc3 -> gpu4,5; etc.)
    const aliasMatch = cleanAlias.match(/\d+/);
    const aliasNum = aliasMatch ? parseInt(aliasMatch[0], 10) : null;

    let target1: string;
    let target2: string | null = null;

    if (aliasNum !== null && aliasNum >= 1) {
      const baseIdx = (aliasNum - 1) * 2;
      target1 = `gpu${baseIdx}`;
      target2 = gpuType === "dual_t4" ? `gpu${baseIdx + 1}` : null;
    } else {
      // Find lowest available gpu number
      let i = 0;
      while (existingSet.has(`gpu${i}`)) i++;
      target1 = `gpu${i}`;
      if (gpuType === "dual_t4") {
        let j = i + 1;
        while (existingSet.has(`gpu${j}`)) j++;
        target2 = `gpu${j}`;
      }
    }

    const targetsToCreate = [
      {
        target: target1,
        displayName: `Kaggle GPU ${target1.replace("gpu", "")} (${cleanAlias.toUpperCase()})`,
        internalPort: 8188,
      },
    ];

    if (target2) {
      targetsToCreate.push({
        target: target2,
        displayName: `Kaggle GPU ${target2.replace("gpu", "")} (${cleanAlias.toUpperCase()})`,
        internalPort: 8189,
      });
    }

    // Create or update slots
    const results = await Promise.all(
      targetsToCreate.map((slot) =>
        prisma.vmInstance.upsert({
          where: {
            userId_target: { userId: user.userId, target: slot.target },
          },
          update: {
            accountAlias: cleanAlias,
            sessionGroup: `kaggle-${cleanAlias}`,
            displayName: slot.displayName,
            workerProfile,
            internalPort: slot.internalPort,
            provider: "kaggle",
          },
          create: {
            userId: user.userId,
            target: slot.target,
            displayName: slot.displayName,
            provider: "kaggle",
            accountAlias: cleanAlias,
            sessionGroup: `kaggle-${cleanAlias}`,
            workerProfile,
            internalPort: slot.internalPort,
            publicUrl: "",
            status: "OFFLINE",
            stepProgress: 0,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      message: `Account ${cleanAlias.toUpperCase()} configured with slots: ${results.map((r) => r.target).join(", ")}`,
      created: results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountAlias = searchParams.get("accountAlias");
    const target = searchParams.get("target");

    if (!accountAlias && !target) {
      return NextResponse.json(
        { error: "Either accountAlias or target query param is required." },
        { status: 400 }
      );
    }

    // Find VMs to delete
    const vmsToDelete = await prisma.vmInstance.findMany({
      where: {
        userId: user.userId,
        ...(accountAlias ? { accountAlias } : { target: target! }),
      },
    });

    if (vmsToDelete.length === 0) {
      return NextResponse.json({ error: "No matching VM slots found." }, { status: 404 });
    }

    // Best-effort kill running sessions
    for (const vm of vmsToDelete) {
      if (vm.status === "ONLINE" || vm.status === "STARTING" || vm.status === "BUSY") {
        try {
          if (vm.publicUrl) {
            await VmGateway.killVm(vm);
          } else {
            const kaggleCred = await getDecryptedCredential(user.userId, "kaggle", vm.accountAlias);
            const kaggleMeta = await getDecryptedCredential(user.userId, "kaggle-meta", vm.accountAlias);
            const sessionId = Number(kaggleMeta?.secret || 0);
            if (kaggleCred?.username && sessionId > 0) {
              await KaggleOrchestrator.cancelKernelSession(
                {
                  username: kaggleCred.username,
                  key: kaggleCred.secret,
                  authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
                },
                sessionId
              );
            }
          }
        } catch {
          // ignore error during cleanup
        }
      }
    }

    // Delete VM instances from DB
    const deleteResult = await prisma.vmInstance.deleteMany({
      where: {
        userId: user.userId,
        ...(accountAlias ? { accountAlias } : { target: target! }),
      },
    });

    // Optionally also remove the credential if accountAlias was deleted
    if (accountAlias) {
      await prisma.credential.deleteMany({
        where: {
          userId: user.userId,
          accountAlias,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${deleteResult.count} VM slot(s).`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
