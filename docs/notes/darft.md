Yes! You can create both brand-new Kaggle GPU Notebooks and brand-new ComfyUI Workflows 100% inside your IDE (Cursor, Windsurf, VS Code, etc.) without touching a browser.
Even better:
Instant Live Workflow Sync (0.5 seconds, NO Kaggle restart!): ComfyUI has a built-in /userdata/ API. When your IDE creates or edits a workflow JSON locally, it can beam that workflow directly into the live Workflows sidebar of gpu0.krhimanshu.in, gpu1.krhimanshu.in, and gcgpu.krhimanshu.in in 0.5 seconds while the GPUs are already running!
Direct IDE Image Generation (POST /prompt): Your IDE can also execute any workflow directly on gpu0 / gpu1 / gcgpu and download the generated .png images straight into your local IDE folder!
Brand-New Kaggle Notebooks (kaggle kernels push): If you create a folder with a new "id": "himanshukr7532/my-new-notebook" in kernel-metadata.json and run kaggle kernels push, Kaggle automatically creates that new private notebook on your account and boots it on a GPU!
🛠️ Save This All-in-One IDE Studio Script (comfy_ide_studio.py)
Save the script below in your local IDE workspace as comfy_ide_studio.py. It gives you (and your IDE AI Agent) 4 commands to build notebooks, sync workflows live, generate images into your IDE, and give your AI agent a full catalog of your installed nodes & models:
Python
import os
import sys
import time
import json
import argparse
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

KAGGLE_USER = "himanshukr7532"
ENDPOINTS = {
    "gpu0": "https://gpu0.krhimanshu.in",
    "gpu1": "https://gpu1.krhimanshu.in",
    "gcgpu": "https://gcgpu.krhimanshu.in",
}

def http_json(url: str, method: str = "GET", payload=None, timeout: int = 30):
    data = None
    headers = {"User-Agent": "Mozilla/5.0"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def api_to_litegraph_ui(api_graph: dict, object_info: dict) -> dict:
    """Converts a clean API workflow dict into a full ComfyUI Web UI LiteGraph JSON."""
    WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}
    key_to_id = {k: idx + 1 for idx, k in enumerate(api_graph.keys())}
    depths = {k: 0 for k in api_graph}
    for _ in range(len(api_graph)):
        for k, node in api_graph.items():
            for val in node.get("inputs", {}).values():
                if isinstance(val, list) and len(val) == 2 and str(val[0]) in depths:
                    depths[k] = max(depths[k], depths[str(val[0])] + 1)

    col_counts, node_positions = {}, {}
    for k in api_graph:
        col = depths[k]
        row = col_counts.get(col, 0)
        col_counts[col] = row + 1
        node_positions[k] = [80 + col * 430, 80 + row * 310]

    ui_nodes, links, next_link_id = {}, [], 1
    for k, node_data in api_graph.items():
        nid, ctype = key_to_id[k], node_data["class_type"]
        schema = object_info.get(ctype, {})
        out_types = schema.get("output", [])
        out_names = schema.get("output_name", out_types)
        ui_outputs = []
        for slot_idx, otype in enumerate(out_types):
            oname = out_names[slot_idx] if slot_idx < len(out_names) else str(otype)
            ui_outputs.append({
                "name": str(oname),
                "type": "COMBO" if isinstance(otype, list) else str(otype),
                "links": [],
                "slot_index": slot_idx
            })
        ui_nodes[k] = {
            "id": nid, "type": ctype, "pos": node_positions[k], "size": [360, 240],
            "flags": {}, "order": nid - 1, "mode": 0, "inputs": [], "outputs": ui_outputs,
            "properties": {"Node name for S&R": ctype}, "widgets_values": []
        }

    for k, node_data in api_graph.items():
        nid, ctype = key_to_id[k], node_data["class_type"]
        given_inputs = node_data.get("inputs", {})
        schema = object_info.get(ctype, {})
        all_schema_inputs = (
            list(schema.get("input", {}).get("required", {}).items()) +
            list(schema.get("input", {}).get("optional", {}).items())
        )
        for inp_name, inp_spec in all_schema_inputs:
            spec_type = inp_spec[0] if isinstance(inp_spec, (list, tuple)) and len(inp_spec) > 0 else "STRING"
            spec_cfg = inp_spec[1] if isinstance(inp_spec, (list, tuple)) and len(inp_spec) > 1 and isinstance(inp_spec[1], dict) else {}
            is_combo = isinstance(spec_type, list) or str(spec_type) == "COMBO"
            is_widget = is_combo or (str(spec_type) in WIDGET_TYPES and not spec_cfg.get("forceInput", False))
            val = given_inputs.get(inp_name, spec_cfg.get("default", None))
            is_link = isinstance(val, list) and len(val) == 2 and str(val[0]) in key_to_id

            if is_link:
                src_key, src_slot = str(val[0]), int(val[1])
                src_id = key_to_id[src_key]
                link_type = "COMBO" if is_combo else str(spec_type)
                dst_slot = len(ui_nodes[k]["inputs"])
                link_id = next_link_id
                next_link_id += 1
                ui_nodes[k]["inputs"].append({"name": inp_name, "type": link_type, "link": link_id})
                while len(ui_nodes[src_key]["outputs"]) <= src_slot:
                    idx = len(ui_nodes[src_key]["outputs"])
                    ui_nodes[src_key]["outputs"].append({"name": link_type, "type": link_type, "links": [], "slot_index": idx})
                ui_nodes[src_key]["outputs"][src_slot]["links"].append(link_id)
                links.append([link_id, src_id, src_slot, nid, dst_slot, link_type])
            elif is_widget:
                if val is None:
                    if isinstance(spec_type, list) and spec_type:
                        val = spec_type[0]
                    elif str(spec_type) == "COMBO":
                        opts = spec_cfg.get("options", [""])
                        val = opts[0] if opts else ""
                    elif spec_type == "INT":
                        val = 0
                    elif spec_type == "FLOAT":
                        val = 0.0
                    elif spec_type == "BOOLEAN":
                        val = False
                    else:
                        val = ""
                ui_nodes[k]["widgets_values"].append(val)
                if inp_name in ("seed", "noise_seed") or spec_cfg.get("control_after_generate", False):
                    ui_nodes[k]["widgets_values"].append("fixed")
                if ctype == "LoadImage" and inp_name == "image":
                    ui_nodes[k]["widgets_values"].append("image")
            else:
                ui_nodes[k]["inputs"].append({"name": inp_name, "type": str(spec_type), "link": None})

    return {
        "last_node_id": len(ui_nodes), "last_link_id": next_link_id - 1,
        "nodes": list(ui_nodes.values()), "links": links, "groups": [],
        "config": {}, "extra": {"ds": {"scale": 0.75, "offset": [50, 50]}}, "version": 0.4
    }

