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
  samplerName?: string;
  scheduler?: string;
  hiresPass?: boolean;
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
    if (input.hiresPass) {
      return this.buildHiresUpscalePromptGraph(input);
    }

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
          sampler_name: input.samplerName || "euler_ancestral",
          scheduler: input.scheduler || "normal",
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

  public static buildHiresUpscalePromptGraph(input: BuildWorkflowGraphInput): Record<string, unknown> {
    const baseW = input.width ?? 768;
    const baseH = input.height ?? 768;
    return {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: input.checkpoint },
      },
      "2": {
        class_type: "EmptyLatentImage",
        inputs: { width: baseW, height: baseH, batch_size: 1 },
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
          steps: input.steps ?? 22,
          cfg: input.cfg ?? 6.0,
          sampler_name: input.samplerName || "dpmpp_2m",
          scheduler: input.scheduler || "karras",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["3", 0],
          negative: ["4", 0],
          latent_image: ["2", 0],
        },
      },
      "6": {
        class_type: "LatentUpscale",
        inputs: {
          samples: ["5", 0],
          upscale_method: "bislerp",
          width: baseW * 2,
          height: baseH * 2,
          crop: "disabled",
        },
      },
      "7": {
        class_type: "KSampler",
        inputs: {
          seed: input.seed + 1,
          steps: Math.max(10, Math.round((input.steps ?? 22) * 0.6)),
          cfg: input.cfg ?? 6.0,
          sampler_name: input.samplerName || "dpmpp_2m",
          scheduler: input.scheduler || "karras",
          denoise: 0.55,
          model: ["1", 0],
          positive: ["3", 0],
          negative: ["4", 0],
          latent_image: ["6", 0],
        },
      },
      "8": {
        class_type: "VAEDecode",
        inputs: { samples: ["7", 0], vae: ["1", 2] },
      },
      "9": {
        class_type: "SaveImage",
        inputs: { images: ["8", 0], filename_prefix: `Scriptoria_${input.target}_Hires` },
      },
    };
  }

  /**
   * Injects a workflow JSON directly into ComfyUI WebUI's saved workflows sidebar (/userdata/workflows/<name>.json).
   */
  public async pushWorkflowToWebUi(
    workflowName: string,
    apiGraph: Record<string, unknown>
  ): Promise<{ savedPath: string }> {
    const cleanName = workflowName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.json$/i, "") + ".json";
    const objInfo = await VmGateway.callJson<Record<string, Record<string, unknown>>>(
      this.vm,
      "/object_info",
      {
        method: "GET",
        targetPort: this.vm.internalPort,
        timeoutMs: 12000,
      }
    );

    const uiWorkflow = convertApiGraphToLiteGraph(apiGraph, objInfo);
    const encodedRel = encodeURIComponent(`workflows/${cleanName}`);

    await VmGateway.callJson(this.vm, `/userdata/${encodedRel}?overwrite=true`, {
      method: "POST",
      targetPort: this.vm.internalPort,
      body: JSON.stringify(uiWorkflow),
      timeoutMs: 10000,
    });

    return { savedPath: `workflows/${cleanName}` };
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

interface ApiGraphNode {
  class_type: string;
  inputs?: Record<string, unknown>;
}

interface LiteGraphNode {
  id: number;
  type: string;
  pos: [number, number];
  size: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: Array<{ name: string; type: string; link: number | null }>;
  outputs: Array<{ name: string; type: string; links: number[]; slot_index: number }>;
  properties: Record<string, string>;
  widgets_values: unknown[];
}

