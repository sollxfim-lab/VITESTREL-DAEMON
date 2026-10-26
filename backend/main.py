from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import psutil
from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from auth import decode_token, hash_password, sign_token, verify_password
from config import (
    ALLOC_PORT_END,
    ALLOC_PORT_START,
    BACKUPS_DIR,
    DEFAULT_ADMIN_PASS,
    DEFAULT_ADMIN_USER,
    DATA,
    NODES_DIR,
    PANEL_COMPANY,
    PANEL_NAME,
    PANEL_VERSION,
    SERVERS_DIR,
    WINGS_VERSION,
    docker_available,
    hostname,
)
from db import db, init_db, log_activity, new_server_id, next_port, row_to_dict, rows_to_list, utcnow
from eggs import egg_by_id
from runtime import dir_size, manager, substitute

app = FastAPI(title=PANEL_NAME, version=PANEL_VERSION, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginBody(BaseModel):
    username: str
    password: str


class PowerBody(BaseModel):
    signal: str


class CommandBody(BaseModel):
    command: str


class FileSaveBody(BaseModel):
    file: str
    contents: str


class FileCreateBody(BaseModel):
    root: str = "/"
    name: str
    directory: bool = False


class FileRenameBody(BaseModel):
    root: str = "/"
    from_name: str = Field(alias="from")
    to_name: str = Field(alias="to")

    model_config = {"populate_by_name": True}


class FileDeleteBody(BaseModel):
    root: str = "/"
    files: list[str]


class StartupBody(BaseModel):
    startup: str | None = None
    environment: dict[str, str] | None = None


class SettingsBody(BaseModel):
    name: str | None = None
    description: str | None = None
    image: str | None = None
    memory: int | None = None
    cpu: int | None = None
    disk: int | None = None


class CreateServerBody(BaseModel):
    name: str
    description: str = ""
    egg_id: int
    owner_id: int | None = None
    node_id: int | None = None
    allocation_id: int | None = None
    memory: int = 512
    cpu: int = 100
    disk: int = 2048
    allocation_port: int | None = None
    environment: dict[str, str] = {}
    start_on_completion: bool = False


class CreateUserBody(BaseModel):
    username: str
    email: str
    password: str
    role: str = "user"
    first_name: str = ""
    last_name: str = ""


class UpdateUserBody(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = None
    role: str | None = None
    first_name: str | None = None
    last_name: str | None = None


class CreateLocationBody(BaseModel):
    short_code: str
    name: str
    description: str = ""


class CreateNodeBody(BaseModel):
    name: str
    fqdn: str
    location_id: int
    memory: int = 8192
    disk: int = 51200
    cpu: int = 400
    scheme: str = "http"
    daemon_listen: int = 8080
    daemon_sftp: int = 2022
    memory_overallocate: int = 0
    disk_overallocate: int = 0
    public: bool = True
    behind_proxy: bool = False


class UpdateNodeBody(BaseModel):
    name: str | None = None
    fqdn: str | None = None
    location_id: int | None = None
    memory: int | None = None
    disk: int | None = None
    cpu: int | None = None
    scheme: str | None = None
    daemon_listen: int | None = None
    daemon_sftp: int | None = None
    memory_overallocate: int | None = None
    disk_overallocate: int | None = None
    behind_proxy: bool | None = None
    maintenance: bool | None = None
    public: bool | None = None


class TransferBody(BaseModel):
    owner_id: int


class SuspendBody(BaseModel):
    suspended: bool = True
    reason: str = ""


class ScheduleStateBody(BaseModel):
    enabled: bool


class NetworkBody(BaseModel):
    allocation_id: int | None = None


class ProfileBody(BaseModel):
    username: str | None = None
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None


class PanelSettingsBody(BaseModel):
    company: str | None = None
    support_email: str | None = None
    registration: bool | None = None
    theme: str | None = None


class AllocationRangeBody(BaseModel):
    ip: str = "0.0.0.0"
    start: int
    end: int
    notes: str = ""


class AutoInstallNodeBody(BaseModel):
    name: str | None = None
    location_id: int | None = None
    memory: int | None = None
    disk: int | None = None
    cpu: int | None = None
    port_start: int | None = None
    port_count: int = 10


class PasswordBody(BaseModel):
    current: str
    new_password: str


class DatabaseBody(BaseModel):
    name: str


class ScheduleBody(BaseModel):
    name: str
    cron: str
    action: str
    payload: str = ""
    enabled: bool = True


class SubuserBody(BaseModel):
    email: str
    permissions: list[str] = []


def user_from_header(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Unauthenticated")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    if not payload or "uid" not in payload:
        raise HTTPException(401, "Invalid token")
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["uid"],)).fetchone()
    user = row_to_dict(row)
    if not user:
        raise HTTPException(401, "User missing")
    user.pop("password_hash", None)
    return user


def admin_user(user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(403, "Administrator privileges required")
    return user


def get_server(server_id: str, user: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            """SELECT s.*, e.name AS egg_name, e.nest_id, e.runtime AS egg_runtime,
                      n.name AS nest_name, u.username AS owner_name
               FROM servers s
               JOIN eggs e ON e.id = s.egg_id
               JOIN nests n ON n.id = e.nest_id
               JOIN users u ON u.id = s.owner_id
               WHERE s.id = ?""",
            (server_id,),
        ).fetchone()
    server = row_to_dict(row)
    if not server:
        raise HTTPException(404, "Server not found")
    if user["role"] != "admin" and server["owner_id"] != user["id"]:
        with db() as conn:
            sub = conn.execute(
                "SELECT id FROM subusers WHERE server_id = ? AND email = ?",
                (server_id, user["email"]),
            ).fetchone()
        if not sub:
            raise HTTPException(403, "You do not have permission to access this server")
    server["status"] = manager.status_of(server["id"])
    try:
        server["environment"] = json.loads(server.get("environment") or "{}")
    except json.JSONDecodeError:
        server["environment"] = {}
    return server


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "role": user["role"],
        "first_name": user.get("first_name") or "",
        "last_name": user.get("last_name") or "",
        "created_at": user.get("created_at"),
        "last_login": user.get("last_login"),
        "root_admin": user.get("role") == "admin",
    }


_LOGIN_FAILURES: dict[str, list[float]] = {}
LOGIN_WINDOW = 300
LOGIN_ATTEMPT_LIMIT = 6


def login_rate_limited(key: str) -> bool:
    now = time.time()
    attempts = [t for t in _LOGIN_FAILURES.get(key, []) if now - t < LOGIN_WINDOW]
    _LOGIN_FAILURES[key] = attempts
    return len(attempts) >= LOGIN_ATTEMPT_LIMIT


def note_login_failure(key: str) -> None:
    _LOGIN_FAILURES.setdefault(key, []).append(time.time())


def clear_login_failures(key: str) -> None:
    _LOGIN_FAILURES.pop(key, None)


def reject_suspended(server: dict[str, Any]) -> None:
    if server.get("suspended"):
        reason = (server.get("suspended_reason") or "").strip()
        detail = "This server is suspended." + (f" {reason}" if reason else "")
        raise HTTPException(403, detail)


def node_connected(node: dict[str, Any]) -> bool:
    fqdn = (node.get("fqdn") or "").lower()
    host = hostname().lower()
    return node.get("id") == 1 or fqdn in {host, "localhost", "127.0.0.1"}


def decorate_node(node: dict[str, Any], conn) -> dict[str, Any]:
    nid = node["id"]
    servers = conn.execute("SELECT COUNT(*) AS c FROM servers WHERE node_id = ?", (nid,)).fetchone()["c"]
    mem_alloc = conn.execute(
        "SELECT COALESCE(SUM(memory),0) AS s FROM servers WHERE node_id = ?", (nid,)
    ).fetchone()["s"]
    disk_alloc = conn.execute(
        "SELECT COALESCE(SUM(disk),0) AS s FROM servers WHERE node_id = ?", (nid,)
    ).fetchone()["s"]
    alloc_total = conn.execute(
        "SELECT COUNT(*) AS c FROM allocations WHERE node_id = ?", (nid,)
    ).fetchone()["c"]
    alloc_free = conn.execute(
        "SELECT COUNT(*) AS c FROM allocations WHERE node_id = ? AND server_id IS NULL", (nid,)
    ).fetchone()["c"]
    connected = node_connected(node)
    running = 0
    if connected:
        running = sum(
            1
            for server_row in conn.execute(
                "SELECT id FROM servers WHERE node_id = ?", (nid,)
            ).fetchall()
            if manager.status_of(server_row["id"]) == "running"
        )
    suspended = conn.execute(
        "SELECT COUNT(*) AS c FROM servers WHERE node_id = ? AND suspended = 1", (nid,)
    ).fetchone()["c"]
    loc = conn.execute("SELECT * FROM locations WHERE id = ?", (node["location_id"],)).fetchone()
    location = row_to_dict(loc) or {"id": node["location_id"], "name": "unknown", "short_code": "?"}
    live = None
    if connected:
        vm = psutil.virtual_memory()
        du = shutil.disk_usage("/")
        live = {
            "cpu": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count() or 1,
            "memory": {"total": vm.total, "used": vm.used, "percent": vm.percent},
            "disk": {
                "total": du.total,
                "used": du.used,
                "percent": round(du.used / max(du.total, 1) * 100, 1),
            },
            "hostname": hostname(),
            "docker": docker_available(),
            "boot_time": int(psutil.boot_time()),
        }
    payload = {
        **node,
        "location": location.get("name"),
        "location_short": location.get("short_code"),
        "servers": servers,
        "running": running if connected else 0,
        "suspended": suspended,
        "memory_allocated": int(mem_alloc or 0),
        "disk_allocated": int(disk_alloc or 0),
        "allocations": {"total": alloc_total, "assigned": alloc_total - alloc_free, "free": alloc_free},
        "daemon": "connected" if connected and not node.get("maintenance") else (
            "maintenance" if node.get("maintenance") else "awaiting"
        ),
        "runtime": "docker" if docker_available() and connected else "process",
        "wings": WINGS_VERSION,
        "live": live,
        "utilization": {
            "memory": round(int(mem_alloc or 0) / max(int(node.get("memory") or 1), 1) * 100, 1),
            "disk": round(int(disk_alloc or 0) / max(int(node.get("disk") or 1), 1) * 100, 1),
        },
    }
    payload.pop("daemon_token", None)
    return payload


# ---------------------------------------------------------------------------
# Local node auto-installer
#
# VITESTERTL executes workloads on the panel host. The installer therefore
# provisions the local host as a first-class node: it audits the Debian runtime,
# registers the node, reserves allocations, and writes a node manifest. It never
# pretends to install a remote agent and it never runs package managers from the
# web process.
# ---------------------------------------------------------------------------

_INSTALL_JOBS: dict[str, dict[str, Any]] = {}
_INSTALL_LOCK = threading.Lock()

_INSTALL_STEPS = [
    ("audit", "Host audit"),
    ("register", "Node registration"),
    ("ports", "Port reservations"),
    ("storage", "Node storage"),
    ("finalize", "Runtime handshake"),
]


def _install_log(job_id: str, message: str, level: str = "info") -> None:
    with _INSTALL_LOCK:
        job = _INSTALL_JOBS.get(job_id)
        if not job:
            return
        job["logs"].append({"at": utcnow(), "level": level, "message": message})
        job["logs"] = job["logs"][-160:]
        job["updated_at"] = utcnow()


def _install_step(job_id: str, step_id: str, status: str, detail: str | None = None) -> None:
    with _INSTALL_LOCK:
        job = _INSTALL_JOBS.get(job_id)
        if not job:
            return
        for step in job["steps"]:
            if step["id"] == step_id:
                step["status"] = status
                if detail is not None:
                    step["detail"] = detail
                break
        job["updated_at"] = utcnow()


def _install_update(job_id: str, **fields: Any) -> None:
    with _INSTALL_LOCK:
        job = _INSTALL_JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = utcnow()


def _install_fail_running(job_id: str, error: str) -> None:
    with _INSTALL_LOCK:
        job = _INSTALL_JOBS.get(job_id)
        if not job:
            return
        for step in job["steps"]:
            if step["status"] == "running":
                step["status"] = "failed"
                step["detail"] = step["detail"] or error
        job["status"] = "failed"
        job["error"] = error
        job["updated_at"] = utcnow()
        job["logs"].append({"at": utcnow(), "level": "error", "message": error})
        job["logs"] = job["logs"][-160:]


def _install_snapshot(job_id: str) -> dict[str, Any] | None:
    with _INSTALL_LOCK:
        job = _INSTALL_JOBS.get(job_id)
        return copy.deepcopy(job) if job else None


def _read_os_release() -> dict[str, str]:
    values: dict[str, str] = {}
    path = Path("/etc/os-release")
    if not path.exists():
        return values
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def _docker_runtime() -> dict[str, Any]:
    binary = shutil.which("docker")
    info: dict[str, Any] = {"available": bool(binary), "daemon": False, "version": None}
    if not binary:
        return info
    try:
        version = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=4
        )
        if version.returncode == 0:
            info["version"] = version.stdout.strip()
        daemon = subprocess.run(
            [binary, "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=4,
        )
        if daemon.returncode == 0 and daemon.stdout.strip():
            info["daemon"] = True
            info["server_version"] = daemon.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return info


def _port_is_free(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _find_port_block(conn, start: int, count: int) -> list[int] | None:
    if count < 1:
        return []
    start = max(1024, min(int(start), ALLOC_PORT_END - count + 1))
    used = {row["p"] for row in conn.execute("SELECT port AS p FROM allocations").fetchall()}
    used |= {
        row["p"]
        for row in conn.execute("SELECT allocation_port AS p FROM servers").fetchall()
    }
    for base in range(start, ALLOC_PORT_END - count + 2):
        ports = list(range(base, base + count))
        if any(port in used for port in ports):
            continue
        if all(_port_is_free(port) for port in ports):
            return ports
    return None


def _existing_local_node(conn) -> dict[str, Any] | None:
    host = hostname().strip().lower()
    for row in conn.execute("SELECT * FROM nodes ORDER BY id").fetchall():
        if (row["fqdn"] or "").strip().lower() in {host, "localhost", "127.0.0.1"}:
            return row_to_dict(row)
    return None


def _recommended_capacity() -> tuple[int, int, int]:
    memory_mib = int(psutil.virtual_memory().total / (1024 * 1024))
    disk = shutil.disk_usage(DATA)
    disk_free_mib = int(disk.free / (1024 * 1024))
    memory = max(1024, int((memory_mib * 0.75) / 512) * 512)
    disk_mib = max(10240, int((disk_free_mib * 0.7) / 1024) * 1024)
    cpu = max(100, (psutil.cpu_count() or 1) * 100)
    return memory, disk_mib, cpu


def _host_audit() -> dict[str, Any]:
    release = _read_os_release()
    system = platform.system()
    docker = _docker_runtime()
    total_memory = psutil.virtual_memory().total
    usage = shutil.disk_usage(DATA)
    root = bool(hasattr(os, "geteuid") and os.geteuid() == 0)
    systemd = system == "Linux" and Path("/run/systemd/system").exists()
    writable = os.access(DATA, os.W_OK)
    if writable:
        probe = DATA / ".installer-write-test"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        except OSError:
            writable = False

    with db() as conn:
        existing = _existing_local_node(conn)
        location = None
        if existing:
            location = conn.execute(
                "SELECT * FROM locations WHERE id = ?", (existing["location_id"],)
            ).fetchone()
        if not location:
            location = conn.execute("SELECT * FROM locations ORDER BY id LIMIT 1").fetchone()
        location = row_to_dict(location)
        names = {
            (row["name"] or "").strip().lower()
            for row in conn.execute("SELECT name FROM nodes").fetchall()
        }
        recommendation_name = "vitestl-local"
        if existing:
            recommendation_name = existing["name"]
        else:
            suffix = 2
            while recommendation_name.lower() in names:
                recommendation_name = f"vitestl-local-{suffix}"
                suffix += 1
        recommended_ports = _find_port_block(conn, ALLOC_PORT_START, 10)
        allocation_count = 0
        if existing:
            allocation_count = conn.execute(
                "SELECT COUNT(*) AS c FROM allocations WHERE node_id = ?", (existing["id"],)
            ).fetchone()["c"]

    memory, disk_mib, cpu = _recommended_capacity()
    pretty = release.get("PRETTY_NAME") or f"{system} {platform.release()}"
    distro_id = (release.get("ID") or "").lower()
    debian_family = distro_id in {"debian", "ubuntu", "raspbian", "linuxmint", "pop"}
    python_ok = sys.version_info >= (3, 10)
    checks = [
        {
            "id": "os",
            "label": "Linux distribution",
            "status": "ok" if debian_family else "warn",
            "detail": pretty,
            "hint": "Debian 12/13 is the supported production target.",
        },
        {
            "id": "python",
            "label": "Python runtime",
            "status": "ok" if python_ok else "fail",
            "detail": f"Python {platform.python_version()}",
            "hint": "Python 3.10 or newer is required.",
        },
        {
            "id": "systemd",
            "label": "systemd service",
            "status": "ok" if systemd else "warn",
            "detail": "systemd detected" if systemd else "systemd not detected",
            "hint": "Use deploy/install.sh to install the managed systemd unit.",
        },
        {
            "id": "docker",
            "label": "Container runtime",
            "status": "ok" if docker["daemon"] else "warn",
            "detail": (
                f"Docker {docker.get('server_version') or docker.get('version') or ''}".strip()
                if docker["available"]
                else "Docker not installed"
            ),
            "hint": "Optional. The native process runtime works without Docker.",
        },
        {
            "id": "privileges",
            "label": "Service privileges",
            "status": "ok" if root else "warn",
            "detail": "Running as root" if root else "Running as an unprivileged user",
            "hint": "The panel should run as the vitestl service account; root is only needed for setup.",
        },
        {
            "id": "storage",
            "label": "Data directory",
            "status": "ok" if writable else "fail",
            "detail": f"{DATA} · {round(usage.free / (1024 ** 3), 1)} GiB free",
            "hint": "The installer writes node manifests and workload data here.",
        },
        {
            "id": "ports",
            "label": "Allocation range",
            "status": "ok" if recommended_ports else "fail",
            "detail": (
                f"{recommended_ports[0]}–{recommended_ports[-1]} available"
                if recommended_ports
                else "No free ten-port block found"
            ),
            "hint": "Choose a different start port if the recommended block is occupied.",
        },
        {
            "id": "existing",
            "label": "Local node",
            "status": "ok",
            "detail": (
                f"#{existing['id']} {existing['name']} is already bound to this host"
                if existing
                else "A new local node will be created"
            ),
            "hint": (
                "Auto-install updates the existing node and fills missing allocations."
                if existing
                else "Auto-install creates the node, storage and allocation block in one pass."
            ),
        },
    ]

    existing_payload = None
    if existing:
        existing_payload = {
            "id": existing["id"],
            "name": existing["name"],
            "fqdn": existing["fqdn"],
            "location_id": existing["location_id"],
            "location": (location or {}).get("name", "Local"),
            "memory": existing["memory"],
            "disk": existing["disk"],
            "cpu": existing["cpu"],
            "allocations": allocation_count,
            "daemon": "connected" if node_connected(existing) else "awaiting",
        }

    return {
        "host": {
            "os": pretty,
            "id": distro_id,
            "version": release.get("VERSION_ID"),
            "kernel": platform.release(),
            "arch": platform.machine(),
            "hostname": hostname(),
            "fqdn": socket.getfqdn() or hostname(),
            "python": platform.python_version(),
            "systemd": systemd,
            "root": root,
            "docker": docker,
            "cpu_cores": psutil.cpu_count() or 1,
            "memory_total": total_memory,
            "disk_total": usage.total,
            "disk_free": usage.free,
            "data_path": str(DATA),
            "writable": writable,
        },
        "checks": checks,
        "ready": not any(check["status"] == "fail" for check in checks),
        "existing_node": existing_payload,
        "recommended": {
            "name": recommendation_name,
            "fqdn": hostname(),
            "location_id": (location or {}).get("id"),
            "location": (location or {}).get("name", "Local"),
            "memory": existing["memory"] if existing else memory,
            "disk": existing["disk"] if existing else disk_mib,
            "cpu": existing["cpu"] if existing else cpu,
            "port_start": (recommended_ports or [ALLOC_PORT_START])[0],
            "port_count": 10,
        },
    }


def _run_node_install(job_id: str, body: dict[str, Any], admin_id: int | None) -> None:
    node_id: int | None = None
    node_dir: Path | None = None
    try:
        _install_update(job_id, status="running")
        _install_step(job_id, "audit", "running")
        _install_log(job_id, f"Auditing local host {hostname()}")
        audit = _host_audit()
        host = audit["host"]
        _install_log(job_id, f"Host: {host['os']} · {host['arch']} · Python {host['python']}")
        _install_log(
            job_id,
            "Container runtime: "
            + (
                f"Docker {host['docker'].get('server_version') or host['docker'].get('version')}"
                if host["docker"]["daemon"]
                else "native process runtime (Docker unavailable)"
            ),
        )
        failures = [check for check in audit["checks"] if check["status"] == "fail"]
        if failures:
            raise RuntimeError("; ".join(f"{check['label']}: {check['detail']}" for check in failures))
        _install_step(job_id, "audit", "success", host["os"])

        recommended = audit["recommended"]
        count = max(1, min(100, int(body.get("port_count") or 10)))
        preferred = int(body.get("port_start") or recommended["port_start"])
        with db() as conn:
            existing = _existing_local_node(conn)
            location_id = int(body.get("location_id") or recommended.get("location_id") or 0)
            location = conn.execute(
                "SELECT * FROM locations WHERE id = ?", (location_id,)
            ).fetchone()
            if not location:
                raise RuntimeError("The selected location no longer exists")
            name = (body.get("name") or recommended["name"]).strip()[:64]
            if not name:
                raise RuntimeError("A node name is required")
            duplicate = conn.execute(
                "SELECT id, name FROM nodes WHERE lower(name) = lower(?)", (name,)
            ).fetchone()
            if duplicate and (not existing or duplicate["id"] != existing["id"]):
                raise RuntimeError(f"Another node already uses the name {name}")

            defaults = _recommended_capacity()
            memory = int(body.get("memory") or (existing or {}).get("memory") or defaults[0])
            disk = int(body.get("disk") or (existing or {}).get("disk") or defaults[1])
            cpu = int(body.get("cpu") or (existing or {}).get("cpu") or defaults[2])
            memory = max(512, min(memory, 1048576))
            disk = max(1024, min(disk, 10485760))
            cpu = max(100, min(cpu, 100000))

            if existing:
                node_id = int(existing["id"])
                conn.execute(
                    "UPDATE nodes SET name=?, location_id=?, memory=?, disk=?, cpu=? WHERE id=?",
                    (name, location_id, memory, disk, cpu, node_id),
                )
                _install_log(job_id, f"Reusing local node #{node_id} ({name})")
            else:
                cur = conn.execute(
                    """INSERT INTO nodes
                    (uuid, location_id, name, fqdn, scheme, memory, memory_overallocate, disk,
                     disk_overallocate, cpu, daemon_token, daemon_listen, daemon_sftp,
                     behind_proxy, maintenance, public, created_at)
                    VALUES (?, ?, ?, ?, 'http', ?, 0, ?, 0, ?, ?, 8080, 2022, 0, 0, 1, ?)""",
                    (
                        str(uuid.uuid4()),
                        location_id,
                        name,
                        hostname(),
                        memory,
                        disk,
                        cpu,
                        secrets.token_urlsafe(32),
                        utcnow(),
                    ),
                )
                node_id = int(cur.lastrowid)
                _install_log(job_id, f"Registered local node #{node_id} ({name})")
        _install_step(
            job_id,
            "register",
            "success",
            f"#{node_id} · {name} · {memory} MiB / {disk} MiB / {cpu}%",
        )

        _install_step(job_id, "ports", "running")
        with db() as conn:
            own_ports = conn.execute(
                "SELECT port FROM allocations WHERE node_id = ?", (node_id,)
            ).fetchall()
            needed = max(0, count - len(own_ports))
            added: list[int] = []
            if needed:
                block = _find_port_block(conn, preferred, needed)
                if not block:
                    raise RuntimeError(
                        f"No free contiguous allocation block of {needed} ports was found"
                    )
                for port in block:
                    try:
                        conn.execute(
                            "INSERT INTO allocations (ip, port, server_id, notes, node_id) "
                            "VALUES ('0.0.0.0', ?, NULL, 'Auto-install', ?)",
                            (port, node_id),
                        )
                        added.append(port)
                    except Exception:
                        continue
            total_ports = conn.execute(
                "SELECT COUNT(*) AS c FROM allocations WHERE node_id = ?", (node_id,)
            ).fetchone()["c"]
        detail = (
            f"{len(added)} added · {total_ports} total"
            if added
            else f"{total_ports} existing allocation{'s' if total_ports != 1 else ''}"
        )
        _install_log(job_id, f"Allocation range ready: {detail}")
        _install_step(job_id, "ports", "success", detail)

        _install_step(job_id, "storage", "running")
        node_dir = NODES_DIR / f"node-{node_id}"
        volumes = node_dir / "volumes"
        volumes.mkdir(parents=True, exist_ok=True)
        manifest = {
            "panel": PANEL_NAME,
            "panel_version": PANEL_VERSION,
            "node_id": node_id,
            "name": name,
            "fqdn": hostname(),
            "location_id": location_id,
            "runtime": "docker" if host["docker"]["daemon"] else "process",
            "memory_mib": memory,
            "disk_mib": disk,
            "cpu_percent": cpu,
            "volumes": str(volumes),
            "allocations": added,
            "host": {
                "os": host["os"],
                "arch": host["arch"],
                "python": host["python"],
                "docker": host["docker"].get("server_version") or host["docker"].get("version"),
                "systemd": host["systemd"],
            },
            "installed_at": utcnow(),
        }
        manifest_path = node_dir / "node.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if os.name != "nt":
            try:
                node_dir.chmod(0o750)
                manifest_path.chmod(0o640)
            except OSError:
                pass
        _install_log(job_id, f"Node manifest written to {manifest_path}")
        _install_step(job_id, "storage", "success", str(node_dir))

        _install_step(job_id, "finalize", "running")
        with db() as conn:
            row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
            node = decorate_node(row_to_dict(row) or {}, conn)
        handshake = "connected" if node_connected(node) else "awaiting"
        _install_step(
            job_id,
            "finalize",
            "success",
            f"{handshake} · {node.get('runtime', 'process')} runtime",
        )
        result = {
            "node_id": node_id,
            "name": name,
            "fqdn": hostname(),
            "location": (row_to_dict(location) or {}).get("name", "Local"),
            "daemon": handshake,
            "runtime": node.get("runtime", "process"),
            "allocations": total_ports,
            "manifest": str(manifest_path),
            "memory": memory,
            "disk": disk,
            "cpu": cpu,
        }
        _install_update(job_id, status="success", result=result)
        _install_log(
            job_id,
            "Node is ready. Assign workloads to it from the server creation page.",
        )
        snapshot = _install_snapshot(job_id) or {}
        (node_dir / "install.log").write_text(
            "\n".join(
                f"{entry['at']} [{entry['level']}] {entry['message']}"
                for entry in snapshot.get("logs", [])
            )
            + "\n",
            encoding="utf-8",
        )
        log_activity(
            admin_id,
            None,
            "node:auto-install",
            {"node": name, "node_id": node_id, "allocations": total_ports},
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the installer log
        message = str(exc) or "Node installation failed"
        _install_fail_running(job_id, message)
        if node_dir:
            try:
                (node_dir / "install.log").write_text(
                    f"{utcnow()} [error] {message}\n", encoding="utf-8"
                )
            except OSError:
                pass


def install_egg_files(server_id: str, egg_id: int, env: dict[str, str]) -> None:
    egg = egg_by_id(egg_id)
    if not egg:
        return
    root = SERVERS_DIR / server_id
    root.mkdir(parents=True, exist_ok=True)
    files = egg.get("files") or {}
    for rel, content in files.items():
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        text = content
        for k, v in env.items():
            text = text.replace("{{" + k + "}}", str(v))
        dest.write_text(text, encoding="utf-8")
        if dest.suffix == ".sh":
            dest.chmod(0o755)


def decorate_server(server: dict[str, Any]) -> dict[str, Any]:
    sid = server["id"]
    inst = manager.instances.get(sid)
    stats = inst.stats() if inst else {
        "state": "offline",
        "cpu_absolute": 0,
        "memory_bytes": 0,
        "memory_limit_bytes": int(server.get("memory") or 0) * 1024 * 1024,
        "disk_bytes": dir_size(SERVERS_DIR / sid),
        "disk_limit_bytes": int(server.get("disk") or 0) * 1024 * 1024,
        "network": {"rx_bytes": 0, "tx_bytes": 0},
        "uptime": 0,
        "pid": None,
        "mode": "process",
    }
    env = server.get("environment")
    if isinstance(env, str):
        try:
            env = json.loads(env)
        except json.JSONDecodeError:
            env = {}
    return {
        **{k: server[k] for k in server if k != "environment"},
        "environment": env or {},
        "status": "suspended" if server.get("suspended") else stats["state"],
        "suspended": bool(server.get("suspended")),
        "identifier": server.get("short_id") or sid[:8],
        "uuid": sid,
        "allocation": {
            "ip": server.get("allocation_ip") or "0.0.0.0",
            "port": server.get("allocation_port"),
            "alias": hostname(),
        },
        "limits": {
            "memory": server.get("memory"),
            "cpu": server.get("cpu"),
            "disk": server.get("disk"),
            "swap": server.get("swap"),
            "io": server.get("io"),
        },
        "resources": stats,
        "feature_limits": {"databases": 2, "allocations": 1, "backups": 8},
    }


def safe_join(server_id: str, rel: str) -> Path:
    root = (SERVERS_DIR / server_id).resolve()
    rel = (rel or "/").replace("\\", "/")
    rel = rel.lstrip("/")
    target = (root / rel).resolve() if rel else root
    if root not in target.parents and target != root:
        raise HTTPException(400, "Path escapes server directory")
    return target


@app.on_event("startup")
async def on_startup() -> None:
    init_db()
    await seed_demo_servers()
    asyncio.create_task(schedule_loop())


async def seed_demo_servers() -> None:
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM servers").fetchone()["c"]
        if count:
            return
        owner = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
        owner_id = owner["id"] if owner else 1
        demos = [
            {
                "name": "atlas-api",
                "description": "Internal FastAPI gateway. Health on /health.",
                "egg_id": 2,
                "memory": 512,
                "cpu": 100,
                "disk": 2048,
                "environment": {"PY_MODULE": "main"},
            },
            {
                "name": "lantern-web",
                "description": "Public status origin. Static files from the working directory.",
                "egg_id": 6,
                "memory": 256,
                "cpu": 50,
                "disk": 1024,
                "environment": {},
            },
            {
                "name": "relay-worker",
                "description": "Node.js worker process bound to its primary allocation.",
                "egg_id": 3,
                "memory": 512,
                "cpu": 80,
                "disk": 2048,
                "environment": {"JS_FILE": "index.js"},
            },
        ]
        for spec in demos:
            sid, short = new_server_id()
            egg = egg_by_id(spec["egg_id"])
            if not egg:
                continue
            port = next_port(conn)
            env = {
                "SERVER_NAME": spec["name"],
                "SERVER_PORT": str(port),
                "SERVER_MEMORY": str(spec["memory"]),
                "SERVER_IP": "0.0.0.0",
                **spec["environment"],
            }
            startup = substitute(egg["startup"], env)
            conn.execute(
                """INSERT INTO servers
                (id, short_id, name, description, egg_id, owner_id, memory, cpu, disk, swap, io,
                 allocation_ip, allocation_port, startup, image, environment, status, created_at, installed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 500, '0.0.0.0', ?, ?, ?, ?, 'offline', ?, 1)""",
                (
                    sid,
                    short,
                    spec["name"],
                    spec["description"],
                    spec["egg_id"],
                    owner_id,
                    spec["memory"],
                    spec["cpu"],
                    spec["disk"],
                    port,
                    startup,
                    egg["docker_image"],
                    json.dumps(spec["environment"]),
                    utcnow(),
                ),
            )
            conn.execute(
                "INSERT INTO allocations (ip, port, server_id, notes) VALUES (?, ?, ?, ?)",
                ("0.0.0.0", port, sid, "primary"),
            )
            install_egg_files(sid, spec["egg_id"], env)
            conn.execute(
                "INSERT INTO activity (user_id, server_id, event, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
                (owner_id, sid, "server:create", json.dumps({"seed": True}), utcnow()),
            )


async def schedule_loop() -> None:
    while True:
        await asyncio.sleep(20)
        try:
            await run_due_schedules()
        except Exception:
            continue


async def run_due_schedules() -> None:
    now = time.time()
    with db() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM schedules WHERE enabled = 1").fetchall())
    for sch in rows:
        last = sch.get("last_run")
        interval = parse_cron_interval(sch.get("cron") or "*/5 * * * *")
        due = True
        if last:
            try:
                # last is iso
                from datetime import datetime, timezone

                dt = datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                due = (now - dt.timestamp()) >= interval
            except Exception:
                due = True
        if not due:
            continue
        server_id = sch["server_id"]
        with db() as conn:
            row = conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
            server = row_to_dict(row)
        if not server or server.get("suspended"):
            continue
        try:
            await execute_schedule_action(server, sch)
        except Exception:
            pass
        with db() as conn:
            conn.execute("UPDATE schedules SET last_run = ? WHERE id = ?", (utcnow(), sch["id"]))


async def execute_schedule_action(server: dict[str, Any], sch: dict[str, Any]) -> None:
    action = sch["action"]
    inst = manager.get(server)
    if action == "start":
        await inst.start()
    elif action == "stop":
        await inst.stop()
    elif action == "restart":
        await inst.stop()
        await inst.start()
    elif action == "kill":
        await inst.stop(kill=True)
    elif action == "backup":
        create_backup_file(server, name=f"schedule-{sch['name']}")
    elif action == "command" and sch.get("payload"):
        await inst.send(sch["payload"])


def parse_cron_interval(expr: str) -> int:
    expr = (expr or "").strip()
    if expr.startswith("*/") and " " in expr:
        try:
            n = int(expr.split()[0][2:])
            return max(60, n * 60)
        except ValueError:
            return 300
    return 300


@app.get("/api/system")
def system_info() -> dict[str, Any]:
    vm = psutil.virtual_memory()
    du = shutil.disk_usage("/")
    cpu_count = psutil.cpu_count() or 1
    return {
        "panel": PANEL_NAME,
        "version": PANEL_VERSION,
        "wings": WINGS_VERSION,
        "hostname": hostname(),
        "docker": docker_available(),
        "runtime": "docker" if docker_available() else "process",
        "cpu": {"cores": cpu_count, "percent": psutil.cpu_percent(interval=None)},
        "memory": {"total": vm.total, "used": vm.used, "percent": vm.percent},
        "disk": {"total": du.total, "used": du.used, "percent": round(du.used / du.total * 100, 1)},
        "boot_time": int(psutil.boot_time()),
    }


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request) -> dict[str, Any]:
    rate_key = f"{request.client.host if request.client else '-'}:{body.username.strip().lower()}"
    if login_rate_limited(rate_key):
        raise HTTPException(429, "Too many sign-in attempts. Try again in a few minutes.")
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? OR email = ?",
            (body.username, body.username),
        ).fetchone()
    user = row_to_dict(row)
    if not user or not verify_password(body.password, user["password_hash"]):
        note_login_failure(rate_key)
        raise HTTPException(401, "Invalid username or password")
    clear_login_failures(rate_key)
    stamp = utcnow()
    with db() as conn:
        conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (stamp, user["id"]))
    user["last_login"] = stamp
    token = sign_token({"uid": user["id"], "role": user["role"], "usr": user["username"]})
    log_activity(user["id"], None, "auth:login")
    return {"token": token, "user": public_user(user)}


