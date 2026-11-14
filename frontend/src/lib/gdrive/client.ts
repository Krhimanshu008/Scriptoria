import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto/vault";

export interface GDriveTokenPayload {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  token_type?: string;
  expiry?: string;
}

export interface ResolvedGDriveCredential {
  id?: string;
  accountAlias?: string;
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

function formatBytesToTbOrGb(bytesStr?: string | number): string {
  const bytes = Number(bytesStr || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const tb = bytes / 1024 ** 4;
  if (tb >= 0.5) return `${tb.toFixed(2)} TB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Loads and decrypts the user's Google Drive credential from the Vault.
 */
export async function getUserGDriveCredential(
  userId: string,
  accountAlias?: string
): Promise<ResolvedGDriveCredential | null> {
  const cred =
    (accountAlias
      ? await prisma.credential.findFirst({
          where: { userId, provider: "gdrive", accountAlias },
        })
      : null) ||
    (await prisma.credential.findFirst({
      where: { userId, provider: "gdrive" },
      orderBy: { updatedAt: "desc" },
    }));

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

  return { id: cred.id, accountAlias: cred.accountAlias, rawTokenJson, parsed, baseFolder };
}

/**
 * Refreshes the Google Drive OAuth token using refresh_token, client_id, and client_secret,
 * updates the encrypted record in the database, and returns the fresh access token and quota info.
 */
export async function refreshAndPersistGDriveToken(
  userId: string,
  accountAlias = "default",
  overrides?: { clientId?: string; clientSecret?: string; refreshToken?: string }
): Promise<{
  accessToken: string;
  email: string;
  used: string;
  limit: string;
  baseFolder: string;
  expiresAt: string;
}> {
  const cred =
    (await prisma.credential.findFirst({
      where: { userId, provider: "gdrive", accountAlias },
    })) ||
    (await prisma.credential.findFirst({
      where: { userId, provider: "gdrive" },
      orderBy: { updatedAt: "desc" },
    }));

  if (!cred) {
    throw new Error(`Google Drive credential '${accountAlias}' not found in Vault.`);
  }

  let rawTokenJson = "";
  let parsed: GDriveTokenPayload = {};
  try {
    rawTokenJson = decryptSecret({
      ciphertext: cred.encryptedKey,
      iv: cred.iv,
      authTag: cred.authTag,
    });
    parsed = JSON.parse(rawTokenJson);
  } catch {
    parsed = {};
  }

  const clientId =
    overrides?.clientId ||
    parsed.client_id ||
    process.env.GDRIVE_CLIENT_ID ||
    process.env.CLIENT_ID;

  const clientSecret =
    overrides?.clientSecret ||
    parsed.client_secret ||
    process.env.GDRIVE_CLIENT_SECRET ||
    process.env.SECRET;

  const refreshToken =
    overrides?.refreshToken ||
    parsed.refresh_token ||
    process.env.GDRIVE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("No refresh_token found in stored credential or environment. Please re-enter credentials.");
  }

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client_id and client_secret are required to refresh Google Drive access tokens.");
  }

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
    cache: "no-store",
  });

  const tokenData = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !tokenData.access_token) {
    const errorMsg =
      tokenData.error_description ||
      tokenData.error ||
      `Google OAuth refresh failed with HTTP ${res.status}`;
    throw new Error(errorMsg);
  }

  const newAccessToken = tokenData.access_token;
  const expiresInSec = Number(tokenData.expires_in || 3599);
  const newExpiry = new Date(Date.now() + expiresInSec * 1000).toISOString();

  let baseFolder = DEFAULT_BASE_FOLDER;
  let prevMeta: Record<string, unknown> = {};
  if (cred.metadataJson) {
    try {
      prevMeta = JSON.parse(cred.metadataJson);
      if (typeof prevMeta?.baseFolder === "string" && prevMeta.baseFolder.trim()) {
        baseFolder = prevMeta.baseFolder.trim().replace(/^\/+|\/+$/g, "");
      }
    } catch {}
  }

  const updatedPayload: GDriveTokenPayload = {
    ...parsed,
    access_token: newAccessToken,
    token_type: tokenData.token_type || "Bearer",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    expiry: newExpiry,
  };

  const newPlainJson = JSON.stringify(updatedPayload);
  const enc = encryptSecret(newPlainJson);

  const updatedMeta = {
    ...prevMeta,
    baseFolder,
    secretHint: `OAuth (${refreshToken.slice(0, 4)}••••${refreshToken.slice(-4)})`,
    lastRefreshedAt: new Date().toISOString(),
  };

  await prisma.credential.update({
    where: { id: cred.id },
    data: {
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      metadataJson: JSON.stringify(updatedMeta),
    },
  });

  let email = "Google Drive User";
  let used = "0 GB";
  let limit = "Unlimited";

  try {
    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)",
      {
        headers: { Authorization: `Bearer ${newAccessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }
    );
    if (aboutRes.ok) {
      const dData = (await aboutRes.json()) as {
        user?: { emailAddress?: string };
        storageQuota?: { limit?: string; usage?: string };
      };
      if (dData.user?.emailAddress) email = dData.user.emailAddress;
      if (dData.storageQuota?.usage) used = formatBytesToTbOrGb(dData.storageQuota.usage);
      if (dData.storageQuota?.limit) limit = formatBytesToTbOrGb(dData.storageQuota.limit);
    }
  } catch (aboutErr) {
    console.warn("[refreshAndPersistGDriveToken] /about verification check failed:", aboutErr);
  }

