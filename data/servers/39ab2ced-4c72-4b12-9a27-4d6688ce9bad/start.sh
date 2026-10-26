#!/usr/bin/env bash
set -euo pipefail
PORT="${SERVER_PORT:-8080}"
echo "generic-shell starting on ${PORT}"
python3 - <<PY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os, json
PORT = int(os.environ.get("SERVER_PORT", "8080"))
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b = json.dumps({"panel":"kestrel","egg":"shell","port":PORT}).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def log_message(self, *args):
        print(*args, flush=True)
print("listening", PORT, flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
PY
