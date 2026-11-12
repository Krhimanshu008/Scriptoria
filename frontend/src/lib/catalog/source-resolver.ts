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

async function lookupHfRepoFile(
  repoId: string,
  desiredPathOrName: string,
  hfToken?: string
): Promise<{ path: string; size?: number; sha256?: string } | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const cleanWanted = desiredPathOrName.replace(/^\/+/, "");
  const wantedBase = cleanWanted.split("/").pop()?.toLowerCase() || "";

  const treeUrl = `https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`;
  const res = await fetch(treeUrl, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const entries = (await res.json()) as HfTreeNode[];
  const files = entries.filter((e) => e.type === "file" && e.path);

  const exact = files.find((f) => f.path?.toLowerCase() === cleanWanted.toLowerCase());
  const byName =
    exact || files.find((f) => f.path?.split("/").pop()?.toLowerCase() === wantedBase);

  if (!byName?.path) return null;
  return {
    path: byName.path,
    size: byName.lfs?.size ?? byName.size,
    sha256: byName.lfs?.oid,
  };
}

/**
 * Resolves the fastest authenticated direct download URL (HuggingFace -> Civitai -> Direct URL)
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
  const [hfCred, civitaiCred] = await Promise.all([
    getDecryptedCredential(userId, "huggingface", "default").catch(() => null),
    getDecryptedCredential(userId, "civitai", "default").catch(() => null),
  ]);

  const hfToken = hfCred?.secret?.trim() || undefined;
  const civitaiKey = civitaiCred?.secret?.trim() || undefined;

  if (asset.hfRepoId) {
    const targetPath = (asset.hfFilePath || asset.filename).replace(/^\/+/, "");
    const resolved = await lookupHfRepoFile(asset.hfRepoId, targetPath, hfToken).catch(() => null);
    const finalPath = resolved?.path || targetPath;
    const url = `https://huggingface.co/${asset.hfRepoId}/resolve/main/${finalPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

    return {
      sourceKind: "huggingface",
      url,
      filename: asset.filename,
      expectedSizeBytes: resolved?.size ?? (asset.sizeBytes || undefined),
      sha256: resolved?.sha256 ?? (asset.sha256 || undefined),
      authHeader: hfToken ? `Bearer ${hfToken}` : undefined,
    };
  }

  if (asset.civitaiVersionId) {
    const base = `https://civitai.com/api/download/models/${encodeURIComponent(
      asset.civitaiVersionId
    )}`;
    const url = civitaiKey ? `${base}?token=${encodeURIComponent(civitaiKey)}` : base;
    return {
      sourceKind: "civitai",
      url,
      filename: asset.filename,
      expectedSizeBytes: asset.sizeBytes || undefined,
      sha256: asset.sha256 || undefined,
    };
  }

  if (asset.civitaiModelId) {
    const metaRes = await fetch(
      `https://civitai.com/api/v1/models/${encodeURIComponent(asset.civitaiModelId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) }
    ).catch(() => null);
    if (metaRes?.ok) {
      const data = (await metaRes.json()) as {
        modelVersions?: Array<{
          id?: number;
          files?: Array<{ name?: string; sizeKB?: number; hashes?: { SHA256?: string }; downloadUrl?: string }>;
        }>;
      };
      const ver = data.modelVersions?.[0];
      const file = ver?.files?.[0];
      const dlBase =
        file?.downloadUrl ||
        (ver?.id ? `https://civitai.com/api/download/models/${ver.id}` : null);
      if (dlBase) {
        const sep = dlBase.includes("?") ? "&" : "?";
        const url = civitaiKey ? `${dlBase}${sep}token=${encodeURIComponent(civitaiKey)}` : dlBase;
        return {
          sourceKind: "civitai",
          url,
          filename: asset.filename || file?.name || `civitai_${asset.civitaiModelId}.safetensors`,
          expectedSizeBytes:
            (file?.sizeKB ? Math.round(file.sizeKB * 1024) : undefined) ??
            (asset.sizeBytes || undefined),
          sha256: file?.hashes?.SHA256?.toLowerCase() ?? (asset.sha256 || undefined),
        };
      }
    }
  }

  if (asset.directUrl) {
    return {
      sourceKind: "direct",
      url: asset.directUrl,
      filename: asset.filename,
      expectedSizeBytes: asset.sizeBytes || undefined,
      sha256: asset.sha256 || undefined,
    };
  }

  return null;
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

  if (host.includes("huggingface.co")) {
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("Invalid HuggingFace URL. Expected https://huggingface.co/<owner>/<repo>/...");
    }
    const repoId = `${parts[0]}/${parts[1]}`;
    const hfCred = await getDecryptedCredential(userId, "huggingface", "default").catch(() => null);
    const hfToken = hfCred?.secret?.trim() || undefined;

    let filePath = "";
    const modeIdx = parts.findIndex((p) => p === "blob" || p === "resolve" || p === "raw");
    if (modeIdx >= 2 && parts.length > modeIdx + 2) {
      filePath = parts.slice(modeIdx + 2).join("/");
    } else if (parts.length > 2 && parts[2] !== "tree") {
      filePath = parts.slice(2).join("/");
    }

    if (filePath) {
      const info = await lookupHfRepoFile(repoId, filePath, hfToken).catch(() => null);
      const finalPath = info?.path || filePath;
      const filename = finalPath.split("/").pop() || "model.safetensors";
      return {
        sourceKind: "huggingface",
        displayName: filename.replace(/\.(safetensors|gguf|pth|pt|bin)$/i, ""),
        filename,
        sizeBytes: info?.size,
        sha256: info?.sha256,
        hfRepoId: repoId,
        hfFilePath: finalPath,
        suggestedCategory: inferCategoryFromFilename(finalPath),
      };
    }

    // Repo root URL: pick largest safetensors/gguf/pth/pt file automatically
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

  if (host.includes("civitai.com")) {
    const versionMatch =
      parsedUrl.pathname.match(/\/api\/download\/models\/(\d+)/) ||
      parsedUrl.searchParams.get("modelVersionId")?.match(/^(\d+)$/);
    const modelMatch = parsedUrl.pathname.match(/\/models\/(\d+)/);
    const versionId = versionMatch?.[1];
    const modelId = modelMatch?.[1];

    if (versionId) {
      const res = await fetch(`https://civitai.com/api/v1/model-versions/${versionId}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const ver = (await res.json()) as {
          modelId?: number;
          baseModel?: string;
          model?: { name?: string; type?: string };
          files?: Array<{ name?: string; sizeKB?: number; hashes?: { SHA256?: string } }>;
        };
        const file = ver.files?.[0];
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
    }

    if (modelId) {
      const res = await fetch(`https://civitai.com/api/v1/models/${modelId}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          name?: string;
          type?: string;
          modelVersions?: Array<{
            id?: number;
            baseModel?: string;
            files?: Array<{ name?: string; sizeKB?: number; hashes?: { SHA256?: string } }>;
          }>;
        };
        const ver = data.modelVersions?.[0];
        const file = ver?.files?.[0];
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

