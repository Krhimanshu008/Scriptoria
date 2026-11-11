import os
import sys
import traceback
from pathlib import Path

# Add project root directory to Python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

try:
    from server import app
    handler = app
except Exception:
    import traceback
    from fastapi import FastAPI
    from fastapi.responses import HTMLResponse

    app = FastAPI(title="Scriptoria Error Diagnostic")
    handler = app
    err_tb = traceback.format_exc()

    @app.get("/{path:path}", response_class=HTMLResponse)
    async def debug_error(path: str = ""):
        return HTMLResponse(
            content=f"""<!DOCTYPE html>
<html>
<head>
    <title>Scriptoria - Serverless Startup Error</title>
    <style>
        body {{ background: #0f172a; color: #f87171; font-family: monospace; padding: 2rem; }}
        pre {{ background: #1e293b; color: #f1f5f9; padding: 1.5rem; border-radius: 8px; overflow: auto; line-height: 1.4; border: 1px solid #334155; }}
        h2 {{ color: #ef4444; }}
    </style>
</head>
<body>
    <h2>⚠️ Scriptoria Serverless Initialization Diagnostic</h2>
    <p>The application encountered an error during import or cold-start initialization:</p>
    <pre>{err_tb}</pre>
</body>
</html>""",
            status_code=500
        )
