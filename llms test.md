
Here is your final, locked-in shortlist of lightweight, T4-ready (16 GB VRAM), 100% open-weight models—updated to the latest stable releases you can download and test right now.
1. The Final Model Shortlist (5 Models Total)
Role in Novel Visualiser	Final Model Choice	Hugging Face Repo & Exact Quant/Format	T4 VRAM Footprint	License
Chief Architect + Gate-3 QC VLM (Reasoning + Side-by-side Image Verification)	Qwen3.5-9B (native multimodal + thinking toggle)	unsloth/Qwen3.5-9B-GGUF
Qwen3.5-9B-Q4_K_M.gguf (5.29 GiB) + mmproj-F16.gguf (875 MiB)[1]	~7–9.3 GB (w/ 16K–32K ctx)	Apache 2.0[1]
Fast Worker LLM (Passage extraction, dialogue, simple state tags)	Qwen3.5-4B (thinking disabled)	unsloth/Qwen3.5-4B-GGUF
Qwen3.5-4B-Q4_K_M.gguf (2.55 GiB) + mmproj-F16.gguf (641 MiB)[2]	~3.5–5.7 GB	Apache 2.0[2]
Ultra-Fast Visual Tagger (Bulk location/outfit/lighting tagging & OCR)	MiniCPM-V 4.7-1B (upgrades 4.6 w/ canvas M-RoPE)[3]	openbmb/MiniCPM-V-4.7-1B-gguf
:Q4_K_M (or openbmb/MiniCPM-V-4.7-1B FP16)[3][4][5]	~1.5–2.2 GB	Apache 2.0
Text Lore Embedding + Reranker (Chapter/Entity/Timeline RAG)	Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B	Qwen/Qwen3-Embedding-0.6B (FP16)[6]
Qwen/Qwen3-Reranker-0.6B (FP16)[7]	~1.2 GB each (can run on CPU or GPU)	Apache 2.0[8][9]
Multimodal Visual Asset Search (Match generated shots vs. reference sheets)	WeMM-Embedding-2B (Matryoshka 256-dim)	tencent/WeMM-Embedding-2B (FP16, 2.72B total params)[10][11]	~5.5 GB (FP16)	Apache 2.0[11]
Two Critical Engineering Notes Before Testing
Use llama.cpp (llama-server), NOT Ollama, for Qwen3.5 vision: Ollama does not reliably support attaching separate mmproj vision projectors for Qwen3.5 GGUFs, whereas llama.cpp loads both -m and --mmproj natively behind an OpenAI-compatible /v1/chat/completions API[12][13].
Use FP16 (not BF16) on Tesla T4: T4 has native FP16 Tensor Cores, not BF16—always pass torch.float16 in PyTorch/Transformers and use mmproj-F16.gguf for llama.cpp. Also pair Qwen3-Embedding-0.6B with padding_side="left"[6] and Qwen3-Reranker-0.6B (to prevent cosine score bunching across large lore chapters). (Alternative if you want single-model sparse+dense keyword matching for fantasy names: BAAI/bge-m3[14][15].)
2. Copy-Paste Test Setup (Run Right Now on Kaggle / Colab T4)
Step A: Test Qwen3.5-9B + Qwen3.5-4B + MiniCPM-V 4.7-1B via llama.cpp
Install prebuilt CUDA llama.cpp or llama-cpp-python / binary in a Kaggle/Colab cell, then boot llama-server:
Bash
# 1. Install Hugging Face CLI + download the exact GGUFs
pip install -q huggingface_hub hf_transfer
export HF_HUB_ENABLE_HF_TRANSFER=1

# Download Qwen3.5-9B (Architect + Gate-3 QC VLM)
hf download unsloth/Qwen3.5-9B-GGUF Qwen3.5-9B-Q4_K_M.gguf mmproj-F16.gguf --local-dir ./models/qwen35_9b

# Download Qwen3.5-4B (Fast Extraction Worker)
hf download unsloth/Qwen3.5-4B-GGUF Qwen3.5-4B-Q4_K_M.gguf mmproj-F16.gguf --local-dir ./models/qwen35_4b
Run llama-server (supports both text JSON schemas and multimodal vision inputs on /v1/chat/completions):
Bash
# Start Qwen3.5-9B with Vision Projector & 16K context on T4
./llama-server \
  -m ./models/qwen35_9b/Qwen3.5-9B-Q4_K_M.gguf \
  --mmproj ./models/qwen35_9b/mmproj-F16.gguf \
  -ngl 99 -c 16384 --port 8080 --host 0.0.0.0

# To test MiniCPM-V 4.7-1B directly from HF via llama.cpp:
./llama-server -hf openbmb/MiniCPM-V-4.7-1B-gguf:Q4_K_M -ngl 99 -c 8192 --port 8081
Quick Python Test: Structured JSON + Thinking Toggle + Image QC (localhost:8080)
Python
import base64, json, requests

