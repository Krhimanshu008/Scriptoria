import { getDecryptedCredential } from "@/lib/crypto/credentials";

export interface ResolvedDownloadSource {
  sourceKind: "huggingface" | "civitai" | "direct";
  url: string;
  filename: string;
  expectedSizeBytes?: number;
  sha256?: string;
  authHeader?: string;
}

export interface ParsedRemoteModelMetadata {
  sourceKind: "huggingface" | "civitai" | "direct";
  displayName: string;
  filename: string;
  sizeBytes?: number;
  sha256?: string;
  hfRepoId?: string;
  hfFilePath?: string;
  civitaiModelId?: string;
  civitaiVersionId?: string;
  directUrl?: string;
  compatibleBase?: string;
  suggestedCategory?: string;
}

interface HfTreeNode {
  type?: string;
  path?: string;
  size?: number;
  lfs?: { oid?: string; size?: number };
}

function parseHfFileUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://huggingface.co") return null;
    const match = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/(?:resolve|blob|raw)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { repo: match[1], revision: decodeURIComponent(match[2]), path: decodeURIComponent(match[3]) };
  } catch {
    return null;
  }
}

interface CivitaiFileMeta {
  name?: string;
  sizeKB?: number;
  type?: string;
  primary?: boolean;
  hashes?: { SHA256?: string };
  downloadUrl?: string;
}

function selectBestCivitaiFile(
  files: CivitaiFileMeta[] | undefined,
  desiredFilename?: string | null
): CivitaiFileMeta | undefined {
  if (!files || files.length === 0) return undefined;
  const wanted = (desiredFilename || "").trim().toLowerCase();
  if (wanted) {
    return files.find((file) => file.name?.toLowerCase() === wanted);
  }
  return (
    files.find((f) => f.primary) ||
    files.find((f) => f.type?.toLowerCase() === "model") ||
    files.find((f) => /\.(safetensors|gguf|ckpt|pt|pth)$/i.test(f.name || "")) ||
    files[0]
  );
}

/**
 * Resolves ALL configured download mirrors in priority order (HuggingFace -> Civitai -> Direct URL)
 * so VM fetchers and CPU mirrors can automatically fail over when one CDN returns 401/403/404 or SHA mismatch.
 */
