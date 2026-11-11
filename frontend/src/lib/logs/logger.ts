import { prisma } from "@/lib/db/prisma";

export type LogCategory =
  | "SYSTEM"
  | "ACTION"
  | "KAGGLE"
  | "COLAB"
  | "RCLONE"
  | "COMFYUI"
  | "HEALTH"
  | "NETWORK"
  | "ERROR";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS" | "DEBUG";

export async function appendSystemLog(params: {
  userId: string;
  vmInstanceId?: string | null;
  category?: LogCategory | string;
  level?: LogLevel | string;
  message: string;
  meta?: unknown;
}): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        userId: params.userId,
        vmInstanceId: params.vmInstanceId ?? null,
        category: (params.category || "SYSTEM").toUpperCase(),
        level: (params.level || "INFO").toUpperCase(),
        message: params.message,
        metaJson: params.meta !== undefined ? JSON.stringify(params.meta) : null,
      },
    });
  } catch (err) {
    console.error("[SystemLog] Failed to write log:", err);
  }
}

