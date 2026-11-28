import crypto from "node:crypto";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import { generateVmSecret } from "@/lib/crypto/vault";

/**
 * Returns or provisions a persistent, rotatable launcher token `<userId>.<64-hex>`
 * for self-renewing Colab or Kaggle Interactive notebooks.
 */
export async function getOrCreateRunnerToken(
  provider: string,
  userId: string,
  scopeKey: string,
  rotate = false
): Promise<string> {
  if (!rotate) {
    const existing = await getDecryptedCredential(userId, provider, scopeKey);
    if (existing?.secret) {
      return `${userId}.${existing.secret}`;
    }
  }

  const key = generateVmSecret();
  await saveUserCredential(userId, {
    provider,
    accountAlias: scopeKey,
    username: scopeKey,
    rawSecret: key,
    authType: "bearer",
    metadata: { rotatedAt: new Date().toISOString() },
  });

  return `${userId}.${key}`;
}

/**
 * Timing-safe verification of a persistent `<userId>.<secret>` runner token.
 */
export async function verifyRunnerToken(
  provider: string,
  scopeKey: string,
  runnerToken: string
): Promise<{ userId: string } | null> {
  const dotIdx = runnerToken.indexOf(".");
  if (dotIdx <= 0 || dotIdx === runnerToken.length - 1) return null;

  const userId = runnerToken.slice(0, dotIdx).trim();
  const providedKey = runnerToken.slice(dotIdx + 1).trim();
  if (!userId || !providedKey) return null;

  const stored = await getDecryptedCredential(userId, provider, scopeKey);
  if (!stored?.secret) return null;

  const a = Buffer.from(providedKey, "utf8");
  const b = Buffer.from(stored.secret, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return { userId };
}

/**
 * Extracts `<userId>` from a `<userId>.<secret>` token without trusting it prior to verification.
 */
export function parseRunnerTokenUserId(runnerToken: string): string | null {
  const dotIdx = runnerToken.indexOf(".");
  if (dotIdx <= 0 || dotIdx === runnerToken.length - 1) return null;
  const userId = runnerToken.slice(0, dotIdx).trim();
  return userId || null;
}
