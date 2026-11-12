import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "./vault";

export interface SaveCredentialInput {
  provider:
    | "kaggle"
    | "colab"
    | "cloudflare"
    | "gdrive"
    | "huggingface"
    | "civitai"
    | "llm"
    | string;
  accountAlias: string;
  username?: string | null;
  rawSecret: string;
  authType?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Encrypts and upserts a provider credential into the user's Credential Vault.
 */
export async function saveUserCredential(userId: string, input: SaveCredentialInput) {
  const provider = input.provider.trim().toLowerCase();
  const accountAlias = input.accountAlias.trim();
  const enc = encryptSecret(input.rawSecret);

  const authType =
    input.authType ||
    (provider === "kaggle"
      ? input.rawSecret.startsWith("KGAT_")
        ? "bearer"
        : "basic"
      : provider === "gdrive"
      ? "oauth_json"
      : "bearer");

  return prisma.credential.upsert({
    where: {
      userId_provider_accountAlias: { userId, provider, accountAlias },
    },
    update: {
      username: input.username ?? null,
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      authType,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
    create: {
      userId,
      provider,
      accountAlias,
      username: input.username ?? null,
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      authType,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

/**
 * Retrieves and decrypts a specific credential for server-side orchestration.
 */
export async function getDecryptedCredential(
  userId: string,
  provider: string,
  accountAlias: string
) {
  const cred = await prisma.credential.findUnique({
    where: {
      userId_provider_accountAlias: { userId, provider, accountAlias },
    },
  });
  if (!cred) return null;

  const secret = decryptSecret({
    ciphertext: cred.encryptedKey,
    iv: cred.iv,
    authTag: cred.authTag,
  });

  let metadata: Record<string, unknown> | null = null;
  if (cred.metadataJson) {
    try {
      metadata = JSON.parse(cred.metadataJson);
    } catch {
      metadata = null;
    }
  }

  return {
    id: cred.id,
    provider: cred.provider,
    accountAlias: cred.accountAlias,
    username: cred.username,
    secret,
    authType: cred.authType,
    metadata,
  };
}

