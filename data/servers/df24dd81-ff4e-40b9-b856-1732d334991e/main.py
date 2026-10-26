from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, platform, time

STARTED = time.time()
PORT = int(os.environ.get("SERVER_PORT", "8080"))

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, ctype="application/json"):
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def do_GET(self):
        if self.path in ("/", "/health"):
            self._send(200, {
                "panel": "kestrel",
                "egg": "python-generic",
                "status": "ok",
                "port": PORT,
                "uptime": round(time.time() - STARTED, 1),
                "python": platform.python_version(),
                "host": platform.node(),
            })
            return
        self._send(404, {"error": "not found"})

if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("python-generic listening on 0.0.0.0:%s" % PORT, flush=True)
    httpd.serve_forever()
