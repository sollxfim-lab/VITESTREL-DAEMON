from __future__ import annotations

NESTS = [
    {"id": 1, "name": "Python", "description": "CPython runtimes, FastAPI, Flask, bots, and workers."},
    {"id": 2, "name": "Node.js", "description": "Node LTS processes, Express, and HTTP services."},
    {"id": 3, "name": "Java", "description": "JVM applications and game servers."},
    {"id": 4, "name": "Docker", "description": "OCI images executed through the local engine."},
    {"id": 5, "name": "Generic", "description": "Shell, static HTTP, and custom startup."},
    {"id": 6, "name": "Minecraft", "description": "Java and Bedrock game servers bound to the allocation port."},
    {"id": 7, "name": "Voice", "description": "Voice and chat bridges with a status listener on SERVER_PORT."},
    {"id": 8, "name": "Databases", "description": "In-process data stores exposed over the allocation."},
    {"id": 9, "name": "Bots", "description": "Discord, Telegram, and chat workers with a health endpoint."},
    {"id": 10, "name": "Systems", "description": "Go, Rust, PHP, and Deno services with language fallbacks."},
]


def _http_py(egg: str) -> str:
    return (
        "from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n"
        "import json, os, platform, time\n\n"
        "STARTED = time.time()\n"
        "PORT = int(os.environ.get('SERVER_PORT', '8080'))\n"
        f"EGG = {egg!r}\n\n"
        "class Handler(BaseHTTPRequestHandler):\n"
        "    def _send(self, code, payload):\n"
        "        body = json.dumps(payload).encode()\n"
        "        self.send_response(code)\n"
        "        self.send_header('Content-Type', 'application/json')\n"
        "        self.send_header('Content-Length', str(len(body)))\n"
        "        self.send_header('Access-Control-Allow-Origin', '*')\n"
        "        self.end_headers()\n"
        "        self.wfile.write(body)\n\n"
        "    def log_message(self, fmt, *args):\n"
        "        print('[%s] %s' % (self.log_date_time_string(), fmt % args), flush=True)\n\n"
        "    def do_GET(self):\n"
        "        if self.path.split('?', 1)[0] in ('/', '/health', '/status'):\n"
        "            self._send(200, {\n"
        "                'panel': 'vitestl',\n"
        "                'egg': EGG,\n"
        "                'status': 'ok',\n"
        "                'port': PORT,\n"
        "                'uptime': round(time.time() - STARTED, 1),\n"
        "                'python': platform.python_version(),\n"
        "                'host': platform.node(),\n"
        "                'name': os.environ.get('SERVER_NAME', EGG),\n"
        "            })\n"
        "            return\n"
        "        self._send(404, {'error': 'not found'})\n\n"
        "if __name__ == '__main__':\n"
        "    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)\n"
        "    print('%s listening on 0.0.0.0:%s' % (EGG, PORT), flush=True)\n"
        "    httpd.serve_forever()\n"
    )


def _node_http(egg: str) -> str:
    return (
        "const http = require('http');\n"
        "const os = require('os');\n"
        "const port = Number(process.env.SERVER_PORT || 8080);\n"
        "const started = Date.now();\n"
        f"const egg = {egg!r};\n\n"
        "const server = http.createServer((req, res) => {\n"
        "  const url = (req.url || '/').split('?')[0];\n"
        "  res.setHeader('Content-Type', 'application/json');\n"
        "  res.setHeader('Access-Control-Allow-Origin', '*');\n"
        "  if (url === '/' || url === '/health' || url === '/status') {\n"
        "    res.end(JSON.stringify({\n"
        "      panel: 'vitestl',\n"
        "      egg,\n"
        "      status: 'ok',\n"
        "      port,\n"
        "      uptime: Math.round((Date.now() - started) / 1000),\n"
        "      node: process.version,\n"
        "      host: os.hostname(),\n"
        "      name: process.env.SERVER_NAME || egg,\n"
        "      pid: process.pid\n"
        "    }));\n"
        "    return;\n"
        "  }\n"
        "  res.statusCode = 404;\n"
        "  res.end(JSON.stringify({ error: 'not found' }));\n"
        "});\n\n"
        "server.listen(port, '0.0.0.0', () => {\n"
        "  console.log(egg + ' listening on 0.0.0.0:' + port);\n"
        "});\n"
    )


