import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SAFE_USER_RE = /[^a-zA-Z0-9_-]/g;
const LOCAL_TOKEN_RE = /^(\d{8}_[0-9a-f-]{36})\.([a-z0-9]{1,8})$/i;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function getLocalOutputsRoot(): string {
  if (process.env.LOCAL_OUTPUT_DIR) {
    return path.resolve(process.env.LOCAL_OUTPUT_DIR);
  }
  return fs.existsSync("/app/data")
    ? "/app/data/outputs"
    : path.resolve(process.cwd(), "data", "outputs");
}

function safeUserDir(userId: string): string {
  const cleaned = userId.replace(SAFE_USER_RE, "_");
  return path.resolve(getLocalOutputsRoot(), cleaned || "user");
}

export async function saveLocalOutputFile(
  userId: string,
  originalFilename: string,
  data: Buffer
): Promise<{
  localFileId: string;
  localPath: string;
  storageUri: string;
  previewUrl: string;
}> {
  const rawExt = path.extname(originalFilename || "").replace(/^\./, "").toLowerCase();
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : "png";
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const token = `${day}_${crypto.randomUUID()}.${ext}`;

  const dir = safeUserDir(userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const dst = path.resolve(dir, token);
  if (!dst.startsWith(dir + path.sep)) {
    throw new Error("Invalid local output destination");
  }
  await fs.promises.writeFile(dst, data);

  const localFileId = `local-${token}`;
  return {
    localFileId,
    localPath: `local-vault/${token}`,
    storageUri: `local://${token}`,
    previewUrl: `/api/outputs/${encodeURIComponent(localFileId)}`,
  };
}

export async function readLocalOutputFile(
  userId: string,
  fileId: string
): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
  if (!fileId.startsWith("local-")) return null;
  const token = fileId.slice(6);
  const match = token.match(LOCAL_TOKEN_RE);
  if (!match) return null;

  const dir = safeUserDir(userId);
  const src = path.resolve(dir, token);
  if (!src.startsWith(dir + path.sep)) return null;

  try {
    const bytes = await fs.promises.readFile(/*turbopackIgnore: true*/ src);
    const ext = match[2].toLowerCase();
    return {
      bytes,
      contentType: MIME_BY_EXT[ext] || "application/octet-stream",
      filename: token,
    };
  } catch {
    return null;
  }
}
