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
 * Generates a safe redacted preview hint (e.g. `hf_••••x81a`) without storing plaintext.
 */
export function buildRedactedSecretHint(provider: string, rawSecret: string): string {
  const trimmed = rawSecret.trim();
  if (!trimmed) return "••••";

  if (provider === "gdrive") {
    try {
      const parsed = JSON.parse(trimmed) as { refresh_token?: string; client_id?: string; access_token?: string };
      const tok = parsed.refresh_token || parsed.access_token || parsed.client_id || "";
      if (tok.length > 8) {
        return `OAuth (${tok.slice(0, 4)}••••${tok.slice(-4)})`;
      }
      return "OAuth JSON";
    } catch {
      return "OAuth JSON";
    }
  }

  if (provider === "colab") {
    try {
      const parsed = JSON.parse(trimmed) as { email?: string; refresh_token?: string };
      if (parsed.refresh_token && parsed.refresh_token.length > 8) {
        return `OAuth (${parsed.refresh_token.slice(0, 4)}••••${parsed.refresh_token.slice(-4)})`;
      }
      if (parsed.email) return `Link (${parsed.email})`;
    } catch {
      // fall through
    }
  }

  if (trimmed.length <= 8) {
    return `••••${trimmed.slice(-2)}`;
  }
  const underscoreIdx = trimmed.indexOf("_");
  const dashIdx = trimmed.indexOf("-");
  const prefixLen =
    underscoreIdx > 0 && underscoreIdx <= 5
      ? underscoreIdx + 1
      : dashIdx > 0 && dashIdx <= 5
      ? dashIdx + 1
      : 4;
  return `${trimmed.slice(0, prefixLen)}••••${trimmed.slice(-4)}`;
}

/**
 * Encrypts and upserts a provider credential into the user's Credential Vault.
 */
export async function saveUserCredential(userId: string, input: SaveCredentialInput) {
  const provider = input.provider.trim().toLowerCase();
  const accountAlias = input.accountAlias.trim();
  const rawSecret = input.rawSecret.trim();
  const enc = encryptSecret(rawSecret);

  const authType =
    input.authType ||
    (provider === "kaggle"
      ? rawSecret.startsWith("KGAT_")
        ? "bearer"
        : "basic"
      : provider === "gdrive"
      ? "oauth_json"
      : "bearer");

  const mergedMeta: Record<string, unknown> = {
    ...(input.metadata || {}),
    secretHint: buildRedactedSecretHint(provider, rawSecret),
  };

  const username = input.username?.trim() ?? null;

  return prisma.credential.upsert({
    where: {
      userId_provider_accountAlias: { userId, provider, accountAlias },
    },
    update: {
      username,
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      authType,
      metadataJson: JSON.stringify(mergedMeta),
    },
    create: {
      userId,
      provider,
      accountAlias,
      username,
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      authType,
      metadataJson: JSON.stringify(mergedMeta),
    },
  });
}

export interface UpdateCredentialInput {
  provider: string;
  accountAlias: string;
  newAccountAlias?: string;
  username?: string | null;
  rawSecret?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Updates metadata/username/alias of an existing credential without requiring re-entry of the secret,
 * or rotates the encrypted secret when rawSecret is supplied.
 */
export async function updateUserCredential(userId: string, input: UpdateCredentialInput) {
  const provider = input.provider.trim().toLowerCase();
  const accountAlias = input.accountAlias.trim();
  const nextAlias = (input.newAccountAlias || accountAlias).trim();

  const existing = await prisma.credential.findUnique({
    where: {
      userId_provider_accountAlias: { userId, provider, accountAlias },
    },
  });

  if (!existing) {
    throw new Error(`Credential not found for ${provider} (${accountAlias}).`);
  }

  let existingMeta: Record<string, unknown> = {};
  if (existing.metadataJson) {
    try {
      existingMeta = JSON.parse(existing.metadataJson) as Record<string, unknown>;
    } catch {
      existingMeta = {};
    }
  }

  const nextMeta: Record<string, unknown> = {
    ...existingMeta,
    ...(input.metadata || {}),
  };

  const data: {
    accountAlias: string;
    username: string | null;
    encryptedKey?: string;
    iv?: string;
    authTag?: string;
    authType?: string;
    metadataJson: string;
  } = {
    accountAlias: nextAlias,
    username: input.username !== undefined ? input.username : existing.username,
    metadataJson: JSON.stringify(nextMeta),
  };

  const rawSecret = input.rawSecret?.trim();
  if (rawSecret) {
    const enc = encryptSecret(rawSecret);
    data.encryptedKey = enc.ciphertext;
    data.iv = enc.iv;
    data.authTag = enc.authTag;
    data.authType =
      provider === "kaggle"
        ? rawSecret.startsWith("KGAT_")
          ? "bearer"
          : "basic"
        : provider === "gdrive"
        ? "oauth_json"
        : existing.authType;
    nextMeta.secretHint = buildRedactedSecretHint(provider, rawSecret);
    data.metadataJson = JSON.stringify(nextMeta);
  }

  return prisma.credential.update({
    where: { id: existing.id },
    data,
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