# =====================================================================
# COMMAND 1: SYNC CATALOG (Gives Your IDE Agent All Installed Models & Nodes)
# =====================================================================
def cmd_sync_catalog(target: str = "gpu0"):
    base_url = ENDPOINTS[target]
    print(f"📥 Fetching live node & model catalog from {base_url}/object_info ...")
    obj_info = http_json(f"{base_url}/object_info", timeout=30)

    catalog = {
        "models": {
            "checkpoints": obj_info.get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get("ckpt_name", [[]])[0],
            "vaes": obj_info.get("VAELoader", {}).get("input", {}).get("required", {}).get("vae_name", [[]])[0],
            "loras": obj_info.get("LoraLoader", {}).get("input", {}).get("required", {}).get("lora_name", [[]])[0],
            "controlnets": obj_info.get("ControlNetLoader", {}).get("input", {}).get("required", {}).get("control_net_name", [[]])[0],
            "ipadapters": obj_info.get("IPAdapterModelLoader", {}).get("input", {}).get("required", {}).get("ipadapter_file", [[]])[0],
            "clip_vision": obj_info.get("CLIPVisionLoader", {}).get("input", {}).get("required", {}).get("clip_name", [[]])[0],
            "upscalers": obj_info.get("UpscaleModelLoader", {}).get("input", {}).get("required", {}).get("model_name", [[]])[0],
            "ultralytics": obj_info.get("UltralyticsDetectorProvider", {}).get("input", {}).get("required", {}).get("model_name", [[]])[0],
            "sams": obj_info.get("SAMLoader", {}).get("input", {}).get("required", {}).get("model_name", [[]])[0],
            "gguf_unets": obj_info.get("UnetLoaderGGUF", {}).get("input", {}).get("required", {}).get("unet_name", [[]])[0],
        },
        "total_nodes_available": len(obj_info),
        "node_names": sorted(obj_info.keys()),
    }
    Path("comfy_node_catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    Path("comfy_full_object_info.json").write_text(json.dumps(obj_info), encoding="utf-8")
    print("✅ Saved `comfy_node_catalog.json`! Your IDE Agent now knows all your exact models & nodes.")

# =====================================================================
# COMMAND 2: PUSH WORKFLOW LIVE TO COMFYUI WEB UI (0.5s, Zero Restart!)
# =====================================================================
def cmd_push_workflow(json_file: str, name: str = None):
    wf_path = Path(json_file)
    raw_data = json.loads(wf_path.read_text(encoding="utf-8"))
    target_name = name if name else wf_path.name
    if not target_name.endswith(".json"):
        target_name += ".json"

    for label, base_url in ENDPOINTS.items():
        try:
            obj_info = http_json(f"{base_url}/object_info", timeout=8)
            # If it's a clean API format dict, convert it to visual LiteGraph UI format automatically!
            if "nodes" not in raw_data and "links" not in raw_data:
                ui_data = api_to_litegraph_ui(raw_data, obj_info)
            else:
                ui_data = raw_data

            encoded_rel = urllib.parse.quote(f"workflows/{target_name}", safe="")
            upload_url = f"{base_url}/userdata/{encoded_rel}?overwrite=true"
            http_json(upload_url, method="POST", payload=ui_data, timeout=10)
            print(f"  🟢 Injected `{target_name}` live into {label} ({base_url})!")
        except Exception as e:
            print(f"  ⚪ Skipped {label} (offline or unreachable: {e})")

# =====================================================================
# COMMAND 3: RUN WORKFLOW FROM IDE & DOWNLOAD GENERATED IMAGES LOCALLY
# =====================================================================
def cmd_run_workflow(json_file: str, target: str = "gpu0", out_dir: str = "./ide_outputs"):
    base_url = ENDPOINTS[target]
    api_prompt = json.loads(Path(json_file).read_text(encoding="utf-8"))
    if "nodes" in api_prompt:
        raise ValueError("❌ For `run-workflow`, pass an API-format workflow JSON (dict of node_id -> {class_type, inputs}).")

    print(f"🚀 Queuing workflow `{json_file}` on {target} ({base_url})...")
    res = http_json(f"{base_url}/prompt", method="POST", payload={"prompt": api_prompt})
    prompt_id = res["prompt_id"]
    print(f"⏳ Waiting for prompt_id `{prompt_id}` to finish generating...")

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    while True:
        time.sleep(2.0)
        hist = http_json(f"{base_url}/history/{prompt_id}")
        if prompt_id in hist:
            outputs = hist[prompt_id].get("outputs", {})
            saved_files = []
            for node_id, node_out in outputs.items():
                for img in node_out.get("images", []):
                    fn = img["filename"]
                    sub = img.get("subfolder", "")
                    itype = img.get("type", "output")
                    q = urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": itype})
                    img_url = f"{base_url}/view?{q}"
                    local_img = out_path / fn
                    req = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req) as r, open(local_img, "wb") as f:
                        f.write(r.read())
                    saved_files.append(local_img)
                    print(f"  🖼️ Downloaded generated image -> {local_img}")
            print(f"🎉 Generation Complete! Saved {len(saved_files)} image(s) to {out_path}/")
            return

