import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, ensureUserVmSlots } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { appendSystemLog } from "@/lib/logs/logger";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { sanitizeVmForClient, sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";

const HEARTBEAT_STALE_MS = 90_000;
const KAGGLE_PRE_HEARTBEAT_POLL_MS = 8_000;
const KAGGLE_ACTIVE_POLL_MS = 30_000;
const lastKagglePollAt = new Map<string, number>();

function pickBestKernelError(lines: string[], fallback?: string): string {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return fallback || "Kaggle kernel exited before opening a tunnel.";

  // If there's an actual exception line (e.g. "SyntaxError: ...", "RuntimeError: ...", "ImportError: ...")
  const excLine = [...clean]
    .reverse()
    .find((l) =>
      /^[A-Za-z0-9_]+Error:|^[A-Za-z0-9_]+Exception:|Name or service not known|No space left on device|Killed/i.test(l)
    );
  if (excLine) return excLine.slice(0, 220);

  // If there's a logged heartbeat or error line
  const priority = [...clean]
    .reverse()
    .find((l) =>
      /\[HEARTBEAT\]|\[ERROR\]|DeadKernelError/i.test(l)
    );
  if (priority) return priority.slice(0, 220);

  // Fallback to the last line
  return clean[clean.length - 1].slice(0, 220);
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserVmSlots(user.userId);

    const forceProbe = req.nextUrl.searchParams.get("probe") === "true";
    const rows = await prisma.vmInstance.findMany({
      where: { userId: user.userId },
    });

    const now = Date.now();
    const updatedRows = await Promise.all(
      rows.map(async (vm) => {
        const isOnline = vm.status === "ONLINE" || vm.status === "BUSY";
        const lastBeatMs = vm.lastHeartbeat ? vm.lastHeartbeat.getTime() : 0;
        const stale = isOnline && now - lastBeatMs > HEARTBEAT_STALE_MS;

        if ((forceProbe || stale) && vm.publicUrl && isOnline) {
          const t0 = Date.now();
          try {
            const stats = await new ComfyClient(vm).getSystemStats();
            const latency = Date.now() - t0;
            const dev = stats.devices?.[0];
            const vramTotal = dev ? Number((dev.vram_total / 1024 ** 3).toFixed(2)) : vm.vramTotalGb ?? 16;
            const vramFree = dev ? Number((dev.vram_free / 1024 ** 3).toFixed(2)) : 0;
            const vramUsed = Number(Math.max(0, vramTotal - vramFree).toFixed(2));

            return prisma.vmInstance.update({
              where: { id: vm.id },
              data: {
                latencyMs: latency,
                gpuName: dev?.name || vm.gpuName,
                vramTotalGb: vramTotal,
                vramUsedGb: vramUsed,
                lastHeartbeat: new Date(),
                stepProgress: 5,
                status: "ONLINE",
              },
            });
          } catch {
            if (stale) {
              return prisma.vmInstance.update({
                where: { id: vm.id },
                data: {
                  status: "OFFLINE",
                  stepProgress: 0,
                  latencyMs: null,
                  vramUsedGb: 0,
                  onlineSince: null,
                  publicUrl: "",
                },
              });
            }
          }
        }
        return vm;
      })
    );

    // Rate-limited Kaggle boot polling: catch failed kernels or silent heartbeat blocks quickly
    const startingKaggleAliases = new Set<string>();
    for (const vm of updatedRows) {
      if (vm.provider !== "kaggle" || vm.status !== "STARTING") continue;
      const pollKey = `${user.userId}:${vm.accountAlias}`;
      const lastPolledMs = lastKagglePollAt.get(pollKey) || 0;
      const lastActivityMs = Math.max(vm.updatedAt.getTime(), vm.lastHeartbeat?.getTime() || 0, lastPolledMs);
      const pollInterval = vm.stepProgress <= 1 ? KAGGLE_PRE_HEARTBEAT_POLL_MS : KAGGLE_ACTIVE_POLL_MS;
      if (forceProbe || now - lastActivityMs >= pollInterval) {
        startingKaggleAliases.add(vm.accountAlias);
        lastKagglePollAt.set(pollKey, now);
      }
    }

    if (startingKaggleAliases.size > 0) {
      await Promise.all(
        Array.from(startingKaggleAliases).map(async (alias) => {
          const groupRows = updatedRows.filter(
            (r) => r.provider === "kaggle" && r.accountAlias === alias && r.status === "STARTING"
          );
          if (groupRows.length === 0) return;

          const kc = await getDecryptedCredential(user.userId, "kaggle", alias);
          if (!kc?.username || !kc.secret) return;

          const creds = {
            username: kc.username,
            key: kc.secret,
            authType: (kc.authType === "bearer" ? "bearer" : "basic") as "bearer" | "basic",
          };

          try {
            const st = await KaggleOrchestrator.getKernelStatus(creds, `kaggle-dual-gpu-runner-${alias}`);
            const kStatus = String(st.status || "").toLowerCase();

            if (kStatus === "error" || kStatus === "cancelacknowledged" || kStatus === "complete") {
              const logLines = await KaggleOrchestrator.getKernelOutput(
                creds,
                `kaggle-dual-gpu-runner-${alias}`
              );
              const detail =
                kStatus === "cancelacknowledged"
                  ? "Cancelled on Kaggle."
                  : pickBestKernelError(logLines, st.failureMessage);
              const nextStatus = kStatus === "cancelacknowledged" ? "OFFLINE" : "ERROR";

              await prisma.vmInstance.updateMany({
                where: {
                  userId: user.userId,
                  provider: "kaggle",
                  accountAlias: alias,
                  status: "STARTING",
                },
                data: {
                  status: nextStatus,
                  stepProgress: 0,
                  publicUrl: "",
                  lastError: nextStatus === "ERROR" ? detail : null,
                },
              });

              await appendSystemLog({
                userId: user.userId,
                vmInstanceId: groupRows[0].id,
                category: nextStatus === "ERROR" ? "ERROR" : "ACTION",
                level: nextStatus === "ERROR" ? "ERROR" : "WARN",
                message: `Kaggle (${alias}) ${kStatus}: ${detail}`,
              });
            } else {
              const allPreHeartbeat = groupRows.every((r) => r.stepProgress <= 1);
              if (allPreHeartbeat) {
                const hint =
                  kStatus === "running"
                    ? "Running on Kaggle GPU — awaiting first heartbeat callback..."
                    : kStatus === "queued"
                    ? "Queued on Kaggle GPU..."
                    : null;
                if (groupRows.some((r) => r.lastError !== hint)) {
                  await prisma.vmInstance.updateMany({
                    where: {
                      userId: user.userId,
                      provider: "kaggle",
                      accountAlias: alias,
                      status: "STARTING",
                      stepProgress: { lte: 1 },
                    },
                    data: { lastError: hint },
                  });
                }
              }
            }
          } catch {
            // Ignore transient Kaggle status API blips
          }
        })
      );

      const finalRows = await prisma.vmInstance.findMany({ where: { userId: user.userId } });
      return NextResponse.json({
        vms: sortVmsByCanonicalTarget(finalRows).map(sanitizeVmForClient),
      });
    }

    const sorted = sortVmsByCanonicalTarget(updatedRows).map(sanitizeVmForClient);
    return NextResponse.json({ vms: sorted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load VM status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