# 1) Fast JSON extraction (thinking OFF -> fast)
resp = requests.post("http://127.0.0.1:8080/v1/chat/completions", json={
    "model": "qwen3.5-9b",
    "chat_template_kwargs": {"enable_thinking": False},
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "state_change",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "character": {"type": "string"},
                    "attribute": {"type": "string"},
                    "new_value": {"type": "string"},
                    "is_permanent": {"type": "boolean"}
                },
                "required": ["character", "attribute", "new_value", "is_permanent"],
                "additionalProperties": False
            }
        }
    },
    "messages": [{"role": "user", "content": "Extract state change: 'A jagged scar carved permanently across Sunny's left cheek.'"}]
})
print("JSON Extract:", resp.json()["choices"][0]["message"]["content"])

# 2) Gate-3 Side-by-Side Image QC (thinking ON -> deep check)
def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()

# qc_resp = requests.post("http://127.0.0.1:8080/v1/chat/completions", json={
#     "chat_template_kwargs": {"enable_thinking": True},
#     "messages": [{"role": "user", "content": [
#         {"type": "text", "text": "Image 1 is canonical Sunny. Image 2 is generated shot. Does Image 2 match hair, face, and cloak? Reply JSON."},
#         {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64('ref.png')}"}},
#         {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64('shot.png')}"}}
#     ]}]
# })
Step B: Test Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B (Text RAG)
Bash
pip install -q "transformers>=4.51.0" sentence-transformers torch
Python
import torch
from sentence_transformers import SentenceTransformer, CrossEncoder

# 1. Embed passages (left padding is important for Qwen3-Embedding)
embedder = SentenceTransformer(
    "Qwen/Qwen3-Embedding-0.6B",
    model_kwargs={"torch_dtype": torch.float16, "device_map": "auto"},
    tokenizer_kwargs={"padding_side": "left"},
)

passages = [
    "CH0001_P004: Sunny wore a tattered grey tunic and carried no weapon.",
    "CH0035_P014: A nightmare creature's claw left a permanent scar over Sunny's left eyebrow.",
    "CH0050_P009: The Midnight Shard shattered into dust during the battle."
]
query = "What permanent injury does Sunny have on his face?"

q_emb = embedder.encode([query], prompt_name="query", normalize_embeddings=True)
p_emb = embedder.encode(passages, normalize_embeddings=True)
print("Cosine scores:", (q_emb @ p_emb.T)[0])

# 2. Rerank top candidates for crisp precision
reranker = CrossEncoder(
    "Qwen/Qwen3-Reranker-0.6B",
    model_kwargs={"torch_dtype": torch.float16, "device_map": "auto"},
)
print("Rerank scores:", reranker.predict([(query, p) for p in passages]))
Step C: Test WeMM-Embedding-2B (Multimodal Image + Text Search)
Bash
pip install -q torch "transformers==5.2.0" "qwen-vl-utils==0.0.14" pillow
Python
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoProcessor
from PIL import Image

MODEL_ID = "tencent/WeMM-Embedding-2B"
processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
model = AutoModel.from_pretrained(
    MODEL_ID,
    trust_remote_code=True,
    torch_dtype=torch.float16,  # FP16 for T4!
    device_map="auto",
).eval()

# Truncate to 256 Matryoshka dims to save 8x vector DB storage (retains ~98.7% accuracy)
def embed_mm(messages, dim=256):
    inputs = processor.apply_chat_template(
        messages, tokenize=True, return_dict=True, return_tensors="pt"
    ).to(model.device)
    with torch.no_grad():
        out = model(**inputs, output_hidden_states=True)
        # Check model card's <embedding> token pooling or helper method on tencent/WeMM-Embedding-2B
        vec = out.last_hidden_state[:, -1, :dim]
        return F.normalize(vec, p=2, dim=-1)
(Note: verify tencent/WeMM-Embedding-2B's exact <embedding> token extraction snippet in its README before benchmarking cosine similarity—the official repo includes a standalone 15-line demo.py[10].)
3. Your 15-Minute "Go / No-Go" Test Checklist
Run these 4 quick checks on one Kaggle T4 right now to lock in your stack:
Qwen3.5-4B (enable_thinking=False): Measure tokens/sec + confirm 10/10 valid JSON parses on 10 sample chapter paragraphs.
Qwen3.5-9B (enable_thinking=True + mmproj): Pass 1 character reference PNG + 1 deliberately flawed shot PNG (wrong hair/missing scar) -> verify it flags the mismatch in JSON.
MiniCPM-V 4.7-1B: Pass 5 location/character images -> verify speed (<1–2s/image) and clean tag output (lighting, indoors/outdoors, camera angle).
Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B: Verify retrieval ranks the exact CH0035_P014 passage #1 out of 50 mixed passages.