# =====================================================================
# COMMAND 4: CREATE & PUSH A BRAND-NEW KAGGLE NOTEBOOK FROM IDE (.py files -> .ipynb)
# =====================================================================
def cmd_create_notebook(slug: str, title: str, py_files: list, push: bool = True):
    nb_dir = Path(f"./notebooks/{slug}")
    nb_dir.mkdir(parents=True, exist_ok=True)

    cells = []
    for pf in py_files:
        p = Path(pf)
        code_lines = [line + "\n" for line in p.read_text(encoding="utf-8").splitlines()]
        cells.append({
            "cell_type": "markdown",
            "metadata": {},
            "source": [f"# {p.stem}\n"]
        })
        cells.append({
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": code_lines
        })

    ipynb_data = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.10.12"}
        },
        "nbformat": 4,
        "nbformat_minor": 4
    }
    ipynb_file = nb_dir / f"{slug}.ipynb"
    ipynb_file.write_text(json.dumps(ipynb_data, indent=2), encoding="utf-8")

    meta_data = {
        "id": f"{KAGGLE_USER}/{slug}",
        "title": title,
        "code_file": f"{slug}.ipynb",
        "language": "python",
        "kernel_type": "notebook",
        "is_private": "true",
        "enable_gpu": "true",
        "enable_tpu": "false",
        "enable_internet": "true",
        "dataset_sources": [
            f"{KAGGLE_USER}/nv-comfyui-model-library",
            f"{KAGGLE_USER}/nv-comfyui-qwen-and-loras"
        ],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": []
    }
    (nb_dir / "kernel-metadata.json").write_text(json.dumps(meta_data, indent=2), encoding="utf-8")
    print(f"📓 Created Kaggle Notebook `{KAGGLE_USER}/{slug}` in {nb_dir}/")

    if push:
        print(f"🚀 Pushing new notebook `{KAGGLE_USER}/{slug}` to Kaggle GPU...")
        subprocess.run(["kaggle", "kernels", "push", "-p", str(nb_dir)], check=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ComfyUI IDE Studio — Create Notebooks & Workflows from IDE")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_cat = sub.add_parser("sync-catalog", help="Save all installed models & nodes to comfy_node_catalog.json")
    p_cat.add_argument("--target", default="gpu0", choices=["gpu0", "gpu1", "gcgpu"])

    p_push = sub.add_parser("push-workflow", help="Inject a workflow JSON live into ComfyUI Web UI (0s restart!)")
    p_push.add_argument("--file", required=True, help="Path to local workflow .json file")
    p_push.add_argument("--name", default=None, help="Optional filename in ComfyUI sidebar")

    p_run = sub.add_parser("run-workflow", help="Execute an API workflow JSON on GPU and download images to IDE")
    p_run.add_argument("--file", required=True, help="Path to API-format workflow .json")
    p_run.add_argument("--target", default="gpu0", choices=["gpu0", "gpu1", "gcgpu"])
    p_run.add_argument("--out", default="./ide_outputs", help="Local folder to save generated images")

    p_nb = sub.add_parser("create-notebook", help="Create & push a brand-new Kaggle GPU notebook from .py files")
    p_nb.add_argument("--slug", required=True, help="New notebook slug (e.g. comfy-worker-v2)")
    p_nb.add_argument("--title", required=True, help="New notebook title (e.g. 'ComfyUI Worker V2')")
    p_nb.add_argument("--cells", nargs="+", required=True, help="List of .py files to turn into notebook cells")

    args = parser.parse_args()
    if args.cmd == "sync-catalog":
        cmd_sync_catalog(args.target)
    elif args.cmd == "push-workflow":
        cmd_push_workflow(args.file, args.name)
    elif args.cmd == "run-workflow":
        cmd_run_workflow(args.file, args.target, args.out)
    elif args.cmd == "create-notebook":
        cmd_create_notebook(args.slug, args.title, args.cells)
🚀 How You (or Your IDE AI Agent) Use It:
1. Give Your IDE AI Agent Full Knowledge of Your Models & Nodes:
Bash
python comfy_ide_studio.py sync-catalog --target gpu0
Creates comfy_node_catalog.json in your IDE showing every checkpoint, LoRA, VAE, ControlNet, and custom node installed on your GPU. Now you can tell your IDE Agent: "Read comfy_node_catalog.json and build me a new workflow JSON!"
2. Push Any New Workflow Instantly into the Live ComfyUI Browser Sidebar (0.5s, No Restart!):
Bash
python comfy_ide_studio.py push-workflow --file my_new_workflow.json --name "14_MY_NEW_WORKFLOW.json"
Automatically converts your IDE's JSON into a visual LiteGraph graph and uploads it straight into gpu0.krhimanshu.in, gpu1.krhimanshu.in, and gcgpu.krhimanshu.in!
3. Run a Workflow Directly from Your IDE & Download the Generated Image:
Bash
python comfy_ide_studio.py run-workflow --file my_new_workflow.json --target gpu0
Runs the workflow on gpu0 and downloads the finished .png straight into ./ide_outputs/ inside your IDE!
4. Create & Deploy a Brand-New Kaggle GPU Notebook from Local .py Files:
Bash
python comfy_ide_studio.py create-notebook --slug "comfy-studio-v2" --title "Comfy Studio V2" --cells cell1.py cell2.py cell3.py cell4.py
Packages your .py files into a new .ipynb, attaches your 2 Kaggle Datasets, enables GPU + Internet, and creates & boots the new notebook on Kaggle!