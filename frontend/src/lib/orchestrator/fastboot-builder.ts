import { getWorkerProfile } from "@/lib/catalog/worker-profiles";

/**
 * Generates a 0-GPU Kaggle CPU Python script that builds `/kaggle/working/comfy_env.tar.gz`
 * with ComfyUI, profile custom nodes, delta site-packages (`/tmp/sc_site_packages`), and
 * pre-compiled Python `.pyc` bytecode.
 */
export function buildFastbootCachePythonCode(profileId = "IMAGE_CORE"): string {
  const profile = getWorkerProfile(profileId);
  const nodesPayload = JSON.stringify(profile.customNodes.map((n) => [n.name, n.repoUrl]));

  return `import compileall, json, os, re, shutil, subprocess, sys, sysconfig, threading, time

PROFILE_ID = ${JSON.stringify(profile.id)}
NODES = ${nodesPayload}
COMFY_DIR = "/tmp/ComfyUI"
SITE_OUT = "/tmp/sc_site_packages"
# Use .pak so Kaggle Datasets stores one single file instead of auto-extracting 20k files & choking on '&' workflow names
OUT_ARC = "/kaggle/working/comfy_env.pak"
SKIP_EXACT = {"torch", "torchvision", "torchaudio", "torchgen", "functorch", "triton", "pip", "wheel", "setuptools", "__pycache__", "pkg_resources", "_distutils_hack"}
SKIP_DIST_PREFIXES = ("torch-", "torchvision-", "torchaudio-", "torchgen-", "functorch-", "nvidia", "triton-", "pip-", "wheel-", "setuptools-")
SKIP_REQS = {"torch", "torchvision", "torchaudio"}

def _is_skipped_site_entry(name: str) -> bool:
    low = name.lower()
    return low in SKIP_EXACT or low.startswith(SKIP_DIST_PREFIXES)

t0 = time.time()
print(f"[FastBoot Builder] Building {PROFILE_ID} environment on CPU (0 GPU quota)...", flush=True)
for d in (COMFY_DIR, SITE_OUT):
    if os.path.exists(d):
        shutil.rmtree(d)

subprocess.run(
    ["git", "clone", "--depth", "1", "--single-branch", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR],
    check=True,
)

if NODES:
    ndir = os.path.join(COMFY_DIR, "custom_nodes")
    os.makedirs(ndir, exist_ok=True)
    def _clone(name, url):
        subprocess.run(["git", "clone", "--depth", "1", "--single-branch", url, os.path.join(ndir, name)], check=True, timeout=120)
    threads = [threading.Thread(target=_clone, args=(n, u), daemon=True) for n, u in NODES]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=130)

req_sources = [os.path.join(COMFY_DIR, "requirements.txt")] + [
    os.path.join(COMFY_DIR, "custom_nodes", n, "requirements.txt") for n, _ in NODES
]
req_file = "/tmp/fb_reqs.txt"
seen = set()
with open(req_file, "w", encoding="utf-8") as wf:
    for rsrc in req_sources:
        if not os.path.exists(rsrc):
            continue
        with open(rsrc, "r", encoding="utf-8", errors="ignore") as rf:
            for line in rf:
                clean = line.strip()
                if not clean or clean.startswith("#") or clean.startswith("-r "):
                    continue
                pkg = re.split(r"[=<>!~;\\s\\[]", clean)[0].lower().replace("_", "-")
                if pkg in SKIP_REQS or clean in seen:
                    continue
                seen.add(clean)
                wf.write(clean + "\\n")
    if any("Impact-Pack" in n for n, _ in NODES):
        for ex in ("ultralytics", "segment-anything", "piexif", "scikit-image", "opencv-python-headless"):
            if ex not in seen:
                seen.add(ex)
                wf.write(ex + "\\n")

def _snap(dirs):
    out = {}
    for sd in dirs:
        ent = {}
        if os.path.isdir(sd):
            for e in os.listdir(sd):
                try:
                    ent[e] = os.lstat(os.path.join(sd, e)).st_mtime_ns
                except OSError:
                    ent[e] = 0
        out[sd] = ent
    return out

site_dirs = list({sysconfig.get_paths()["purelib"], sysconfig.get_paths()["platlib"]})
before = _snap(site_dirs)

uv_bin = "/tmp/uv"
try:
    subprocess.run(["curl", "-sSLf", "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz", "-o", "/tmp/uv.tar.gz"], check=True)
    subprocess.run(["tar", "-xzf", "/tmp/uv.tar.gz", "-C", "/tmp", "--strip-components=1"], check=True)
    os.chmod(uv_bin, 0o755)
except Exception:
    uv_bin = ""

if uv_bin and os.path.exists(uv_bin):
    r = subprocess.run([uv_bin, "pip", "install", "--system", "--break-system-packages", "--no-cache", "--quiet", "-r", req_file])
    if r.returncode != 0:
        r = subprocess.run([uv_bin, "pip", "install", "--system", "--no-cache", "--quiet", "-r", req_file])
    if r.returncode != 0:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file], check=True)
else:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file], check=True)

os.makedirs(SITE_OUT, exist_ok=True)
for sd in site_dirs:
    if not os.path.isdir(sd):
        continue
    prev = before.get(sd, {})
    for e in os.listdir(sd):
        if _is_skipped_site_entry(e):
            continue
        sp = os.path.join(sd, e)
        try:
            mt = os.lstat(sp).st_mtime_ns
        except OSError:
            mt = 0
        if e in prev and prev[e] == mt:
            continue
        dp = os.path.join(SITE_OUT, e)
        if os.path.isdir(sp):
            shutil.copytree(sp, dp, dirs_exist_ok=True)
        else:
            shutil.copy2(sp, dp)

if not os.path.isdir(os.path.join(SITE_OUT, "torchsde")):
    raise RuntimeError("torchsde missing from sc_site_packages snapshot; aborting incomplete cache build.")

compileall.compile_dir(COMFY_DIR, quiet=1)
compileall.compile_dir(SITE_OUT, quiet=1)
with open(os.path.join(COMFY_DIR, ".scriptoria_env_manifest.json"), "w", encoding="utf-8") as mf:
    json.dump({"profileId": PROFILE_ID, "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}", "nodes": [n for n, _ in NODES]}, mf, indent=2)

env = os.environ.copy()
env["GZIP"] = "-1"
subprocess.run([
    "tar", "--warning=no-file-changed", "--ignore-failed-read",
    "--exclude=*.git*", "--exclude=*&*", "--exclude=*example_workflows*",
    "--exclude=ComfyUI/user/*", "--exclude=ComfyUI/output/*", "--exclude=ComfyUI/input/*",
    "-czf", OUT_ARC, "-C", "/tmp", "ComfyUI", "sc_site_packages",
], env=env, check=True)
print(f"[FastBoot Builder] Ready in {round(time.time() - t0, 1)}s -> {OUT_ARC} ({round(os.path.getsize(OUT_ARC)/(1024**2), 1)} MB)", flush=True)
`;
}

