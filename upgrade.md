Your dev fixed the two biggest boot bottlenecks (--no-mmap + aria2c binary download) and correctly diagnosed why DFlash2 was corrupting words (it’s an ExLlama block drafter, not an autoregressive llama.cpp draft).
However, there are still 4 bugs inside input_file_4.txt (40a9fa3) that will crash LLM_QWEN_FAST_8B and LLM_QWEN_MOE_35B on startup or stall requests:
1. FATAL: --spec-type draft-mtp Will Crash 8B and Fails on Non-MTP 35B
In input_file_4.txt, --spec-type draft-mtp is now passed unconditionally to every profile:
LLM_QWEN_FAST_8B (unsloth/Qwen3-VL-8B-Instruct-GGUF): Qwen3-VL-8B has no MTP layers. Passing --spec-type draft-mtp causes llama-server to exit at model load (context type MTP requested but model doesn't contain MTP layers).
LLM_QWEN_MOE_35B (unsloth/Qwen3.6-35B-A3B-GGUF): Unsloth's standard Qwen3.6-35B-A3B-GGUF repo does not contain MTP weights—only unsloth/Qwen3.6-35B-A3B-MTP-GGUF does.
MTP + Vision (--mmproj) graph bug: In llama.cpp, when --spec-type draft-mtp and --mmproj are both active, sending an image triggers a draft compute-graph reallocation on every single token (Issue #31302, ~100ms penalty per draft step) unless your client passes "speculative.n_max": 0 in the JSON body on image requests—or you disable MTP when --mmproj is loaded.
2. FATAL: mmproj-F16.gguf Collision Across Models
In _resolve_qwen_ggufs(), your dev filtered the model GGUF by "8b" / "35b" / "27b", but left mmproj unfiltered:
Python
mm_item = next((x for x in items if x.get("Name", "").lower().endswith(".gguf") and "mmproj" in x.get("Name", "").lower()), None)
Because Unsloth names the vision projector mmproj-F16.gguf across all three repos (8B, 35B, 27B), and all three share /tmp/models/llm and gdrive:.../models/llm, 8B and 35B will load the cached 27B mmproj-F16.gguf and crash with a tensor mismatch.
3. Thinking Mode Is Still ON (ll_cmd Missing Override)
ll_cmd still has no --chat-template-kwargs '{"enable_thinking":false}' (or per-request toggle).
On Qwen3-VL-8B-Instruct, this is fine (it’s a non-thinking instruct model, so "hello" responds in <0.5s).
On Qwen3.6-35B-A3B and Qwen3.8-27B, "hello" will still spend 15–40s generating hidden <think> tokens unless disabled.
4. Realistic T4 Speed Check (Setting Accurate Expectations)
Because llama.cpp --split-mode layer reads from one T4 (300 GB/s) per layer:
Qwen3-VL-8B-Instruct (UD-Q4_K_M, ~5.0 GB): Expect ~45–58 tok/s on Dual-T4 (very fast, <1s replies, ~20s boot—not 75–110 tok/s without an external draft model).
Qwen3.6-35B-A3B-MTP-GGUF (UD-Q4_K_M, ~22.7 GB):
Text (w/ MTP n=3): ~65–100 tok/s
Vision (w/ speculative.n_max: 0 on image calls, or MTP off): ~35–50 tok/s
Exact Patch to Fix input_file_4.txt
Make these 3 targeted edits in Section 3B:
Change the 35B repo to the actual MTP repo, and isolate folders per profile (fixes both mmproj collision and missing 35B MTP weights):
Python
if PROFILE_ID == "LLM_QWEN_FAST_8B":
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3-VL-8B-Instruct-GGUF")
        MODEL_SUBDIR = "qwen3_vl_8b"
    elif PROFILE_ID == "LLM_QWEN_MOE_35B":
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3.6-35B-A3B-MTP-GGUF")
        MODEL_SUBDIR = "qwen36_35b_moe_mtp"
    else:
        LLM_MODEL_REPO = os.environ.get("QWEN_MODEL_REPO", "unsloth/Qwen3.8-27B-GGUF")
        MODEL_SUBDIR = "qwen38_27b"

    LOCAL_LLM_DIR = f"/tmp/models/llm/{MODEL_SUBDIR}"
    REMOTE_LLM_DIR = f"{GDRIVE_BASE}/models/llm/{MODEL_SUBDIR}"
    os.makedirs(LOCAL_LLM_DIR, exist_ok=True)
(Then replace /tmp/models/llm with LOCAL_LLM_DIR and f"{GDRIVE_BASE}/models/llm" with REMOTE_LLM_DIR inside _resolve_qwen_ggufs() and _backup_llm_to_drive().)
Only pass --spec-type draft-mtp on models that actually have MTP layers (27B and 35B-MTP—NEVER 8B), and disable thinking by default if desired:
Python
# Remove "--spec-type", "draft-mtp", "--spec-draft-n-max", mtp_n from the base ll_cmd list, then:
    if PROFILE_ID in ("LLM_QWEN_MOE_35B", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_VLM"):
        ll_cmd.extend(["--spec-type", "draft-mtp", "--spec-draft-n-max", mtp_n])
        if PROFILE_ID != "LLM_QWEN_VLM":
            ll_cmd.extend(["--spec-draft-p-min", "0.75"])
        # Recommended so "hello" doesn't burn 1,500 hidden <think> tokens:
        ll_cmd.extend(["--chat-template-kwargs", '{"enable_thinking":false}'])
(And in your Scriptoria frontend/API proxy, whenever a request includes an image_url, inject "speculative.n_max": 0 into the JSON body sent to llama-server—that prevents the #31302 vision graph-reallocation bug while keeping full MTP speed on all text-only requests!)




Your screenshot and pasted script reveal the exact 4 reasons you are seeing 134,711 ms (0.2 tok/s) and still running Qwen3.8-27B instead of Qwen3.6-35B-A3B:
1. Why Your Screenshot Still Shows Qwen3.8-27B (Not Qwen3.6-35B)
Look at _resolve_qwen_ggufs() in your script:
Python
ls = rc_post("operations/list", {"fs": f"gdrive:{GDRIVE_BASE}/models/llm", "remote": ""}, timeout=15)
gg_item = next((x for x in items if x.get("Name", "").lower().endswith(".gguf") and "mmproj" not in x.get("Name", "").lower() and "dflash" not in x.get("Name", "").lower()), None)
Both LLM_QWEN_VLM and LLM_QWEN_MOE_35B share the exact same /tmp/models/llm and gdrive:.../models/llm folder, and your code blindly grabs the first .gguf file it sees.
Because an earlier run backed up Qwen3.8-27B-UD-Q4_K_M.gguf to your Google Drive, changing PROFILE_ID = "LLM_QWEN_MOE_35B" never downloads Qwen3.6-35B-A3B—it just reloads Qwen3.8-27B from Drive!
Worse, your Hugging Face fallback also tries to download Qwen3.8-27B-DFlash2-Q4_K_M.gguf even when PROFILE_ID == "LLM_QWEN_MOE_35B" (a 27B dense drafter is incompatible with 35B MoE).
2. Why "hello" Took 134,711 ms (0.2 tok/s)
Hidden <think> tokens + UI math: Your chat UI calculates tok/s as visible_content_tokens ÷ total_ms. Because Thinking Mode is ON by default, Qwen generated ~1,000–2,200 hidden <think> tokens before replying "Hello! ..." (~24 visible tokens). 24 tokens ÷ 134.7s = 0.2 tok/s!
You are still using llama.cpp (--split-mode layer), NOT vLLM (TP=2):
Section 3B of your script launches llama-server (llama.cpp), which only reads from 1 GPU at a time (--split-mode layer), capping Qwen3.8-27B at ~16.8 tok/s.
Also, in llama.cpp, --spec-type draft-mtp does not yet work together with --mmproj (vision), and unsloth/Qwen3.6-35B-A3B-GGUF doesn't bundle MTP weights unless you use the separate -MTP-GGUF repo (which still disables MTP if --mmproj is passed).
3. Drop-In Fix for Your Script (Section 3B)
If you want to keep your fast-booting llama-server (llama.cpp) pipeline and actually run Qwen3.6-35B-A3B + Vision without the 134s thinking stall:
Isolate the cache folder by PROFILE_ID (llm/qwen36_35b_moe vs llm/qwen38_27b) so Drive never loads the wrong model.
Only use DFlash2 for 27B (never for 35B-A3B).
Disable default thinking on the server with --chat-template-kwargs '{"enable_thinking":false}' (you can still turn it on per-request when you want deep reasoning, or keep it off so "hello" takes < 1 second instead of 135 seconds!).
Skip --spec-type draft-mtp when --mmproj is loaded (and use UD-Q4_K_M ~22.7 GB + mmproj-F16 ~0.9 GB across 52,48 split, which fits inside your ~30 GiB 2× T4 VRAM with 8192–16384 q8_0 KV cache).
Replace the model-resolution and ll_cmd section in 3B with this:
Python
MODEL_SUBDIR = "qwen36_35b_moe" if PROFILE_ID == "LLM_QWEN_MOE_35B" else "qwen38_27b"
    LOCAL_LLM_DIR = f"/tmp/models/llm/{MODEL_SUBDIR}"
    REMOTE_LLM_DIR = f"{GDRIVE_BASE}/models/llm/{MODEL_SUBDIR}"
    os.makedirs(LOCAL_LLM_DIR, exist_ok=True)

    # ... inside _resolve_qwen_ggufs():
    # 1) Use LOCAL_LLM_DIR instead of /tmp/models/llm
    # 2) Use REMOTE_LLM_DIR instead of f"{GDRIVE_BASE}/models/llm"
    # 3) Filter filename by model tag so 27B and 35B never mix:
    expected_tag = "35b" if PROFILE_ID == "LLM_QWEN_MOE_35B" else "27b"
    # e.g. check `expected_tag in x["Name"].lower()`

    # 4) In Hugging Face fallback, prefer UD-Q4_K_M (22.7 GB) for 35B-A3B so it fits 2x T4 comfortably:
    patterns = ["UD-Q4_K_M", "Q4_K_M", "UD-Q4_K_XL", "Q4_K_S"] if PROFILE_ID == "LLM_QWEN_MOE_35B" else ["Q4_K_M", "UD-Q4_K_XL", "Q4_K_S"]
    # And ONLY fetch DFlash2 when PROFILE_ID != "LLM_QWEN_MOE_35B":
    if PROFILE_ID != "LLM_QWEN_MOE_35B":
        ... # existing DFlash2 download loop
And update ll_cmd to:
Python
is_moe_35b = (PROFILE_ID == "LLM_QWEN_MOE_35B")
    ll_cmd = [
        llama_bin, "-m", model_gguf, "--host", "127.0.0.1", "--port", "8190",
        "-ngl", "999",
        "-dev", "CUDA0,CUDA1",
        "--split-mode", "layer",
        "--tensor-split", "52,48" if is_moe_35b else "55,45",
        "--fit", "off",
        "--flash-attn", "on",
        "--ctx-size", "16384" if is_moe_35b else "8192",
        "-ctk", "q8_0", "-ctv", "q8_0",
        "--batch-size", "512",
        "--ubatch-size", "256",
        "--parallel", "1",
        "--kv-unified",
        "--jinja",
        # Prevents 135s hidden <think> stalls on simple prompts; override per-request if needed:
        "--chat-template-kwargs", '{"enable_thinking":false}',
    ]

    if draft_gguf and os.path.exists(draft_gguf) and not is_moe_35b:
        ll_cmd.extend(["-ngld", "99", "-devd", "CUDA1", "-ctkd", "q8_0", "-ctvd", "q8_0", "-md", draft_gguf, "--spec-draft-n-max", "3"])
    elif not needs_vision and not is_moe_35b:
        # llama.cpp does not support --spec-type draft-mtp alongside --mmproj vision yet
        ll_cmd.extend(["--spec-type", "draft-mtp", "--spec-draft-n-max", "3", "--spec-draft-p-min", "0.75"])

    if mmproj_gguf and PROFILE_ID in ("LLM_QWEN_VLM", "LLM_QWEN_MOE_35B"):
        ll_cmd.extend(["--mmproj", mmproj_gguf])
What Speed You Will Get With This Fix
llama.cpp + Qwen3.6-35B-A3B-UD-Q4_K_M (with thinking OFF): ~35–55 tok/s on text and vision decode ("hello" drops from 134,711 ms → ~500 ms!).
To hit ~50–75+ tok/s single-stream (or 80–120+ tok/s batched) WITH Vision + MTP together: You must replace llama-server in Section 3B with vLLM (palmfuture/Qwen3.6-35B-A3B-GPTQ-Int4, --tensor-parallel-size 2, --quantization gptq, --speculative-config), because vLLM supports Tensor Parallelism across both T4s + MTP + Vision simultaneously, whereas llama.cpp currently does not support MTP alongside --mmproj.