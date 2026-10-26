from __future__ import annotations

NESTS = [
    {"id": 1, "name": "Python", "description": "CPython runtimes, FastAPI, bots, workers."},
    {"id": 2, "name": "Node.js", "description": "Node LTS processes and HTTP services."},
    {"id": 3, "name": "Java", "description": "JVM applications and game servers."},
    {"id": 4, "name": "Docker", "description": "OCI images executed through the local engine."},
    {"id": 5, "name": "Generic", "description": "Shell, static HTTP, and custom startup."},
]

_PYTHON_MAIN = '''\
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
                "panel": "vitestl",
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
'''

_FASTAPI_MAIN = '''\
from fastapi import FastAPI
from datetime import datetime, timezone
import os, platform, socket

app = FastAPI(title=os.environ.get("SERVER_NAME", "vitestl-api"), version="1.0.0")

@app.get("/")
def root():
    return {
        "service": os.environ.get("SERVER_NAME", "vitestl-api"),
        "runtime": "python-fastapi",
        "host": socket.gethostname(),
        "python": platform.python_version(),
        "time": datetime.now(timezone.utc).isoformat(),
        "port": int(os.environ.get("SERVER_PORT", "8000")),
    }

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/env")
def env():
    keys = ["SERVER_NAME", "SERVER_PORT", "SERVER_MEMORY", "SERVER_IP", "PY_MODULE"]
    return {k: os.environ.get(k) for k in keys}
'''

_NODE_MAIN = '''\
const http = require("http");
const os = require("os");
const port = Number(process.env.SERVER_PORT || 8080);
const started = Date.now();

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url === "/" || url === "/health") {
    res.end(JSON.stringify({
      panel: "vitestl",
      egg: "nodejs",
      status: "ok",
      port,
      uptime: Math.round((Date.now() - started) / 1000),
      node: process.version,
      host: os.hostname(),
      pid: process.pid
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log("nodejs listening on 0.0.0.0:" + port);
});
'''

_STATIC_INDEX = '''\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lantern Status</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font: 14px/1.5 "IBM Plex Sans", ui-sans-serif, system-ui; background:#0f1419; color:#e7ecf1; }
    main { max-width: 720px; margin: 10vh auto; padding: 0 24px; }
    h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
    p { color:#9aa5b1; margin: 0 0 24px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card { background:#151b22; border:1px solid #2c3440; border-radius:4px; padding:14px 16px; }
    .k { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#6d7885; }
    .v { margin-top:6px; font-family: ui-monospace, monospace; color:#e7ecf1; }
    .ok { color:#3fb950; }
  </style>
</head>
<body>
  <main>
    <h1>Lantern</h1>
    <p>Static origin served by VITESTERTL. Replace this file from the file manager.</p>
    <div class="grid">
      <div class="card"><div class="k">Status</div><div class="v ok">operational</div></div>
      <div class="card"><div class="k">Runtime</div><div class="v">python http.server</div></div>
      <div class="card"><div class="k">Region</div><div class="v">node-01</div></div>
      <div class="card"><div class="k">Panel</div><div class="v">vitestl 1.7.0</div></div>
    </div>
  </main>
</body>
</html>
'''

_JAVA_MAIN = '''\
public class Main {
    public static void main(String[] args) throws Exception {
        int port = 8080;
        try { port = Integer.parseInt(System.getenv().getOrDefault("SERVER_PORT", "8080")); }
        catch (Exception ignored) {}
        java.net.ServerSocket ss = new java.net.ServerSocket(port);
        System.out.println("java listening on 0.0.0.0:" + port);
        byte[] body = "{\\"panel\\":\\"vitestl\\",\\"egg\\":\\"java\\"}".getBytes();
        while (true) {
            java.net.Socket s = ss.accept();
            java.io.OutputStream out = s.getOutputStream();
            String hdr = "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: "
                + body.length + "\\r\\nConnection: close\\r\\n\\r\\n";
            out.write(hdr.getBytes());
            out.write(body);
            out.flush();
            s.close();
        }
    }
}
'''

_DOCKER_README = """\
# Docker egg
This server is configured to launch an OCI image through the node engine.
If Docker is not installed on the node, Wings falls back to process runtime
using the files in this directory.

Image: {{IMAGE}}
Startup: {{STARTUP}}
"""