function convertApiGraphToLiteGraph(
  rawGraph: Record<string, unknown>,
  objectInfo: Record<string, Record<string, unknown>>
) {
  const apiGraph = rawGraph as Record<string, ApiGraphNode>;
  const widgetTypes = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);
  const keys = Object.keys(apiGraph);
  const keyToId = new Map<string, number>();
  keys.forEach((k, idx) => keyToId.set(k, idx + 1));

  const depths: Record<string, number> = {};
  for (const k of keys) depths[k] = 0;

  for (let pass = 0; pass < keys.length; pass++) {
    for (const k of keys) {
      const inputs = apiGraph[k]?.inputs || {};
      for (const val of Object.values(inputs)) {
        if (Array.isArray(val) && val.length === 2 && String(val[0]) in depths) {
          depths[k] = Math.max(depths[k], depths[String(val[0])] + 1);
        }
      }
    }
  }

  const colCounts: Record<number, number> = {};
  const nodePositions: Record<string, [number, number]> = {};
  for (const k of keys) {
    const col = depths[k] || 0;
    const row = colCounts[col] || 0;
    colCounts[col] = row + 1;
    nodePositions[k] = [80 + col * 430, 80 + row * 310];
  }

  const uiNodes: Record<string, LiteGraphNode> = {};
  const links: Array<[number, number, number, number, number, string]> = [];
  let nextLinkId = 1;

  for (const k of keys) {
    const nid = keyToId.get(k)!;
    const ctype = apiGraph[k].class_type;
    const schema = (objectInfo[ctype] || {}) as {
      output?: unknown[];
      output_name?: string[];
    };
    const outTypes = Array.isArray(schema.output) ? schema.output : [];
    const outNames = Array.isArray(schema.output_name) ? schema.output_name : [];

    const uiOutputs = outTypes.map((otype, slotIdx) => ({
      name: String(outNames[slotIdx] ?? otype),
      type: Array.isArray(otype) ? "COMBO" : String(otype),
      links: [] as number[],
      slot_index: slotIdx,
    }));

    uiNodes[k] = {
      id: nid,
      type: ctype,
      pos: nodePositions[k],
      size: [360, 240],
      flags: {},
      order: nid - 1,
      mode: 0,
      inputs: [],
      outputs: uiOutputs,
      properties: { "Node name for S&R": ctype },
      widgets_values: [],
    };
  }

  for (const k of keys) {
    const nid = keyToId.get(k)!;
    const ctype = apiGraph[k].class_type;
    const givenInputs = apiGraph[k].inputs || {};
    const schema = (objectInfo[ctype] || {}) as {
      input?: {
        required?: Record<string, [unknown, Record<string, unknown>?]>;
        optional?: Record<string, [unknown, Record<string, unknown>?]>;
      };
    };

    const allInputs = [
      ...Object.entries(schema.input?.required || {}),
      ...Object.entries(schema.input?.optional || {}),
    ];

    for (const [inpName, inpSpec] of allInputs) {
      const specType = Array.isArray(inpSpec) && inpSpec.length > 0 ? inpSpec[0] : "STRING";
      const specCfg =
        Array.isArray(inpSpec) && inpSpec.length > 1 && typeof inpSpec[1] === "object" && inpSpec[1]
          ? (inpSpec[1] as Record<string, unknown>)
          : {};

      const isCombo = Array.isArray(specType) || String(specType) === "COMBO";
      const isWidget =
        isCombo || (widgetTypes.has(String(specType)) && !Boolean(specCfg.forceInput));
      let val = inpName in givenInputs ? givenInputs[inpName] : specCfg.default;

      const isLink =
        Array.isArray(val) && val.length === 2 && keyToId.has(String(val[0]));

      if (isLink) {
        const linkPair = val as [unknown, unknown];
        const srcKey = String(linkPair[0]);
        const srcSlot = Number(linkPair[1]);
        const srcId = keyToId.get(srcKey)!;
        const linkType = isCombo ? "COMBO" : String(specType);
        const dstSlot = uiNodes[k].inputs.length;
        const linkId = nextLinkId++;

        uiNodes[k].inputs.push({ name: inpName, type: linkType, link: linkId });
        while (uiNodes[srcKey].outputs.length <= srcSlot) {
          const idx = uiNodes[srcKey].outputs.length;
          uiNodes[srcKey].outputs.push({
            name: linkType,
            type: linkType,
            links: [],
            slot_index: idx,
          });
        }
        uiNodes[srcKey].outputs[srcSlot].links.push(linkId);
        links.push([linkId, srcId, srcSlot, nid, dstSlot, linkType]);
      } else if (isWidget) {
        if (val === undefined || val === null) {
          if (Array.isArray(specType) && specType.length > 0) val = specType[0];
          else if (String(specType) === "COMBO") {
            const opts = Array.isArray(specCfg.options) ? specCfg.options : [""];
            val = opts[0] ?? "";
          } else if (specType === "INT") val = 0;
          else if (specType === "FLOAT") val = 0.0;
          else if (specType === "BOOLEAN") val = false;
          else val = "";
        }
        uiNodes[k].widgets_values.push(val);
        if (inpName === "seed" || inpName === "noise_seed" || Boolean(specCfg.control_after_generate)) {
          uiNodes[k].widgets_values.push("fixed");
        }
      } else {
        uiNodes[k].inputs.push({ name: inpName, type: String(specType), link: null });
      }
    }
  }

  return {
    last_node_id: keys.length,
    last_link_id: nextLinkId - 1,
    nodes: Object.values(uiNodes),
    links,
    groups: [],
    config: {},
    extra: { ds: { scale: 0.75, offset: [50, 50] } },
    version: 0.4,
  };
}

