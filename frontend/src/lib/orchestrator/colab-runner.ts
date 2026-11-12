import crypto from "node:crypto";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { generateVmSecret } from "@/lib/crypto/vault";

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
  if (!rotate) {
    const existing = await getDecryptedCredential(userId, COLAB_RUNNER_PROVIDER, target);
    if (existing?.secret) {
      return `${userId}.${existing.secret}`;
    }
  }

  const key = generateVmSecret();
  await saveUserCredential(userId, {
    provider: COLAB_RUNNER_PROVIDER,
    accountAlias: target,
    username: target,
    rawSecret: key,
    authType: "bearer",
    metadata: { rotatedAt: new Date().toISOString() },
  });

  return `${userId}.${key}`;
}

/**
 * Timing-safe verification of a runnerToken submitted by Colab Cell 1 during `/api/vm/colab/claim`.
 */
export async function verifyColabRunnerToken(
  target: string,
  runnerToken: string
): Promise<{ userId: string } | null> {
  const dotIdx = runnerToken.indexOf(".");
  if (dotIdx <= 0 || dotIdx === runnerToken.length - 1) return null;

  const userId = runnerToken.slice(0, dotIdx).trim();
  const providedKey = runnerToken.slice(dotIdx + 1).trim();
  if (!userId || !providedKey) return null;

  const stored = await getDecryptedCredential(userId, COLAB_RUNNER_PROVIDER, target);
  if (!stored?.secret) return null;

  const a = Buffer.from(providedKey, "utf8");
  const b = Buffer.from(stored.secret, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return { userId };
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

