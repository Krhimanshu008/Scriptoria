import { VmEndpointTarget, VmGateway } from "./vm-gateway";

export interface RcloneListResponse {
  list?: Array<{
    Path: string;
    Name: string;
    Size: number;
    ModTime: string;
    IsDir: boolean;
    ID?: string;
  }>;
}

export interface RcloneCoreStats {
  bytes?: number;
  speed?: number;
  transfers?: number;
  transferring?: Array<{
    name: string;
    size: number;
    bytes: number;
    percentage: number;
    speed: number;
    speedAvg: number;
    eta: number | null;
  }>;
}

export interface RcloneJobStatus {
  finished?: boolean;
  success?: boolean;
  error?: string;
  id?: number;
}

export interface VmStoredModelItem {
  category: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

const VALID_CATEGORIES = new Set([
  "checkpoints",
  "loras",
  "vae",
  "unet",
  "clip",
  "clip_vision",
  "controlnet",
  "ipadapter",
  "text_encoders",
  "upscale_models",
  "diffusion_models",
  "ultralytics",
  "sams",
  "tts",
  "audio_sfx",
  "audio_bgm",
  "lipsync",
]);

export function sanitizeModelCategory(category: string): string {
  const clean = category.trim().toLowerCase();
  return VALID_CATEGORIES.has(clean) ? clean : "checkpoints";
}

export class GDriveModelStreamer {
  public static async listModelsInDriveViaVm(
    vm: VmEndpointTarget,
    baseFolder: string,
    category = "checkpoints"
  ) {
    const cleanBase = baseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria";
    const safeCat = sanitizeModelCategory(category);
    const data = await VmGateway.callJson<RcloneListResponse>(vm, "/operations/list", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        fs: `gdrive:${cleanBase}/models/${safeCat}`,
        remote: "",
      }),
      timeoutMs: 15000,
    });

    return (data.list || [])
      .filter((item) => !item.IsDir)
      .map((item) => ({
        id: item.ID || item.Name,
        name: item.Name,
        category: safeCat,
        sizeBytes: item.Size || 0,
        modifiedTime: item.ModTime,
      }));
  }

  public static async listVmModelsViaRclone(vm: VmEndpointTarget): Promise<VmStoredModelItem[]> {
    const data = await VmGateway.callJson<RcloneListResponse>(vm, "/operations/list", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        fs: "/tmp/models",
        remote: "",
        opt: { recurse: true },
      }),
      timeoutMs: 10000,
    });

    const items: VmStoredModelItem[] = [];
    for (const item of data.list || []) {
      if (item.IsDir) continue;
      const parts = item.Path.split("/").filter(Boolean);
      const category = parts.length > 1 ? parts[0] : "checkpoints";
      const relName = parts.length > 1 ? parts.slice(1).join("/") : item.Name;
      items.push({
        category,
        name: relName,
        sizeBytes: item.Size || 0,
        modifiedAt: item.ModTime,
      });
    }
    return items;
  }

  public static async deleteVmModelViaRclone(
    vm: VmEndpointTarget,
    category: string,
    filename: string
  ): Promise<void> {
    const safeCat = sanitizeModelCategory(category);
    const safeName = filename.replace(/[/\\]/g, "");
    await VmGateway.callText(vm, "/operations/deletefile", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        fs: `/tmp/models/${safeCat}`,
        remote: safeName,
      }),
      timeoutMs: 10000,
    });
  }

  public static async statVmModel(
    vm: VmEndpointTarget,
    category: string,
    filename: string
  ): Promise<{ exists: boolean; sizeBytes: number }> {
    const safeCat = sanitizeModelCategory(category);
    try {
      const res = await VmGateway.callJson<{
        item?: { Name: string; Size: number; IsDir: boolean } | null;
      }>(vm, "/operations/stat", {
        method: "POST",
        targetPort: 5572,
        body: JSON.stringify({
          fs: `/tmp/models/${safeCat}`,
          remote: filename,
        }),
        timeoutMs: 5000,
      });
      if (res.item && !res.item.IsDir && res.item.Size > 0) {
        return { exists: true, sizeBytes: res.item.Size };
      }
      return { exists: false, sizeBytes: 0 };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  public static async startModelStream(
    vm: VmEndpointTarget,
    baseFolder: string,
    category: string,
    filename: string,
    options?: { provider?: "kaggle" | "colab" | string }
  ) {
    const cleanBase = baseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria";
    const safeCat = sanitizeModelCategory(category);
    const isColab = options?.provider === "colab";

    return VmGateway.callJson<{ jobid?: number }>(vm, "/operations/copyfile", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        srcFs: `gdrive:${cleanBase}/models/${safeCat}`,
        srcRemote: filename,
        dstFs: `/tmp/models/${safeCat}`,
        dstRemote: filename,
        _async: true,
        _config: {
          SizeOnly: true,
          IgnoreExisting: false,
          Inplace: false,
          MultiThreadCutoff: "64M",
          MultiThreadChunkSize: "128M",
          MultiThreadStreams: isColab ? 10 : 8,
          MultiThreadWriteBufferSize: "1M",
          BufferSize: isColab ? "8M" : "16M",
          DisableHTTP2: true,
        },
      }),
      timeoutMs: 15000,
    });
  }

  public static async getStreamStats(vm: VmEndpointTarget): Promise<RcloneCoreStats> {
    return VmGateway.callJson<RcloneCoreStats>(vm, "/core/stats", {
      method: "POST",
      targetPort: 5572,
      body: "{}",
      timeoutMs: 5000,
    });
  }

  public static async getJobStatus(
    vm: VmEndpointTarget,
    jobid: number
  ): Promise<RcloneJobStatus | null> {
    try {
      return await VmGateway.callJson<RcloneJobStatus>(vm, "/job/status", {
        method: "POST",
        targetPort: 5572,
        body: JSON.stringify({ jobid }),
        timeoutMs: 4000,
      });
    } catch {
      return null;
    }
  }
}
