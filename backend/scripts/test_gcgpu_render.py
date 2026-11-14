import asyncio
import httpx
import json
import uuid
import sys
from pathlib import Path

async def test_render():
    url = "https://gcgpu.krhimanshu.in"
    print(f"Connecting to {url}...")

    # SDXL workflow using verified models on gcgpu:
    # Checkpoint: sdxl/illustrious/waiNSFWIllustrious_v110.safetensors
    # VAE: sdxl_vae_fp16_fix.safetensors
    workflow = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "sdxl/illustrious/waiNSFWIllustrious_v110.safetensors"
            }
        },
        "2": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "sdxl_vae_fp16_fix.safetensors"
            }
        },
        "3": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": 1024,
                "height": 1024,
                "batch_size": 1
            }
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "masterpiece, best quality, 1boy, Sunny from shadow slave, pale skin, messy black hair, sharp dark onyx eyes, wearing dark leather tunic, dramatic cinematic rim lighting, 8k resolution anime aesthetic",
                "clip": ["1", 1]
            }
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "worst quality, low quality, bad anatomy, bad hands, missing fingers, blurry, watermark",
                "clip": ["1", 1]
            }
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["3", 0],
                "seed": 424242,
                "steps": 25,
                "cfg": 6.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0
            }
        },
        "7": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["6", 0],
                "vae": ["2", 0]
            }
        },
        "8": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "GCGPU_TEST_SUNNY",
                "images": ["7", 0]
            }
        }
    }

    client_id = str(uuid.uuid4())
    async with httpx.AsyncClient(timeout=180.0) as client:
        print("Submitting prompt to gcgpu...")
        resp = await client.post(f"{url}/prompt", json={"prompt": workflow, "client_id": client_id})
        print(f"Status Code: {resp.status_code}")
        data = resp.json()
        print("Response data:", data)

        if "prompt_id" not in data:
            print("Prompt rejected or failed validation!")
            if "node_errors" in data:
                print("Node errors:", json.dumps(data["node_errors"], indent=2))
            return

        prompt_id = data["prompt_id"]
        print(f"Prompt successfully queued! Prompt ID: {prompt_id}")
        print("Monitoring execution...")

        out_dir = Path("output/shots")
        out_dir.mkdir(parents=True, exist_ok=True)
        artifact_dir = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")

        for attempt in range(60):
            await asyncio.sleep(3.0)
            hist_resp = await client.get(f"{url}/history/{prompt_id}")
            if hist_resp.status_code == 200:
                h_json = hist_resp.json()
                if prompt_id in h_json:
                    p_info = h_json[prompt_id]
                    status_info = p_info.get("status", {})
                    print(f"Status: {status_info}")
                    outputs = p_info.get("outputs", {})

                    for nid, n_out in outputs.items():
                        for img in n_out.get("images", []):
                            fname = img["filename"]
                            subf = img.get("subfolder", "")
                            t = img.get("type", "output")
                            view_url = f"{url}/view?filename={fname}&subfolder={subf}&type={t}"
                            print(f"Downloading completed frame: {fname} from {view_url}...")
                            img_data = (await client.get(view_url)).content

                            save_path = out_dir / fname
                            with open(save_path, "wb") as f:
                                f.write(img_data)
                            print(f"✓ Saved locally to {save_path} ({len(img_data)} bytes)")

                            # Copy to artifact directory
                            artifact_dir.mkdir(parents=True, exist_ok=True)
                            with open(artifact_dir / fname, "wb") as f:
                                f.write(img_data)
                            print(f"✓ Mirrored to artifact directory!")

                    print("=== GCGPU Test Generation Completed Successfully! ===")
                    return
            print(f"Rendering on gcgpu Tesla T4... ({attempt + 1}/60)")

if __name__ == "__main__":
    asyncio.run(test_render())