  return {
    accessToken: newAccessToken,
    email,
    used,
    limit,
    baseFolder,
    expiresAt: newExpiry,
  };
}

/**
 * Mints a fresh Google OAuth2 access token using refresh_token + client_id + client_secret,
 * auto-refreshing expired tokens and persisting updates to the database when userId is provided.
 */
export async function mintGDriveAccessToken(
  parsed: GDriveTokenPayload,
  userId?: string,
  accountAlias = "default"
): Promise<string> {
  // Check if current access token is still valid (with 60-second safety cushion)
  if (parsed.access_token && parsed.expiry) {
    const expiresAt = new Date(parsed.expiry).getTime();
    if (!Number.isNaN(expiresAt) && Date.now() < expiresAt - 60000) {
      return parsed.access_token;
    }
  }

  const clientId =
    parsed.client_id ||
    process.env.GDRIVE_CLIENT_ID ||
    process.env.CLIENT_ID;
  const clientSecret =
    parsed.client_secret ||
    process.env.GDRIVE_CLIENT_SECRET ||
    process.env.SECRET;
  const refreshToken =
    parsed.refresh_token ||
    process.env.GDRIVE_REFRESH_TOKEN;

  if (refreshToken && clientId && clientSecret) {
    if (userId) {
      try {
        const refreshed = await refreshAndPersistGDriveToken(userId, accountAlias, {
          clientId,
          clientSecret,
          refreshToken,
        });
        return refreshed.accessToken;
      } catch (err) {
        console.warn("[mintGDriveAccessToken] refreshAndPersistGDriveToken failed:", err);
      }
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
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
    } else {
      const errText = await res.text().catch(() => "");
      console.error("[mintGDriveAccessToken] OAuth token refresh failed:", res.status, errText);
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
 * Recursively scans `<baseFolder>/models` across all category subfolders (up to depth 3)
 * so the Studio Workflow Creator & Drive Preview/Review scanner can list every file on 5 TB Drive.
 */
export async function scanAllModelsInGDriveApi(userId: string): Promise<{
  baseFolder: string;
  files: Array<GDriveModelFile & { subdir: string; relativePath: string }>;
}> {
  const resolved = await getUserGDriveCredential(userId);
  if (!resolved) {
    throw new Error("No Google Drive credential found in Vault.");
  }

  const accessToken = await mintGDriveAccessToken(resolved.parsed);
  const modelsRootSegments = [...resolved.baseFolder.split("/").filter(Boolean), "models"];
  const modelsFolderId = await findFolderIdByPath(accessToken, modelsRootSegments);

  if (!modelsFolderId) {
    return { baseFolder: resolved.baseFolder, files: [] };
  }

  const results: Array<GDriveModelFile & { subdir: string; relativePath: string }> = [];

  async function listChildren(folderId: string) {
    const q = `'${folderId}' in parents and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=name&pageSize=200`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Google Drive scan failed (${res.status})`);
    }
    const data = (await res.json()) as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
      }>;
    };
    return data.files || [];
  }

  const topEntries = await listChildren(modelsFolderId);
  for (const catEntry of topEntries) {
    if (catEntry.mimeType !== "application/vnd.google-apps.folder") continue;
    const category = catEntry.name;
    const level1 = await listChildren(catEntry.id);

    for (const entry of level1) {
      if (entry.mimeType === "application/vnd.google-apps.folder") {
        const subdir = entry.name;
        const level2 = await listChildren(entry.id);
        for (const nested of level2) {
          if (nested.mimeType === "application/vnd.google-apps.folder") continue;
          results.push({
            id: nested.id,
            name: nested.name,
            category,
            subdir,
            relativePath: `${category}/${subdir}/${nested.name}`,
            sizeBytes: Number(nested.size || 0),
            modifiedTime: nested.modifiedTime,
          });
        }
      } else {
        results.push({
          id: entry.id,
          name: entry.name,
          category,
          subdir: "",
          relativePath: `${category}/${entry.name}`,
          sizeBytes: Number(entry.size || 0),
          modifiedTime: entry.modifiedTime,
        });
      }
    }
  }

  return { baseFolder: resolved.baseFolder, files: results };
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

