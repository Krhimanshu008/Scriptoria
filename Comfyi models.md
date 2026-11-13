This Master Catalog of Image Generation Models & Components is optimized specifically for the NVIDIA Tesla T4 GPU (16 GB VRAM, Turing Architecture).
💡 What Runs Best on a 16 GB Tesla T4?
SDXL / Illustrious / Pony / SDXL-Turbo (~6.5 GB FP16): The #1 sweet spot for a 16 GB T4. Leaves ~9.5 GB of free VRAM for ControlNet Union, IP-Adapter Plus, SAM, and tiled upscaling.
Flux.1 Dev / Schnell (GGUF Q4_K_M ~6.8 GB or Q8_0 ~12 GB) & Flux.2 Klein (~3.9 GB): Full 24 GB Flux doesn't fit in 16 GB, but GGUF quantized UNets (via ComfyUI-GGUF) run smoothly inside 16 GB VRAM!
Qwen-Image-Edit (GGUF Q4_K_M ~12.2 GB + 4-Step Lightning LoRA): Great for multi-image fusion, relighting, and camera angle edits on a 16 GB T4.
T4 Hardware Rule: Always use sdxl_vae_fp16_fix.safetensors for SDXL (prevents black NaN images in --fp16-vae mode on Turing GPUs).
1️⃣ Base Checkpoints (ComfyUI/models/checkpoints/)
Model Name & Style	Exact Filename	Size	Best T4 Settings	Hugging Face Link (repo_id)	Civitai Link
DreamShaper XL v2.1 Turbo (Photoreal + Art, Fast)[1]	DreamShaperXL_Turbo_v2_1.safetensors	6.6 GB	6–8 steps, CFG 2.0, dpmpp_sde + karras[1][2]	Lykon/dreamshaper-xl-v2-turbo	Civitai #112902
WAI-NSFW-Illustrious SDXL (Top Anime / Illustration)[3]	waiNSFWIllustrious_v110.safetensors (or v120/v16)	6.6 GB	24–28 steps, CFG 6.0–6.5, euler_ancestral	guy39/wai-nsfw-illustrious-sdxl-v11.0	Civitai #827184[4]
Juggernaut XL v9 / XI (Top Photorealism)[5][6]	Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors	6.6 GB	25–30 steps, CFG 5.0–6.0, dpmpp_2m_sde + karras	RunDiffusion/Juggernaut-XL-v9[5]	Civitai #133005
RealVisXL V5.0 (Portraits & Skin Realism)[7][8]	RealVisXL_V5.0_fp16.safetensors	6.6 GB	25–30 steps, CFG 5.5, dpmpp_sde + karras[9]	SG161222/RealVisXL_V5.0[9]	Civitai #139562[10]
RealVisXL V5.0 Lightning (Fast 6-Step Photoreal)[8][10]	RealVisXL_V5.0_Lightning_fp16.safetensors	6.6 GB	4–6 steps, CFG 1.5–2.0, dpmpp_sde + karras	SG161222/RealVisXL_V5.0_Lightning	Civitai #139562
NoobAI-XL (V-Pred / Eps) (Anime / Character Concept)	NoobAI-XL-v1.1.safetensors	6.6 GB	24–28 steps, CFG 5.5, euler	Laxhar/noobai-XL-1.1	Civitai #833294
DreamShaper 8 (SD 1.5) (Ultra-Light & Fast)[1][11]	dreamshaper_8.safetensors	2.0 GB	20–25 steps, CFG 7.0, dpmpp_2m + karras	Lykon/DreamShaper	Civitai #4384
2️⃣ UNet & Quantized GGUF Models (ComfyUI/models/unet/ & diffusion_models/)
(Loaded via UnetLoaderGGUF or UNETLoader so 12B–20B models fit inside a 16 GB T4!)
Model Name	Exact Filename	Size	Loader Node	Hugging Face Link (repo_id)	Civitai Link
Qwen-Image-Edit 2511 (GGUF Q4_K_M) (Image Editing, Relight, Angles, Fusion)	qwen-image-edit-2511-Q4_K_M.gguf	12.2 GB	UnetLoaderGGUF	unsloth/Qwen-Image-Edit-2511-GGUF	Civitai Qwen-Image
Flux.1-dev (GGUF Q4_K_S / Q4_K_M) (Best Prompt Adherence & Text)	flux1-dev-Q4_K_S.gguf	6.8 GB	UnetLoaderGGUF	city96/FLUX.1-dev-gguf	Civitai #618692
Flux.1-schnell (GGUF Q4_K_S) (4-Step Fast Flux)	flux1-schnell-Q4_K_S.gguf	6.8 GB	UnetLoaderGGUF	city96/FLUX.1-schnell-gguf	Civitai #618692
Flux.2 Klein 4B (FP8) (Lightweight Fast Flux2)	flux-2-klein-4b-fp8.safetensors	3.9 GB	UNETLoader	black-forest-labs/FLUX.1-dev	—
3️⃣ Text Encoders & CLIP (ComfyUI/models/text_encoders/ & clip/)
Encoder Name	Exact Filename	Size	Used With	Hugging Face Link (repo_id)
Qwen 2.5 VL 7B (FP8 Scaled)	qwen_2.5_vl_7b_fp8_scaled.safetensors	8.9 GB	Qwen-Image-Edit (CLIPLoader type: qwen_image)	Comfy-Org/Qwen-Image_ComfyUI
T5-XXL FP8 (e4m3fn)	t5xxl_fp8_e4m3fn.safetensors	4.9 GB	Flux.1 Dev / Schnell / SD 3.5 (DualCLIPLoader)	comfyanonymous/flux_text_encoders
T5-XXL GGUF (Q4_K_M) (Low-VRAM T5 for 16GB T4)	t5-v1_1-xxl-encoder-Q4_K_M.gguf	2.9 GB	Flux.1 Dev / Schnell (DualCLIPLoaderGGUF)	city96/t5-v1_1-xxl-encoder-gguf
CLIP-L	clip_l.safetensors	246 MB	Flux.1 / SD 3.5 (DualCLIPLoader)	comfyanonymous/flux_text_encoders
Qwen 3 4B FP4 (Flux2)	qwen_3_4b_fp4_flux2.safetensors	3.7 GB	Flux.2 Klein 4B	(Already in your Google Drive)
4️⃣ VAEs (ComfyUI/models/vae/)
VAE Name	Exact Filename	Size	Used With	Hugging Face Link (repo_id)	Civitai Link
SDXL VAE FP16 Fix (Mandatory for T4!)	sdxl_vae_fp16_fix.safetensors	319 MB	All SDXL, Illustrious, Pony & Turbo models	madebyollin/sdxl-vae-fp16-fix	Civitai #296576[12]
Qwen Image VAE	qwen_image_vae.safetensors	242 MB	Qwen-Image-Edit 2511	Comfy-Org/Qwen-Image_ComfyUI	—
Flux.1 AE (VAE)	ae.safetensors	335 MB	Flux.1 Dev / Schnell	black-forest-labs/FLUX.1-schnell	Civitai #618692
Flux.2 VAE	flux2-vae.safetensors	320 MB	Flux.2 Klein 4B	(Already in your Google Drive)	—
5️⃣ LoRAs — Speed, Detailers, Character Sheets & Qwen Edit (ComfyUI/models/loras/)
LoRA Name & Purpose	Exact Filename	Size	Base Model	Hugging Face Link (repo_id)	Civitai Link
VN Character Sheet v4 (3-Angle Turnaround)	vn_character_sheet_v4.safetensors	218 MB	SDXL / Illustrious	MIUProject/VNCCS	Civitai #400668
SDXL FaeTastic Details v2.4 (Environment & Lighting Enhancer)	SDXLFaeTastic2400.safetensors	435 MB	SDXL / Illustrious	AiWise/sdxl-faetastic-details_v24	Civitai #291895
Add-Detail-XL (Sharpness & Micro-Texture Boost)	add-detail-xl.safetensors	218 MB	SDXL / Illustrious	PvDeep/Add-Detail-XL[12]	Civitai #122359
Anime Background Detailer XL	Anibgdet_XL_Illustrious.safetensors	163 MB	Illustrious / SDXL	(Already in your Google Drive)	Civitai Illustrious LoRAs
SDXL Lightning 4-Step LoRA (Turn any SDXL model into 4-step Turbo!)	sdxl_lightning_4step_lora.safetensors	394 MB	Any SDXL / Illustrious	ByteDance/SDXL-Lightning	Civitai #324815
Hyper-SDXL 8-Step LoRA (Faster SDXL with Full CFG)	Hyper-SDXL-8steps-CFG-lora.safetensors	787 MB	Any SDXL / Illustrious	ByteDance/Hyper-SD	Civitai #425667
Qwen-Image-Edit 4-Step Lightning	Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors	810 MB	Qwen-Image-Edit	lightx2v/Qwen-Image-Edit-2511-Lightning	—
Qwen-Edit 3-Image Fusion LoRA	Qwen-Edit-2509-Fusion.safetensors	225 MB	Qwen-Image-Edit	Comfy-Org/Qwen-Image-Edit	—
Qwen-Edit Multiple Camera Angles	Qwen-Edit-2509-Multiple-angles.safetensors	225 MB	Qwen-Image-Edit	Comfy-Org/Qwen-Image-Edit	—
Qwen-Edit Relight LoRA	Qwen-Edit-2509-Relight.safetensors	225 MB	Qwen-Image-Edit	Comfy-Org/Qwen-Image-Edit	—
6️⃣ ControlNet & IP-Adapter Ecosystem (controlnet/, ipadapter/, clip_vision/)
Component	Exact Filename	Size	Purpose	Hugging Face Link (repo_id)	Civitai Link
ControlNet Union SDXL 1.0 ProMax (All-in-One: Depth, Canny, Pose, Lineart, Tile!)	xinsir-controlnet-union-sdxl-1.0-promax.safetensors	2.4 GB	Replaces 10 separate ControlNet models in 1 file!	xinsir/controlnet-union-sdxl-1.0	Civitai #559665
CLIP-ViT-H-14 Image Encoder	CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors	2.4 GB	Required by all SDXL IP-Adapter Plus models	h94/IP-Adapter	—
IP-Adapter Plus SDXL (ViT-H) (Style & Composition Transfer)	ip-adapter-plus_sdxl_vit-h.safetensors	808 MB	High-strength style & character reference	h94/IP-Adapter	Civitai #207619
IP-Adapter Plus Face SDXL (ViT-H) (Character Face Consistency)	ip-adapter-plus-face_sdxl_vit-h.safetensors	808 MB	Locks character face identity across shots	h94/IP-Adapter	Civitai #207619
NoobAI / Illustrious IP-Adapter (Anime-Specific IP-Adapter)	noobIPAMark1_mark1.safetensors	848 MB	Dedicated IP-Adapter trained specifically for Illustrious/NoobAI	Laxhar/noob-ipa	Civitai #1010989
7️⃣ Upscalers & Detailer Detectors (upscale_models/, ultralytics/, sams/)
Component	Exact Filename	Size	Purpose	Hugging Face Link (repo_id)
4x-UltraSharp (Best Realistic Upscaler)	4x-UltraSharp.pth	64 MB	Photorealistic skin, fabric, and architecture upscaling	Kim2091/UltraSharp
4x-AnimeSharp (Best Anime / 2D Upscaler)	4x-AnimeSharp.pth	64 MB	Crisp anime lineart & cel-shaded upscaling	Kim2091/AnimeSharp
4x_NMKD-Siax_200k (Natural Texture Upscaler)	4x_NMKD-Siax_200k.pth	64 MB	Great all-rounder without over-sharpening	uwg/upscaler
YOLOv8m Face Detector (For FaceDetailer)	bbox/face_yolov8m.pt (and face_yolov8n.pt)	50 MB	Detects realistic & anime faces for FaceDetailer	Bingsu/adetailer
YOLOv8n Hand Detector (For Hand Detailer!)	bbox/hand_yolov8n.pt	6 MB	Detects hands so DetailerForEach can fix fingers!	Bingsu/adetailer
YOLOv8m Person Segmentation (For Background Detailer)	segm/person_yolov8m-seg.pt	52 MB	Segments characters so InvertMask selects only the background	Bingsu/adetailer
Segment Anything (SAM ViT-B)	sam_vit_b_01ec64.pth	358 MB	Pixel-accurate mask refinement inside FaceDetailer	scenario-labs/sam_vit
📋 Ready-to-Paste Python Tuples for Cell 3 (NEW_MODELS_TO_DOWNLOAD)
Whenever you want to add any of the extra models above to your Google Drive and Kaggle setup, just uncomment the line you want inside Cell 3:
Python
NEW_MODELS_TO_DOWNLOAD = [
    # --- Photorealistic SDXL Checkpoints ---
    # ("checkpoints/sdxl/Juggernaut-XL_v9.safetensors", "RunDiffusion/Juggernaut-XL-v9", "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"),
    # ("checkpoints/sdxl/RealVisXL_V5.0_fp16.safetensors", "SG161222/RealVisXL_V5.0", "RealVisXL_V5.0_fp16.safetensors"),
    # ("checkpoints/sdxl/RealVisXL_V5.0_Lightning_fp16.safetensors", "SG161222/RealVisXL_V5.0_Lightning", "RealVisXL_V5.0_Lightning_fp16.safetensors"),

    # --- Flux.1 GGUF (Runs on 16GB T4!) ---
    # ("unet/flux/flux1-dev-Q4_K_S.gguf", "city96/FLUX.1-dev-gguf", "flux1-dev-Q4_K_S.gguf"),
    # ("text_encoders/t5xxl_fp8_e4m3fn.safetensors", "comfyanonymous/flux_text_encoders", "t5xxl_fp8_e4m3fn.safetensors"),
    # ("text_encoders/clip_l.safetensors", "comfyanonymous/flux_text_encoders", "clip_l.safetensors"),
    # ("vae/ae.safetensors", "black-forest-labs/FLUX.1-schnell", "ae.safetensors"),

    # --- Extra Detailers, Speed LoRAs & Upscalers ---
    # ("ultralytics/bbox/hand_yolov8n.pt", "Bingsu/adetailer", "hand_yolov8n.pt"),
    # ("loras/sdxl/add-detail-xl.safetensors", "PvDeep/Add-Detail-XL", "add-detail-xl.safetensors"),
    # ("loras/sdxl/sdxl_lightning_4step_lora.safetensors", "ByteDance/SDXL-Lightning", "sdxl_lightning_4step_lora.safetensors"),
    # ("upscale_models/4x_NMKD-Siax_200k.pth", "uwg/upscaler", "ESRGAN/4x_NMKD-Siax_200k.pth"),
]