import httpx

nodes = [
    ("Kaggle GPU 0", "https://gpu0.krhimanshu.in"),
    ("Kaggle GPU 1", "https://gpu1.krhimanshu.in"),
    ("Colab GCGPU", "https://gcgpu.krhimanshu.in"),
]

for label, url in nodes:
    try:
        r = httpx.get(f"{url}/system_stats", timeout=5.0)
        if r.status_code == 200:
            devs = r.json().get("devices", [])
            vram = devs[0].get("vram_free", 0) // (1024*1024) if devs else 0
            print(f"[ONLINE] {label} ({url}) -> Status: {r.status_code}, Free VRAM: {vram} MB")
        else:
            print(f"[OFFLINE] {label} ({url}) -> Status: {r.status_code}")
    except Exception as e:
        print(f"[ERROR] {label} ({url}) -> {e}")

