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
OUT_ARC = "/kaggle/working/comfy_env.tar.gz"
SKIP_PREFIXES = ("torch", "nvidia", "triton", "pip", "wheel", "setuptools")
SKIP_REQS = {"torch", "torchvision", "torchaudio"}

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
        if e.lower().startswith(SKIP_PREFIXES) or e == "__pycache__":
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

compileall.compile_dir(COMFY_DIR, quiet=1)
compileall.compile_dir(SITE_OUT, quiet=1)
with open(os.path.join(COMFY_DIR, ".scriptoria_env_manifest.json"), "w", encoding="utf-8") as mf:
    json.dump({"profileId": PROFILE_ID, "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}", "nodes": [n for n, _ in NODES]}, mf, indent=2)

env = os.environ.copy()
env["GZIP"] = "-1"
subprocess.run([
    "tar", "--warning=no-file-changed", "--ignore-failed-read",
    "--exclude=*.git*", "--exclude=ComfyUI/user/*", "--exclude=ComfyUI/output/*", "--exclude=ComfyUI/input/*",
    "-czf", OUT_ARC, "-C", "/tmp", "ComfyUI", "sc_site_packages",
], env=env, check=True)
print(f"[FastBoot Builder] Ready in {round(time.time() - t0, 1)}s -> {OUT_ARC} ({round(os.path.getsize(OUT_ARC)/(1024**2), 1)} MB)", flush=True)
`;
}
