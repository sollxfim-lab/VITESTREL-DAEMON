from __future__ import annotations

import os
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(
    os.environ.get("VITESTL_DATA_DIR")
    or os.environ.get("BUILDP_DATA_DIR")
    or os.environ.get("KESTREL_DATA_DIR")
    or str(ROOT / "data")
).expanduser().resolve()
SERVERS_DIR = DATA / "servers"
BACKUPS_DIR = DATA / "backups"
NODES_DIR = DATA / "nodes"
DB_PATH = DATA / "kestrel.db"

DATA.mkdir(parents=True, exist_ok=True)
SERVERS_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
NODES_DIR.mkdir(parents=True, exist_ok=True)

SECRET = os.environ.get("KESTREL_SECRET", "kestrel-control-plane-dev-secret")
TOKEN_TTL = 60 * 60 * 24 * 7
PANEL_NAME = "VITESTERTL"
PANEL_COMPANY = "VITESTERTL"
PANEL_VERSION = "1.7.0"
WINGS_VERSION = "1.7.0"
ALLOC_PORT_START = 9000
ALLOC_PORT_END = 9999

DEFAULT_ADMIN_USER = os.environ.get("KESTREL_ADMIN_USER", "Yanxzyx")
DEFAULT_ADMIN_PASS = os.environ.get("KESTREL_ADMIN_PASS", "Kestrel.admin1")
DEFAULT_ADMIN_EMAIL = os.environ.get("KESTREL_ADMIN_EMAIL", "yanxzyx@vitestl.local")


def hostname() -> str:
    try:
        return socket.gethostname()
    except OSError:
        return "node-01"


def docker_available() -> bool:
    from shutil import which

    return which("docker") is not None
