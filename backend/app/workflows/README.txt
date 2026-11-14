GCGPU ComfyUI Workflow Pack — API Format

These JSON files are ComfyUI API prompt graphs extracted from Final_GCGPU_Single_T4_Enhanced.ipynb.
They are intended for POST /prompt or ComfyUI API clients, not drag-and-drop onto the canvas.

For canvas-native (LiteGraph/UI) workflow JSON files:
1. Run the updated Google Colab notebook through the ComfyUI startup cell.
2. The notebook queries the running ComfyUI /object_info endpoint and converts available API graphs into UI workflow files.
3. Generated UI files are saved under:
   /content/ComfyUI/user/default/workflows/
4. Load them from the ComfyUI Workflows menu.

DreamShaper Turbo run order for one Tesla T4:
- 12_DS_TURBO_BASE_IPADAPTER.json OR 13_DS_TURBO_BASE_CONTROLNET.json (choose one base method)
- 14_DS_TURBO_BACKGROUND_DETAIL.json
- 15_DS_TURBO_UPSCALE_FACE.json

The stage handoff images (ds_stage1_base.png, ds_original_base.png, ds_stage2_background.png) must be in ComfyUI/input with those exact names. Checkpoint, LoRA, VAE, ControlNet, IP-Adapter, detector, SAM, and upscaler files must also exist in their corresponding model folders.

This package contains workflow graphs only; it does not include model weights or custom nodes.
