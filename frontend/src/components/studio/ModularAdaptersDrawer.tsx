"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Users,
  ShieldCheck,
  Sliders,
  Sun,
  Upload,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import type {
  ControlNetMode,
  ControlNetModuleInput,
  IpConnectorMode,
  IpConnectorModuleInput,
  MultiCharRegionInput,
  RelightMode,
} from "@/lib/workflow/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export interface ModularAdaptersState {
  ipMode: IpConnectorMode;
  ipRefImage: string;
  ipWeight: number;
  cnMode: ControlNetMode;
  cnImage: string;
  cnStrength: number;
  cnEndPercent: number;
  cnPreprocessor: boolean;
  characters: MultiCharRegionInput[];
  relight: RelightMode;
  relightRefImage: string;
  enableHandDetailer: boolean;
  enable360Preview: boolean;
  dualGpuSplit: boolean;
}

export const DEFAULT_MODULAR_ADAPTERS: ModularAdaptersState = {
  ipMode: "none",
  ipRefImage: "",
  ipWeight: 0.72,
  cnMode: "none",
  cnImage: "",
  cnStrength: 0.8,
  cnEndPercent: 0.85,
  cnPreprocessor: true,
  characters: [],
  relight: "none",
  relightRefImage: "",
  enableHandDetailer: false,
  enable360Preview: false,
  dualGpuSplit: false,
};

interface ReferenceUploadBoxProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  target: string;
  isVmOnline: boolean;
  placeholder: string;
}

/**
 * Shared image reference uploader: uploads straight to ComfyUI /upload/image when VM is online,
 * or stages a local data:image URI that auto-uploads before prompt execution.
 */