export interface LlmDatasetBuildSpec {
  presetId: string;
  shortLabel: string;
  primaryRepo: string;
  fileHints: string[];
  mmprojHints: string[];
  companions: Array<{
    role: string;
    repoId: string;
    fileHints: string[];
    mmprojHints: string[];
  }>;
}

/**
 * Generates a 0-GPU CPU Kaggle notebook script that downloads quantized Qwen GGUF
 * models + mmproj vision files directly into /kaggle/working/qwen_llm_models/
 * (under Kaggle's 19.5 GiB output cap) for instant Output -> New Dataset creation.
 */
export function buildLlmDatasetPythonCode(spec: LlmDatasetBuildSpec): string {
  const safeSpecJson = JSON.stringify({
    presetId: spec.presetId,
    shortLabel: spec.shortLabel,
    primaryRepo: spec.primaryRepo,
    fileHints: spec.fileHints,
    mmprojHints: spec.mmprojHints,
    companions: spec.companions,
  });

  return `# Scriptoria 0-GPU Qwen LLM Dataset Builder (${spec.shortLabel})
# Output in /kaggle/working/qwen_llm_models -> Save Version / Output -> New Dataset
import os, sys, json, time, fnmatch, shutil, subprocess

t0 = time.time()
SPEC = json.loads(${JSON.stringify(safeSpecJson)})
OUT_DIR = "/kaggle/working/qwen_llm_models"
os.makedirs(OUT_DIR, exist_ok=True)
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"

print(f"[Qwen Dataset Builder] Preparing preset '{SPEC['shortLabel']}' ({SPEC['presetId']})...", flush=True)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "huggingface_hub", "hf_transfer"],
    check=True,
)

from huggingface_hub import HfApi, hf_hub_download
api = HfApi()

def _pick_file(files, patterns):
    lower_map = {f.lower(): f for f in files if f.lower().endswith(".gguf") and "mmproj" not in f.lower()}
    for pat in patterns:
        pat_l = pat.lower()
        for f_low, orig in sorted(lower_map.items()):
            if fnmatch.fnmatch(os.path.basename(f_low), pat_l):
                return orig
    # Fallback: smallest non-mmproj gguf file
    ggufs = [f for f in files if f.lower().endswith(".gguf") and "mmproj" not in f.lower()]
    return sorted(ggufs)[0] if ggufs else None

def _pick_mmproj(files, patterns):
    if not patterns:
        return None
    mm_files = [f for f in files if f.lower().endswith(".gguf") and "mmproj" in f.lower()]
    for pat in patterns:
        pat_l = pat.lower()
        for orig in sorted(mm_files):
            if fnmatch.fnmatch(os.path.basename(orig.lower()), pat_l):
                return orig
    return sorted(mm_files)[0] if mm_files else None

def _ensure_free_gb(min_gb=1.2):
    free_gb = shutil.disk_usage("/kaggle/working").free / (1024 ** 3)
    print(f"[Qwen Dataset Builder] /kaggle/working free space: {free_gb:.2f} GiB", flush=True)
    if free_gb < min_gb:
        raise RuntimeError(f"Insufficient /kaggle/working space ({free_gb:.2f} GiB free < {min_gb:.2f} GiB).")

def _fetch_repo_bundle(role, repo_id, file_hints, mmproj_hints):
    _ensure_free_gb(1.0)
    print(f"[Qwen Dataset Builder] Inspecting HF repo: {repo_id} (role={role})", flush=True)
    files = list(api.list_repo_files(repo_id=repo_id))
    main_file = _pick_file(files, file_hints)
    if not main_file:
        raise RuntimeError(f"No matching GGUF found in {repo_id} for hints {file_hints}")
    mmproj_file = _pick_mmproj(files, mmproj_hints)
    role_dir = os.path.join(OUT_DIR, role)
    os.makedirs(role_dir, exist_ok=True)
    downloaded = []
    for target_file in ([main_file] + ([mmproj_file] if mmproj_file else [])):
        _ensure_free_gb(0.8)
        print(f"[Qwen Dataset Builder] Downloading {repo_id}/{target_file}...", flush=True)
        local_path = hf_hub_download(
            repo_id=repo_id,
            filename=target_file,
            local_dir=role_dir,
        )
        # Flatten into OUT_DIR/filename so Kaggle Dataset mount works with simple globs
        flat_dest = os.path.join(OUT_DIR, os.path.basename(local_path))
        if os.path.abspath(local_path) != os.path.abspath(flat_dest):
            shutil.move(local_path, flat_dest)
        size_mb = round(os.path.getsize(flat_dest) / (1024 ** 2), 1)
        print(f"[Qwen Dataset Builder] Staged {os.path.basename(flat_dest)} ({size_mb} MB)", flush=True)
        downloaded.append({"role": role, "repoId": repo_id, "filename": os.path.basename(flat_dest), "sizeMb": size_mb})
    shutil.rmtree(role_dir, ignore_errors=True)
    return downloaded

staged_files = []
staged_files.extend(_fetch_repo_bundle("primary", SPEC["primaryRepo"], SPEC["fileHints"], SPEC["mmprojHints"]))
for comp in SPEC.get("companions") or []:
    staged_files.extend(_fetch_repo_bundle(comp["role"], comp["repoId"], comp["fileHints"], comp["mmprojHints"]))

# Clean huggingface temporary cache so Output stays strictly <= 19.5 GiB
shutil.rmtree("/root/.cache/huggingface", ignore_errors=True)
shutil.rmtree(os.path.join(OUT_DIR, ".cache"), ignore_errors=True)

manifest = {
    "presetId": SPEC["presetId"],
    "shortLabel": SPEC["shortLabel"],
    "createdAtEpoch": int(time.time()),
    "files": staged_files,
}
manifest_path = os.path.join(OUT_DIR, "scriptoria_llm_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as mf:
    json.dump(manifest, mf, indent=2)

total_gb = round(sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR)) / (1024 ** 3), 2)
print(f"[Qwen Dataset Builder] Complete in {round(time.time() - t0, 1)}s -> {len(staged_files)} model file(s), {total_gb} GiB total in {OUT_DIR}", flush=True)
print("[Qwen Dataset Builder] Next step: Save Version (if in editor) -> Output tab -> New Dataset, then attach <username>/scriptoria-qwen-llm in GPU Cluster!", flush=True)
`;
}