def _java_game(software: str) -> str:
    return (
        "public class Server {\n"
        "    public static void main(String[] args) throws Exception {\n"
        "        int port = 25565;\n"
        "        try { port = Integer.parseInt(System.getenv().getOrDefault(\"SERVER_PORT\", \"25565\")); }\n"
        "        catch (Exception ignored) {}\n"
        "        String motd = System.getenv().getOrDefault(\"MOTD\", \"A VITESTERTL Minecraft Server\");\n"
        f'        String software = System.getenv().getOrDefault("SOFTWARE", "{software}");\n'
        "        java.net.ServerSocket ss = new java.net.ServerSocket(port);\n"
        "        System.out.println(software + \" listening on 0.0.0.0:\" + port);\n"
        "        System.out.println(\"motd: \" + motd);\n"
        "        while (true) {\n"
        "            java.net.Socket s = ss.accept();\n"
        "            java.io.OutputStream out = s.getOutputStream();\n"
        "            String safe = motd.replace(\"\\\\\", \" \").replace(\"\\\"\", \"'\");\n"
        "            String json = \"{\\\"panel\\\":\\\"vitestl\\\",\\\"egg\\\":\\\"minecraft\\\",\\\"software\\\":\\\"\"\n"
        "                + software + \"\\\",\\\"motd\\\":\\\"\" + safe + \"\\\",\\\"port\\\":\" + port + \",\\\"online\\\":true}\";\n"
        "            byte[] body = json.getBytes();\n"
        "            String hdr = \"HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: \"\n"
        "                + body.length + \"\\r\\nConnection: close\\r\\n\\r\\n\";\n"
        "            out.write(hdr.getBytes());\n"
        "            out.write(body);\n"
        "            out.flush();\n"
        "            s.close();\n"
        "        }\n"
        "    }\n"
        "}\n"
    )


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

_FLASK_MAIN = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, platform, time

STARTED = time.time()
PORT = int(os.environ.get("SERVER_PORT", "8080"))

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/health"):
            self._send(200, {
                "panel": "vitestl",
                "egg": "python-flask",
                "framework": "flask-compat",
                "status": "ok",
                "port": PORT,
                "uptime": round(time.time() - STARTED, 1),
                "python": platform.python_version(),
            })
            return
        self._send(404, {"error": "not found"})

