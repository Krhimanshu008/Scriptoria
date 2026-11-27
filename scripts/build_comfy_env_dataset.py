#!/usr/bin/env python3
"""
Zero-GPU-Quota Kaggle Environment Cache Builder for Scriptoria.

Run this script inside a Kaggle CPU notebook (GPU: None, Internet: ON) to pre-build
`/kaggle/working/comfy_env.tar.gz` containing ComfyUI, profile custom nodes, delta Python
site-packages (`/tmp/sc_site_packages`), and pre-compiled `.pyc` bytecode.

Then click "Save Version" -> Output -> "New Dataset" (Private, e.g. `<user>/scriptoria-comfy-env`),
attach the dataset slug in Scriptoria's FastBoot Dataset selector, and cut Dual-T4 boot
time from ~154s down to ~25-40s.
"""

import argparse
import compileall
import json
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import threading
import time

COMFY_DIR = "/tmp/ComfyUI"
SITE_OUT = "/tmp/sc_site_packages"
DEFAULT_OUT = "/kaggle/working/comfy_env.pak"

PROFILE_NODES = {
    "BASE_COMFY": [],
    "IMAGE_CORE": [
        ("ComfyUI_IPAdapter_plus", "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git"),
        ("ComfyUI-Impact-Pack", "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git"),
        ("ComfyUI-Impact-Subpack", "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git"),
        ("ComfyUI-Inspire-Pack", "https://github.com/ltdrdata/ComfyUI-Inspire-Pack.git"),
        ("comfyui_controlnet_aux", "https://github.com/Fannovel16/comfyui_controlnet_aux.git"),
        ("ComfyUI-KJNodes", "https://github.com/kijai/ComfyUI-KJNodes.git"),
        ("ComfyUI_UltimateSDUpscale", "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git"),
        ("ComfyUI-ComfyCouple", "https://github.com/Danand/ComfyUI-ComfyCouple.git"),
        ("style_aligned_comfy", "https://github.com/jasonphillips/style_aligned_comfy.git"),
        ("ComfyUI-Inpaint-CropAndStitch", "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git"),
        ("ComfyUI-RMBG", "https://github.com/1038lab/ComfyUI-RMBG.git"),
    ],
    "IMAGE_GGUF_EDIT": [
        ("ComfyUI-GGUF", "https://github.com/city96/ComfyUI-GGUF.git"),
        ("ComfyUI-KJNodes", "https://github.com/kijai/ComfyUI-KJNodes.git"),
        ("ComfyUI-Anima-Ref-Adapter", "https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter.git"),
        ("ComfyUI-Anima-CharRef-LLLite", "https://github.com/quinteroac/ComfyUI-Anima-CharRef-LLLite.git"),
        ("ComfyUI-LBM", "https://github.com/1038lab/ComfyUI-LBM.git"),
        ("ComfyUI-RMBG", "https://github.com/1038lab/ComfyUI-RMBG.git"),
        ("ComfyUI-Inpaint-CropAndStitch", "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git"),
    ],
    "IMAGE_DIT_DUAL_T4": [
        ("ComfyUI-GGUF", "https://github.com/city96/ComfyUI-GGUF.git"),
        ("ComfyUI-KJNodes", "https://github.com/kijai/ComfyUI-KJNodes.git"),
        ("ComfyUI-Inspire-Pack", "https://github.com/ltdrdata/ComfyUI-Inspire-Pack.git"),
        ("comfyui_controlnet_aux", "https://github.com/Fannovel16/comfyui_controlnet_aux.git"),
        ("ComfyUI-Anima-Ref-Adapter", "https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter.git"),
        ("ComfyUI-Anima-CharRef-LLLite", "https://github.com/quinteroac/ComfyUI-Anima-CharRef-LLLite.git"),
        ("RES4LYF", "https://github.com/ClownsharkBatwing/RES4LYF.git"),
        ("ComfyUI-LBM", "https://github.com/1038lab/ComfyUI-LBM.git"),
        ("ComfyUI-RMBG", "https://github.com/1038lab/ComfyUI-RMBG.git"),
        ("ComfyUI-Inpaint-CropAndStitch", "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git"),
        ("ComfyUI-Olm-DragCrop", "https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop.git"),
        ("ComfyUI_pytorch360convert", "https://github.com/ProGamerGov/ComfyUI_pytorch360convert.git"),
        ("ComfyUI_preview360panorama", "https://github.com/ProGamerGov/ComfyUI_preview360panorama.git"),
    ],
    "AUDIO_LIPSYNC": [
        ("comfyui-kokoro", "https://github.com/stavsap/comfyui-kokoro.git"),
        ("ComfyUI-F5-TTS", "https://github.com/niknah/ComfyUI-F5-TTS.git"),
        ("ComfyUI-MMAudio", "https://github.com/kijai/ComfyUI-MMAudio.git"),
        ("ComfyUI-StableAudioSampler", "https://github.com/lks-ai/ComfyUI-StableAudioSampler.git"),
        ("ComfyUI-LatentSyncWrapper", "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper.git"),
    ],
    "VIDEO_MOTION": [
        ("ComfyUI-LTXVideo", "https://github.com/Lightricks/ComfyUI-LTXVideo.git"),
        ("ComfyUI-WanVideoWrapper", "https://github.com/kijai/ComfyUI-WanVideoWrapper.git"),
        ("ComfyUI-VideoHelperSuite", "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"),
    ],
}

