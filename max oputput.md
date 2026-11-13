Because Kaggle’s TPU v5e-8 queue is backed up at 1,100+, tuning 2× T4 properly is the right move. First, here is the honest hardware constraint, followed by the exact setups that actually hit 40–150+ tok/s on Kaggle’s 2× T4 (30 GiB usable VRAM, 300 GB/s bandwidth per card, 70W cap, no P2P).
The Hardware Catch (and How to Beat It)
Single-stream token generation is limited by memory bandwidth ÷ active bytes read per token.
On 2× T4, a 27B dense model at 4-bit (~16 GB) hits a physical wall of ~16–19 tok/s with normal decoding.
To break past that to 40–150+ tok/s, you must do one of three things:
Use ExLlamaV3 (TP=2) + DFlash2 Speculative Decoding on Qwen3.8-27B (drafts 7 tokens at once).
Switch to a Sparse MoE model (Qwen3.6-35B-A3B Vision), which only reads ~3B active parameters (~2 GB) per token instead of 27B.
Use vLLM continuous batching (TP=2) to get 100+ tok/s aggregate across concurrent requests.
Best Setups Ranked on Kaggle 2× T4
Setup	Text Speed (Single Stream)	Vision Speed (After Prefill)	Max Context Window	Best For
1. Qwen3.8-27B on ExLlamaV3 (EXL3 4.0bpw + DFlash2 + TP=2)	154 tok/s (code/JSON)
55–57 tok/s (mixed)
35–37 tok/s (prose)	35–150 tok/s (depends on prose vs JSON/code output)	~192K – 262K (w/ Q8/Q6 KV)	Maximum intelligence + fastest code/JSON on 2× T4
2. Qwen3.6-35B-A3B (MoE, 3B active) on vLLM (TP=2 + MTP)	~45–65 tok/s plain
~80–120+ tok/s w/ MTP (all text types)	~45–100+ tok/s	~128K – 262K (hybrid 40-layer KV is tiny)	Hitting 50–100+ tok/s even on prose & vision
3. Qwen3.8-27B on vLLM (INT4 + MTP + TP=2)	~40 tok/s single
~120–180+ tok/s batched (4–8 reqs)	~40 tok/s single
~120+ tok/s batched	~48K – 96K (pooled, FP16 KV)	Bulk dataset processing
4. Qwen3.5-9B or Gemma 4 12B (4-bit)	~75–110+ tok/s plain (150+ w/ spec)	~75–110+ tok/s	256K – 262K	Strict low-latency prose (lower IQ than 27B/35B)
(Note: "Vision tok/s" splits into Image Prefill + Text Decode. On T4, a 1024×1024 image prefills in ~0.8–1.5 seconds, and then output tokens stream at the exact decode speed above. Keep images ≤ 1024×1024 so prefill doesn't stall.)
Setup 1: Qwen3.8-27B at 55–154 tok/s (ExLlamaV3 + DFlash2)
This exact configuration has been benchmarked on Kaggle’s free 2× T4 (EXL3 4.0bpw + DFlash2 7-token block drafter + TP=2 over PCIe), hitting 154 tok/s on code, 55–57 tok/s overall, and 35–37 tok/s on prose (lossless greedy match vs. plain decode).
What you need:
Engine: Upstream turboderp/exllamav3 (>= v1.6.4, which includes Turing sm_75 support) or r0b0tlab/exllamav3 (community branch with native DFlash2DraftModel) + TabbyAPI (or examples/chat.py).
Target weights: turboderp/Qwen3.8-27B-exl3 (pick the 4.0bpw variant with the quantized vision tower, ~15.4 GiB) or r0b0tlab/Qwen3.8-27B-EXL3-4.00bpw (text-only if you don't need vision).
Draft weights: r0b0tlab/Qwen3.8-27B-DFlash2-EXL3-4.00bpw (~1.2 GiB + ~1.22 GiB GDN state).
VRAM & Context Window on 2× T4 (30 GiB usable):
Target (15.4 GiB) + DFlash2 (~2.4 GiB) = ~17.8 GiB across both cards (~9 GiB/GPU).
Remaining ~11–12 GiB for KV cache:
With Q8 KV cache (~32 KiB/token, verified near-lossless on Qwen3.8-27B): fits up to ~262,144 tokens (full native 262K context, ~26.2 GiB total; keep at 196,608 for safe activation headroom).
With Q6 / Q4 KV cache: fits full 262,144 tokens effortlessly (~22.7 GiB total).
Why prose is ~35 tok/s here: DFlash2 drafts 7 tokens per step; structured code/JSON gets ~7 tokens accepted/step (154 tok/s), while open-ended prose only gets ~2.5 accepted/step (35–37 tok/s).
Setup 2: Qwen3.6-35B-A3B (MoE + Vision) for Fast All-Around Speed (50–100+ tok/s)
If you want high speed on prose AND vision (not just code), switch from dense 27B to Qwen3.6-35B-A3B:
Why it flies on 2× T4: It has 35B total parameters, but only 3B activate per token (256 experts, 8 routed + 1 shared), plus a native Vision encoder that matches Claude Sonnet 4.5 on vision benchmarks (MMMU-Pro 75.0%, RealWorldQA 85.3%, AIME 2026 92.7%, SWE-bench Verified 73.4%).
VRAM & Context Window on 2× T4:
A 4-bit checkpoint (GPTQ-Int4 / AWQ / EXL3 4.0bpw) takes ~20–21 GiB across both T4s (~10.5 GiB/GPU).
Only 10 of its 40 layers are full attention (the other 30 are fixed-state Gated DeltaNet), so its KV cache is even smaller than 27B (~40 KiB/token in FP16, ~20 KiB/token in Q8).
With 8–9 GiB free, you get ~131K–200K context in vLLM (or full 262K in ExLlamaV3/llama.cpp with Q8 KV).
Speed on 2× T4: Because only ~2 GB of active weights are read per token across TP=2, plain decode hits ~45–65 tok/s, and turning on MTP (num_speculative_tokens=2 or 3) pushes it into the ~80–120+ tok/s range even on general text & vision outputs.
vLLM Launch Template for Qwen3.6-35B-A3B on 2× T4:
Bash
export HF_HOME=/tmp/hf
export NCCL_P2P_DISABLE=1

vllm serve Qwen/Qwen3.6-35B-A3B-GPTQ-Int4 \  # or community AWQ / GPTQ-Int4 build
  --tensor-parallel-size 2 \
  --dtype float16 \
  --quantization gptq \
  --gpu-memory-utilization 0.92 \
  --max-model-len 65536 \                    # can push to 131072 at max-num-seqs 2-4
  --max-num-seqs 4 \
  --enable-chunked-prefill \
  --max-num-batched-tokens 2048 \
  --speculative-config '{"method":"qwen3_next_mtp","num_speculative_tokens":3}' \
  --limit-mm-per-prompt '{"image": 1, "video": 0}' \
  --mm-processor-kwargs '{"min_pixels": 3136, "max_pixels": 1003520}' \
  --mm-encoder-tp-mode data \
  --reasoning-parser qwen3 \
  --disable-custom-all-reduce
(Remember: do not pass --kv-cache-dtype fp8 on T4 SM 7.5 in vLLM, and avoid *_marlin quantization flags if your vLLM wheel throws SM 7.5 errors.)
Which One Should You Pick?
Pick Qwen3.8-27B (ExLlamaV3 TP=2 + DFlash2) if you are generating code, JSON extraction, tool calls, or structured vision outputs and want up to 154 tok/s with 192K–262K context and peak 27B intelligence.
Pick Qwen3.6-35B-A3B (vLLM TP=2 + MTP) if you need 50–100+ tok/s across general prose and vision tasks (or high multi-request throughput) with 64K–131K+ context.
And in both cases: Pass enable_thinking: false (or reasoning_effort: "low") for straightforward vision/extraction prompts—otherwise Qwen spends 50–80% of your tokens inside hidden <think> blocks, cutting your visible output rate in half.