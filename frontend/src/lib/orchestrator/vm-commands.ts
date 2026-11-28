import { prisma } from "@/lib/db/prisma";

export type VmCommandAction = "STAGE_LLM" | "LOAD_LLM" | "UNLOAD_LLM" | "FREE_VRAM";
export type VmCommandStatus = "PENDING" | "DISPATCHED" | "COMPLETED" | "FAILED";

export interface VmCommandPayload {
  presetId?: string;
  modelName?: string;
  repoId?: string;
  fileHints?: string[];
  mmprojHints?: string[];
  companionRepos?: Array<{
    role: string;
    repoId: string;
    fileHints: string[];
    mmprojHints: string[];
  }>;
  topologyMode?: string;
  gpuLayers?: number;
  ctxSize?: number;
  approxDiskGb?: number;
  useDflash2?: boolean;
}

export interface VmCommandAckInput {
  id: string;
  status: "COMPLETED" | "FAILED" | "DISPATCHED";
  resultMessage?: string;
}

const globalForVmCommand = globalThis as unknown as {
  __vmCommandTableReady?: boolean;
  __vmCommandTablePromise?: Promise<void> | null;
};

/**
 * Guarantees the VmCommand table exists in SQLite/LibSQL before any read or write,
 * preventing race conditions if a server process starts ahead of manual migrations.
 */
export async function ensureVmCommandTableReady(): Promise<void> {
  if (globalForVmCommand.__vmCommandTableReady) return;
  if (!globalForVmCommand.__vmCommandTablePromise) {
    globalForVmCommand.__vmCommandTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "VmCommand" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "vmInstanceId" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "sessionGroup" TEXT NOT NULL,
          "target" TEXT NOT NULL,
          "action" TEXT NOT NULL,
          "payloadJson" TEXT,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "resultMessage" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "VmCommand_vmInstanceId_fkey" FOREIGN KEY ("vmInstanceId") REFERENCES "VmInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "VmCommand_sessionGroup_status_createdAt_idx" ON "VmCommand"("sessionGroup", "status", "createdAt")`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "VmCommand_vmInstanceId_status_idx" ON "VmCommand"("vmInstanceId", "status")`
      );
      globalForVmCommand.__vmCommandTableReady = true;
    })().finally(() => {
      globalForVmCommand.__vmCommandTablePromise = null;
    });
  }
  return globalForVmCommand.__vmCommandTablePromise;
}

export async function enqueueVmCommand(params: {
  vmInstanceId: string;
  userId: string;
  sessionGroup: string;
  target: string;
  action: VmCommandAction;
  payload?: VmCommandPayload;
}) {
  await ensureVmCommandTableReady();
  return prisma.vmCommand.create({
    data: {
      vmInstanceId: params.vmInstanceId,
      userId: params.userId,
      sessionGroup: params.sessionGroup,
      target: params.target,
      action: params.action,
      payloadJson: params.payload ? JSON.stringify(params.payload) : null,
      status: "PENDING",
    },
  });
}

export async function listPendingVmCommandsForSessionGroup(sessionGroup: string) {
  await ensureVmCommandTableReady();
  const rows = await prisma.vmCommand.findMany({
    where: {
      sessionGroup,
      status: { in: ["PENDING", "DISPATCHED"] },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  // Mark freshly polled PENDING commands as DISPATCHED so worker won't double-trigger if slow,
  // while worker tracks seen command IDs cleanly and still acks COMPLETED/FAILED.
  const pendingIds = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
  if (pendingIds.length > 0) {
    await prisma.vmCommand.updateMany({
      where: { id: { in: pendingIds } },
      data: { status: "DISPATCHED" },
    });
  }

  return rows.map((row) => {
    let payload: VmCommandPayload | null = null;
    if (row.payloadJson) {
      try {
        payload = JSON.parse(row.payloadJson) as VmCommandPayload;
      } catch {
        payload = null;
      }
    }
    return {
      id: row.id,
      target: row.target,
      action: row.action,
      payload,
    };
  });
}

export async function ackVmCommands(sessionGroup: string, acks: VmCommandAckInput[]): Promise<void> {
  if (!Array.isArray(acks) || acks.length === 0) return;
  await ensureVmCommandTableReady();
  for (const ack of acks.slice(0, 20)) {
    if (!ack?.id || (ack.status !== "COMPLETED" && ack.status !== "FAILED" && ack.status !== "DISPATCHED")) {
      continue;
    }
    await prisma.vmCommand.updateMany({
      where: { id: String(ack.id), sessionGroup },
      data: {
        status: ack.status,
        resultMessage: typeof ack.resultMessage === "string" ? ack.resultMessage.slice(0, 500) : null,
      },
    });
  }
}
