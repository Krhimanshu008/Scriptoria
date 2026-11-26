import { prisma } from "@/lib/db/prisma";

export function kaggleDisplayName(metadata: string | null | undefined, username?: string | null) {
  let label: unknown;
  try { label = JSON.parse(metadata || "{}").displayName; } catch { /* Legacy metadata */ }
  return typeof label === "string" && label.trim() ? label.trim() : username ? "@" + username : "Personal Kaggle";
}

export async function checkKaggleConnection(userId: string, alias: string, username?: string | null) {
  const rows = await prisma.credential.findMany({
    where: { userId, provider: "kaggle" }, select: { accountAlias: true, username: true },
  });
  const owner = (username || rows.find((r) => r.accountAlias === alias)?.username || "").trim().toLowerCase();
  if (rows.some((r) => r.username && (r.username.toLowerCase() !== owner || r.accountAlias !== alias))) {
    return "This workspace has another Kaggle connection. Use one personal connection for its projects. Existing records are available in Settings.";
  }
  return null;
}
