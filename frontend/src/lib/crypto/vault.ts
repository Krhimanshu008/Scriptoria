import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKeyCandidates(): Buffer[] {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not defined");
  }
  const clean = secret.trim().replace(/^["']|["']$/g, "");
  const keys = [crypto.createHash("sha256").update(clean).digest()];
  if (clean !== secret.trim()) {
    keys.push(crypto.createHash("sha256").update(secret.trim()).digest());
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

