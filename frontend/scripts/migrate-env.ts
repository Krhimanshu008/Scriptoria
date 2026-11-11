import { loadLocalEnv, parseEnvFile } from "./env-loader";
loadLocalEnv();

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db/prisma";
import { saveUserCredential } from "../src/lib/crypto/credentials";
import { ensureUserVmSlots } from "../src/lib/auth/session";

async function main() {
  const candidates = [
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../env"),
    path.resolve(process.cwd(), ".env"),
  ];
  const envFile = candidates.find((p) => fs.existsSync(p));
  if (!envFile) {
    console.error("No legacy .env file found at ../.env or ./.env");
    process.exit(1);
  }

  console.log(`Reading legacy secrets from ${envFile}...`);
  const legacy = parseEnvFile(envFile);

  const email = process.env.SEED_ADMIN_EMAIL || "admin@krhimanshu.in";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: process.env.SEED_ADMIN_PASSWORD ? { passwordHash } : {},
    create: {
      email,
      name: "Himanshu (Admin)",
      passwordHash,
      role: "ADMIN",
    },
  });

  if (legacy.KAGGLE_ACC1_KEY) {
    await saveUserCredential(admin.id, {
      provider: "kaggle",
      accountAlias: "acc1",
      username: legacy.KAGGLE_ACC1_USERNAME || legacy.KAGGLE_USERNAME || "",
      rawSecret: legacy.KAGGLE_ACC1_KEY,
    });
  }

  if (legacy.KAGGLE_ACC2_KEY) {
    await saveUserCredential(admin.id, {
      provider: "kaggle",
      accountAlias: "acc2",
      username: legacy.KAGGLE_ACC2_USERNAME || "",
      rawSecret: legacy.KAGGLE_ACC2_KEY,
    });
  }

  if (legacy.GDRIVE_REFRESH_TOKEN) {
    const tokenPayload = JSON.stringify({
      client_id: legacy.GDRIVE_CLIENT_ID || "",
      client_secret: legacy.GDRIVE_CLIENT_SECRET || "",
      refresh_token: legacy.GDRIVE_REFRESH_TOKEN,
      token_type: "Bearer",
    });
    await saveUserCredential(admin.id, {
      provider: "gdrive",
      accountAlias: "default",
      username: "personal-drive",
      rawSecret: tokenPayload,
      authType: "oauth_json",
      metadata: {
        baseFolder: process.env.GDRIVE_BASE_FOLDER || "NovelVisualizer/ComfyUI_Storage",
      },
    });
  }

  if (legacy.CF_TOKEN_KAGGLE) {
    await saveUserCredential(admin.id, {
      provider: "cloudflare",
      accountAlias: "kaggle",
      rawSecret: legacy.CF_TOKEN_KAGGLE,
      authType: "bearer",
    });
  }

  if (legacy.CF_TOKEN_GCGPU) {
    await saveUserCredential(admin.id, {
      provider: "cloudflare",
      accountAlias: "colab",
      rawSecret: legacy.CF_TOKEN_GCGPU,
      authType: "bearer",
    });
  }

  await ensureUserVmSlots(admin.id);
  console.log("Legacy .env secrets encrypted and migrated into Vault.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