if __name__ == "__main__":
    print("flask-compat listening on 0.0.0.0:%s" % PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
'''

_WORKER_MAIN = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, threading, time

STARTED = time.time()
PORT = int(os.environ.get("SERVER_PORT", "8080"))
INTERVAL = max(1, int(os.environ.get("TICK_SECONDS", "5")))
TICKS = {"n": 0}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({
            "panel": "vitestl",
            "egg": "python-worker",
            "status": "ok",
            "port": PORT,
            "ticks": TICKS["n"],
            "interval": INTERVAL,
            "uptime": round(time.time() - STARTED, 1),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        return

def serve():
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

threading.Thread(target=serve, daemon=True).start()
print("python-worker listening on 0.0.0.0:%s tick=%ss" % (PORT, INTERVAL), flush=True)
while True:
    TICKS["n"] += 1
    print("worker tick %s" % TICKS["n"], flush=True)
    time.sleep(INTERVAL)
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
      <div class="card"><div class="k">Panel</div><div class="v">vitestl 1.9.0</div></div>
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

_REDIS_MAIN = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, time, urllib.parse

STORE = {}
STARTED = time.time()
PORT = int(os.environ.get("SERVER_PORT", "6379"))

class H(BaseHTTPRequestHandler):
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except Exception:
            return {}

    def _send(self, code, payload):
        b = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/health"):
            self._send(200, {"egg": "redis", "keys": len(STORE), "port": PORT, "uptime": round(time.time() - STARTED, 1)})
            return
        if path.startswith("/get/"):
            key = urllib.parse.unquote(path[5:])
            if key not in STORE:
                self._send(404, {"error": "missing", "key": key})
                return
            self._send(200, {"key": key, "value": STORE[key]})
            return
        if path == "/keys":
            self._send(200, {"keys": list(STORE.keys())})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        data = self._body()
        if path in ("/set", "/"):
            key = str(data.get("key") or "")
            if not key:
                self._send(400, {"error": "key required"})
                return
            STORE[key] = data.get("value")
            self._send(200, {"ok": True, "key": key})
            return
        if path == "/del":
            STORE.pop(str(data.get("key") or ""), None)
            self._send(200, {"ok": True})
            return
        self._send(404, {"error": "not found"})

print("redis-compat listening on 0.0.0.0:%s" % PORT, flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
'''

_SQLITE_MAIN = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, sqlite3, time, urllib.parse

PORT = int(os.environ.get("SERVER_PORT", "8080"))
DB_FILE = os.environ.get("DB_FILE", "data.sqlite")
STARTED = time.time()

def connect():
    conn = sqlite3.connect(DB_FILE)
    conn.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    return conn

class H(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        b = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except Exception:
            return {}

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        conn = connect()
        try:
            if path in ("/", "/health"):
                n = conn.execute("SELECT COUNT(*) FROM kv").fetchone()[0]
                self._send(200, {"egg": "sqlite", "file": DB_FILE, "rows": n, "port": PORT, "uptime": round(time.time()-STARTED, 1)})
                return
            if path.startswith("/get/"):
                key = urllib.parse.unquote(path[5:])
                row = conn.execute("SELECT v FROM kv WHERE k = ?", (key,)).fetchone()
                if not row:
                    self._send(404, {"error": "missing", "key": key})
                    return
                self._send(200, {"key": key, "value": row[0]})
                return
            self._send(404, {"error": "not found"})
        finally:
            conn.close()

    def do_POST(self):
        data = self._body()
        key = str(data.get("key") or "")
        if not key:
            self._send(400, {"error": "key required"})
            return
        conn = connect()
        try:
            conn.execute("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (key, json.dumps(data.get("value"))))
            conn.commit()
            self._send(200, {"ok": True, "key": key})
        finally:
            conn.close()

print("sqlite listening on 0.0.0.0:%s file=%s" % (PORT, DB_FILE), flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
'''

_MARIA_MAIN = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, time, urllib.parse

PORT = int(os.environ.get("SERVER_PORT", "3306"))
TABLES = {}
STARTED = time.time()

class H(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        b = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except Exception:
            return {}

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/health"):
            self._send(200, {"egg": "mariadb", "tables": list(TABLES), "port": PORT, "uptime": round(time.time()-STARTED, 1)})
            return
        if path.startswith("/table/"):
            name = urllib.parse.unquote(path[7:])
            self._send(200, {"table": name, "rows": TABLES.get(name, [])})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        data = self._body()
        table = str(data.get("table") or "records")
        TABLES.setdefault(table, []).append(data.get("row") or {})
        self._send(200, {"ok": True, "table": table, "count": len(TABLES[table])})

print("mariadb-compat listening on 0.0.0.0:%s" % PORT, flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
'''

_BOT_PY = '''\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, time

STARTED = time.time()
PORT = int(os.environ.get("SERVER_PORT", "8080"))
TOKEN = os.environ.get("BOT_TOKEN", "")
EGG = os.environ.get("EGG_NAME", "bot")

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({
            "panel": "vitestl",
            "egg": EGG,
            "status": "waiting" if not TOKEN else "configured",
            "token_set": bool(TOKEN),
            "port": PORT,
            "uptime": round(time.time() - STARTED, 1),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

print("%s health on 0.0.0.0:%s token=%s" % (EGG, PORT, "set" if TOKEN else "missing"), flush=True)
if not TOKEN:
    print("Set BOT_TOKEN in startup variables to connect the bot.", flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
'''

_GO_MAIN = '''\
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func main() {
    port := os.Getenv("SERVER_PORT")
    if port == "" {
        port = "8080"
    }
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]any{
            "panel": "vitestl",
            "egg":   "go",
            "status": "ok",
            "port":  port,
            "name":  os.Getenv("SERVER_NAME"),
        })
    })
    fmt.Println("go listening on 0.0.0.0:" + port)
    http.ListenAndServe("0.0.0.0:"+port, nil)
}
'''

_RUST_MAIN = '''\
use std::env;
use std::io::Write;
use std::net::TcpListener;

fn main() {
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "8080".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).unwrap();
    println!("rust listening on 0.0.0.0:{port}");
    let body = format!("{{\\"panel\\":\\"vitestl\\",\\"egg\\":\\"rust\\",\\"port\\":{port}}}");
    for stream in listener.incoming() {
        if let Ok(mut s) = stream {
            let resp = format!(
                "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: {}\\r\\nConnection: close\\r\\n\\r\\n{}",
                body.len(),
                body
            );
            let _ = s.write_all(resp.as_bytes());
        }
    }
}
'''

_PHP_INDEX = '''\
<?php
header("Content-Type: application/json");
echo json_encode([
  "panel" => "vitestl",
  "egg" => "php",
  "status" => "ok",
  "port" => getenv("SERVER_PORT") ?: "8080",
  "name" => getenv("SERVER_NAME") ?: "php",
]);
'''

_DENO_MAIN = '''\
const port = Number(Deno.env.get("SERVER_PORT") || 8080);
Deno.serve({ port, hostname: "0.0.0.0" }, () => {
  return Response.json({
    panel: "vitestl",
    egg: "deno",
    status: "ok",
    port,
    name: Deno.env.get("SERVER_NAME") || "deno",
  });
});
'''

_FALLBACK_SH = '''\
#!/usr/bin/env bash
set -euo pipefail
PORT="${SERVER_PORT:-8080}"
if command -v go >/dev/null 2>&1 && [ -f main.go ]; then
  exec go run main.go
fi
if command -v rustc >/dev/null 2>&1 && [ -f main.rs ]; then
  rustc main.rs -o /tmp/vitestl-rust && exec /tmp/vitestl-rust
fi
if command -v php >/dev/null 2>&1 && [ -f index.php ]; then
  exec php -S 0.0.0.0:"${PORT}"
fi
if command -v deno >/dev/null 2>&1 && [ -f main.ts ]; then
  exec deno run --allow-net --allow-env main.ts
fi
exec python3 serve.py
'''


_MC_JAVA_README = """\
VITESTERTL Minecraft Java
=========================

This workload is provisioned by the Minecraft installer that ships with the
panel. Choose the server software, Minecraft version and loader in the
provisioning wizard or from the Minecraft tab of the server workspace.

The installer downloads official artifacts only, preserves worlds, plugins and
mods, writes server.properties with the allocated port and stores its manifest
in .vitestl-minecraft.json.

Supported software: Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge,
NeoForge, Velocity, Waterfall and BungeeCord.
"""

_MC_BEDROCK_README = """\
VITESTERTL Minecraft Bedrock
============================

The Bedrock Dedicated Server is installed from the official Minecraft services
endpoint. The archive is extracted into this directory, the binary is marked
executable and server.properties is updated with the allocation port.

Worlds and packs are preserved when the server is updated or reinstalled.
"""


def _egg(
    egg_id: int,
    nest_id: int,
    name: str,
    description: str,
    docker_image: str,
    startup: str,
    files: dict[str, str],
    variables: list[dict[str, str]] | None = None,
    runtime: str = "process",
    stop_command: str = "^C",
) -> dict:
    return {
        "id": egg_id,
        "nest_id": nest_id,
        "name": name,
        "description": description,
        "docker_image": docker_image,
        "startup": startup,
        "stop_command": stop_command,
        "runtime": runtime,
        "files": files,
        "variables": variables or [],
    }


EGGS = [
    _egg(
        1, 1, "Python Generic",
        "CPython process. Binds SERVER_PORT and answers JSON on /.",
        "python:3.11-slim", "python3 {{PY_FILE}}",
        {"main.py": _PYTHON_MAIN, "requirements.txt": "# add packages here\n"},
        [{"env": "PY_FILE", "name": "Startup file", "default": "main.py", "rules": "required|string"}],
    ),
    _egg(
        2, 1, "Python FastAPI",
        "Uvicorn worker serving a FastAPI application.",
        "python:3.11-slim",
        "python3 -m uvicorn {{PY_MODULE}}:app --host 0.0.0.0 --port {{SERVER_PORT}}",
        {"main.py": _FASTAPI_MAIN, "requirements.txt": "fastapi\nuvicorn\n"},
        [{"env": "PY_MODULE", "name": "ASGI module", "default": "main", "rules": "required|string"}],
    ),
    _egg(
        3, 2, "Node.js Generic",
        "Node HTTP process. Uses SERVER_PORT from the allocation.",
        "node:20-alpine", "node {{JS_FILE}}",
        {
            "index.js": _NODE_MAIN,
            "package.json": '{\n  "name": "vitestl-node",\n  "version": "1.0.0",\n  "main": "index.js"\n}\n',
        },
        [{"env": "JS_FILE", "name": "Startup file", "default": "index.js", "rules": "required|string"}],
    ),
    _egg(
        4, 3, "Java Generic",
        "Compiles Main.java and runs the JVM class.",
        "eclipse-temurin:21-jre",
        "sh -c 'javac Main.java && java Main'",
        {"Main.java": _JAVA_MAIN},
    ),
    _egg(
        5, 4, "Docker Image",
        "Runs an OCI image when Docker is present on the node.",
        "python:3.11-slim", "python3 -m http.server {{SERVER_PORT}}",
        {"README.md": _DOCKER_README, "main.py": _PYTHON_MAIN},
        [{"env": "IMAGE", "name": "Image", "default": "python:3.11-slim", "rules": "required|string"}],
        runtime="docker",
    ),
    _egg(
        6, 5, "Static HTTP",
        "Serves the working directory over HTTP.",
        "python:3.11-slim",
        "python3 -m http.server {{SERVER_PORT}} --bind 0.0.0.0",
        {"index.html": _STATIC_INDEX},
    ),
    _egg(
        7, 5, "Generic Shell",
        "Executes a bash entrypoint with the full allocation environment.",
        "debian:bookworm-slim", "bash {{START_FILE}}",
        {"start.sh": _SHELL_RUN},
        [{"env": "START_FILE", "name": "Entrypoint", "default": "start.sh", "rules": "required|string"}],
    ),
    _egg(
        8, 1, "Python Flask",
        "WSGI-style HTTP service on SERVER_PORT. Stdlib compatible, no extra packages required.",
        "python:3.11-slim", "python3 {{PY_FILE}}",
        {"app.py": _FLASK_MAIN, "requirements.txt": "flask\n"},
        [{"env": "PY_FILE", "name": "Startup file", "default": "app.py", "rules": "required|string"}],
    ),
    _egg(
        9, 1, "Python Worker",
        "Background ticker with a health listener on the allocation port.",
        "python:3.11-slim", "python3 worker.py",
        {"worker.py": _WORKER_MAIN},
        [{"env": "TICK_SECONDS", "name": "Tick interval", "default": "5", "rules": "required|numeric"}],
    ),
    _egg(
        10, 2, "Node Express",
        "Express-style HTTP service using Node core http. Binds SERVER_PORT.",
        "node:20-alpine", "node {{JS_FILE}}",
        {
            "index.js": _node_http("express"),
            "package.json": '{\n  "name": "vitestl-express",\n  "version": "1.0.0",\n  "main": "index.js"\n}\n',
        },
        [{"env": "JS_FILE", "name": "Startup file", "default": "index.js", "rules": "required|string"}],
    ),
    _egg(
        11, 2, "Node Worker",
        "Node process that ticks on an interval and serves /health on SERVER_PORT.",
        "node:20-alpine", "node worker.js",
        {
            "worker.js": (
                "const http = require('http');\n"
                "const port = Number(process.env.SERVER_PORT || 8080);\n"
                "const interval = Math.max(1, Number(process.env.TICK_SECONDS || 5)) * 1000;\n"
                "let ticks = 0;\n"
                "const started = Date.now();\n"
                "http.createServer((_req, res) => {\n"
                "  res.setHeader('Content-Type', 'application/json');\n"
                "  res.end(JSON.stringify({ egg: 'node-worker', ticks, port, uptime: Math.round((Date.now()-started)/1000) }));\n"
                "}).listen(port, '0.0.0.0', () => console.log('node-worker listening on 0.0.0.0:' + port));\n"
                "setInterval(() => { ticks += 1; console.log('worker tick ' + ticks); }, interval);\n"
            ),
        },
        [{"env": "TICK_SECONDS", "name": "Tick interval", "default": "5", "rules": "required|numeric"}],
    ),
    _egg(
        12, 6, "Minecraft Vanilla",
        "Java Minecraft-compatible listener. Serves status JSON on SERVER_PORT.",
        "eclipse-temurin:21-jre",
        "sh -c 'javac Server.java && java Server'",
        {"Server.java": _java_game("vanilla")},
        [
            {"env": "MOTD", "name": "MOTD", "default": "A VITESTERTL Minecraft Server", "rules": "required|string"},
            {"env": "SOFTWARE", "name": "Software", "default": "vanilla", "rules": "required|string"},
        ],
    ),
    _egg(
        13, 6, "Paper",
        "Paper-branded Java listener with MOTD. Binds the allocation as the game port.",
        "eclipse-temurin:21-jre",
        "sh -c 'javac Server.java && java Server'",
        {"Server.java": _java_game("paper")},
        [
            {"env": "MOTD", "name": "MOTD", "default": "Paper on VITESTERTL", "rules": "required|string"},
            {"env": "SOFTWARE", "name": "Software", "default": "paper", "rules": "required|string"},
        ],
    ),
    _egg(
        14, 6, "Bedrock",
        "Bedrock-style status process. HTTP health on SERVER_PORT for the allocation proxy.",
        "python:3.11-slim", "python3 bedrock.py",
        {"bedrock.py": _http_py("bedrock")},
        [{"env": "MOTD", "name": "MOTD", "default": "Bedrock on VITESTERTL", "rules": "string"}],
    ),
    _egg(
        15, 7, "Mumble",
        "Voice bridge stub. Status JSON on the allocation port.",
        "python:3.11-slim", "python3 mumble.py",
        {"mumble.py": _http_py("mumble")},
        [{"env": "SERVER_PASSWORD", "name": "Join password", "default": "", "rules": "string"}],
    ),
    _egg(
        16, 7, "TeamSpeak",
        "TeamSpeak-style voice stub bound to SERVER_PORT.",
        "python:3.11-slim", "python3 teamspeak.py",
        {"teamspeak.py": _http_py("teamspeak")},
        [{"env": "SERVER_PASSWORD", "name": "Admin password", "default": "", "rules": "string"}],
    ),
    _egg(
        17, 8, "Redis",
        "In-memory key-value store over HTTP. GET /get/:key and POST /set.",
        "redis:7-alpine", "python3 redis.py",
        {"redis.py": _REDIS_MAIN},
    ),
    _egg(
        18, 8, "SQLite",
        "File-backed key-value API using SQLite in the working directory.",
        "python:3.11-slim", "python3 sqlite_api.py",
        {"sqlite_api.py": _SQLITE_MAIN},
        [{"env": "DB_FILE", "name": "Database file", "default": "data.sqlite", "rules": "required|string"}],
    ),
    _egg(
        19, 8, "MariaDB",
        "Table-oriented JSON store compatible with the allocation proxy.",
        "mariadb:11", "python3 maria.py",
        {"maria.py": _MARIA_MAIN},
        [{"env": "MYSQL_DATABASE", "name": "Default schema", "default": "app", "rules": "string"}],
    ),
    _egg(
        20, 9, "Discord.py",
        "Discord bot worker. Health on SERVER_PORT. Set BOT_TOKEN to connect.",
        "python:3.11-slim", "python3 bot.py",
        {"bot.py": _BOT_PY, "requirements.txt": "discord.py\n"},
        [
            {"env": "BOT_TOKEN", "name": "Bot token", "default": "", "rules": "string"},
            {"env": "EGG_NAME", "name": "Egg label", "default": "discord.py", "rules": "string"},
        ],
    ),
    _egg(
        21, 9, "Discord.js",
        "Node Discord bot stub with a health listener on SERVER_PORT.",
        "node:20-alpine", "node bot.js",
        {"bot.js": _node_http("discord.js")},
        [{"env": "BOT_TOKEN", "name": "Bot token", "default": "", "rules": "string"}],
    ),
    _egg(
        22, 9, "Telegram Bot",
        "Telegram worker stub. Serves health JSON until BOT_TOKEN is configured.",
        "python:3.11-slim", "python3 bot.py",
        {"bot.py": _BOT_PY},
        [
            {"env": "BOT_TOKEN", "name": "Bot token", "default": "", "rules": "string"},
            {"env": "EGG_NAME", "name": "Egg label", "default": "telegram", "rules": "string"},
        ],
    ),
    _egg(
        23, 10, "Go HTTP",
        "Go net/http service. Falls back to Python if the Go toolchain is absent.",
        "golang:1.22", "bash start.sh",
        {"main.go": _GO_MAIN, "serve.py": _http_py("go"), "start.sh": _FALLBACK_SH},
    ),
    _egg(
        24, 10, "Rust HTTP",
        "Rust TCP/HTTP listener. Compiles with rustc when available.",
        "rust:1-slim", "bash start.sh",
        {"main.rs": _RUST_MAIN, "serve.py": _http_py("rust"), "start.sh": _FALLBACK_SH},
    ),
    _egg(
        25, 10, "PHP Built-in",
        "PHP built-in server on SERVER_PORT, with a Python fallback.",
        "php:8.3-cli", "bash start.sh",
        {"index.php": _PHP_INDEX, "serve.py": _http_py("php"), "start.sh": _FALLBACK_SH},
    ),
    _egg(
        26, 10, "Deno",
        "Deno HTTP service with a Python fallback when Deno is not installed.",
        "denoland/deno:latest", "bash start.sh",
        {"main.ts": _DENO_MAIN, "serve.py": _http_py("deno"), "start.sh": _FALLBACK_SH},
    ),
    _egg(
        27, 6, "Minecraft Java (auto-installer)",
        "Official Java server provisioning with version and loader selection: Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity, Waterfall and BungeeCord.",
        "eclipse-temurin:21-jre",
        "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -XX:+UseG1GC -jar server.jar nogui",
        {"README-FIRST.txt": _MC_JAVA_README},
        [
            {"env": "MC_SOFTWARE", "name": "Minecraft software", "default": "paper", "rules": "string"},
            {"env": "MC_VERSION", "name": "Minecraft version", "default": "", "rules": "string"},
            {"env": "MC_LOADER", "name": "Loader or build", "default": "", "rules": "string"},
            {"env": "MOTD", "name": "MOTD", "default": "A VITESTERTL Minecraft Server", "rules": "string"},
        ],
    ),
    _egg(
        28, 6, "Minecraft Bedrock (auto-installer)",
        "Official Bedrock Dedicated Server provisioning for Windows, console and mobile clients. Installs the latest stable or preview build.",
        "debian:bookworm-slim",
        "bash bedrock_server.sh",
        {"README-FIRST.txt": _MC_BEDROCK_README},
        [
            {"env": "MC_VERSION", "name": "Bedrock version", "default": "", "rules": "string"},
            {"env": "MOTD", "name": "Server name", "default": "VITESTERTL Bedrock", "rules": "string"},
        ],
    ),
]


def egg_by_id(egg_id: int) -> dict | None:
    for egg in EGGS:
        if egg["id"] == egg_id:
            return egg
    return None


def default_egg_files() -> dict[str, str]:
    return {"main.py": _http_py("custom")}
