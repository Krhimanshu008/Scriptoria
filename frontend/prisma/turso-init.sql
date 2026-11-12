-- Idempotent Turso / LibSQL Schema Initialization for Scriptoria

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Credential" (
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
);

CREATE TABLE IF NOT EXISTS "VmInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "sessionGroup" TEXT NOT NULL,
    "workerProfile" TEXT NOT NULL DEFAULT 'IMAGE_CORE',
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
);

CREATE TABLE IF NOT EXISTS "Job" (
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
);

CREATE TABLE IF NOT EXISTS "SystemLog" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE INDEX IF NOT EXISTS "Credential_userId_idx" ON "Credential"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Credential_userId_provider_accountAlias_key" ON "Credential"("userId", "provider", "accountAlias");
CREATE INDEX IF NOT EXISTS "VmInstance_userId_status_idx" ON "VmInstance"("userId", "status");
CREATE INDEX IF NOT EXISTS "VmInstance_userId_sessionGroup_idx" ON "VmInstance"("userId", "sessionGroup");
CREATE UNIQUE INDEX IF NOT EXISTS "VmInstance_userId_target_key" ON "VmInstance"("userId", "target");
CREATE INDEX IF NOT EXISTS "Job_userId_status_idx" ON "Job"("userId", "status");
CREATE INDEX IF NOT EXISTS "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Job_vmInstanceId_idx" ON "Job"("vmInstanceId");
CREATE INDEX IF NOT EXISTS "SystemLog_userId_createdAt_idx" ON "SystemLog"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "ModelAsset" (
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
);

CREATE TABLE IF NOT EXISTS "WorkflowTemplate" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModelAsset_userId_slug_key" ON "ModelAsset"("userId", "slug");
CREATE INDEX IF NOT EXISTS "ModelAsset_userId_modality_category_idx" ON "ModelAsset"("userId", "modality", "category");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTemplate_userId_slug_key" ON "WorkflowTemplate"("userId", "slug");
CREATE INDEX IF NOT EXISTS "WorkflowTemplate_userId_modality_targetProfile_idx" ON "WorkflowTemplate"("userId", "modality", "targetProfile");