function ReferenceUploadBox({
  label,
  value,
  onChange,
  target,
  isVmOnline,
  placeholder,
}: ReferenceUploadBoxProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (isVmOnline) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/vm/${encodeURIComponent(target)}/upload`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "VM upload failed; staging inline instead.");
        } else {
          onChange(data.filename);
          toast.success(`Uploaded '${data.filename}' to ${target.toUpperCase()} ComfyUI input/`);
          return;
        }
      }

      // Offline fallback: store compact data URI so stageGraphReferenceImages uploads when run
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      onChange(dataUrl);
      toast.info(`Staged '${file.name}' locally; will auto-upload on run.`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-zinc-300">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          value={value.startsWith("data:") ? "[Staged Local Image Ready]" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 flex-1 text-xs"
        />
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span>{isVmOnline ? "Upload" : "Stage"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </label>
      </div>
      {value.startsWith("data:image/") && (
        <div className="pt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Staged reference" className="h-14 w-14 rounded border border-zinc-700 object-cover" />
        </div>
      )}
    </div>
  );
}

interface ModularAdaptersDrawerProps {
  value: ModularAdaptersState;
  onChange: (next: ModularAdaptersState) => void;
  target: string;
  isVmOnline: boolean;
}

/**
 * Collapsible IP-Connector, ControlNet, Multi-Character Spatial Region, and Relight/Dual-T4 drawers.
 */
export function ModularAdaptersDrawer({
  value,
  onChange,
  target,
  isVmOnline,
}: ModularAdaptersDrawerProps) {
  const [openSection, setOpenSection] = useState<"ip" | "cn" | "chars" | "post" | null>("ip");

  const update = (patch: Partial<ModularAdaptersState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        <span>Modular Consistency, ControlNet &amp; Dual-T4 Blocks</span>
        <span className="font-mono text-[10px] text-emerald-400">T4 Guardrails Active</span>
      </div>

      {/* 1. IP-Connector Consistency */}
      <div className="rounded-md border border-zinc-800 bg-[#111114]">
        <button
          type="button"
          onClick={() => setOpenSection(openSection === "ip" ? null : "ip")}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-200"
        >
          <span className="flex items-center gap-2">
            {openSection === "ip" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
            IP-Connector (Character &amp; Style Lock)
          </span>
          <span className="font-mono text-[10px] text-zinc-400">{value.ipMode}</span>
        </button>

        {openSection === "ip" && (
          <div className="space-y-2.5 border-t border-zinc-800/80 p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">IP-Connector Architecture</Label>
                <select
                  value={value.ipMode}
                  onChange={(e) => update({ ipMode: e.target.value as IpConnectorMode })}
                  className="glass-input h-8 w-full rounded-md px-2 text-xs text-zinc-100"
                >
                  <option value="none" className="bg-zinc-900">None (Prompt Only)</option>
                  <option value="noob_ipa_mk1" className="bg-zinc-900">NoobAI IP-Adapter Mk1 (ViT-bigG Anime)</option>
                  <option value="style_aligned" className="bg-zinc-900">StyleAligned Batch Share (SDXL/NoobAI)</option>
                  <option value="anima_ref_v2" className="bg-zinc-900">Anima Ref Adapter v2 (r64)</option>
                  <option value="flux3_ref_latent" className="bg-zinc-900">FLUX 3 ReferenceLatent</option>
                  <option value="qwen21_ref_strength" className="bg-zinc-900">Qwen 2.1 Reference Latent</option>
                  <option value="sdxl_ipa_photoreal" className="bg-zinc-900">SDXL Plus (Photoreal Only)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Strength ({value.ipWeight.toFixed(2)})</Label>
                <Input
                  type="range"
                  min={0.1}
                  max={1.3}
                  step={0.05}
                  value={value.ipWeight}
                  onChange={(e) => update({ ipWeight: Number(e.target.value) })}
                  className="h-8 accent-cyan-400"
                />
              </div>
            </div>

            {value.ipMode !== "none" && value.ipMode !== "style_aligned" && (
              <ReferenceUploadBox
                label="Character / Style Reference Image"
                value={value.ipRefImage}
                onChange={(ipRefImage) => update({ ipRefImage })}
                target={target}
                isVmOnline={isVmOnline}
                placeholder="character_ref.png or https://..."
              />
            )}
          </div>
        )}
      </div>

      {/* 2. ControlNet */}
      <div className="rounded-md border border-zinc-800 bg-[#111114]">
        <button
          type="button"
          onClick={() => setOpenSection(openSection === "cn" ? null : "cn")}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-200"
        >
          <span className="flex items-center gap-2">
            {openSection === "cn" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Sliders className="h-3.5 w-3.5 text-amber-400" />
            ControlNet / Spatial Structure
          </span>
          <span className="font-mono text-[10px] text-zinc-400">{value.cnMode}</span>
        </button>

        {openSection === "cn" && (
          <div className="space-y-2.5 border-t border-zinc-800/80 p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Control Mode</Label>
                <select
                  value={value.cnMode}
                  onChange={(e) => update({ cnMode: e.target.value as ControlNetMode })}
                  className="glass-input h-8 w-full rounded-md px-2 text-xs text-zinc-100"
                >
                  <option value="none" className="bg-zinc-900">None</option>
                  <option value="canny" className="bg-zinc-900">Canny Edge</option>
                  <option value="depth" className="bg-zinc-900">Depth Map</option>
                  <option value="lineart_anime" className="bg-zinc-900">Anime Lineart / Sketch</option>
                  <option value="openpose" className="bg-zinc-900">OpenPose Skeleton</option>
                  <option value="tile" className="bg-zinc-900">Tile Detail / Repair</option>
                  <option value="qwen_fun_union" className="bg-zinc-900">Qwen 2.1 Fun Union INT8</option>
                  <option value="moss_color_depth" className="bg-zinc-900">MOSS Color + Depth LoRA</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Strength ({value.cnStrength.toFixed(2)})</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={0.1}
                  max={1.4}
                  value={value.cnStrength}
                  onChange={(e) => update({ cnStrength: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">End Percent</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={0.2}
                  max={1.0}
                  value={value.cnEndPercent}
                  onChange={(e) => update({ cnEndPercent: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {value.cnMode !== "none" && (
              <>
                <ReferenceUploadBox
                  label="Pose / Depth / Sketch Guide Image"
                  value={value.cnImage}
                  onChange={(cnImage) => update({ cnImage })}
                  target={target}
                  isVmOnline={isVmOnline}
                  placeholder="control_guide.png or https://..."
                />
                <label className="flex items-center gap-2 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={value.cnPreprocessor}
                    onChange={(e) => update({ cnPreprocessor: e.target.checked })}
                  />
                  Auto-extract Pose / Depth / Lineart on GPU (`comfyui_controlnet_aux`)
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {/* 3. Multi-Character Spatial Regions */}
      <div className="rounded-md border border-zinc-800 bg-[#111114]">
        <button
          type="button"
          onClick={() => setOpenSection(openSection === "chars" ? null : "chars")}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-200"
        >
          <span className="flex items-center gap-2">
            {openSection === "chars" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Users className="h-3.5 w-3.5 text-emerald-400" />
            Multi-Character Spatial Isolation (ComfyCouple / DiT Boxes)
          </span>
          <span className="font-mono text-[10px] text-zinc-400">{value.characters.length} regions</span>
        </button>

        {openSection === "chars" && (
          <div className="space-y-2 border-t border-zinc-800/80 p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  update({
                    characters: [
                      { name: "Left Hero", prompt: "silver-haired swordsman left side", x: 0, y: 0, w: 0.5, h: 1 },
                      { name: "Right Rival", prompt: "crimson-cloaked mage right side", x: 0.5, y: 0, w: 0.5, h: 1 },
                    ],
                  })
                }
                className="h-7 text-[11px]"
              >
                + 2-Char Left/Right Preset
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  update({
                    characters: [
                      ...value.characters,
                      { name: `Char ${value.characters.length + 1}`, prompt: "", x: 0.25, y: 0.1, w: 0.5, h: 0.8 },
                    ].slice(0, 4),
                  })
                }
                className="h-7 text-[11px]"
              >
                <Plus className="mr-1 h-3 w-3" /> Add Region
              </Button>
            </div>

            {value.characters.map((ch, idx) => (
              <div key={idx} className="space-y-1.5 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <Input
                    value={ch.prompt}
                    onChange={(e) => {
                      const next = [...value.characters];
                      next[idx] = { ...next[idx], prompt: e.target.value };
                      update({ characters: next });
                    }}
                    placeholder={`Character ${idx + 1} appearance & action...`}
                    className="h-7 flex-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => update({ characters: value.characters.filter((_, i) => i !== idx) })}
                    className="text-zinc-500 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {(["x", "y", "w", "h"] as const).map((coord) => (
                    <label key={coord} className="flex items-center gap-1 text-zinc-400">
                      <span className="uppercase">{coord}:</span>
                      <Input
                        type="number"
                        step={0.05}
                        min={0}
                        max={1}
                        value={ch[coord]}
                        onChange={(e) => {
                          const next = [...value.characters];
                          next[idx] = { ...next[idx], [coord]: Number(e.target.value) };
                          update({ characters: next });
                        }}
                        className="h-6 px-1.5 text-[10px]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Relighting, Detailers & Dual-T4 Split */}
      <div className="rounded-md border border-zinc-800 bg-[#111114]">
        <button
          type="button"
          onClick={() => setOpenSection(openSection === "post" ? null : "post")}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-200"
        >
          <span className="flex items-center gap-2">
            {openSection === "post" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Sun className="h-3.5 w-3.5 text-violet-400" />
            Relighting, Hand/Face Detailer &amp; Dual-T4 Split
          </span>
          <span className="font-mono text-[10px] text-zinc-400">
            {value.dualGpuSplit ? "Dual-T4 Split" : "Single T4"}
          </span>
        </button>

        {openSection === "post" && (
          <div className="space-y-2.5 border-t border-zinc-800/80 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Relight / Lighting Pass</Label>
                <select
                  value={value.relight}
                  onChange={(e) => update({ relight: e.target.value as RelightMode })}
                  className="glass-input h-8 w-full rounded-md px-2 text-xs text-zinc-100"
                >
                  <option value="none" className="bg-zinc-900">None</option>
                  <option value="lbm_relight" className="bg-zinc-900">JasperAI LBM Relight (4-Step Bridge)</option>
                  <option value="qwen_light_migration" className="bg-zinc-900">Qwen-Edit Light Migration</option>
                </select>
              </div>
              <div className="flex flex-col justify-end gap-1.5 text-[11px] text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.dualGpuSplit}
                    onChange={(e) => update({ dualGpuSplit: e.target.checked })}
                  />
                  Dual-T4 DiT Split (`cuda:0` DiT + `cuda:1` TE)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.enableHandDetailer}
                    onChange={(e) => update({ enableHandDetailer: e.target.checked })}
                  />
                  HandDetailer (YOLOv8n + SAM)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.enable360Preview}
                    onChange={(e) => update({ enable360Preview: e.target.checked })}
                  />
                  Interactive 360° Panorama Preview Node
                </label>
              </div>
            </div>

            {value.relight === "lbm_relight" && (
              <ReferenceUploadBox
                label="Background Lighting Plate (LBM Reference)"
                value={value.relightRefImage}
                onChange={(relightRefImage) => update({ relightRefImage })}
                target={target}
                isVmOnline={isVmOnline}
                placeholder="bg_lighting.png or https://..."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function buildAdapterArraysFromState(state: ModularAdaptersState): {
  ipConnectors?: IpConnectorModuleInput[];
  controlNets?: ControlNetModuleInput[];
  characters?: MultiCharRegionInput[];
} {
  return {
    ipConnectors:
      state.ipMode !== "none"
        ? [{ mode: state.ipMode, refImagePath: state.ipRefImage || "character_ref.png", weight: state.ipWeight }]
        : undefined,
    controlNets:
      state.cnMode !== "none"
        ? [
            {
              mode: state.cnMode,
              controlImagePath: state.cnImage || "control_guide.png",
              strength: state.cnStrength,
              endPercent: state.cnEndPercent,
              preprocessor: state.cnPreprocessor,
            },
          ]
        : undefined,
    characters: state.characters.length >= 2 ? state.characters : undefined,
  };
}
