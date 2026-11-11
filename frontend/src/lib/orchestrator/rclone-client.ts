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

export class GDriveModelStreamer {
  public static async listModelsInDriveViaVm(
    vm: VmEndpointTarget,
    baseFolder: string,
    category = "checkpoints"
  ) {
    const cleanBase = baseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria";
    const data = await VmGateway.callJson<RcloneListResponse>(vm, "/operations/list", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        fs: `gdrive:${cleanBase}/models/${category}`,
        remote: "",
      }),
      timeoutMs: 15000,
    });

    return (data.list || [])
      .filter((item) => !item.IsDir)
      .map((item) => ({
        id: item.ID || item.Name,
        name: item.Name,
        category,
        sizeBytes: item.Size || 0,
        modifiedTime: item.ModTime,
      }));
  }

  public static async startModelStream(
    vm: VmEndpointTarget,
    baseFolder: string,
    category: string,
    filename: string
  ) {
    const cleanBase = baseFolder.replace(/^\/+|\/+$/g, "") || "Scriptoria";
    return VmGateway.callJson<{ jobid?: number }>(vm, "/operations/copyfile", {
      method: "POST",
      targetPort: 5572,
      body: JSON.stringify({
        srcFs: `gdrive:${cleanBase}/models/${category}`,
        srcRemote: filename,
        dstFs: `/tmp/models/${category}`,
        dstRemote: filename,
        _async: true,
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
}

