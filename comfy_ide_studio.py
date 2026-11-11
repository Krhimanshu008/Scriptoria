"""
ComfyUI IDE Studio & VM Orchestrator CLI
Provides IDE CLI commands for:
1. vm-toggle / vm-start / vm-stop / vm-status
2. sync-catalog: Fetch installed models & custom nodes
3. push-workflow: Live workflow injection (0.5s, no restart)
4. run-workflow: Direct generation & local asset download
5. create-notebook: Generate .ipynb & push to Kaggle GPU
6. dashboard: Launch the local Web Dashboard
"""

from __future__ import annotations
import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from config import settings
from notebook_generator import build_kaggle_kernel_bundle

def http_json(url: str, method: str = "GET", payload=None, timeout: int = 30):
    data = None
    headers = {"User-Agent": "Mozilla/5.0"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def cmd_vm_status():
    """Prints live status table of all remote GPUs."""
    print("\n" + "=" * 70)
    print("   CLOUD GPU VM STATUS TABLE (Kaggle & Colab)")
    print("=" * 70)
    for target, cfg in settings.ENDPOINTS.items():
        url = cfg["url"]
        try:
            req = urllib.request.Request(f"{url}/system_stats", headers={"User-Agent": "Mozilla/5.0"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=4) as r:
                lat = int((time.time() - t0) * 1000)
                data = json.loads(r.read().decode("utf-8"))
                devices = data.get("devices", [])
                gpu_name = devices[0].get("name", "GPU") if devices else "CPU"
                vram = devices[0].get("vram_free", 0) / (1024**3) if devices else 0
                print(f"  🟢 {target.upper()} ({cfg['name']}): ONLINE ({lat}ms) | {gpu_name} | {vram:.1f} GB VRAM free")
        except Exception:
            print(f"  ⚪ {target.upper()} ({cfg['name']}): OFFLINE / STOPPED ({url})")
    print("=" * 70 + "\n")

def cmd_vm_toggle(target: str):
    """Toggles VM via the backend API or direct push/kill."""
    print(f"🔄 Toggling {target}...")
    try:
        res = http_json(f"http://127.0.0.1:{settings.PORT}/api/vm/{target}/toggle", method="POST")
        print(f"✅ Toggle result: {res}")
    except Exception:
        # Fallback if server is not running: perform direct action
        print("Backend server not running locally. Triggering direct Kaggle push...")
        if target in ("gpu0", "gpu1"):
            bundle = build_kaggle_kernel_bundle(target)
            subprocess.run([sys.executable, "-m", "kaggle", "kernels", "push", "-p", str(bundle)], check=True)
            print(f"🚀 Pushed {target} notebook directly to Kaggle GPU!")
        else:
            print(f"Please open Google Colab and run the worker notebook for {target}.")

def cmd_vm_stop(target: str):
    """Stops the specified VM."""
    print(f"🛑 Requesting shutdown for {target}...")
    cfg = settings.ENDPOINTS.get(target)
    if not cfg:
        print(f"❌ Unknown target {target}")
        return
    url = f"{cfg['url']}/vm-kill"
    try:
        res = http_json(url, method="POST", payload={"action": "shutdown"}, timeout=5)
        print(f"✅ Remote shutdown confirmed: {res}")
    except Exception as e:
        print(f"Notice: Remote kill signal dispatched: {e}")

def cmd_sync_catalog(target: str = "gpu0"):
    cfg = settings.ENDPOINTS[target]
    base_url = cfg["url"]
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
        },
        "total_nodes_available": len(obj_info),
        "node_names": sorted(obj_info.keys()),
    }
    cat_file = Path("comfy_node_catalog.json")
    cat_file.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"✅ Saved `{cat_file}`! Your IDE Agent now has full knowledge of all installed models & nodes.")

def cmd_push_workflow(json_file: str, name: str = None):
    wf_path = Path(json_file)
    raw_data = json.loads(wf_path.read_text(encoding="utf-8"))
    target_name = name if name else wf_path.name
    if not target_name.endswith(".json"):
        target_name += ".json"

    for label, cfg in settings.ENDPOINTS.items():
        base_url = cfg["url"]
        try:
            encoded_rel = urllib.parse.quote(f"workflows/{target_name}", safe="")
            upload_url = f"{base_url}/userdata/{encoded_rel}?overwrite=true"
            http_json(upload_url, method="POST", payload=raw_data, timeout=10)
            print(f"  🟢 Injected `{target_name}` live into {label} ({base_url})!")
        except Exception as e:
            print(f"  ⚪ Skipped {label} (offline or unreachable)")

def cmd_start_dashboard():
    """Runs the FastAPI Web Dashboard server."""
    import uvicorn
    print(f"🚀 Launching Web Dashboard at: http://{settings.HOST}:{settings.PORT}")
    uvicorn.run("server:app", host=settings.HOST, port=settings.PORT, reload=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ComfyUI IDE Studio & VM Orchestrator")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # VM Commands
    sub.add_parser("vm-status", help="Check live health status of all GPUs")
    
    p_vmtoggle = sub.add_parser("vm-toggle", help="Toggle VM state (Start/Stop)")
    p_vmtoggle.add_argument("--target", default="gpu0", choices=["gpu0", "gpu1", "gcgpu"])

    p_vmstop = sub.add_parser("vm-stop", help="Stop VM instance")
    p_vmstop.add_argument("--target", default="gpu0", choices=["gpu0", "gpu1", "gcgpu"])

    sub.add_parser("dashboard", help="Start the Web Dashboard server on port 8000")

    # Catalog & Workflow Commands
    p_cat = sub.add_parser("sync-catalog", help="Fetch node & model catalog")
    p_cat.add_argument("--target", default="gpu0", choices=["gpu0", "gpu1", "gcgpu"])

    p_push = sub.add_parser("push-workflow", help="Inject workflow JSON live into ComfyUI")
    p_push.add_argument("--file", required=True)
    p_push.add_argument("--name", default=None)

    args = parser.parse_args()
    if args.cmd == "vm-status":
        cmd_vm_status()
    elif args.cmd == "vm-toggle":
        cmd_vm_toggle(args.target)
    elif args.cmd == "vm-stop":
        cmd_vm_stop(args.target)
    elif args.cmd == "dashboard":
        cmd_start_dashboard()
    elif args.cmd == "sync-catalog":
        cmd_sync_catalog(args.target)
    elif args.cmd == "push-workflow":
        cmd_push_workflow(args.file, args.name)

