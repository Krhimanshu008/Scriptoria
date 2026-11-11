import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/crypto/vault";

export interface GDriveTokenPayload {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  token_type?: string;
  expiry?: string;
}

export interface ResolvedGDriveCredential {
  rawTokenJson: string;
  parsed: GDriveTokenPayload;
  baseFolder: string;
}

export interface GDriveModelFile {
  id: string;
  name: string;
  category: string;
  sizeBytes: number;
  modifiedTime?: string;
}

const DEFAULT_BASE_FOLDER = process.env.GDRIVE_BASE_FOLDER || "Scriptoria";

/**
 * Loads and decrypts the user's Google Drive credential from the Vault.
 */
export async function getUserGDriveCredential(userId: string): Promise<ResolvedGDriveCredential | null> {
  const cred = await prisma.credential.findFirst({
    where: { userId, provider: "gdrive" },
    orderBy: { updatedAt: "desc" },
  });

  if (!cred) return null;

  const rawTokenJson = decryptSecret({
    ciphertext: cred.encryptedKey,
    iv: cred.iv,
    authTag: cred.authTag,
  });

  let parsed: GDriveTokenPayload = {};
  try {
    parsed = JSON.parse(rawTokenJson);
  } catch {
    parsed = { access_token: rawTokenJson };
  }

  let baseFolder = DEFAULT_BASE_FOLDER;
  if (cred.metadataJson) {
    try {
      const meta = JSON.parse(cred.metadataJson);
      if (meta?.baseFolder && typeof meta.baseFolder === "string") {
        baseFolder = meta.baseFolder.replace(/^\/+|\/+$/g, "");
      }
    } catch {
      // ignore invalid metadata
    }
  }

  return { rawTokenJson, parsed, baseFolder };
}

/**
 * Mints a fresh Google OAuth2 access token using refresh_token + client_id + client_secret,
 * or falls back to the stored access_token if refresh metadata is absent.
 */
export async function mintGDriveAccessToken(parsed: GDriveTokenPayload): Promise<string> {
  if (parsed.refresh_token && parsed.client_id && parsed.client_secret) {
    const body = new URLSearchParams({
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      refresh_token: parsed.refresh_token,
      grant_type: "refresh_token",
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });

    if (res.ok) {
      const data = (await res.json()) as { access_token?: string };
      if (data.access_token) {
        return data.access_token;
      }
    }
  }

  if (parsed.access_token) {
    return parsed.access_token;
  }

  throw new Error("Google Drive credential has neither a valid access_token nor refresh credentials.");
}

async function findFolderIdByPath(accessToken: string, pathSegments: string[]): Promise<string | null> {
  let parentId = "root";
  for (const segment of pathSegments) {
    const escaped = segment.replace(/'/g, "\\'");
    const q = `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Google Drive folder lookup failed (${res.status})`);
    }
    const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    if (!data.files || data.files.length === 0) {
      return null;
    }
    parentId = data.files[0].id;
  }
  return parentId;
}

/**
 * Lists model files from Google Drive API v3 under `<baseFolder>/models/<category>`.
 */
export async function listModelsInGDriveApi(
  userId: string,
  category = "checkpoints"
): Promise<{ baseFolder: string; category: string; files: GDriveModelFile[] }> {
  const resolved = await getUserGDriveCredential(userId);
  if (!resolved) {
    throw new Error("No Google Drive credential found in Vault.");
  }

  const accessToken = await mintGDriveAccessToken(resolved.parsed);
  const segments = [...resolved.baseFolder.split("/").filter(Boolean), "models", category];
  const folderId = await findFolderIdByPath(accessToken, segments);

  if (!folderId) {
    return { baseFolder: resolved.baseFolder, category, files: [] };
  }

  const q = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,size,modifiedTime)&orderBy=name&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive file list failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; size?: string; modifiedTime?: string }>;
  };

  const files: GDriveModelFile[] = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    category,
    sizeBytes: Number(f.size || 0),
    modifiedTime: f.modifiedTime,
  }));

  return { baseFolder: resolved.baseFolder, category, files };
}

/**
 * Fetches binary media stream from Google Drive API v3 for a permanent fileId.
 */
export async function fetchGDriveFileStream(userId: string, fileId: string): Promise<Response> {
  const resolved = await getUserGDriveCredential(userId);
  if (!resolved) {
    throw new Error("No Google Drive credential found in Vault.");
  }

  const accessToken = await mintGDriveAccessToken(resolved.parsed);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

