import { prisma } from "@/lib/db/prisma";

const globalForSchema = globalThis as typeof globalThis & {
  __scriptoriaSchemaReady?: boolean;
  __scriptoriaSchemaPromise?: Promise<void> | null;
};

const SCHEMA_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "username" TEXT,
    "encryptedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "VmInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "sessionGroup" TEXT NOT NULL,
    "workerProfile" TEXT NOT NULL DEFAULT 'BASE_COMFY',
    "idleTimeoutMinutes" INTEGER,
    "prewarmModelsJson" TEXT,
    "internalPort" INTEGER NOT NULL DEFAULT 8188,
    "publicUrl" TEXT NOT NULL DEFAULT '',
    "vmSecret" TEXT,
    "useRouteLess" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "stepProgress" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeat" DATETIME,
    "onlineSince" DATETIME,
    "latencyMs" INTEGER,
    "vramTotalGb" REAL,
    "vramUsedGb" REAL,
    "gpuName" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VmInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vmInstanceId" TEXT,
    "target" TEXT NOT NULL,
    "promptId" TEXT,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "checkpoint" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1024,
    "height" INTEGER NOT NULL DEFAULT 1024,
    "steps" INTEGER NOT NULL DEFAULT 25,
    "cfg" REAL NOT NULL DEFAULT 6.0,
    "seed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputFiles" TEXT,
    "errorMessage" TEXT,
    "executionTimeMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_vmInstanceId_fkey" FOREIGN KEY ("vmInstanceId") REFERENCES "VmInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "SystemLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vmInstanceId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'SYSTEM',
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SystemLog_vmInstanceId_fkey" FOREIGN KEY ("vmInstanceId") REFERENCES "VmInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ModelAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subdir" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL,
    "sizeBytes" REAL,
    "vramEstimateGb" REAL NOT NULL DEFAULT 0,
    "compatibleBase" TEXT NOT NULL DEFAULT 'SDXL',
    "requiredCustomNodesJson" TEXT,
    "recommendedConfigJson" TEXT,
    "hfRepoId" TEXT,
    "hfFilePath" TEXT,
    "civitaiModelId" TEXT,
    "civitaiVersionId" TEXT,
    "directUrl" TEXT,
    "sha256" TEXT,
    "gdrivePath" TEXT,
    "gdriveFileId" TEXT,
    "backupStatus" TEXT NOT NULL DEFAULT 'NONE',
    "isSeeded" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "WorkflowTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "categoryTag" TEXT NOT NULL,
    "targetProfile" TEXT NOT NULL DEFAULT 'IMAGE_CORE',
    "description" TEXT NOT NULL,
    "vramRequiredGb" REAL NOT NULL DEFAULT 8.0,
    "requiredModelsJson" TEXT NOT NULL,
    "requiredNodesJson" TEXT NOT NULL,
    "apiGraphTemplateJson" TEXT NOT NULL,
    "inputSchemaJson" TEXT NOT NULL,
    "isSeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`,
  `CREATE INDEX IF NOT EXISTS "Credential_userId_idx" ON "Credential"("userId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Credential_userId_provider_accountAlias_key" ON "Credential"("userId", "provider", "accountAlias")`,
  `CREATE INDEX IF NOT EXISTS "VmInstance_userId_status_idx" ON "VmInstance"("userId", "status")`,
  `CREATE INDEX IF NOT EXISTS "VmInstance_userId_sessionGroup_idx" ON "VmInstance"("userId", "sessionGroup")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "VmInstance_userId_target_key" ON "VmInstance"("userId", "target")`,
  `CREATE INDEX IF NOT EXISTS "Job_userId_status_idx" ON "Job"("userId", "status")`,
  `CREATE INDEX IF NOT EXISTS "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Job_vmInstanceId_idx" ON "Job"("vmInstanceId")`,
  `CREATE INDEX IF NOT EXISTS "SystemLog_userId_createdAt_idx" ON "SystemLog"("userId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ModelAsset_userId_slug_key" ON "ModelAsset"("userId", "slug")`,
  `CREATE INDEX IF NOT EXISTS "ModelAsset_userId_modality_category_idx" ON "ModelAsset"("userId", "modality", "category")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTemplate_userId_slug_key" ON "WorkflowTemplate"("userId", "slug")`,
  `CREATE INDEX IF NOT EXISTS "WorkflowTemplate_userId_modality_targetProfile_idx" ON "WorkflowTemplate"("userId", "modality", "targetProfile")`,
  `CREATE TABLE IF NOT EXISTS "WorkspaceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "defaultDashboard" TEXT NOT NULL DEFAULT 'vms',
    "gdriveBaseFolder" TEXT NOT NULL DEFAULT 'NovelVisualizer/ComfyUI_Storage',
    "autoBackupToDrive" BOOLEAN NOT NULL DEFAULT true,
    "diskCleanupThresholdGb" REAL NOT NULL DEFAULT 6.0,
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "defaultWorkerProfile" TEXT NOT NULL DEFAULT 'BASE_COMFY',
    "autoVaeFixSdxl" BOOLEAN NOT NULL DEFAULT true,
    "preferredLlmProvider" TEXT NOT NULL DEFAULT 'gemini',
    "preferredLlmModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "agentMode" TEXT NOT NULL DEFAULT 'COPILOT',
    "systemInstructions" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSettings_userId_key" ON "WorkspaceSettings"("userId")`,
  `CREATE TABLE IF NOT EXISTS "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Studio Session',
    "mode" TEXT NOT NULL DEFAULT 'COPILOT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCallsJson" TEXT,
    "proposedActionJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'ingest,batch,read',
    "webhookSecret" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "BatchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL DEFAULT 'studio',
    "idempotencyKey" TEXT,
    "webhookUrl" TEXT,
    "rawPayloadJson" TEXT,
    "strategyJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "failedTasks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BatchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "BatchTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "sequenceIndex" INTEGER NOT NULL DEFAULT 0,
    "sceneKey" TEXT NOT NULL,
    "trackType" TEXT NOT NULL DEFAULT 'VISUAL',
    "dependsOnTaskIdsJson" TEXT,
    "workerProfile" TEXT NOT NULL DEFAULT 'IMAGE_CORE',
    "baseCheckpoint" TEXT NOT NULL DEFAULT '',
    "requiredModelsJson" TEXT,
    "workflowSlug" TEXT,
    "inputParamsJson" TEXT,
    "compiledGraphJson" TEXT,
    "assignedTarget" TEXT,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputFilesJson" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BatchTask_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "stylePreset" TEXT NOT NULL DEFAULT 'Illustrious Anime',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "CharacterProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerWords" TEXT NOT NULL DEFAULT '',
    "loraSlug" TEXT,
    "voicePreset" TEXT NOT NULL DEFAULT 'af_heart',
    "refImageUrl" TEXT,
    "refAudioUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "tracksJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LlmChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "mode" TEXT NOT NULL DEFAULT 'chat',
    "systemPrompt" TEXT,
    "jsonSchema" TEXT,
    "temperature" REAL NOT NULL DEFAULT 0.25,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "reasoningEffort" TEXT NOT NULL DEFAULT 'none',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LlmChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LlmChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "thinking" TEXT,
    "imagesJson" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LlmChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "AgentSession_userId_updatedAt_idx" ON "AgentSession"("userId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "AgentMessage_sessionId_createdAt_idx" ON "AgentMessage"("sessionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "LlmChatSession_userId_updatedAt_idx" ON "LlmChatSession"("userId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "LlmChatMessage_sessionId_createdAt_idx" ON "LlmChatMessage"("sessionId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "ApiToken_userId_idx" ON "ApiToken"("userId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BatchJob_userId_idempotencyKey_key" ON "BatchJob"("userId", "idempotencyKey")`,
  `CREATE INDEX IF NOT EXISTS "BatchJob_userId_status_createdAt_idx" ON "BatchJob"("userId", "status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "BatchTask_batchId_sequenceIndex_idx" ON "BatchTask"("batchId", "sequenceIndex")`,
  `CREATE INDEX IF NOT EXISTS "BatchTask_status_idx" ON "BatchTask"("status")`,
  `CREATE INDEX IF NOT EXISTS "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "CharacterProfile_projectId_idx" ON "CharacterProfile"("projectId")`,
  `CREATE INDEX IF NOT EXISTS "Scene_projectId_orderIndex_idx" ON "Scene"("projectId", "orderIndex")`,
];

