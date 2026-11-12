import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { isValidWorkerProfile } from "@/lib/catalog/worker-profiles";

export interface PublicWorkspaceSettings {
  defaultDashboard: "vms" | "studio";
  gdriveBaseFolder: string;
  autoBackupToDrive: boolean;
  diskCleanupThresholdGb: number;
  idleTimeoutMinutes: number;
  defaultWorkerProfile: string;
  autoVaeFixSdxl: boolean;
  preferredLlmProvider: string;
  preferredLlmModel: string;
  agentMode: "COPILOT" | "AUTONOMOUS";
  systemInstructions: string;
  updatedAt: string;
}

const DEFAULT_BASE_FOLDER =
  process.env.GDRIVE_BASE_FOLDER?.replace(/^\/+|\/+$/g, "") || "NovelVisualizer/ComfyUI_Storage";

export async function getOrCreateWorkspaceSettings(
  userId: string
): Promise<PublicWorkspaceSettings> {
  await ensureDbSchemaReady();

  const row = await prisma.workspaceSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      defaultDashboard: "vms",
      gdriveBaseFolder: DEFAULT_BASE_FOLDER,
      autoBackupToDrive: true,
      diskCleanupThresholdGb: 6.0,
      idleTimeoutMinutes: 15,
      defaultWorkerProfile: "BASE_COMFY",
      autoVaeFixSdxl: true,
      preferredLlmProvider: "gemini",
      preferredLlmModel: "gemini-2.5-flash",
      agentMode: "COPILOT",
      systemInstructions: "",
    },
  });

  return {
    defaultDashboard: row.defaultDashboard === "studio" ? "studio" : "vms",
    gdriveBaseFolder: row.gdriveBaseFolder,
    autoBackupToDrive: row.autoBackupToDrive,
    diskCleanupThresholdGb: row.diskCleanupThresholdGb,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    defaultWorkerProfile: isValidWorkerProfile(row.defaultWorkerProfile)
      ? row.defaultWorkerProfile
      : "BASE_COMFY",
    autoVaeFixSdxl: row.autoVaeFixSdxl,
    preferredLlmProvider: row.preferredLlmProvider,
    preferredLlmModel: row.preferredLlmModel,
    agentMode: row.agentMode === "AUTONOMOUS" ? "AUTONOMOUS" : "COPILOT",
    systemInstructions: row.systemInstructions,
    updatedAt: row.updatedAt.toISOString(),
  };
}

