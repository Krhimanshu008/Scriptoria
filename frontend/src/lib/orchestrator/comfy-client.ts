import { VmEndpointTarget, VmGateway } from "./vm-gateway";

export interface SystemStatsResponse {
  system?: {
    os: string;
    python_version: string;
  };
  devices?: Array<{
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }>;
}

export interface ComfyCatalog {
  target: string;
  models: {
    checkpoints: string[];
    vaes: string[];
    loras: string[];
    controlnets: string[];
    ipadapters: string[];
    clip_vision: string[];
  };
  totalNodesAvailable: number;
  fetchedAt: string;
}

export interface BuildWorkflowGraphInput {
  prompt: string;
  negativePrompt?: string;
  checkpoint: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed: number;
  target: string;
}

export interface ComfyOutputImageInfo {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyObjectInfoNode {
  input?: {
    required?: Record<string, [string[], ...unknown[]]>;
  };
}

interface ComfyHistoryRecord {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  outputs?: Record<
    string,
    {
      images?: Array<{
        filename: string;
        subfolder?: string;
        type?: string;
      }>;
    }
  >;
}

export class ComfyClient {
  constructor(private vm: VmEndpointTarget) {}

  public async getSystemStats(): Promise<SystemStatsResponse> {
    return VmGateway.callJson<SystemStatsResponse>(this.vm, "/system_stats", {
      method: "GET",
      targetPort: this.vm.internalPort,
      timeoutMs: 4000,
    });
  }

  public async getCatalog(target: string): Promise<ComfyCatalog> {
    const objInfo = await VmGateway.callJson<Record<string, ComfyObjectInfoNode>>(
      this.vm,
      "/object_info",
      {
        method: "GET",
        targetPort: this.vm.internalPort,
        timeoutMs: 15000,
      }
    );

    const extractList = (node: string, field: string): string[] => {
      const val = objInfo?.[node]?.input?.required?.[field]?.[0];
      return Array.isArray(val) ? val : [];
    };

    return {
      target,
      models: {
        checkpoints: extractList("CheckpointLoaderSimple", "ckpt_name"),
        vaes: extractList("VAELoader", "vae_name"),
        loras: extractList("LoraLoader", "lora_name"),
        controlnets: extractList("ControlNetLoader", "control_net_name"),
        ipadapters: extractList("IPAdapterModelLoader", "ipadapter_file"),
        clip_vision: extractList("CLIPVisionLoader", "clip_name"),
      },
      totalNodesAvailable: Object.keys(objInfo || {}).length,
      fetchedAt: new Date().toISOString(),
    };
  }

  public static buildStandardPromptGraph(input: BuildWorkflowGraphInput): Record<string, unknown> {
    return {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: input.checkpoint },
      },
      "2": {
        class_type: "EmptyLatentImage",
        inputs: {
          width: input.width ?? 1024,
          height: input.height ?? 1024,
          batch_size: 1,
        },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: input.prompt, clip: ["1", 1] },
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: input.negativePrompt || "bad quality, blurry, deformed", clip: ["1", 1] },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed: input.seed,
          steps: input.steps ?? 25,
          cfg: input.cfg ?? 6.0,
          sampler_name: "euler_ancestral",
          scheduler: "normal",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["3", 0],
          negative: ["4", 0],
          latent_image: ["2", 0],
        },
      },
      "6": {
        class_type: "VAEDecode",
        inputs: { samples: ["5", 0], vae: ["1", 2] },
      },
      "7": {
        class_type: "SaveImage",
        inputs: { images: ["6", 0], filename_prefix: `Scriptoria_${input.target}` },
      },
    };
  }

  public async queuePrompt(
    promptGraph: Record<string, unknown>,
    clientId: string
  ): Promise<{ prompt_id: string }> {
    return VmGateway.callJson<{ prompt_id: string }>(this.vm, "/prompt", {
      method: "POST",
      targetPort: this.vm.internalPort,
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
      timeoutMs: 15000,
    });
  }

  /**
   * Checks /history/{promptId} once (non-blocking for serverless status polling).
   */
  public async checkPromptHistory(
    promptId: string
  ): Promise<{ finished: boolean; images: ComfyOutputImageInfo[]; error?: string }> {
    const history = await VmGateway.callJson<Record<string, ComfyHistoryRecord>>(
      this.vm,
      `/history/${encodeURIComponent(promptId)}`,
      {
        method: "GET",
        targetPort: this.vm.internalPort,
        timeoutMs: 8000,
      }
    );

    const record = history?.[promptId];
    if (!record) {
      return { finished: false, images: [] };
    }

    if (record.status?.status_str === "error") {
      return {
        finished: true,
        images: [],
        error: JSON.stringify(record.status?.messages || "ComfyUI execution failed"),
      };
    }

    const outputs = record.outputs || {};
    const images: ComfyOutputImageInfo[] = [];
    for (const nodeId of Object.keys(outputs)) {
      const nodeImages = outputs[nodeId]?.images;
      if (Array.isArray(nodeImages)) {
        for (const img of nodeImages) {
          images.push({
            filename: img.filename,
            subfolder: img.subfolder || "",
            type: img.type || "output",
          });
        }
      }
    }

    return { finished: images.length > 0 || Boolean(record.status?.completed), images };
  }

  /**
   * Calls the VM's port 9999 sidecar to copy an output image into Google Drive and return its fileId.
   */
  public async syncOutputToGDrive(
    filename: string,
    subfolder = ""
  ): Promise<{ gdriveFileId: string; gdrivePath: string }> {
    return VmGateway.callJson<{ gdriveFileId: string; gdrivePath: string }>(
      this.vm,
      "/sync-output",
      {
        method: "POST",
        targetPort: this.vm.useRouteLess ? 9999 : this.vm.internalPort,
        body: JSON.stringify({ filename, subfolder }),
        timeoutMs: 30000,
      }
    );
  }
}

