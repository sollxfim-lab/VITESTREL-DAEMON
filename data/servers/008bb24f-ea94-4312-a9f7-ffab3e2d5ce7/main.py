from fastapi import FastAPI
from datetime import datetime, timezone
import os, platform, socket

app = FastAPI(title=os.environ.get("SERVER_NAME", "kestrel-api"), version="1.0.0")

@app.get("/")
def root():
    return {
        "service": os.environ.get("SERVER_NAME", "atlas-api"),
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
