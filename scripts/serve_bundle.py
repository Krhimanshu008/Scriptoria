import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs" / "ai_studio"
os.chdir(DOCS_DIR)

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

if __name__ == "__main__":
    print(f"Serving {DOCS_DIR} on http://127.0.0.1:8089")
    server = HTTPServer(("127.0.0.1", 8089), CORSRequestHandler)
    server.serve_forever()