SKIP_EXACT = {"torch", "torchvision", "torchaudio", "torchgen", "functorch", "triton", "pip", "wheel", "setuptools", "__pycache__", "pkg_resources", "_distutils_hack"}
SKIP_DIST_PREFIXES = ("torch-", "torchvision-", "torchaudio-", "torchgen-", "functorch-", "nvidia", "triton-", "pip-", "wheel-", "setuptools-")
SKIP_REQ_PKGS = {"torch", "torchvision", "torchaudio"}


def _is_skipped_site_entry(name: str) -> bool:
    low = name.lower()
    return low in SKIP_EXACT or low.startswith(SKIP_DIST_PREFIXES)


def ensure_uv() -> str:
    uv_bin = "/tmp/uv"
    if os.path.exists(uv_bin):
        return uv_bin
    try:
        subprocess.run(
            ["curl", "-sSLf", "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz", "-o", "/tmp/uv.tar.gz"],
            check=True,
        )
        subprocess.run(["tar", "-xzf", "/tmp/uv.tar.gz", "-C", "/tmp", "--strip-components=1"], check=True)
        os.chmod(uv_bin, 0o755)
        os.remove("/tmp/uv.tar.gz")
        return uv_bin
    except Exception as exc:
        print(f"[FastBoot Builder] uv unavailable ({exc}), using pip fallback.", flush=True)
        return ""


def snap_site_dirs(dirs):
    snap = {}
    for sd in dirs:
        entries = {}
        if os.path.isdir(sd):
            for entry in os.listdir(sd):
                try:
                    entries[entry] = os.lstat(os.path.join(sd, entry)).st_mtime_ns
                except OSError:
                    entries[entry] = 0
        snap[sd] = entries
    return snap


