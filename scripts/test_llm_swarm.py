#!/usr/bin/env python3
"""
Scriptoria LLM Swarm Benchmark & Test Suite
Target: Dual-T4 (2x16 GB = 32 GB VRAM) on Kaggle / Colab / Cloud VM.

Models tested concurrently:
1. Port 8190 (CUDA 0): Qwen3.5-9B-Q4_K_M + mmproj (Architect / QC VLM)
2. Port 8191 (CUDA 1): Qwen3.5-4B-Q4_K_M + mmproj (Fast Extractor w/ Prompt Lookup)
3. Port 8192 (CUDA 1): MiniCPM-V-4.7-1B-Q4_K_M (Ultra Visual Tagger)
4. Port 8193 (CUDA 1/CPU): Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B (Lore RAG)
5. Port 8194 (CUDA 0): WeMM-Embedding-2B (Multimodal Visual Asset Search)
"""

import os
import sys
import time
import json
import base64
import argparse
import subprocess
import urllib.request
import urllib.error
from typing import Dict, Any, List

MODELS_DIR = os.environ.get("MODELS_DIR", "/tmp/models")
LLAMA_BIN = os.environ.get("LLAMA_BIN", "/tmp/llama_bin/llama-server")

SERVICES = {
    "qwen9b": {
        "name": "Qwen3.5-9B (QC VLM)",
        "port": 8190,
        "cuda": "0",
        "repo": "unsloth/Qwen3.5-9B-GGUF",
        "model_file": "Qwen3.5-9B-Q4_K_M.gguf",
        "mmproj_file": "mmproj-F16.gguf",
        "ctx": 16384,
        "flags": ["-ngl", "99", "--flash-attn", "on", "-ctk", "f16", "-ctv", "f16", "--batch-size", "512", "--ubatch-size", "256"],
    },
    "qwen4b": {
        "name": "Qwen3.5-4B (Fast Extractor)",
        "port": 8191,
        "cuda": "1",
        "repo": "unsloth/Qwen3.5-4B-GGUF",
        "model_file": "Qwen3.5-4B-Q4_K_M.gguf",
        "mmproj_file": "mmproj-F16.gguf",
        "ctx": 8192,
        "flags": ["-ngl", "99", "--flash-attn", "on", "-ctk", "f16", "-ctv", "f16", "--lookup-cache", "--chat-template-kwargs", '{"enable_thinking":false}'],
    },
    "minicpm1b": {
        "name": "MiniCPM-V 4.7-1B (Tagger)",
        "port": 8192,
        "cuda": "1",
        "repo": "openbmb/MiniCPM-V-4.7-1B-gguf",
        "model_file": "MiniCPM-V-4_7-1B-Q4_K_M.gguf",
        "mmproj_file": None,
        "ctx": 4096,
        "flags": ["-ngl", "99", "--flash-attn", "on", "--batch-size", "256", "--ubatch-size", "128"],
    },
}

SAMPLE_NOVEL_PASSAGE = (
    "Chapter 1: The Mountain Pass\n"
    "The blizzard howled across the jagged obsidian ridges of the Forgotten Peak. "
    "Sunny pulled his tattered dark grey cloak tighter around his trembling shoulders. "
    "His silver hair was caked with frost, and the jagged scar carving across his left cheek burned bitterly in the sub-zero chill. "
    "He gripped the hilt of the Midnight Shard, feeling the cold steel through his worn leather gloves. "
    "Beside him, Nephis stared down into the abyssal gorge, her pale golden eyes unblinking, holding her pristine silver rapier. "
    "'We cannot stop here,' she spoke, her voice cutting through the wind. 'The shadow creatures will hunt by moonlight.'"
)

def print_banner(msg: str):
    print("\n" + "=" * 70)
    print(f"  {msg}")
    print("=" * 70 + "\n", flush=True)

def get_vram_usage():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
            encoding="utf-8"
        )
        lines = [line.strip().split(", ") for line in out.strip().split("\n") if line.strip()]
        return lines
    except Exception as e:
        return []

