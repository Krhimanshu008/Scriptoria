import os
import sys
import traceback
from pathlib import Path

# Add project root directory to Python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI(title="Scriptoria Serverless Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Diagnostic test endpoint to verify runtime
@app.get("/api/test")
def test_runtime():
    return {
        "status": "online",
        "python_version": sys.version,
        "cwd": os.getcwd(),
        "root_dir": str(ROOT_DIR),
        "files_in_root": os.listdir(str(ROOT_DIR)) if ROOT_DIR.exists() else []
    }

# Diagnostic endpoint to test importing server and vm_manager
@app.get("/api/debug-import")
def test_import():
    results = {}
    for mod in ["config", "log_broker", "comfy_client", "notebook_generator", "vm_manager", "server"]:
        try:
            __import__(mod)
            results[mod] = "OK"
        except Exception:
            results[mod] = traceback.format_exc()
    return results

@app.get("/api/env-check")
def check_env():
    from config import settings
    return {
        "KAGGLE_ACC1_CONFIGURED": bool(settings.KAGGLE_ACC1_KEY),
        "KAGGLE_ACC2_CONFIGURED": bool(settings.KAGGLE_ACC2_KEY),
        "CF_TOKEN_KAGGLE_CONFIGURED": bool(settings.CF_TOKEN_KAGGLE),
        "CF_TOKEN_GCGPU_CONFIGURED": bool(settings.CF_TOKEN_GCGPU),
        "GDRIVE_CONFIGURED": bool(settings.GDRIVE_REFRESH_TOKEN),
    }

@app.get("/api/debug-ping")
async def debug_ping():
    import httpx, time
    from config import settings
    res = {}
    async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
        for t, cfg in settings.ENDPOINTS.items():
            url = f"{cfg['url']}/system_stats"
            t0 = time.time()
            try:
                r = await client.get(url)
                res[t] = {
                    "status_code": r.status_code,
                    "elapsed_ms": int((time.time() - t0) * 1000),
                    "body_snippet": r.text[:120]
                }
            except Exception as e:
                res[t] = {
                    "error": str(e),
                    "elapsed_ms": int((time.time() - t0) * 1000)
                }
    return res

@app.get("/api/status")
async def get_status():
    try:
        from vm_manager import vm_manager
        await vm_manager.check_all_health()
        return await vm_manager.get_all_status()
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "traceback": traceback.format_exc()}
        )

# Proxy other /api routes into server.py if needed
try:
    from server import app as server_app
    # Mount server routes onto this app
    for route in server_app.routes:
        if route.path not in [r.path for r in app.routes]:
            app.routes.append(route)
except Exception as ex:
    print(f"Warning: could not mount server routes at startup: {ex}")

handler = app