@app.get("/api/auth/me")
def me(user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    return {"user": public_user(user)}


@app.post("/api/auth/password")
def change_password(body: PasswordBody, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, str]:
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        full = row_to_dict(row)
        if not full or not verify_password(body.current, full["password_hash"]):
            raise HTTPException(400, "Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
    return {"status": "ok"}


@app.put("/api/account")
def update_account(body: ProfileBody, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    with db() as conn:
        current = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        if not current:
            raise HTTPException(404, "Account not found")
        username = (body.username or current["username"]).strip()
        email = (body.email or current["email"]).strip().lower()
        first_name = body.first_name if body.first_name is not None else current.get("first_name") or ""
        last_name = body.last_name if body.last_name is not None else current.get("last_name") or ""
        if len(username) < 3:
            raise HTTPException(400, "Username must be at least 3 characters")
        if "@" not in email:
            raise HTTPException(400, "A valid email is required")
        try:
            conn.execute(
                "UPDATE users SET username = ?, email = ?, first_name = ?, last_name = ? WHERE id = ?",
                (username, email, first_name.strip(), last_name.strip(), user["id"]),
            )
        except Exception as exc:
            raise HTTPException(400, "Username or email is already in use") from exc
        updated = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()) or {}
    log_activity(user["id"], None, "account:update")
    return {"user": public_user(updated)}


@app.get("/api/servers")
def list_servers(user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    with db() as conn:
        if user["role"] == "admin":
            rows = conn.execute(
                """SELECT s.*, e.name AS egg_name, n.name AS nest_name, u.username AS owner_name
                   FROM servers s
                   JOIN eggs e ON e.id = s.egg_id
                   JOIN nests n ON n.id = e.nest_id
                   JOIN users u ON u.id = s.owner_id
                   ORDER BY s.name COLLATE NOCASE"""
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT s.*, e.name AS egg_name, n.name AS nest_name, u.username AS owner_name
                   FROM servers s
                   JOIN eggs e ON e.id = s.egg_id
                   JOIN nests n ON n.id = e.nest_id
                   JOIN users u ON u.id = s.owner_id
                   WHERE s.owner_id = ? OR s.id IN (SELECT server_id FROM subusers WHERE email = ?)
                   ORDER BY s.name COLLATE NOCASE""",
                (user["id"], user["email"]),
            ).fetchall()
    data = [decorate_server(row_to_dict(r) or {}) for r in rows]
    return {"data": data}


@app.get("/api/servers/{server_id}")
def show_server(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    return {"data": decorate_server(get_server(server_id, user))}


@app.get("/api/servers/{server_id}/resources")
def server_resources(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    server = get_server(server_id, user)
    inst = manager.get(server)
    return {"data": inst.stats()}


@app.post("/api/servers/{server_id}/power")
async def server_power(
    server_id: str, body: PowerBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    inst = manager.get(server)
    sig = body.signal.lower().strip()
    log_activity(user["id"], server_id, f"server:power:{sig}")
    if sig == "start":
        await inst.start()
    elif sig == "stop":
        await inst.stop()
    elif sig == "restart":
        await inst.stop()
        await inst.start()
    elif sig == "kill":
        await inst.stop(kill=True)
    else:
        raise HTTPException(400, "Unknown power signal")
    with db() as conn:
        conn.execute("UPDATE servers SET status = ? WHERE id = ?", (inst.status, server_id))
    return {"status": inst.status}


@app.post("/api/servers/{server_id}/command")
async def server_command(
    server_id: str, body: CommandBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    inst = manager.get(server)
    await inst.send(body.command)
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/activity")
def server_activity(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        rows = conn.execute(
            """SELECT a.*, u.username FROM activity a
               LEFT JOIN users u ON u.id = a.user_id
               WHERE a.server_id = ? ORDER BY a.id DESC LIMIT 80""",
            (server_id,),
        ).fetchall()
    return {"data": decode_activity(rows_to_list(rows))}


@app.get("/api/activity")
def my_activity(
    limit: int = 24, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    limit = max(1, min(100, limit))
    with db() as conn:
        if user["role"] == "admin":
            rows = conn.execute(
                """SELECT a.*, u.username, s.name AS server_name
                   FROM activity a
                   LEFT JOIN users u ON u.id = a.user_id
                   LEFT JOIN servers s ON s.id = a.server_id
                   ORDER BY a.id DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT a.*, u.username, s.name AS server_name
                   FROM activity a
                   LEFT JOIN users u ON u.id = a.user_id
                   LEFT JOIN servers s ON s.id = a.server_id
                   WHERE a.user_id = ?
                      OR a.server_id IN (SELECT id FROM servers WHERE owner_id = ?)
                      OR a.server_id IN (SELECT server_id FROM subusers WHERE email = ?)
                   ORDER BY a.id DESC LIMIT ?""",
                (user["id"], user["id"], user["email"], limit),
            ).fetchall()
    return {"data": decode_activity(rows_to_list(rows))}


def decode_activity(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        try:
            row["metadata"] = json.loads(row.get("metadata") or "{}")
        except (json.JSONDecodeError, TypeError):
            row["metadata"] = {}
    return rows


@app.get("/api/servers/{server_id}/files")
def list_files(
    server_id: str,
    directory: str = Query("/"),
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    get_server(server_id, user)
    path = safe_join(server_id, directory)
    if not path.exists():
        raise HTTPException(404, "Directory not found")
    if not path.is_dir():
        raise HTTPException(400, "Not a directory")
    entries = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            st = child.stat()
        except OSError:
            continue
        entries.append(
            {
                "name": child.name,
                "mode": oct(st.st_mode)[-3:],
                "size": st.st_size,
                "is_file": child.is_file(),
                "is_symlink": child.is_symlink(),
                "mimetype": "inode/directory" if child.is_dir() else "text/plain",
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_ctime)),
                "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
            }
        )
    return {"data": entries}


@app.get("/api/servers/{server_id}/files/contents")
def file_contents(
    server_id: str, file: str = Query(...), user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    get_server(server_id, user)
    path = safe_join(server_id, file)
    if not path.is_file():
        raise HTTPException(404, "File not found")
    if path.stat().st_size > 2_000_000:
        raise HTTPException(400, "File too large to edit")
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "Binary file cannot be edited")
    return {"content": text}


@app.post("/api/servers/{server_id}/files/save")
def file_save(
    server_id: str, body: FileSaveBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    path = safe_join(server_id, body.file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.contents, encoding="utf-8")
    log_activity(user["id"], server_id, "file:save", {"file": body.file})
    return {"status": "ok"}


@app.post("/api/servers/{server_id}/files/create")
def file_create(
    server_id: str, body: FileCreateBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    path = safe_join(server_id, str(Path(body.root) / body.name))
    if body.directory:
        path.mkdir(parents=True, exist_ok=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)
    return {"status": "ok"}


@app.post("/api/servers/{server_id}/files/rename")
def file_rename(
    server_id: str, body: FileRenameBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    src = safe_join(server_id, str(Path(body.root) / body.from_name))
    dst = safe_join(server_id, str(Path(body.root) / body.to_name))
    if not src.exists():
        raise HTTPException(404, "Source not found")
    src.rename(dst)
    return {"status": "ok"}


@app.post("/api/servers/{server_id}/files/delete")
def file_delete(
    server_id: str, body: FileDeleteBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    for name in body.files:
        path = safe_join(server_id, str(Path(body.root) / name))
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    return {"status": "ok"}


@app.post("/api/servers/{server_id}/files/upload")
async def file_upload(
    server_id: str,
    directory: str = Query("/"),
    upload: UploadFile = File(...),
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    dest_dir = safe_join(server_id, directory)
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = Path(upload.filename or "upload.bin").name
    dest = dest_dir / name
    data = await upload.read()
    dest.write_bytes(data)
    return {"status": "ok", "name": name}


@app.get("/api/servers/{server_id}/files/download")
def file_download(
    server_id: str, file: str = Query(...), user: dict[str, Any] = Depends(user_from_header)
) -> FileResponse:
    get_server(server_id, user)
    path = safe_join(server_id, file)
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=path.name)


@app.get("/api/servers/{server_id}/startup")
def get_startup(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    server = get_server(server_id, user)
    with db() as conn:
        egg = row_to_dict(conn.execute("SELECT * FROM eggs WHERE id = ?", (server["egg_id"],)).fetchone())
    variables = []
    if egg:
        try:
            variables = json.loads(egg.get("variables") or "[]")
        except json.JSONDecodeError:
            variables = []
    return {
        "data": {
            "startup": server["startup"],
            "image": server["image"],
            "environment": server.get("environment") or {},
            "variables": variables,
            "invocation": server["startup"],
        }
    }


@app.put("/api/servers/{server_id}/startup")
def put_startup(
    server_id: str, body: StartupBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    env = server.get("environment") or {}
    if body.environment is not None:
        env.update(body.environment)
    startup = body.startup if body.startup is not None else server["startup"]
    with db() as conn:
        conn.execute(
            "UPDATE servers SET startup = ?, environment = ? WHERE id = ?",
            (startup, json.dumps(env), server_id),
        )
    log_activity(user["id"], server_id, "server:startup")
    return {"status": "ok"}


@app.put("/api/servers/{server_id}/settings")
def put_settings(
    server_id: str, body: SettingsBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    name = body.name if body.name is not None else server["name"]
    desc = body.description if body.description is not None else server["description"]
    image = body.image if body.image is not None else server["image"]
    memory = server["memory"]
    cpu = server["cpu"]
    disk = server["disk"]
    if user.get("role") == "admin":
        if body.memory is not None:
            memory = max(32, int(body.memory))
        if body.cpu is not None:
            cpu = max(10, int(body.cpu))
        if body.disk is not None:
            disk = max(128, int(body.disk))
    with db() as conn:
        conn.execute(
            "UPDATE servers SET name = ?, description = ?, image = ?, memory = ?, cpu = ?, disk = ? WHERE id = ?",
            (name, desc, image, memory, cpu, disk, server_id),
        )
    return {"status": "ok"}


@app.post("/api/servers/{server_id}/reinstall")
def reinstall(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    env = {
        "SERVER_NAME": server["name"],
        "SERVER_PORT": str(server["allocation_port"]),
        "SERVER_MEMORY": str(server["memory"]),
        "SERVER_IP": server["allocation_ip"],
        "IMAGE": server["image"],
        **(server.get("environment") or {}),
    }
    install_egg_files(server_id, server["egg_id"], env)
    log_activity(user["id"], server_id, "server:reinstall")
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/databases")
def list_databases(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        rows = conn.execute("SELECT * FROM databases WHERE server_id = ?", (server_id,)).fetchall()
    return {"data": rows_to_list(rows)}


@app.post("/api/servers/{server_id}/databases")
def create_database(
    server_id: str, body: DatabaseBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    get_server(server_id, user)
    username = f"u{server_id[:6]}"
    password = uuid.uuid4().hex[:16]
    dbname = "".join(ch for ch in body.name.lower() if ch.isalnum() or ch == "_")[:32] or "sdb"
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO databases (server_id, name, username, password, host, port, created_at)
               VALUES (?, ?, ?, ?, '127.0.0.1', 3306, ?)""",
            (server_id, dbname, username, password, utcnow()),
        )
        rid = cur.lastrowid
        row = conn.execute("SELECT * FROM databases WHERE id = ?", (rid,)).fetchone()
    path = SERVERS_DIR / server_id / ".kestrel" / "db"
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{dbname}.sqlite").touch()
    return {"data": row_to_dict(row)}


@app.delete("/api/servers/{server_id}/databases/{db_id}")
def delete_database(
    server_id: str, db_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    reject_suspended(get_server(server_id, user))
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM databases WHERE id = ? AND server_id = ?", (db_id, server_id)
        ).fetchone()
        database = row_to_dict(row)
        conn.execute("DELETE FROM databases WHERE id = ? AND server_id = ?", (db_id, server_id))
    if database:
        sqlite_file = SERVERS_DIR / server_id / ".kestrel" / "db" / f"{database['name']}.sqlite"
        if sqlite_file.exists():
            sqlite_file.unlink()
        log_activity(user["id"], server_id, "database:delete", {"name": database["name"]})
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/backups")
def list_backups(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC", (server_id,)
        ).fetchall()
    return {"data": rows_to_list(rows)}


def create_backup_file(server: dict[str, Any], name: str | None = None) -> dict[str, Any]:
    bid = str(uuid.uuid4())
    src = SERVERS_DIR / server["id"]
    dest_dir = BACKUPS_DIR / server["id"]
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{bid}.tar.gz"
    with tarfile.open(dest, "w:gz") as tar:
        if src.exists():
            tar.add(src, arcname=".")
    checksum = hashlib.sha256(dest.read_bytes()).hexdigest()
    label = name or time.strftime("backup-%Y%m%d-%H%M%S", time.gmtime())
    with db() as conn:
        conn.execute(
            """INSERT INTO backups (id, server_id, uuid, name, bytes, checksum, created_at, path, successful)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (bid, server["id"], bid, label, dest.stat().st_size, checksum, utcnow(), str(dest)),
        )
        row = conn.execute("SELECT * FROM backups WHERE id = ?", (bid,)).fetchone()
    return row_to_dict(row) or {}


@app.post("/api/servers/{server_id}/backups")
def create_backup(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    data = create_backup_file(server)
    log_activity(user["id"], server_id, "backup:create", {"id": data.get("id")})
    return {"data": data}


@app.get("/api/servers/{server_id}/backups/{backup_id}/download")
def download_backup(
    server_id: str, backup_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> FileResponse:
    get_server(server_id, user)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM backups WHERE id = ? AND server_id = ?", (backup_id, server_id)
        ).fetchone()
    backup = row_to_dict(row)
    if not backup:
        raise HTTPException(404, "Backup not found")
    archive = Path(backup["path"])
    if not archive.exists():
        raise HTTPException(404, "Backup archive missing")
    return FileResponse(archive, filename=f"{backup['name']}.tar.gz", media_type="application/gzip")


@app.post("/api/servers/{server_id}/backups/{backup_id}/restore")
def restore_backup(
    server_id: str, backup_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    get_server(server_id, user)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM backups WHERE id = ? AND server_id = ?", (backup_id, server_id)
        ).fetchone()
    backup = row_to_dict(row)
    if not backup:
        raise HTTPException(404, "Backup not found")
    src = Path(backup["path"])
    if not src.exists():
        raise HTTPException(404, "Backup archive missing")
    dest = SERVERS_DIR / server_id
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(src, "r:gz") as tar:
        for member in tar.getmembers():
            member_path = Path(member.name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise HTTPException(400, "Backup archive contains an unsafe path")
        tar.extractall(dest)
    log_activity(user["id"], server_id, "backup:restore", {"id": backup_id})
    return {"status": "ok"}


@app.delete("/api/servers/{server_id}/backups/{backup_id}")
def delete_backup(
    server_id: str, backup_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    get_server(server_id, user)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM backups WHERE id = ? AND server_id = ?", (backup_id, server_id)
        ).fetchone()
        backup = row_to_dict(row)
        conn.execute("DELETE FROM backups WHERE id = ? AND server_id = ?", (backup_id, server_id))
    if backup:
        p = Path(backup["path"])
        if p.exists():
            p.unlink()
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/schedules")
def list_schedules(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        rows = conn.execute("SELECT * FROM schedules WHERE server_id = ?", (server_id,)).fetchall()
    return {"data": rows_to_list(rows)}


@app.post("/api/servers/{server_id}/schedules")
def create_schedule(
    server_id: str, body: ScheduleBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO schedules (server_id, name, cron, action, payload, enabled, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (server_id, body.name, body.cron, body.action, body.payload, 1 if body.enabled else 0, utcnow()),
        )
        row = conn.execute("SELECT * FROM schedules WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"data": row_to_dict(row)}


@app.patch("/api/servers/{server_id}/schedules/{schedule_id}")
def update_schedule(
    server_id: str,
    schedule_id: int,
    body: ScheduleStateBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM schedules WHERE id = ? AND server_id = ?", (schedule_id, server_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Schedule not found")
        conn.execute(
            "UPDATE schedules SET enabled = ? WHERE id = ? AND server_id = ?",
            (1 if body.enabled else 0, schedule_id, server_id),
        )
        out = conn.execute("SELECT * FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
    return {"data": row_to_dict(out)}


@app.post("/api/servers/{server_id}/schedules/{schedule_id}/run")
async def run_schedule_now(
    server_id: str, schedule_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM schedules WHERE id = ? AND server_id = ?", (schedule_id, server_id)
        ).fetchone()
    schedule = row_to_dict(row)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    await execute_schedule_action(server, schedule)
    with db() as conn:
        conn.execute("UPDATE schedules SET last_run = ? WHERE id = ?", (utcnow(), schedule_id))
    log_activity(user["id"], server_id, "schedule:run", {"name": schedule["name"]})
    return {"status": "ok"}


@app.delete("/api/servers/{server_id}/schedules/{schedule_id}")
def delete_schedule(
    server_id: str, schedule_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    get_server(server_id, user)
    with db() as conn:
        conn.execute("DELETE FROM schedules WHERE id = ? AND server_id = ?", (schedule_id, server_id))
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/network")
def network(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    server = get_server(server_id, user)
    with db() as conn:
        rows = rows_to_list(
            conn.execute(
                "SELECT * FROM allocations WHERE server_id = ? ORDER BY port", (server_id,)
            ).fetchall()
        )
        node = row_to_dict(conn.execute("SELECT * FROM nodes WHERE id = ?", (server["node_id"],)).fetchone())
        free = conn.execute(
            "SELECT COUNT(*) AS c FROM allocations WHERE node_id = ? AND server_id IS NULL",
            (server["node_id"],),
        ).fetchone()["c"]
    for row in rows:
        row["primary"] = row["port"] == server["allocation_port"] and row["ip"] == server["allocation_ip"]
    return {
        "data": rows,
        "meta": {
            "node_id": server["node_id"],
            "node_name": (node or {}).get("name") or "node",
            "free": free,
        },
    }


@app.post("/api/servers/{server_id}/network")
def add_network_allocation(
    server_id: str,
    body: NetworkBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    with db() as conn:
        if body.allocation_id:
            row = conn.execute(
                "SELECT * FROM allocations WHERE id = ? AND node_id = ? AND server_id IS NULL",
                (body.allocation_id, server["node_id"]),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM allocations WHERE node_id = ? AND server_id IS NULL ORDER BY port LIMIT 1",
                (server["node_id"],),
            ).fetchone()
        alloc = row_to_dict(row)
        if not alloc:
            raise HTTPException(400, "No free allocations are available on this node")
        conn.execute(
            "UPDATE allocations SET server_id = ?, notes = ? WHERE id = ?",
            (server_id, alloc.get("notes") or "additional", alloc["id"]),
        )
        alloc["server_id"] = server_id
    log_activity(user["id"], server_id, "network:assign", {"port": alloc["port"]})
    return {"data": alloc}


@app.post("/api/servers/{server_id}/network/{allocation_id}/primary")
def set_primary_allocation(
    server_id: str, allocation_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM allocations WHERE id = ? AND server_id = ?", (allocation_id, server_id)
        ).fetchone()
        alloc = row_to_dict(row)
        if not alloc:
            raise HTTPException(404, "Allocation not found")
        conn.execute(
            "UPDATE servers SET allocation_ip = ?, allocation_port = ? WHERE id = ?",
            (alloc["ip"], alloc["port"], server_id),
        )
        conn.execute(
            "UPDATE allocations SET notes = 'additional' WHERE server_id = ? AND id != ?",
            (server_id, allocation_id),
        )
        conn.execute("UPDATE allocations SET notes = 'primary' WHERE id = ?", (allocation_id,))
    log_activity(user["id"], server_id, "network:primary", {"port": alloc["port"]})
    return {"status": "ok"}


@app.delete("/api/servers/{server_id}/network/{allocation_id}")
def delete_network_allocation(
    server_id: str, allocation_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM allocations WHERE id = ? AND server_id = ?", (allocation_id, server_id)
        ).fetchone()
        alloc = row_to_dict(row)
        if not alloc:
            raise HTTPException(404, "Allocation not found")
        if alloc["port"] == server["allocation_port"] and alloc["ip"] == server["allocation_ip"]:
            raise HTTPException(400, "Choose another primary allocation before removing this one")
        conn.execute(
            "UPDATE allocations SET server_id = NULL, notes = '' WHERE id = ?", (allocation_id,)
        )
    log_activity(user["id"], server_id, "network:release", {"port": alloc["port"]})
    return {"status": "ok"}


@app.get("/api/servers/{server_id}/users")
def list_subusers(server_id: str, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        rows = conn.execute("SELECT * FROM subusers WHERE server_id = ?", (server_id,)).fetchall()
    data = []
    for r in rows_to_list(rows):
        try:
            r["permissions"] = json.loads(r.get("permissions") or "[]")
        except json.JSONDecodeError:
            r["permissions"] = []
        data.append(r)
    return {"data": data}


@app.post("/api/servers/{server_id}/users")
def create_subuser(
    server_id: str, body: SubuserBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    get_server(server_id, user)
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO subusers (server_id, email, permissions, created_at) VALUES (?, ?, ?, ?)",
            (server_id, body.email, json.dumps(body.permissions), utcnow()),
        )
        row = conn.execute("SELECT * FROM subusers WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"data": row_to_dict(row)}


@app.delete("/api/servers/{server_id}/users/{sub_id}")
def delete_subuser(
    server_id: str, sub_id: int, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, str]:
    get_server(server_id, user)
    with db() as conn:
        conn.execute("DELETE FROM subusers WHERE id = ? AND server_id = ?", (sub_id, server_id))
    return {"status": "ok"}


def ws_user(token: str | None) -> dict[str, Any]:
    payload = decode_token(token or "")
    if not payload:
        raise HTTPException(401, "Invalid token")
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["uid"],)).fetchone()
    user = row_to_dict(row)
    if not user:
        raise HTTPException(401, "Invalid token")
    return user


@app.websocket("/ws/console/{server_id}")
async def ws_console(websocket: WebSocket, server_id: str, token: str = Query("")) -> None:
    await websocket.accept()
    try:
        user = ws_user(token)
        server = get_server(server_id, user)
        reject_suspended(server)
    except HTTPException as exc:
        await websocket.send_json({"event": "error", "message": exc.detail})
        await websocket.close()
        return
    inst = manager.get(server)
    queue = inst.subscribe()
    sender = None

    async def pump() -> None:
        while True:
            line = await queue.get()
            await websocket.send_json({"event": "console output", "args": [line]})

    sender = asyncio.create_task(pump())
    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                await inst.send(message)
                continue
            event = payload.get("event")
            if event == "send command":
                args = payload.get("args") or [""]
                await inst.send(str(args[0]))
            elif event == "set state":
                sig = str((payload.get("args") or ["start"])[0])
                if sig == "start":
                    await inst.start()
                elif sig == "stop":
                    await inst.stop()
                elif sig == "restart":
                    await inst.stop()
                    await inst.start()
                elif sig == "kill":
                    await inst.stop(kill=True)
    except WebSocketDisconnect:
        pass
    finally:
        if sender:
            sender.cancel()
        inst.unsubscribe(queue)


@app.websocket("/ws/stats/{server_id}")
async def ws_stats(websocket: WebSocket, server_id: str, token: str = Query("")) -> None:
    await websocket.accept()
    try:
        user = ws_user(token)
        server = get_server(server_id, user)
    except HTTPException:
        await websocket.close()
        return
    inst = manager.get(server)
    try:
        while True:
            await websocket.send_json({"event": "stats", "args": [inst.stats()]})
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return


@app.api_route("/gate/{server_id}/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def gate_proxy(
    server_id: str,
    full_path: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    # Allow cookie-less preview from the panel origin; token may be query
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    token = token or request.query_params.get("token")
    # Gate is same-origin from the panel; we still require a logged-in token if provided.
    with db() as conn:
        row = conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    server = row_to_dict(row)
    if not server:
        raise HTTPException(404, "Server not found")
    if manager.status_of(server_id) != "running":
        return JSONResponse({"error": "instance offline"}, status_code=502)
    port = server["allocation_port"]
    url = f"http://127.0.0.1:{port}/{full_path}"
    if request.query_params:
        filtered = {k: v for k, v in request.query_params.items() if k != "token"}
        if filtered:
            from urllib.parse import urlencode

            url += "?" + urlencode(filtered)
    import httpx

    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "authorization", "content-length")}
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            resp = await client.request(request.method, url, content=body or None, headers=headers)
    except Exception as exc:
        return JSONResponse({"error": "upstream unreachable", "detail": str(exc)}, status_code=502)
    excluded = {"content-encoding", "transfer-encoding", "content-length"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=resp.content, status_code=resp.status_code, headers=out_headers)


# ── Admin ────────────────────────────────────────────────────────────────────

@app.get("/api/admin/overview")
def admin_overview(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    vm = psutil.virtual_memory()
    du = shutil.disk_usage("/")
    with db() as conn:
        servers = conn.execute("SELECT COUNT(*) AS c FROM servers").fetchone()["c"]
        suspended = conn.execute("SELECT COUNT(*) AS c FROM servers WHERE suspended = 1").fetchone()["c"]
        users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        admins = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").fetchone()["c"]
        eggs = conn.execute("SELECT COUNT(*) AS c FROM eggs").fetchone()["c"]
        backups = conn.execute("SELECT COUNT(*) AS c FROM backups").fetchone()["c"]
        backup_bytes = conn.execute("SELECT COALESCE(SUM(bytes),0) AS s FROM backups").fetchone()["s"]
        nodes = conn.execute("SELECT COUNT(*) AS c FROM nodes").fetchone()["c"]
        locations = conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"]
        databases = conn.execute("SELECT COUNT(*) AS c FROM databases").fetchone()["c"]
        allocations = conn.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN server_id IS NULL THEN 1 ELSE 0 END),0) AS free FROM allocations"
        ).fetchone()
        recent = conn.execute(
            """SELECT a.*, u.username, s.name AS server_name
               FROM activity a
               LEFT JOIN users u ON u.id = a.user_id
               LEFT JOIN servers s ON s.id = a.server_id
               ORDER BY a.id DESC LIMIT 10"""
        ).fetchall()
    running = sum(1 for i in manager.instances.values() if i.proc and i.proc.returncode is None)
    return {
        "data": {
            "servers": servers,
            "running": running,
            "suspended": suspended,
            "users": users,
            "admins": admins,
            "eggs": eggs,
            "backups": backups,
            "backup_bytes": int(backup_bytes or 0),
            "nodes": nodes,
            "locations": locations,
            "databases": databases,
            "allocations": {
                "total": allocations["total"],
                "free": allocations["free"],
                "assigned": allocations["total"] - allocations["free"],
            },
            "docker": docker_available(),
            "hostname": hostname(),
            "version": PANEL_VERSION,
            "wings": WINGS_VERSION,
            "memory": {
                "total": vm.total,
                "used": vm.used,
                "percent": vm.percent,
            },
            "disk": {
                "total": du.total,
                "used": du.used,
                "percent": round(du.used / max(du.total, 1) * 100, 1),
            },
            "cpu": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count() or 1,
            "recent_activity": decode_activity(rows_to_list(recent)),
        }
    }


@app.get("/api/admin/activity")
def admin_activity(
    limit: int = 50,
    offset: int = 0,
    event: str | None = None,
    _: dict[str, Any] = Depends(admin_user),
) -> dict[str, Any]:
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    where = ""
    args: list[Any] = []
    if event:
        where = " WHERE a.event LIKE ?"
        args.append(f"%{event}%")
    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM activity a{where}", args).fetchone()["c"]
        rows = conn.execute(
            f"""SELECT a.*, u.username, s.name AS server_name
                FROM activity a
                LEFT JOIN users u ON u.id = a.user_id
                LEFT JOIN servers s ON s.id = a.server_id
                {where}
                ORDER BY a.id DESC LIMIT ? OFFSET ?""",
            [*args, limit, offset],
        ).fetchall()
    return {"data": decode_activity(rows_to_list(rows)), "total": total, "limit": limit, "offset": offset}


USER_PUBLIC_COLS = "id, username, email, role, first_name, last_name, created_at, last_login"


@app.get("/api/admin/users")
def admin_users(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(f"SELECT {USER_PUBLIC_COLS} FROM users ORDER BY id").fetchall()
        data = []
        for r in rows_to_list(rows):
            r["servers"] = conn.execute(
                "SELECT COUNT(*) AS c FROM servers WHERE owner_id = ?", (r["id"],)
            ).fetchone()["c"]
            data.append(r)
    return {"data": data}


@app.get("/api/admin/users/{user_id}")
def admin_get_user(user_id: int, _: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(f"SELECT {USER_PUBLIC_COLS} FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        data = row_to_dict(row) or {}
        data["servers"] = rows_to_list(
            conn.execute(
                "SELECT id, name, status, allocation_port FROM servers WHERE owner_id = ? ORDER BY name",
                (user_id,),
            ).fetchall()
        )
    return {"data": data}


@app.post("/api/admin/users")
def admin_create_user(body: CreateUserBody, admin: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    if body.role not in ("admin", "user"):
        raise HTTPException(400, "Invalid role")
    username = body.username.strip()
    email = body.email.strip().lower()
    if len(username) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if "@" not in email:
        raise HTTPException(400, "A valid email is required")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    with db() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO users (username, email, password_hash, role, first_name, last_name, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    username,
                    email,
                    hash_password(body.password),
                    body.role,
                    body.first_name.strip(),
                    body.last_name.strip(),
                    utcnow(),
                ),
            )
        except Exception as exc:
            raise HTTPException(400, "Username or email already exists") from exc
        row = conn.execute(f"SELECT {USER_PUBLIC_COLS} FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    log_activity(admin["id"], None, "user:create", {"username": username})
    return {"data": row_to_dict(row)}


@app.put("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: int, body: UpdateUserBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user = row_to_dict(row)
        if not user:
            raise HTTPException(404, "User not found")
        username = (body.username or user["username"]).strip()
        email = (body.email or user["email"]).strip().lower()
        role = body.role or user["role"]
        if role not in ("admin", "user"):
            raise HTTPException(400, "Invalid role")
        if user_id == admin["id"] and role != "admin":
            raise HTTPException(400, "Cannot remove your own administrator role")
        first_name = body.first_name if body.first_name is not None else user.get("first_name") or ""
        last_name = body.last_name if body.last_name is not None else user.get("last_name") or ""
        if len(username) < 3:
            raise HTTPException(400, "Username must be at least 3 characters")
        try:
            if body.password:
                if len(body.password) < 8:
                    raise HTTPException(400, "Password must be at least 8 characters")
                conn.execute(
                    """UPDATE users SET username=?, email=?, role=?, first_name=?, last_name=?, password_hash=?
                       WHERE id=?""",
                    (username, email, role, first_name, last_name, hash_password(body.password), user_id),
                )
            else:
                conn.execute(
                    """UPDATE users SET username=?, email=?, role=?, first_name=?, last_name=? WHERE id=?""",
                    (username, email, role, first_name, last_name, user_id),
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, "Username or email is already in use") from exc
        out = conn.execute(f"SELECT {USER_PUBLIC_COLS} FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"data": row_to_dict(out)}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: dict[str, Any] = Depends(admin_user)) -> dict[str, str]:
    if user_id == admin["id"]:
        raise HTTPException(400, "Cannot delete your own account")
    with db() as conn:
        owned = conn.execute("SELECT COUNT(*) AS c FROM servers WHERE owner_id = ?", (user_id,)).fetchone()["c"]
        if owned:
            raise HTTPException(400, "Transfer or delete this user's servers first")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"status": "ok"}


@app.get("/api/admin/nests")
def admin_nests(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        nests = rows_to_list(conn.execute("SELECT * FROM nests ORDER BY id").fetchall())
        eggs = rows_to_list(conn.execute("SELECT * FROM eggs ORDER BY id").fetchall())
    for e in eggs:
        try:
            e["variables"] = json.loads(e.get("variables") or "[]")
        except json.JSONDecodeError:
            e["variables"] = []
        e.pop("files", None)
    return {"nests": nests, "eggs": eggs}


@app.get("/api/admin/locations")
def admin_locations(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM locations ORDER BY id").fetchall())
        for loc in rows:
            loc["nodes"] = conn.execute(
                "SELECT COUNT(*) AS c FROM nodes WHERE location_id = ?", (loc["id"],)
            ).fetchone()["c"]
    return {"data": rows}


@app.post("/api/admin/locations")
def admin_create_location(
    body: CreateLocationBody, _: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    code = body.short_code.strip().lower().replace(" ", "-")[:16]
    name = body.name.strip()
    if not code or not name:
        raise HTTPException(400, "Short code and name are required")
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO locations (short_code, name, description, created_at) VALUES (?, ?, ?, ?)",
                (code, name, body.description.strip(), utcnow()),
            )
        except Exception as exc:
            raise HTTPException(400, "Location short code already exists") from exc
        row = conn.execute("SELECT * FROM locations WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"data": row_to_dict(row)}


@app.delete("/api/admin/locations/{location_id}")
def admin_delete_location(location_id: int, _: dict[str, Any] = Depends(admin_user)) -> dict[str, str]:
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM nodes WHERE location_id = ?", (location_id,)).fetchone()["c"]
        if n:
            raise HTTPException(400, "Move or delete nodes in this location first")
        conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
    return {"status": "ok"}


@app.get("/api/admin/node-installer/audit")
def admin_node_installer_audit(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    return {"data": _host_audit()}


@app.post("/api/admin/node-installer/install")
def admin_node_installer_start(
    body: AutoInstallNodeBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    count = int(body.port_count or 10)
    if count < 1 or count > 100:
        raise HTTPException(400, "Allocation count must be between 1 and 100")
    start = ALLOC_PORT_START if body.port_start is None else int(body.port_start)
    if start < ALLOC_PORT_START or start + count - 1 > ALLOC_PORT_END:
        raise HTTPException(
            400,
            f"Choose a start port between {ALLOC_PORT_START} and {ALLOC_PORT_END - count + 1}",
        )
    name = (body.name or "").strip()
    if len(name) > 64:
        raise HTTPException(400, "Node name must be 64 characters or fewer")
    if body.memory is not None and not (512 <= body.memory <= 1048576):
        raise HTTPException(400, "Memory must be between 512 and 1048576 MiB")
    if body.disk is not None and not (1024 <= body.disk <= 10485760):
        raise HTTPException(400, "Disk must be between 1024 and 10485760 MiB")
    if body.cpu is not None and not (100 <= body.cpu <= 100000):
        raise HTTPException(400, "CPU must be between 100 and 100000 percent")
    with db() as conn:
        existing = _existing_local_node(conn)
        if body.location_id is not None:
            if not conn.execute(
                "SELECT id FROM locations WHERE id = ?", (body.location_id,)
            ).fetchone():
                raise HTTPException(400, "Location not found")
        if name:
            duplicate = conn.execute(
                "SELECT id FROM nodes WHERE lower(name) = lower(?)", (name,)
            ).fetchone()
            if duplicate and (not existing or duplicate["id"] != existing["id"]):
                raise HTTPException(409, f"Another node already uses the name {name}")

    job_id = uuid.uuid4().hex[:12]
    with _INSTALL_LOCK:
        if len(_INSTALL_JOBS) >= 12:
            finished = sorted(
                (
                    job
                    for job in _INSTALL_JOBS.values()
                    if job["status"] in {"success", "failed"}
                ),
                key=lambda job: job["created_at"],
            )
            for old in finished[: max(1, len(_INSTALL_JOBS) - 10)]:
                _INSTALL_JOBS.pop(old["id"], None)
        job = {
            "id": job_id,
            "status": "queued",
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "steps": [
                {"id": step_id, "label": label, "status": "pending", "detail": ""}
                for step_id, label in _INSTALL_STEPS
            ],
            "logs": [],
            "result": None,
            "error": None,
        }
        _INSTALL_JOBS[job_id] = job
        snapshot = copy.deepcopy(job)
    thread = threading.Thread(
        target=_run_node_install,
        args=(job_id, body.model_dump(), admin["id"]),
        name=f"node-installer-{job_id}",
        daemon=True,
    )
    thread.start()
    return {"data": snapshot}


@app.get("/api/admin/node-installer/jobs/{job_id}")
def admin_node_installer_job(
    job_id: str, _: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    job = _install_snapshot(job_id)
    if not job:
        raise HTTPException(404, "Installer job not found")
    return {"data": job}


@app.get("/api/admin/nodes")
def admin_nodes(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM nodes ORDER BY id").fetchall())
        data = [decorate_node(n, conn) for n in rows]
    return {"data": data}


@app.get("/api/admin/nodes/{node_id}")
def admin_get_node(node_id: int, _: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Node not found")
        raw = row_to_dict(row) or {}
        token_value = raw.get("daemon_token") or ""
        node = decorate_node(raw, conn)
        allocs = rows_to_list(
            conn.execute("SELECT * FROM allocations WHERE node_id = ? ORDER BY port", (node_id,)).fetchall()
        )
        servers = rows_to_list(
            conn.execute(
                """SELECT s.id, s.name, s.status, s.memory, s.disk, s.allocation_port, u.username AS owner_name
                   FROM servers s JOIN users u ON u.id = s.owner_id
                   WHERE s.node_id = ? ORDER BY s.name""",
                (node_id,),
            ).fetchall()
        )
    live = None
    if node_connected(node):
        vm = psutil.virtual_memory()
        du = shutil.disk_usage("/")
        live = {
            "cpu": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count(),
            "memory": {"total": vm.total, "used": vm.used, "percent": vm.percent},
            "disk": {"total": du.total, "used": du.used},
            "hostname": hostname(),
            "docker": docker_available(),
        }
    token = token_value
    config = (
        f"debug: false\n"
        f"uuid: {node.get('uuid')}\n"
        f"token_id: {str(node.get('uuid') or '')[:8]}\n"
        f"token: {token}\n"
        f"api:\n"
        f"  host: 0.0.0.0\n"
        f"  port: {node.get('daemon_listen')}\n"
        f"  ssl:\n"
        f"    enabled: false\n"
        f"system:\n"
        f"  data: /var/lib/vitestl/volumes\n"
        f"  sftp:\n"
        f"    bind_port: {node.get('daemon_sftp')}\n"
        f"allowed_mounts: []\n"
        f"remote: {node.get('scheme')}://{node.get('fqdn')}\n"
    )
    node.pop("daemon_token", None)
    return {"data": {**node, "live": live, "allocation_list": allocs, "server_list": servers, "wings_config": config, "token": token}}


@app.post("/api/admin/nodes")
def admin_create_node(body: CreateNodeBody, _: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    if not body.name.strip() or not body.fqdn.strip():
        raise HTTPException(400, "Name and FQDN are required")
    with db() as conn:
        loc = conn.execute("SELECT id FROM locations WHERE id = ?", (body.location_id,)).fetchone()
        if not loc:
            raise HTTPException(400, "Location not found")
        cur = conn.execute(
            """INSERT INTO nodes
            (uuid, location_id, name, fqdn, scheme, memory, memory_overallocate, disk, disk_overallocate,
             cpu, daemon_token, daemon_listen, daemon_sftp, behind_proxy, public, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                body.location_id,
                body.name.strip(),
                body.fqdn.strip(),
                body.scheme if body.scheme in ("http", "https") else "http",
                max(0, body.memory),
                max(0, body.memory_overallocate),
                max(0, body.disk),
                max(0, body.disk_overallocate),
                max(100, body.cpu),
                secrets.token_urlsafe(32),
                max(1, body.daemon_listen),
                max(1, body.daemon_sftp),
                1 if body.behind_proxy else 0,
                1 if body.public else 0,
                utcnow(),
            ),
        )
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (cur.lastrowid,)).fetchone()
        data = decorate_node(row_to_dict(row) or {}, conn)
    return {"data": data}


@app.put("/api/admin/nodes/{node_id}")
def admin_update_node(
    node_id: int, body: UpdateNodeBody, _: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        node = row_to_dict(row)
        if not node:
            raise HTTPException(404, "Node not found")
        name = body.name.strip() if body.name is not None else node["name"]
        fqdn = body.fqdn.strip() if body.fqdn is not None else node["fqdn"]
        location_id = body.location_id if body.location_id is not None else node["location_id"]
        if not name or not fqdn:
            raise HTTPException(400, "Name and FQDN are required")
        if not conn.execute("SELECT id FROM locations WHERE id = ?", (location_id,)).fetchone():
            raise HTTPException(400, "Location not found")
        memory = max(0, body.memory) if body.memory is not None else node["memory"]
        disk = max(0, body.disk) if body.disk is not None else node["disk"]
        cpu = max(100, body.cpu) if body.cpu is not None else node["cpu"]
        scheme = body.scheme if body.scheme in ("http", "https") else node["scheme"]
        daemon_listen = body.daemon_listen if body.daemon_listen is not None else node["daemon_listen"]
        daemon_sftp = body.daemon_sftp if body.daemon_sftp is not None else node["daemon_sftp"]
        mem_over = (
            body.memory_overallocate
            if body.memory_overallocate is not None
            else node["memory_overallocate"]
        )
        disk_over = (
            body.disk_overallocate
            if body.disk_overallocate is not None
            else node["disk_overallocate"]
        )
        behind_proxy = 1 if (body.behind_proxy if body.behind_proxy is not None else node["behind_proxy"]) else 0
        maintenance = 1 if (body.maintenance if body.maintenance is not None else node["maintenance"]) else 0
        public = 1 if (body.public if body.public is not None else node["public"]) else 0
        conn.execute(
            """UPDATE nodes SET name=?, fqdn=?, location_id=?, memory=?, disk=?, cpu=?, scheme=?,
               daemon_listen=?, daemon_sftp=?, memory_overallocate=?, disk_overallocate=?,
               behind_proxy=?, maintenance=?, public=? WHERE id=?""",
            (
                name,
                fqdn,
                location_id,
                memory,
                disk,
                cpu,
                scheme,
                daemon_listen,
                daemon_sftp,
                mem_over,
                disk_over,
                behind_proxy,
                maintenance,
                public,
                node_id,
            ),
        )
        out = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        data = decorate_node(row_to_dict(out) or {}, conn)
    return {"data": data}


@app.post("/api/admin/nodes/{node_id}/regenerate-token")
def admin_regenerate_node_token(
    node_id: int, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Node not found")
        conn.execute("UPDATE nodes SET daemon_token = ? WHERE id = ?", (token, node_id))
        node = row_to_dict(row) or {}
    log_activity(admin["id"], None, "node:token", {"node": node.get("name")})
    return {"token": token}


@app.delete("/api/admin/nodes/{node_id}")
def admin_delete_node(node_id: int, _: dict[str, Any] = Depends(admin_user)) -> dict[str, str]:
    if node_id == 1:
        raise HTTPException(400, "The primary node cannot be deleted")
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM servers WHERE node_id = ?", (node_id,)).fetchone()["c"]
        if n:
            raise HTTPException(400, "Move or delete servers on this node first")
        conn.execute("DELETE FROM allocations WHERE node_id = ?", (node_id,))
        conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
    return {"status": "ok"}


@app.post("/api/admin/nodes/{node_id}/allocations")
def admin_create_allocations(
    node_id: int, body: AllocationRangeBody, _: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    start, end = int(body.start), int(body.end)
    if start < 1 or end < start or end > 65535:
        raise HTTPException(400, "Invalid port range")
    if end - start > 200:
        raise HTTPException(400, "Port range too large (max 200)")
    created = 0
    skipped = 0
    with db() as conn:
        node = conn.execute("SELECT id FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(404, "Node not found")
        for port in range(start, end + 1):
            try:
                conn.execute(
                    "INSERT INTO allocations (ip, port, server_id, notes, node_id) VALUES (?, ?, NULL, ?, ?)",
                    (body.ip.strip() or "0.0.0.0", port, body.notes, node_id),
                )
                created += 1
            except Exception:
                skipped += 1
    return {"created": created, "skipped": skipped}


@app.get("/api/admin/allocations")
def admin_allocations(
    node_id: int | None = None,
    unassigned: bool = False,
    _: dict[str, Any] = Depends(admin_user),
) -> dict[str, Any]:
    q = "SELECT * FROM allocations WHERE 1=1"
    args: list[Any] = []
    if node_id is not None:
        q += " AND node_id = ?"
        args.append(node_id)
    if unassigned:
        q += " AND server_id IS NULL"
    q += " ORDER BY port"
    with db() as conn:
        rows = conn.execute(q, args).fetchall()
    return {"data": rows_to_list(rows)}


@app.delete("/api/admin/allocations/{allocation_id}")
def admin_delete_allocation(
    allocation_id: int, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, str]:
    with db() as conn:
        row = conn.execute("SELECT * FROM allocations WHERE id = ?", (allocation_id,)).fetchone()
        allocation = row_to_dict(row)
        if not allocation:
            raise HTTPException(404, "Allocation not found")
        if allocation.get("server_id"):
            raise HTTPException(400, "Release this allocation from its server before deleting it")
        conn.execute("DELETE FROM allocations WHERE id = ?", (allocation_id,))
    log_activity(admin["id"], None, "allocation:delete", {"port": allocation["port"]})
    return {"status": "ok"}


@app.post("/api/admin/servers")
async def admin_create_server(
    body: CreateServerBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    egg = egg_by_id(body.egg_id)
    if not egg:
        raise HTTPException(400, "Unknown egg")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Server name is required")
    sid, short = new_server_id()
    with db() as conn:
        owner_id = body.owner_id or admin["id"]
        owner = conn.execute("SELECT id FROM users WHERE id = ?", (owner_id,)).fetchone()
        if not owner:
            raise HTTPException(400, "Owner not found")
        node_id = body.node_id or 1
        node = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(400, "Node not found")
        node_d = row_to_dict(node) or {}
        if node_d.get("maintenance"):
            raise HTTPException(400, "Node is in maintenance mode")
        used_mem = conn.execute(
            "SELECT COALESCE(SUM(memory),0) AS s FROM servers WHERE node_id = ?", (node_id,)
        ).fetchone()["s"]
        used_disk = conn.execute(
            "SELECT COALESCE(SUM(disk),0) AS s FROM servers WHERE node_id = ?", (node_id,)
        ).fetchone()["s"]
        mem_limit = int(node_d.get("memory") or 0) * (1 + int(node_d.get("memory_overallocate") or 0) / 100)
        disk_limit = int(node_d.get("disk") or 0) * (1 + int(node_d.get("disk_overallocate") or 0) / 100)
        if int(used_mem) + body.memory > mem_limit:
            raise HTTPException(400, "This node does not have enough memory capacity")
        if int(used_disk) + body.disk > disk_limit:
            raise HTTPException(400, "This node does not have enough disk capacity")
        body.memory = max(32, int(body.memory))
        body.cpu = max(10, int(body.cpu))
        body.disk = max(128, int(body.disk))
        alloc_ip = "0.0.0.0"
        port = body.allocation_port
        if body.allocation_id:
            alloc = row_to_dict(
                conn.execute(
                    "SELECT * FROM allocations WHERE id = ? AND server_id IS NULL",
                    (body.allocation_id,),
                ).fetchone()
            )
            if not alloc:
                raise HTTPException(400, "Allocation is missing or already assigned")
            if alloc.get("node_id") and int(alloc["node_id"]) != int(node_id):
                raise HTTPException(400, "Allocation belongs to a different node")
            port = alloc["port"]
            alloc_ip = alloc["ip"]
            conn.execute("UPDATE allocations SET server_id = ?, notes = 'primary' WHERE id = ?", (sid, body.allocation_id))
        else:
            port = port or next_port(conn)
            conn.execute(
                "INSERT INTO allocations (ip, port, server_id, notes, node_id) VALUES (?, ?, ?, ?, ?)",
                (alloc_ip, port, sid, "primary", node_id),
            )
        env = {
            "SERVER_NAME": name,
            "SERVER_PORT": str(port),
            "SERVER_MEMORY": str(body.memory),
            "SERVER_IP": alloc_ip,
            "IMAGE": egg["docker_image"],
            **body.environment,
        }
        for var in egg.get("variables") or []:
            env.setdefault(var["env"], var.get("default") or "")
        startup = substitute(egg["startup"], env)
        conn.execute(
            """INSERT INTO servers
            (id, short_id, name, description, egg_id, owner_id, node_id, memory, cpu, disk, swap, io,
             allocation_ip, allocation_port, startup, image, environment, status, created_at, installed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 500, ?, ?, ?, ?, ?, 'offline', ?, 1)""",
            (
                sid,
                short,
                name,
                body.description.strip(),
                body.egg_id,
                owner_id,
                node_id,
                body.memory,
                body.cpu,
                body.disk,
                alloc_ip,
                port,
                startup,
                egg["docker_image"],
                json.dumps(body.environment),
                utcnow(),
            ),
        )
    install_egg_files(sid, body.egg_id, env)
    log_activity(admin["id"], sid, "server:create", {"node_id": node_id})
    with db() as conn:
        row = conn.execute(
            """SELECT s.*, e.name AS egg_name, n.name AS nest_name, u.username AS owner_name
               FROM servers s
               JOIN eggs e ON e.id = s.egg_id
               JOIN nests n ON n.id = e.nest_id
               JOIN users u ON u.id = s.owner_id
               WHERE s.id = ?""",
            (sid,),
        ).fetchone()
    server = decorate_server(row_to_dict(row) or {})
    if body.start_on_completion:
        inst = manager.get(row_to_dict(row) or server)
        await inst.start()
        server["status"] = inst.status
        server["resources"] = inst.stats()
    return {"data": server}


@app.post("/api/admin/servers/{server_id}/suspend")
async def admin_suspend_server(
    server_id: str, body: SuspendBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    server = row_to_dict(row)
    if not server:
        raise HTTPException(404, "Server not found")
    if body.suspended:
        inst = manager.get(server)
        await inst.stop(kill=True)
    with db() as conn:
        conn.execute(
            "UPDATE servers SET suspended = ?, suspended_reason = ? WHERE id = ?",
            (1 if body.suspended else 0, body.reason.strip() if body.suspended else "", server_id),
        )
        out = conn.execute(
            """SELECT s.*, e.name AS egg_name, n.name AS nest_name, u.username AS owner_name
               FROM servers s
               JOIN eggs e ON e.id = s.egg_id
               JOIN nests n ON n.id = e.nest_id
               JOIN users u ON u.id = s.owner_id
               WHERE s.id = ?""",
            (server_id,),
        ).fetchone()
    log_activity(
        admin["id"],
        server_id,
        "server:suspend" if body.suspended else "server:unsuspend",
        {"reason": body.reason} if body.reason else {},
    )
    return {"data": decorate_server(row_to_dict(out) or {})}


@app.post("/api/admin/servers/{server_id}/transfer")
def admin_transfer_server(
    server_id: str, body: TransferBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, str]:
    with db() as conn:
        server = row_to_dict(conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone())
        if not server:
            raise HTTPException(404, "Server not found")
        owner = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (body.owner_id,)).fetchone())
        if not owner:
            raise HTTPException(400, "Owner not found")
        if server["owner_id"] == owner["id"]:
            raise HTTPException(400, "This user already owns the server")
        conn.execute("UPDATE servers SET owner_id = ? WHERE id = ?", (owner["id"], server_id))
    log_activity(
        admin["id"],
        server_id,
        "server:transfer",
        {"from": server["owner_id"], "to": owner["id"]},
    )
    return {"status": "ok"}


@app.delete("/api/admin/servers/{server_id}")
async def admin_delete_server(
    server_id: str,
    delete_files: bool = Query(True),
    delete_backups: bool = Query(True),
    admin: dict[str, Any] = Depends(admin_user),
) -> dict[str, str]:
    with db() as conn:
        row = conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
    server = row_to_dict(row)
    if not server:
        raise HTTPException(404, "Server not found")
    inst = manager.get(server)
    await inst.stop(kill=True)
    manager.instances.pop(server_id, None)
    with db() as conn:
        conn.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        conn.execute("DELETE FROM allocations WHERE server_id = ?", (server_id,))
        conn.execute("DELETE FROM databases WHERE server_id = ?", (server_id,))
        conn.execute("DELETE FROM backups WHERE server_id = ?", (server_id,))
        conn.execute("DELETE FROM schedules WHERE server_id = ?", (server_id,))
        conn.execute("DELETE FROM subusers WHERE server_id = ?", (server_id,))
    if delete_files:
        shutil.rmtree(SERVERS_DIR / server_id, ignore_errors=True)
    if delete_backups:
        shutil.rmtree(BACKUPS_DIR / server_id, ignore_errors=True)
    log_activity(
        admin["id"],
        server_id,
        "server:delete",
        {"name": server["name"], "files": delete_files, "backups": delete_backups},
    )
    return {"status": "ok"}


@app.get("/api/admin/settings")
def admin_settings(_: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {"data": {r["key"]: r["value"] for r in rows}}


@app.put("/api/admin/settings")
def admin_update_settings(
    body: PanelSettingsBody, admin: dict[str, Any] = Depends(admin_user)
) -> dict[str, Any]:
    updates: dict[str, str] = {}
    if body.company is not None:
        updates["company"] = body.company.strip()[:120]
    if body.support_email is not None:
        updates["support_email"] = body.support_email.strip()[:160]
    if body.registration is not None:
        updates["registration"] = "true" if body.registration else "false"
    if body.theme is not None:
        if body.theme not in ("dark", "light"):
            raise HTTPException(400, "Theme must be dark or light")
        updates["theme"] = body.theme
    with db() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
    log_activity(admin["id"], None, "settings:update", {"keys": list(updates)})
    return admin_settings(admin)


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    settings = {r["key"]: r["value"] for r in rows}
    return {
        "name": PANEL_NAME,
        "version": PANEL_VERSION,
        "company": settings.get("company", PANEL_COMPANY),
        "support_email": settings.get("support_email", ""),
        "registration": settings.get("registration", "false") == "true",
        "theme": settings.get("theme", "dark"),
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