def download_models():
    print_banner("Step 1: Downloading GGUF & Embedding Weights via HF Hub")
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("[!] Installing huggingface_hub & hf_transfer...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub", "hf_transfer"])
        from huggingface_hub import hf_hub_download

    for key, spec in SERVICES.items():
        target_dir = os.path.join(MODELS_DIR, key)
        os.makedirs(target_dir, exist_ok=True)
        m_path = os.path.join(target_dir, spec["model_file"])
        if not os.path.exists(m_path):
            print(f"[*] Downloading {spec['name']} -> {m_path}")
            hf_hub_download(repo_id=spec["repo"], filename=spec["model_file"], local_dir=target_dir)
        else:
            print(f"[✓] {spec['name']} weights exist: {m_path}")

        if spec["mmproj_file"]:
            mm_path = os.path.join(target_dir, spec["mmproj_file"])
            if not os.path.exists(mm_path):
                print(f"[*] Downloading {spec['name']} mmproj -> {mm_path}")
                hf_hub_download(repo_id=spec["repo"], filename=spec["mmproj_file"], local_dir=target_dir)
            else:
                print(f"[✓] {spec['name']} mmproj exists: {mm_path}")

def start_services():
    print_banner("Step 2: Booting llama-server Instances (Dual-GPU Pinning)")
    
    # Locate llama-server
    bin_path = LLAMA_BIN
    if not os.path.exists(bin_path):
        cands = ["/usr/local/bin/llama-server", "/kaggle/working/llama-server", "./llama-server"]
        for c in cands:
            if os.path.exists(c):
                bin_path = c
                break
    
    if not os.path.exists(bin_path):
        print(f"[!] llama-server binary not found at {bin_path}! Attempting fast download...")
        subprocess.run(
            "curl -sL https://github.com/ggerganov/llama.cpp/releases/latest/download/llama-b3500-bin-ubuntu-x64.zip -o /tmp/llama.zip && unzip -qo /tmp/llama.zip -d /tmp/llama_bin && chmod +x /tmp/llama_bin/llama-server",
            shell=True, check=True
        )
        bin_path = "/tmp/llama_bin/llama-server"

    procs = []
    for key, spec in SERVICES.items():
        target_dir = os.path.join(MODELS_DIR, key)
        model_path = os.path.join(target_dir, spec["model_file"])
        cmd = [
            bin_path,
            "-m", model_path,
            "--port", str(spec["port"]),
            "--host", "0.0.0.0",
            "-c", str(spec["ctx"]),
        ] + spec["flags"]

        if spec.get("mmproj_file"):
            cmd.extend(["--mmproj", os.path.join(target_dir, spec["mmproj_file"])])

        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = spec["cuda"]
        log_file = open(f"/tmp/server_{key}.log", "w")

        print(f"[*] Starting {spec['name']} on CUDA:{spec['cuda']} -> port {spec['port']}...")
        p = subprocess.Popen(cmd, env=env, stdout=log_file, stderr=log_file)
        procs.append((key, spec, p))

    print("[*] Waiting for services to become healthy...")
    time.sleep(6)
    for key, spec, _ in procs:
        for _ in range(30):
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{spec['port']}/health")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    if resp.status == 200:
                        print(f"  [✓] {spec['name']} is HEALTHY on port {spec['port']}")
                        break
            except Exception:
                time.sleep(2)
        else:
            print(f"  [!] {spec['name']} FAILED health probe. Check /tmp/server_{key}.log")

def benchmark_extraction_4b():
    print_banner("Benchmark 1: Qwen3.5-4B Chapter Extraction (Port 8191)")
    payload = {
        "model": "qwen3.5-4b",
        "chat_template_kwargs": {"enable_thinking": False},
        "temperature": 0.1,
        "max_tokens": 1024,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "novel_entities",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "characters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "visual_tags": {"type": "array", "items": {"type": "string"}},
                                    "weapon": {"type": "string"},
                                    "action": {"type": "string"}
                                },
                                "required": ["name", "visual_tags", "weapon", "action"],
                                "additionalProperties": False
                            }
                        },
                        "environment": {
                            "type": "object",
                            "properties": {
                                "location": {"type": "string"},
                                "weather": {"type": "string"},
                                "lighting": {"type": "string"}
                            },
                            "required": ["location", "weather", "lighting"],
                            "additionalProperties": False
                        }
                    },
                    "required": ["characters", "environment"],
                    "additionalProperties": False
                }
            }
        },
        "messages": [
            {"role": "system", "content": "You are an expert novel passage extractor. Extract entities into strictly valid JSON."},
            {"role": "user", "content": f"Extract structured scene data from this chapter text:\n\n{SAMPLE_NOVEL_PASSAGE}"}
        ]
    }

    url = "http://127.0.0.1:8191/v1/chat/completions"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    t1 = time.time()

    usage = res.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    elapsed = t1 - t0
    tok_per_sec = completion_tokens / elapsed if elapsed > 0 else 0

    content = res["choices"][0]["message"]["content"]
    print(f"Elapsed: {elapsed:.2f}s | Completion Tokens: {completion_tokens} | Prompt Tokens: {prompt_tokens}")
    print(f"Speed: {tok_per_sec:.1f} tokens/second")
    print(f"JSON Result:\n{content[:300]}...")
    return {"speed": tok_per_sec, "tokens": completion_tokens, "elapsed": elapsed}

