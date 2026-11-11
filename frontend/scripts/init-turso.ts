import { loadLocalEnv } from "./env-loader";
loadLocalEnv();

import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!url.startsWith("libsql://") && !url.startsWith("https://") && !url.startsWith("file:")) {
    console.error("Set TURSO_DATABASE_URL (libsql://, https://, or file:) first.");
    process.exit(1);
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const sqlPath = path.resolve(process.cwd(), "prisma/turso-init.sql");
  const rawSql = fs.readFileSync(sqlPath, "utf8").replace(/^\s*--.*$/gm, "");
  const statements = rawSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Applying ${statements.length} DDL statements to ${url}...`);
  for (const stmt of statements) {
    await client.execute(stmt);
  }
  console.log("Turso schema initialized successfully.");
}

main().catch((err) => {
  console.error("Turso init failed:", err);
  process.exit(1);
});