def build_cache(profile_id: str, output_path: str) -> None:
    if profile_id not in PROFILE_NODES:
        raise ValueError(f"Unknown profile '{profile_id}'. Choices: {', '.join(PROFILE_NODES)}")

    t0 = time.time()
    print(f"[FastBoot Builder] Building '{profile_id}' cache (CPU mode = 0 GPU quota)...", flush=True)
    for d in (COMFY_DIR, SITE_OUT):
        if os.path.exists(d):
            shutil.rmtree(d)

    subprocess.run(
        ["git", "clone", "--depth", "1", "--single-branch", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR],
        check=True,
    )

    nodes = PROFILE_NODES[profile_id]
    if nodes:
        nodes_dir = os.path.join(COMFY_DIR, "custom_nodes")
        os.makedirs(nodes_dir, exist_ok=True)

        def _clone(name: str, url: str) -> None:
            dst = os.path.join(nodes_dir, name)
            print(f"[FastBoot Builder] Cloning {name}...", flush=True)
            subprocess.run(["git", "clone", "--depth", "1", "--single-branch", url, dst], check=True, timeout=120)

        threads = [threading.Thread(target=_clone, args=(n, u), daemon=True) for n, u in nodes]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=130)

    req_sources = [os.path.join(COMFY_DIR, "requirements.txt")] + [
        os.path.join(COMFY_DIR, "custom_nodes", n, "requirements.txt") for n, _ in nodes
    ]
    req_file = "/tmp/fastboot_builder_reqs.txt"
    seen = set()
    with open(req_file, "w", encoding="utf-8") as wf:
        for src in req_sources:
            if not os.path.exists(src):
                continue
            with open(src, "r", encoding="utf-8", errors="ignore") as rf:
                for line in rf:
                    clean = line.strip()
                    if not clean or clean.startswith("#") or clean.startswith("-r "):
                        continue
                    pkg = re.split(r"[=<>!~;\s\[]", clean)[0].lower().replace("_", "-")
                    if pkg in SKIP_REQ_PKGS or clean in seen:
                        continue
                    seen.add(clean)
                    wf.write(clean + "\n")
        if any("Impact-Pack" in n for n, _ in nodes):
            for extra in ("ultralytics", "segment-anything", "piexif", "scikit-image", "opencv-python-headless"):
                if extra not in seen:
                    seen.add(extra)
                    wf.write(extra + "\n")

    site_dirs = list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
    before = snap_site_dirs(site_dirs)

    uv_bin = ensure_uv()
    print(f"[FastBoot Builder] Installing {len(seen)} requirement lines...", flush=True)
    if uv_bin:
        res = subprocess.run([uv_bin, "pip", "install", "--system", "--break-system-packages", "--no-cache", "--quiet", "-r", req_file])
        if res.returncode != 0:
            res = subprocess.run([uv_bin, "pip", "install", "--system", "--no-cache", "--quiet", "-r", req_file])
        if res.returncode != 0:
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file], check=True)
    else:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file], check=True)

    os.makedirs(SITE_OUT, exist_ok=True)
    copied = 0
    for sd in site_dirs:
        if not os.path.isdir(sd):
            continue
        prev = before.get(sd, {})
        for entry in os.listdir(sd):
            if _is_skipped_site_entry(entry):
                continue
            src_p = os.path.join(sd, entry)
            try:
                mtime = os.lstat(src_p).st_mtime_ns
            except OSError:
                mtime = 0
            if entry in prev and prev[entry] == mtime:
                continue
            dst_p = os.path.join(SITE_OUT, entry)
            if os.path.isdir(src_p):
                shutil.copytree(src_p, dst_p, dirs_exist_ok=True)
            else:
                shutil.copy2(src_p, dst_p)
            copied += 1

    if not os.path.isdir(os.path.join(SITE_OUT, "torchsde")):
        raise RuntimeError("torchsde missing from sc_site_packages snapshot; aborting incomplete cache build.")

    print(f"[FastBoot Builder] Pre-compiling Python bytecode ({copied} site entries)...", flush=True)
    compileall.compile_dir(COMFY_DIR, quiet=1)
    compileall.compile_dir(SITE_OUT, quiet=1)

    manifest = {
        "profileId": profile_id,
        "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}",
        "nodes": [n for n, _ in nodes],
        "createdAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(COMFY_DIR, ".scriptoria_env_manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    env = os.environ.copy()
    env["GZIP"] = "-1"
    print(f"[FastBoot Builder] Packing {output_path}...", flush=True)
    subprocess.run(
        [
            "tar",
            "--warning=no-file-changed",
            "--ignore-failed-read",
            "--exclude=*.git*",
            "--exclude=*&*",
            "--exclude=*example_workflows*",
            "--exclude=ComfyUI/user/*",
            "--exclude=ComfyUI/output/*",
            "--exclude=ComfyUI/input/*",
            "-czf",
            output_path,
            "-C",
            "/tmp",
            "ComfyUI",
            "sc_site_packages",
        ],
        env=env,
        check=True,
    )
    size_mb = round(os.path.getsize(output_path) / (1024 * 1024), 1)
    print(f"[FastBoot Builder] DONE in {round(time.time() - t0, 1)}s -> {output_path} ({size_mb} MB).", flush=True)
    print("Next: Save Version -> Output -> New Dataset (Private), then attach '<username>/<dataset>' in Scriptoria.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Scriptoria FastBoot ComfyUI archive for Kaggle Dataset")
    parser.add_argument("--profile", default=os.environ.get("SCRIPTORIA_PROFILE", "IMAGE_CORE"), help="Worker profile ID")
    parser.add_argument("--output", default=os.environ.get("FASTBOOT_OUTPUT", DEFAULT_OUT), help="Output .tar.gz path")
    args = parser.parse_args()
    build_cache(args.profile, args.output)
