Here is a complete, end-to-end execution plan to deploy and run Qwen 27B (Qwen3.8-27B BF16) with Vision at up to 262K context on Kaggle’s free TPU v5e-8 (128 GB HBM).
Phase 1: Prerequisites & Quota Planning
Verify your Kaggle account:
Go to Kaggle → Settings and complete Phone Verification (some accounts also receive a Persona identity prompt). Without this, Kaggle will deny Internet ON and/or assign empty TPU sessions.
Understand your TPU budget:
Weekly quota: ~20 hours/week
Max session length: 9 hours (set auto-keepalive to 480 minutes / 8 hours so it exits cleanly before hitting the hard cutoff)
Concurrency limit: 1 active TPU session at a time
Disk / RAM limits: ~30 GB host RAM and 20 GB in /kaggle/working. (This plan avoids both limits by mounting model weights and XLA caches read-only via /kaggle/input.)
Phase 2: Choose Your Configuration Profile
Pick the configuration that matches your workload before starting, because both profiles below have pre-compiled XLA graphs included in the environment dataset (saving ~30 minutes of cold compile time):
Setting (serve_config.json)	Profile A: Max Context & Speed (Long docs, huge prompts, single/few streams)	Profile B: Max Batch Throughput (Processing hundreds/thousands of images)
max_model_len	262144 (262K native)	131072 (131K)
max_num_seqs	4	16
mtp_tokens	3 (~130 tok/s single stream)	0 (saves overhead; ~900 tok/s total across 16 streams)
text_only	false (keeps Vision ON)	false (keeps Vision ON)
fast_start	false (~18–22 min boot, all shapes pre-warmed) or true (~4–6 min boot, compiles shapes lazily on first hit)	false (or true for quick tests)
reasoning_effort_default	"low" / "medium" / "xhigh"	"low" (or override with enable_thinking: false per request)
keepalive_min	480 (8 hours)	480 (8 hours)
Important: If you also need JSON mode / Structured Outputs (response_format) while mtp_tokens: 3 is enabled, you must pass --no-async-scheduling to vLLM (otherwise vllm-tpu 0.28.0 crashes with AttributeError: __delitem__). If you use Profile B (mtp_tokens: 0), structured outputs work normally without disabling async scheduling.
Phase 3: Deployment (Pick Route A or Route B)
Route A: Kaggle Notebook UI (Zero Local Setup)
Get the Notebook: Download or import qwen38-27b/notebook/qwen38-tpu-serve.ipynb from the ARahim3/kaggle-tpu-lab GitHub repository into a new Kaggle Notebook (or fork the author's published Kaggle notebook).
Configure the Right Sidebar (3 required settings):
Accelerator: TPU VM v5e-8
Internet: ON
Add Input (Attach Datasets): Search and attach both public datasets:
rahim3/qwen3-8-27b-bf16 (54 GB BF16 model weights)
rahim3/qwen38-tpu-env-v5e8 (pre-built XLA compile cache + cloudflared binary)
Add a Pre-Flight "Ghost TPU" Check (Cell 1):
Kaggle occasionally boots a TPU VM without attaching the chips. Run this before anything else:
Python
import jax
n = jax.device_count()
print("TPU chips detected:", n)
assert n == 8, "Ghost TPU session! Stop and restart the Kaggle session."
Update serve_config.json:
Edit the configuration cell with your chosen profile from Phase 2—for example, for Profile A:
JSON
{
  "max_model_len": 262144,
  "max_num_seqs": 4,
  "mtp_tokens": 3,
  "reasoning_effort_default": "medium",
  "keepalive_min": 480,
  "text_only": false,
  "fast_start": false
}
Run All Cells:
The notebook installs vllm-tpu 0.28.0 via uv (~30s), applies the Gated-DeltaNet MTP state-rollback patch, restores the XLA cache from /kaggle/input, launches vLLM across all 8 TPU chips, and starts a Cloudflare tunnel.
The final cell stays running—this is your server. Wait until you see the READY banner with your https://....trycloudflare.com URL and API Key.
Route B: Local Terminal CLI (Best for Automation)
If you prefer launching and monitoring from your own machine:
Bash
# 1. One-time setup
pip install kaggle
# Ensure your Kaggle API token is saved at ~/.kaggle/kaggle.json (chmod 600)

git clone https://github.com/ARahim3/kaggle-tpu-lab
cd kaggle-tpu-lab

# 2. Launch the TPU server on Kaggle (add --fast-start for ~6 min boot)
python launch.py serve
# Optional: if using JSON schema outputs with MTP on:
# python launch.py serve --no-async-scheduling

# 3. Reconnect to logs if terminal closes, or shut down cleanly to save quota
python launch.py status -f
python launch.py stop
Phase 4: Vision Preprocessing Pipeline (Critical for TPU Speed!)
On vllm-tpu (tpu-inference), the vision encoder compiles a separate XLA graph for every unique image grid resolution.
If you send 50 images with 50 different dimensions, every single image triggers a ~1-minute XLA ViT compilation (and may hit Cloudflare’s 100-second HTTP 524 timeout!).
If you resize/pad all images to one standardized resolution (e.g., 1024×1024 for general/OCR or 768×768 for fast batching), only the very first image compiles (~1 min), and every image after that runs instantly.
Standardized Image Helper (Run on Your Client / Batch Script)
Python
import io, base64
from PIL import Image, ImageOps

def encode_fixed_image(path: str, size: int = 1024) -> str:
    """Pad & resize any image to a fixed square (size x size) to prevent XLA ViT recompiles."""
    img = Image.open(path).convert("RGB")
    img = ImageOps.pad(img, (size, size), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"
Phase 5: Production Client & Batch Execution Script
Use this Python script (either from your laptop against the Cloudflare URL, or from another notebook cell against http://127.0.0.1:8000/v1) to process images concurrently while obeying TPU/Cloudflare rules:
Always set stream=True: Cloudflare drops idle HTTP connections after 100 seconds with no bytes received (which can happen during the first ViT compile or a huge 200K-token prefill). Streaming keeps the connection alive.
Match concurrency to max_num_seqs (4 for Profile A, 16 for Profile B).
Warm up the ViT once with a single dummy/first image before launching 16 concurrent workers.
Python
import asyncio
from openai import AsyncOpenAI

ENDPOINT_URL = "https://YOUR-TUNNEL.trycloudflare.com/v1"
API_KEY = "YOUR-KEY-FROM-READY-BANNER"
MODEL = "qwen3.8-27b"

client = AsyncOpenAI(base_url=ENDPOINT_URL, api_key=API_KEY, timeout=300.0)

async def process_one(image_path: str, prompt: str, sem: asyncio.Semaphore, disable_thinking: bool = True):
    img_uri = encode_fixed_image(image_path, size=1024)  # Always fixed size!
    async with sem:
        extra = {"chat_template_kwargs": {"enable_thinking": False}} if disable_thinking else {}
        stream = await client.chat.completions.create(
            model=MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": img_uri}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=4096,
            temperature=0.2,
            stream=True,
            extra_body=extra,
        )
        chunks = []
        async for event in stream:
            delta = event.choices[0].delta
            if delta and delta.content:
                chunks.append(delta.content)
        return "".join(chunks)

async def run_batch(image_paths: list[str], concurrency: int = 16):
    sem = asyncio.Semaphore(concurrency)
    # 1. Warm up ViT graph once with the first image (handles the ~60s first-time ViT compile)
    first_res = await process_one(image_paths[0], "Describe and extract all text.", sem)
    
    # 2. Fire the rest concurrently across TPU batch slots
    tasks = [process_one(p, "Describe and extract all text.", sem) for p in image_paths[1:]]
    rest_res = await asyncio.gather(*tasks, return_exceptions=True)
    return [first_res] + list(rest_res)
Phase 6: Operational Checklist & Recovery Rules
Warmup Retry: If the very first image request returns HTTP 524 over Cloudflare because XLA was compiling the 1024×1024 ViT graph, simply retry that one request—the compiled graph is now cached in TPU memory for the rest of the session.
Multi-Turn Note: vllm-tpu 0.28.0 disables automatic prefix caching on hybrid Gated DeltaNet models. Long multi-turn histories still work fine (prefill runs at ~10,300 tok/s, so even 50K tokens re-prefills in ~5s), but for batch datasets, keep prompts single-turn for maximum throughput.
Session Handoff (at 8 Hours): Because Kaggle caps sessions at 9 hours, write your batch script to save results incrementally to disk (JSONL/SQLite) after each image and skip already-completed IDs on restart.
Stop Cleanly: When finished, run python launch.py stop (CLI) or click Stop Session (Kaggle UI) immediately so idle server minutes don't drain your 20-hour weekly TPU quota.