async function runSchemaSync(): Promise<void> {
  const [vmCols, existingTables] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("VmInstance")`),
    prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('User','Credential','VmInstance','Job','SystemLog','ModelAsset','WorkflowTemplate','WorkspaceSettings','AgentSession','AgentMessage','ApiToken','BatchJob','BatchTask','Project','CharacterProfile','Scene','LlmChatSession','LlmChatMessage')`
    ),
  ]);

  const tableSet = new Set(existingTables.map((t) => t.name));
  const vmColSet = new Set(vmCols.map((c) => c.name));
  const hasWorkerProfile = vmColSet.has("workerProfile");
  const hasIdleTimeout = vmColSet.has("idleTimeoutMinutes");
  const hasPrewarmModels = vmColSet.has("prewarmModelsJson");
  const hasBootMetadata = vmColSet.has("bootMetadataJson");
  const allTablesExist =
    tableSet.has("User") &&
    tableSet.has("Credential") &&
    tableSet.has("VmInstance") &&
    tableSet.has("Job") &&
    tableSet.has("SystemLog") &&
    tableSet.has("ModelAsset") &&
    tableSet.has("WorkflowTemplate") &&
    tableSet.has("WorkspaceSettings") &&
    tableSet.has("AgentSession") &&
    tableSet.has("AgentMessage") &&
    tableSet.has("ApiToken") &&
    tableSet.has("BatchJob") &&
    tableSet.has("BatchTask") &&
    tableSet.has("Project") &&
    tableSet.has("CharacterProfile") &&
    tableSet.has("Scene") &&
    tableSet.has("LlmChatSession") &&
    tableSet.has("LlmChatMessage");

  if (allTablesExist && hasWorkerProfile && hasIdleTimeout && hasPrewarmModels && hasBootMetadata) {
    try {
      await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`);
      await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`);
      await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 5000;`);
    } catch {
      // Ignore if PRAGMAs are not supported on remote endpoints
    }
    globalForSchema.__scriptoriaSchemaReady = true;
    return;
  }

  for (const stmt of SCHEMA_DDL_STATEMENTS) {
    await prisma.$executeRawUnsafe(stmt);
  }

  if (tableSet.has("VmInstance")) {
    const missingVmCols: Array<{ present: boolean; sql: string }> = [
      {
        present: hasWorkerProfile,
        sql: `ALTER TABLE "VmInstance" ADD COLUMN "workerProfile" TEXT NOT NULL DEFAULT 'BASE_COMFY'`,
      },
      {
        present: hasIdleTimeout,
        sql: `ALTER TABLE "VmInstance" ADD COLUMN "idleTimeoutMinutes" INTEGER`,
      },
      {
        present: hasPrewarmModels,
        sql: `ALTER TABLE "VmInstance" ADD COLUMN "prewarmModelsJson" TEXT`,
      },
      {
        present: hasBootMetadata,
        sql: `ALTER TABLE "VmInstance" ADD COLUMN "bootMetadataJson" TEXT`,
      },
    ];

    for (const col of missingVmCols) {
      if (col.present) continue;
      try {
        await prisma.$executeRawUnsafe(col.sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : "";
        if (!msg.includes("duplicate column")) {
          throw err;
        }
      }
    }
  }

  globalForSchema.__scriptoriaSchemaReady = true;
}

/**
 * Ensures SQLite / Turso LibSQL schema is up-to-date once per server/serverless instance.
 * Automatically applies additive columns and new tables without losing existing data.
 */
export async function ensureDbSchemaReady(): Promise<void> {
  if (globalForSchema.__scriptoriaSchemaReady) {
    return;
  }
  if (!globalForSchema.__scriptoriaSchemaPromise) {
    globalForSchema.__scriptoriaSchemaPromise = runSchemaSync().finally(() => {
      globalForSchema.__scriptoriaSchemaPromise = null;
    });
  }
  return globalForSchema.__scriptoriaSchemaPromise;
}

