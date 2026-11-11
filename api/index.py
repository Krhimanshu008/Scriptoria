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
