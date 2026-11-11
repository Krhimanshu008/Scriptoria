import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { sanitizeVmForClient, sortVmsByCanonicalTarget } from "@/lib/orchestrator/vm-helpers";

const HEARTBEAT_STALE_MS = 90_000;

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const sorted = sortVmsByCanonicalTarget(updatedRows).map(sanitizeVmForClient);
    return NextResponse.json({ vms: sorted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load VM status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