_SHELL_RUN = '''\
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
        b = json.dumps({"panel":"vitestl","egg":"shell","port":PORT}).encode()
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
'''

EGGS = [
    {
        "id": 1,
        "nest_id": 1,
        "name": "Python Generic",
        "description": "CPython process. Binds SERVER_PORT and answers JSON on /.",
        "docker_image": "python:3.11-slim",
        "startup": "python3 {{PY_FILE}}",
        "stop_command": "^C",
        "runtime": "process",
        "files": {
            "main.py": _PYTHON_MAIN,
            "requirements.txt": "# add packages here\n",
        },
        "variables": [
            {"env": "PY_FILE", "name": "Startup file", "default": "main.py", "rules": "required|string"},
        ],
    },
    {
        "id": 2,
        "nest_id": 1,
        "name": "Python FastAPI",
        "description": "Uvicorn worker serving a FastAPI application.",
        "docker_image": "python:3.11-slim",
        "startup": "python3 -m uvicorn {{PY_MODULE}}:app --host 0.0.0.0 --port {{SERVER_PORT}}",
        "stop_command": "^C",
        "runtime": "process",
        "files": {
            "main.py": _FASTAPI_MAIN,
            "requirements.txt": "fastapi\nuvicorn\n",
        },
        "variables": [
            {"env": "PY_MODULE", "name": "ASGI module", "default": "main", "rules": "required|string"},
        ],
    },
    {
        "id": 3,
        "nest_id": 2,
        "name": "Node.js Generic",
        "description": "Node HTTP process. Uses SERVER_PORT from the allocation.",
        "docker_image": "node:20-alpine",
        "startup": "node {{JS_FILE}}",
        "stop_command": "^C",
        "runtime": "process",
        "files": {
            "index.js": _NODE_MAIN,
            "package.json": '{\n  "name": "vitestl-node",\n  "version": "1.0.0",\n  "main": "index.js"\n}\n',
        },
        "variables": [
            {"env": "JS_FILE", "name": "Startup file", "default": "index.js", "rules": "required|string"},
        ],
    },
    {
        "id": 4,
        "nest_id": 3,
        "name": "Java Generic",
        "description": "Compiles Main.java and runs the JVM class.",
        "docker_image": "eclipse-temurin:21-jre",
        "startup": "sh -c 'javac Main.java && java Main'",
        "stop_command": "^C",
        "runtime": "process",
        "files": {"Main.java": _JAVA_MAIN},
        "variables": [],
    },
    {
        "id": 5,
        "nest_id": 4,
        "name": "Docker Image",
        "description": "Runs an OCI image when Docker is present on the node.",
        "docker_image": "python:3.11-slim",
        "startup": "python3 -m http.server {{SERVER_PORT}}",
        "stop_command": "^C",
        "runtime": "docker",
        "files": {
            "README.md": _DOCKER_README,
            "main.py": _PYTHON_MAIN,
        },
        "variables": [
            {"env": "IMAGE", "name": "Image", "default": "python:3.11-slim", "rules": "required|string"},
        ],
    },
    {
        "id": 6,
        "nest_id": 5,
        "name": "Static HTTP",
        "description": "Serves the working directory over HTTP.",
        "docker_image": "python:3.11-slim",
        "startup": "python3 -m http.server {{SERVER_PORT}} --bind 0.0.0.0",
        "stop_command": "^C",
        "runtime": "process",
        "files": {"index.html": _STATIC_INDEX},
        "variables": [],
    },
    {
        "id": 7,
        "nest_id": 5,
        "name": "Generic Shell",
        "description": "Executes a bash entrypoint with the full allocation environment.",
        "docker_image": "debian:bookworm-slim",
        "startup": "bash {{START_FILE}}",
        "stop_command": "^C",
        "runtime": "process",
        "files": {"start.sh": _SHELL_RUN},
        "variables": [
            {"env": "START_FILE", "name": "Entrypoint", "default": "start.sh", "rules": "required|string"},
        ],
    },
]


def egg_by_id(egg_id: int) -> dict | None:
    for egg in EGGS:
        if egg["id"] == egg_id:
            return egg
    return None
