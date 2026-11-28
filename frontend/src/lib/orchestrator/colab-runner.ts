import { prisma } from "@/lib/db/prisma";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { getOrCreateRunnerToken, verifyRunnerToken } from "@/lib/orchestrator/runner-token";

export const COLAB_RUNNER_PROVIDER = "colab-runner";

/**
 * Returns or provisions a persistent, rotatable launcher token `<userId>.<64-hex>`
 * for self-renewing Colab notebooks.
 */
export async function getOrCreateColabRunnerToken(
  userId: string,
  target: string,
  rotate = false
): Promise<string> {
  return getOrCreateRunnerToken(COLAB_RUNNER_PROVIDER, userId, target, rotate);
}

/**
 * Timing-safe verification of a runnerToken submitted by Colab Cell 1 during `/api/vm/colab/claim`.
 */
export async function verifyColabRunnerToken(
  target: string,
  runnerToken: string
): Promise<{ userId: string } | null> {
  return verifyRunnerToken(COLAB_RUNNER_PROVIDER, target, runnerToken);
}

/**
 * Extracts a Google Drive file ID from either a full Colab/Drive URL or a raw ID string.
 */
export function extractGoogleDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const driveMatch =
    trimmed.match(/colab\.research\.google\.com\/drive\/([a-zA-Z0-9_-]{10,})/) ||
    trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (driveMatch?.[1]) return driveMatch[1];

  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Clears cached Drive file binding for a Colab slot when its linked Google email changes
 * (unless the user explicitly pinned a custom Drive URL via manualBind).
 */
export async function invalidateColabMetaIfEmailChanged(
  userId: string,
  accountAlias: string,
  previousEmail: string | null | undefined,
  nextEmail: string | null | undefined
): Promise<void> {
  if (!nextEmail) return;
  if (previousEmail && previousEmail.toLowerCase() === nextEmail.toLowerCase()) return;

  const target = accountAlias === "acc2" ? "gcgpu1" : "gcgpu";
  const existingMeta = await getDecryptedCredential(userId, "colab-meta", target);
  if (!existingMeta) return;

  const isManual = Boolean(existingMeta.metadata?.manualBind);
  if (!isManual) {
    await prisma.credential.deleteMany({
      where: { userId, provider: "colab-meta", accountAlias: target },
    });
  }
}

