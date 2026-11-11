import { loadLocalEnv } from "./env-loader";
loadLocalEnv();

import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db/prisma";
import { saveUserCredential } from "../src/lib/crypto/credentials";
import { ensureUserVmSlots } from "../src/lib/auth/session";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@krhimanshu.in";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Himanshu (Admin)",
      passwordHash,
      role: "ADMIN",
    },
  });

  const k1User = process.env.KAGGLE_ACC1_USERNAME || "YOUR_KAGGLE_USER_1";
  const k1Key = process.env.KAGGLE_ACC1_KEY || "YOUR_KAGGLE_KEY_1";
  if (k1Key && !k1Key.includes("YOUR_")) {
    await saveUserCredential(admin.id, {
      provider: "kaggle",
      accountAlias: "acc1",
      username: k1User,
      rawSecret: k1Key,
    });
  }

  const k2User = process.env.KAGGLE_ACC2_USERNAME || "YOUR_KAGGLE_USER_2";
  const k2Key = process.env.KAGGLE_ACC2_KEY || "YOUR_KAGGLE_KEY_2";
  if (k2Key && !k2Key.includes("YOUR_")) {
    await saveUserCredential(admin.id, {
      provider: "kaggle",
      accountAlias: "acc2",
      username: k2User,
      rawSecret: k2Key,
    });
  }

  const gdriveTokenJson =
    process.env.GDRIVE_TOKEN_JSON ||
    (process.env.GDRIVE_REFRESH_TOKEN
      ? JSON.stringify({
          client_id: process.env.GDRIVE_CLIENT_ID || "",
          client_secret: process.env.GDRIVE_CLIENT_SECRET || "",
          refresh_token: process.env.GDRIVE_REFRESH_TOKEN || "",
          token_type: "Bearer",
        })
      : "");

  if (gdriveTokenJson) {
    await saveUserCredential(admin.id, {
      provider: "gdrive",
      accountAlias: "default",
      username: "personal-drive",
      rawSecret: gdriveTokenJson,
      authType: "oauth_json",
      metadata: {
        baseFolder: process.env.GDRIVE_BASE_FOLDER || "Scriptoria",
      },
    });
  }

  await ensureUserVmSlots(admin.id);
  console.log(`Seeded admin (${email}) and 6 GPU slots.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
