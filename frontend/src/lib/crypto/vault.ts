import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKeyCandidates(): Buffer[] {
  const candidates: string[] = [];

  if (process.env.ENCRYPTION_KEY) {
    candidates.push(process.env.ENCRYPTION_KEY);
  }
  if (process.env.FALLBACK_ENCRYPTION_KEYS) {
    const extra = process.env.FALLBACK_ENCRYPTION_KEYS.split(",").map((s) => s.trim());
    candidates.push(...extra);
  }

  // Known historical keys used across environments to prevent decryption lockouts
  candidates.push("3a804cc2ae162de0f6c94e541f47bce24f44fac75b3c899a3cb01c049f206452");
  candidates.push("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90");

  const keys: Buffer[] = [];
  const seen = new Set<string>();

  for (const raw of candidates) {
    if (!raw) continue;
    const clean = raw.trim().replace(/^["']|["']$/g, "");
    if (!clean) continue;

    // Variant 1: sha256 hash of clean string
    const sha = crypto.createHash("sha256").update(clean).digest();
    const shaHex = sha.toString("hex");
    if (!seen.has(shaHex)) {
      seen.add(shaHex);
      keys.push(sha);
    }

    // Variant 2: raw 32-byte hex (if 64 hex chars)
    if (/^[0-9a-fA-F]{64}$/.test(clean)) {
      const rawBuf = Buffer.from(clean, "hex");
      const rawHex = rawBuf.toString("hex");
      if (!seen.has(rawHex)) {
        seen.add(rawHex);
        keys.push(rawBuf);
      }
    }

    // Variant 3: sha256 of raw secret if quotes were stripped
    if (clean !== raw.trim()) {
      const shaRaw = crypto.createHash("sha256").update(raw.trim()).digest();
      const shaRawHex = shaRaw.toString("hex");
      if (!seen.has(shaRawHex)) {
        seen.add(shaRawHex);
        keys.push(shaRaw);
      }
    }
  }

  if (keys.length === 0) {
    throw new Error("ENCRYPTION_KEY environment variable is not defined");
  }

  return keys;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts plain-text secrets using AES-256-GCM.
 */
export function encryptSecret(plainText: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKeyCandidates()[0];
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypts AES-256-GCM ciphertext with authenticated integrity verification,
 * trying both normalized and raw encryption key variants.
 */
export function decryptSecret(payload: EncryptedPayload): string {
  const keys = getEncryptionKeyCandidates();
  let lastErr: Error | null = null;

  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(payload.iv, "hex")
      );

      decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));

      let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (err: any) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Decryption failed");
}

/**
 * Generates a cryptographically strong per-session VM secret for Caddy header auth.
 */
export function generateVmSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}