export async function resolveAllModelDownloadSources(
  userId: string,
  asset: {
    filename: string;
    sizeBytes?: number | null;
    sha256?: string | null;
    hfRepoId?: string | null;
    hfFilePath?: string | null;
    civitaiModelId?: string | null;
    civitaiVersionId?: string | null;
    directUrl?: string | null;
  }
): Promise<ResolvedDownloadSource[]> {
  const [hfCred, civitaiCred] = await Promise.all([
    getDecryptedCredential(userId, "huggingface", "default").catch(() => null),
    getDecryptedCredential(userId, "civitai", "default").catch(() => null),
  ]);

  const hfToken = hfCred?.secret?.trim() || undefined;
  const civitaiKey = civitaiCred?.secret?.trim() || undefined;
  const civitaiApiHeaders: Record<string, string> = { Accept: "application/json" };
  if (civitaiKey) civitaiApiHeaders["Authorization"] = `Bearer ${civitaiKey}`;

  const sources: ResolvedDownloadSource[] = [];
  const seenUrls = new Set<string>();
  const pushSource = (src: ResolvedDownloadSource) => {
    if (!src.url || seenUrls.has(src.url)) return;
    seenUrls.add(src.url);
    sources.push(src);
  };

  const errors: string[] = [];
  const pinnedHash = asset.sha256?.toLowerCase() || undefined;
  if (asset.hfRepoId && /^[\w.-]+\/[\w.-]+$/.test(asset.hfRepoId)) {
    const path = (asset.hfFilePath || asset.filename).split("/").map(encodeURIComponent).join("/");
    const base = `https://huggingface.co/${asset.hfRepoId}/resolve/`;
    const headers = hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined;
    const imported = parseHfFileUrl(asset.directUrl);
    const requestedRevision = imported?.repo === asset.hfRepoId && imported.path === (asset.hfFilePath || asset.filename)
      ? encodeURIComponent(imported.revision) : "main";
    const info = await fetch(`${base}${requestedRevision}/${path}`, {
      method: "HEAD", headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (info && info.status >= 200 && info.status < 400) {
      const etag = (info.headers.get("x-linked-etag") || info.headers.get("etag") || "").replace(/"/g, "").toLowerCase();
      const remoteHash = /^[a-f0-9]{64}$/.test(etag) ? etag : undefined;
      const revision = info.headers.get("x-repo-commit");
      if (pinnedHash && remoteHash && pinnedHash !== remoteHash) {
        errors.push("Hugging Face file differs from the catalog checksum");
      } else {
        pushSource({ sourceKind: "huggingface", filename: asset.filename,
          url: `${base}${revision && /^[a-f0-9]{40}$/.test(revision) ? revision : requestedRevision}/${path}`,
          authHeader: headers?.Authorization, sha256: pinnedHash || remoteHash,
          expectedSizeBytes: Number(info.headers.get("x-linked-size") || (info.ok && info.headers.get("content-length"))) || undefined,
        });
      }
    } else {
      errors.push(`Hugging Face file lookup: ${info?.status ?? "network error"}`);
    }
  }

  if (asset.civitaiVersionId || asset.civitaiModelId) {
    const version = Boolean(asset.civitaiVersionId);
    const id = encodeURIComponent((asset.civitaiVersionId || asset.civitaiModelId)!);
    const res = await fetch(`https://civitai.com/api/v1/${version ? "model-versions" : "models"}/${id}`, {
      headers: civitaiApiHeaders, cache: "no-store", signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (res?.ok) {
      type Version = { files?: CivitaiFileMeta[] };
      const data = await res.json() as Version & { modelVersions?: Version[] };
      const versions = version ? [data] : (data.modelVersions || []);
      const files = versions.flatMap((v) => v.files || []);
      const expectedHash = pinnedHash || sources[0]?.sha256;
      const file = expectedHash
        ? files.find((f) => f.hashes?.SHA256?.toLowerCase() === expectedHash)
        : selectBestCivitaiFile(files, asset.filename);
      const url = file?.downloadUrl;
      const sha = file?.hashes?.SHA256?.toLowerCase();
      if (url && /^https:\/\/civitai\.com\/api\/download\/models\/\d+([?]|$)/.test(url) && sha && /^[a-f0-9]{64}$/.test(sha)) {
        pushSource({ sourceKind: "civitai", url, filename: asset.filename, sha256: sha,
          authHeader: civitaiKey ? `Bearer ${civitaiKey}` : undefined });
      } else {
        errors.push(`Civitai has no matching verified file for ${asset.filename}`);
      }
    } else {
      errors.push(`Civitai metadata lookup: ${res?.status ?? "network error"}`);
    }
  }

  if (asset.directUrl && !(asset.hfRepoId && parseHfFileUrl(asset.directUrl))) {
    pushSource({
      sourceKind: "direct",
      url: asset.directUrl,
      filename: asset.filename,
      expectedSizeBytes: asset.sizeBytes || undefined,
      sha256: asset.sha256 || undefined,
    });
  }

  if (!sources.length && errors.length) throw new Error(errors.join(". "));
  return sources;
}

/**
 * Resolves the highest-priority authenticated direct download URL (HuggingFace -> Civitai -> Direct URL)
 * for a ModelAsset using tokens stored in the user's AES-256-GCM Vault.
 */
export async function resolveFastModelDownloadSource(
  userId: string,
  asset: {
    filename: string;
    sizeBytes?: number | null;
    sha256?: string | null;
    hfRepoId?: string | null;
    hfFilePath?: string | null;
    civitaiModelId?: string | null;
    civitaiVersionId?: string | null;
    directUrl?: string | null;
  }
): Promise<ResolvedDownloadSource | null> {
  const sources = await resolveAllModelDownloadSources(userId, asset);
  return sources[0] ?? null;
}

/**
 * Inspects a pasted HuggingFace, Civitai, or direct model URL and returns auto-populated metadata.
 */
export async function inspectRemoteModelUrl(
  userId: string,
  rawUrl: string
): Promise<ParsedRemoteModelMetadata> {
  const trimmed = rawUrl.trim();
  const parsedUrl = new URL(trimmed);
  const host = parsedUrl.hostname.toLowerCase();

  if (host === "huggingface.co") {
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("Invalid HuggingFace URL. Expected https://huggingface.co/<owner>/<repo>/...");
    }
    const repoId = `${parts[0]}/${parts[1]}`;

    const imported = parseHfFileUrl(trimmed);
    if (imported) {
      const filename = imported.path.split("/").pop()!;
      const directUrl = `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(imported.revision)}/${imported.path.split("/").map(encodeURIComponent).join("/")}`;
      const [file] = await resolveAllModelDownloadSources(userId, {
        filename, hfRepoId: repoId, hfFilePath: imported.path, directUrl,
      });
      if (!file) throw new Error("Hugging Face file metadata unavailable.");
      return {
        sourceKind: "huggingface", displayName: filename.replace(/\.(safetensors|gguf|pth|pt|bin)$/i, ""),
        filename, sizeBytes: file.expectedSizeBytes, sha256: file.sha256,
        hfRepoId: repoId, hfFilePath: imported.path, directUrl: file.url,
        suggestedCategory: inferCategoryFromFilename(imported.path),
      };
    }
    if (parts.length > 2 && (parts[2] !== "tree" || parts[3] !== "main" || parts.length > 4)) {
      throw new Error("Paste the full Hugging Face file URL, including its revision and filename.");
    }

    // Repo root URL: pick largest safetensors/gguf/pth/pt file automatically
    const hfCred = await getDecryptedCredential(userId, "huggingface", "default").catch(() => null);
    const hfToken = hfCred?.secret?.trim();
    const treeRes = await fetch(
      `https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`,
      {
        headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!treeRes.ok) {
      throw new Error(`HuggingFace repo lookup failed (${treeRes.status}). Paste full file URL.`);
    }
    const tree = (await treeRes.json()) as HfTreeNode[];
    const weights = tree
      .filter((t) => t.type === "file" && /\.(safetensors|gguf|pth|pt)$/i.test(t.path || ""))
      .sort((a, b) => (b.lfs?.size ?? b.size ?? 0) - (a.lfs?.size ?? a.size ?? 0));
    const top = weights[0];
    if (!top?.path) {
      throw new Error("No .safetensors/.gguf/.pth/.pt weights found in that HuggingFace repo.");
    }
    const filename = top.path.split("/").pop() || "model.safetensors";
    return {
      sourceKind: "huggingface",
      displayName: `${parts[1]} (${filename})`,
      filename,
      sizeBytes: top.lfs?.size ?? top.size,
      sha256: top.lfs?.oid,
      hfRepoId: repoId,
      hfFilePath: top.path,
      suggestedCategory: inferCategoryFromFilename(top.path),
    };
  }

  if (host === "civitai.com" || host === "www.civitai.com") {
    const versionMatch =
      parsedUrl.pathname.match(/\/api\/download\/models\/(\d+)/) ||
      parsedUrl.searchParams.get("modelVersionId")?.match(/^(\d+)$/);
    const modelMatch = parsedUrl.pathname.match(/\/models\/(\d+)/);
    const versionId = versionMatch?.[1];
    const modelId = modelMatch?.[1];
    const civitaiCred = await getDecryptedCredential(userId, "civitai", "default").catch(() => null);
    const civitaiKey = civitaiCred?.secret?.trim() || undefined;
    const civitaiHeaders: Record<string, string> = { Accept: "application/json" };
    if (civitaiKey) civitaiHeaders["Authorization"] = `Bearer ${civitaiKey}`;

    if (versionId) {
      const res = await fetch(`https://civitai.com/api/v1/model-versions/${versionId}`, {
        headers: civitaiHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Civitai version lookup failed (HTTP ${res.status}).`);
      const ver = (await res.json()) as {
        modelId?: number;
        baseModel?: string;
        model?: { name?: string; type?: string };
        files?: CivitaiFileMeta[];
      };
      const selectors = [...parsedUrl.searchParams].filter(([key]) =>
        ["type", "format", "size", "fp"].includes(key.toLowerCase()));
      const file = selectors.length && parsedUrl.pathname.startsWith("/api/download/models/")
        ? ver.files?.find((candidate) => {
            if (!candidate.downloadUrl) return false;
            const fields = new Map([...new URL(candidate.downloadUrl).searchParams].map(([key, val]) => [key.toLowerCase(), val.toLowerCase()]));
            return selectors.every(([key, val]) => fields.get(key.toLowerCase()) === val.toLowerCase());
          })
        : selectBestCivitaiFile(ver.files);
      if (!file?.name) throw new Error("The requested Civitai file variant is unavailable.");
      const filename = file?.name || `civitai_${versionId}.safetensors`;
      return {
        sourceKind: "civitai",
        displayName: ver.model?.name || filename,
        filename,
        sizeBytes: file?.sizeKB ? Math.round(file.sizeKB * 1024) : undefined,
        sha256: file?.hashes?.SHA256?.toLowerCase(),
        civitaiModelId: ver.modelId ? String(ver.modelId) : modelId,
        civitaiVersionId: versionId,
        compatibleBase: ver.baseModel,
        suggestedCategory: inferCivitaiCategory(ver.model?.type, filename),
      };
    }

    if (!versionId && modelId) {
      const res = await fetch(`https://civitai.com/api/v1/models/${modelId}`, {
        headers: civitaiHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Civitai model lookup failed (HTTP ${res.status}).`);
      const data = (await res.json()) as {
        name?: string;
        type?: string;
        modelVersions?: Array<{
          id?: number;
          baseModel?: string;
          files?: CivitaiFileMeta[];
        }>;
      };
      const ver = data.modelVersions?.[0];
      const file = selectBestCivitaiFile(ver?.files);
      const filename = file?.name || `civitai_${modelId}.safetensors`;
      return {
        sourceKind: "civitai",
        displayName: data.name || filename,
        filename,
        sizeBytes: file?.sizeKB ? Math.round(file.sizeKB * 1024) : undefined,
        sha256: file?.hashes?.SHA256?.toLowerCase(),
        civitaiModelId: modelId,
        civitaiVersionId: ver?.id ? String(ver.id) : undefined,
        compatibleBase: ver?.baseModel,
        suggestedCategory: inferCivitaiCategory(data.type, filename),
      };
    }

    throw new Error("Could not resolve Civitai model ID or version ID from URL.");
  }

  const filename = parsedUrl.pathname.split("/").filter(Boolean).pop() || "model.safetensors";
  return {
    sourceKind: "direct",
    displayName: filename.replace(/\.(safetensors|gguf|pth|pt|bin)$/i, ""),
    filename,
    directUrl: trimmed,
    suggestedCategory: inferCategoryFromFilename(filename),
  };
}

function inferCategoryFromFilename(pathOrName: string): string {
  const lower = pathOrName.toLowerCase();
  if (lower.includes("vae")) return "vae";
  if (lower.includes("lora")) return "loras";
  if (lower.includes("controlnet")) return "controlnet";
  if (lower.includes("ip-adapter") || lower.includes("ipadapter")) return "ipadapter";
  if (lower.includes("clip_vision") || lower.includes("vit-h")) return "clip_vision";
  if (lower.includes("t5") || lower.includes("clip_l") || lower.includes("qwen_2.5_vl")) {
    return "text_encoders";
  }
  if (lower.includes("4x") || lower.includes("ultrasharp") || lower.includes("animesharp")) {
    return "upscale_models";
  }
  if (lower.endsWith(".gguf")) return "unet";
  if (lower.includes("kokoro") || lower.includes("f5-tts") || lower.includes("cosyvoice")) {
    return "tts";
  }
  if (lower.includes("mmaudio")) return "audio_sfx";
  if (lower.includes("stable_audio") || lower.includes("ace-step")) return "audio_bgm";
  if (lower.includes("latentsync") || lower.includes("liveportrait")) return "lipsync";
  return "checkpoints";
}

function inferCivitaiCategory(modelType?: string, filename = ""): string {
  const t = (modelType || "").toLowerCase();
  if (t === "lora" || t === "locon") return "loras";
  if (t === "vae") return "vae";
  if (t === "controlnet") return "controlnet";
  if (t === "upscaler") return "upscale_models";
  if (t === "checkpoint") return "checkpoints";
  return inferCategoryFromFilename(filename);
}