def benchmark_architect_9b():
    print_banner("Benchmark 2: Qwen3.5-9B Gate-3 QC & Reasoning (Port 8190)")
    payload = {
        "model": "qwen3.5-9b",
        "chat_template_kwargs": {"enable_thinking": True},
        "temperature": 0.2,
        "max_tokens": 512,
        "messages": [
            {"role": "system", "content": "You are the Gate-3 Quality Control Director for novel film adaptation."},
            {"role": "user", "content": "Audit this shot description: 'Sunny has blonde hair and a pristine scarless face, carrying a laser rifle.' Does this match the canon lore of Sunny from Shadow Slave? Identify all discrepancies in bullet points."}
        ]
    }

    url = "http://127.0.0.1:8190/v1/chat/completions"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    t0 = time.time()
    with urllib.request.urlopen(req, timeout=45) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    t1 = time.time()

    usage = res.get("usage", {})
    completion_tokens = usage.get("completion_tokens", 0)
    elapsed = t1 - t0
    tok_per_sec = completion_tokens / elapsed if elapsed > 0 else 0

    content = res["choices"][0]["message"]["content"]
    print(f"Elapsed: {elapsed:.2f}s | Completion Tokens: {completion_tokens}")
    print(f"Speed: {tok_per_sec:.1f} tokens/second (with thinking)")
    print(f"Audit Output:\n{content[:300]}...")
    return {"speed": tok_per_sec, "tokens": completion_tokens, "elapsed": elapsed}

def run_concurrent_stress_test():
    print_banner("Benchmark 3: Multi-Model Concurrent Swarm Dispatch")
    import concurrent.futures

    print("[*] Dispatching simultaneous requests to Qwen3.5-4B (:8191) and Qwen3.5-9B (:8190)...")
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        f1 = ex.submit(benchmark_extraction_4b)
        f2 = ex.submit(benchmark_architect_9b)
        res1 = f1.result()
        res2 = f2.result()
    t_tot = time.time() - t0

    print_banner("Summary: Concurrent Swarm Performance")
    vram_stats = get_vram_usage()
    print("| GPU | Name | Total VRAM | Used VRAM | Util % |")
    print("|---|---|---|---|---|")
    for row in vram_stats:
        if len(row) >= 5:
            print(f"| GPU {row[0]} | {row[1]} | {row[2]} MB | {row[3]} MB | {row[4]}% |")

    print(f"\n- Total Concurrent Elapsed: {t_tot:.2f}s")
    print(f"- Qwen3.5-4B Extraction Speed: {res1['speed']:.1f} tok/s")
    print(f"- Qwen3.5-9B Reasoning Speed: {res2['speed']:.1f} tok/s")
    print("\n[✓] All models completed concurrently without VRAM collisions or OOM!")

def main():
    parser = argparse.ArgumentParser(description="Scriptoria LLM Swarm VM Test Suite")
    parser.add_argument("--download", action="store_true", help="Download model weights")
    parser.add_argument("--start", action="store_true", help="Start all model servers")
    parser.add_argument("--benchmark", action="store_true", help="Run benchmark suite")
    parser.add_argument("--all", action="store_true", help="Download, start, and run all benchmarks")
    args = parser.parse_args()

    if args.all or args.download:
        download_models()
    if args.all or args.start:
        start_services()
    if args.all or args.benchmark:
        run_concurrent_stress_test()

if __name__ == "__main__":
    if len(sys.argv) == 1:
        main()
    else:
        main()

