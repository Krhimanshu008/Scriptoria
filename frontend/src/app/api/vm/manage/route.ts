import { checkKaggleConnection } from "@/lib/orchestrator/kaggle-connection";
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
      return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
    }

    const conflict = await checkKaggleConnection(user.userId, cleanAlias, username);
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
    // 1. If username and apiKey provided, save encrypted credential
    if (username && apiKey) {
      await saveUserCredential(user.userId, {
        provider: "kaggle",
        accountAlias: cleanAlias,
        username: username.trim(),
        rawSecret: apiKey.trim(),
        metadata: { displayName: String(body.displayName || username).trim().slice(0, 80) },
      });
    }

    // Device IDs belong to the connection, independently of its editable label.
    const existing = await prisma.vmInstance.findMany({ where: { userId: user.userId },
      select: { target: true, provider: true, accountAlias: true } });
    const owned = existing.filter((v) => v.provider === "kaggle" && v.accountAlias === cleanAlias && /^gpu\d+$/.test(v.target))
      .sort((a, b) => Number(a.target.slice(3)) - Number(b.target.slice(3)));
    const used = new Set(existing.map((v) => v.target));
    const nextSlot = () => {
      let index = 0;
      while (used.has("gpu" + index)) index++;
      const target = "gpu" + index;
      used.add(target);
      return target;
    };
    const target1 = owned[0]?.target ?? nextSlot();
    const target2 = gpuType === "dual_t4" ? owned[1]?.target ?? nextSlot() : null;

    const targetsToCreate = [
      {
        target: target1,
        displayName: `Kaggle GPU ${target1.replace("gpu", "")}`,
        internalPort: 8188,
      },
    ];

    if (target2) {
      targetsToCreate.push({
        target: target2,
        displayName: `Kaggle GPU ${target2.replace("gpu", "")}`,
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
        ...(accountAlias ? { accountAlias, provider: "kaggle" } : { target: target! }),
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
        ...(accountAlias ? { accountAlias, provider: "kaggle" } : { target: target! }),
      },
    });

    // Optionally also remove the credential if accountAlias was deleted
    if (accountAlias) {
      await prisma.credential.deleteMany({
        where: {
          userId: user.userId,
          accountAlias,
          provider: { in: ["kaggle", "kaggle-meta", "kaggle-tpu-meta"] },
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
