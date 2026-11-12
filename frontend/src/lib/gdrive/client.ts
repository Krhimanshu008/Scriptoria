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

export async function getGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    // Works with pure Drive tokens (like rclone OAuth) without needing userinfo.email scope
    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (aboutRes.ok) {
      const aboutData = (await aboutRes.json()) as { user?: { emailAddress?: string } };
      if (aboutData.user?.emailAddress) {
        return aboutData.user.emailAddress;
      }
    }

    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email || null;
  } catch {
    return null;
  }
}

async function ensureFolderIdByPath(
  accessToken: string,
  pathSegments: string[]
): Promise<string | null> {
  let parentId = "root";
  for (const segment of pathSegments) {
    const escaped = segment.replace(/'/g, "\\'");
    const q = `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const findUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
    const findRes = await fetch(findUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!findRes.ok) return null;
    const found = (await findRes.json()) as { files?: Array<{ id: string }> };
    if (found.files && found.files.length > 0) {
      parentId = found.files[0].id;
      continue;
    }

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: segment,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
      cache: "no-store",
    });
    if (!createRes.ok) return null;
    const created = (await createRes.json()) as { id?: string };
    if (!created.id) return null;
    parentId = created.id;
  }
  return parentId;
}

/**
 * Creates or updates a Colab .ipynb notebook in Google Drive using either
 * `drive` or `drive.file` OAuth scope, preserving fileId across runs.
 */
export async function upsertColabNotebookInDrive(params: {
  accessToken: string;
  filename: string;
  notebookJson: Record<string, unknown>;
  existingFileId?: string | null;
  folderSegments?: string[];
  hasFullDriveScope?: boolean;
}): Promise<{ fileId: string; updated: boolean }> {
  const { accessToken, filename, notebookJson, existingFileId, folderSegments, hasFullDriveScope } =
    params;
  const contentStr = JSON.stringify(notebookJson, null, 2);

  if (existingFileId) {
    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=media&fields=id`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-ipynb+json",
        },
        body: contentStr,
        cache: "no-store",
      }
    );
    if (patchRes.ok) {
      return { fileId: existingFileId, updated: true };
    }
  }

  let parentId: string | null = null;
  if (hasFullDriveScope && folderSegments?.length) {
    parentId = await ensureFolderIdByPath(accessToken, folderSegments);
  }

  const escaped = filename.replace(/'/g, "\\'");
  const q = parentId
    ? `'${parentId}' in parents and name='${escaped}' and trashed=false`
    : `name='${escaped}' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
    const matchedId = searchData.files?.[0]?.id;
    if (matchedId) {
      const patchRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(matchedId)}?uploadType=media&fields=id`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-ipynb+json",
          },
          body: contentStr,
          cache: "no-store",
        }
      );
      if (patchRes.ok) {
        return { fileId: matchedId, updated: true };
      }
    }
  }

  const boundary = `scriptoria_colab_nb_${Date.now()}`;
  const metadata = JSON.stringify({
    name: filename,
    mimeType: "application/vnd.google.colaboratory",
    ...(parentId ? { parents: [parentId] } : {}),
  });
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/x-ipynb+json\r\n\r\n` +
    `${contentStr}\r\n` +
    `--${boundary}--`;

  const createRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
      cache: "no-store",
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Failed uploading Colab notebook to Google Drive (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as { id?: string };
  if (!created.id) {
    throw new Error("Google Drive upload succeeded without returning a file ID.");
  }
  return { fileId: created.id, updated: false };
}

/**
 * Grants a secondary Google account writer permission on a Drive notebook without sending notification spam.
 */
export async function shareDriveFileWithUser(
  accessToken: string,
  fileId: string,
  email: string
): Promise<void> {
  const cleanEmail = email.trim();
  if (!cleanEmail) return;

  const payload = JSON.stringify({
    role: "writer",
    type: "user",
    emailAddress: cleanEmail,
  });

  const firstRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: payload,
      cache: "no-store",
    }
  );

  if (firstRes.ok) return;

  const errText = await firstRes.text().catch(() => firstRes.statusText);
  // Some Drive ACL edges require default notification behavior when inviting an external user
  if (firstRes.status === 400 && /notification/i.test(errText)) {
    const retryRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: payload,
        cache: "no-store",
      }
    );
    if (retryRes.ok) return;
    const retryErr = await retryRes.text().catch(() => retryRes.statusText);
    throw new Error(`Google Drive share failed (${retryRes.status}): ${retryErr}`);
  }

  throw new Error(`Google Drive share failed (${firstRes.status}): ${errText}`);
}

