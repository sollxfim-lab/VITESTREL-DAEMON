from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
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
from db import (
    db,
    init_db,
    log_activity,
    new_server_id,
    next_custom_id,
    next_port,
    parse_tags,
    row_to_dict,
    rows_to_list,
    sync_catalog,
    utcnow,
)
from eggs import NESTS, EGGS, default_egg_files, egg_by_id
from minecraft import MinecraftError
from minecraft import catalog as minecraft_catalog
from minecraft import check_update as minecraft_check_update
from minecraft import content_capabilities as minecraft_capabilities
from minecraft import content_update as minecraft_content_update
from minecraft import install_content as minecraft_install_content
from minecraft import install_server as minecraft_install_server
from minecraft import installed_content as minecraft_installed_content
from minecraft import java_status as minecraft_java_status
from minecraft import bedrock_status as minecraft_bedrock_status
from minecraft import latest_release as minecraft_latest_release
from minecraft import read_install_metadata as minecraft_install_metadata
from minecraft import read_server_properties as minecraft_read_properties
from minecraft import search_content as minecraft_search_content
from minecraft import software as minecraft_software
from minecraft import content_versions as minecraft_content_versions
from minecraft import delete_content as minecraft_delete_content
from minecraft import store_uploaded_content as minecraft_store_upload
from minecraft import toggle_content as minecraft_toggle_content
from minecraft import update_properties as minecraft_update_properties
from minecraft import versions as minecraft_versions
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
    minecraft: dict[str, Any] | None = None
    accept_eula: bool = False


class MinecraftInstallBody(BaseModel):
    software: str
    version: str = ""
    loader_version: str = ""
    accept_eula: bool = False
    properties: dict[str, Any] = {}


class MinecraftPropertiesBody(BaseModel):
    properties: dict[str, Any] = {}


class MinecraftUpgradeBody(BaseModel):
    version: str = ""
    loader_version: str | None = None
    accept_eula: bool = False
    backup: bool = True


class TerminalSudoBody(BaseModel):
    enabled: bool


class PluginUpdateBody(BaseModel):
    version_id: str | None = None


class PluginInstallBody(BaseModel):
    project_id: str
    version_id: str | None = None


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


class NestBody(BaseModel):
    name: str
    description: str = ""


class EggBody(BaseModel):
    nest_id: int
    name: str
    description: str = ""
    docker_image: str = "python:3.11-slim"
    startup: str = "python3 main.py"
    stop_command: str = "^C"
    runtime: str = "process"
    files: dict[str, str] | None = None
    variables: list[dict[str, Any]] | None = None


class ApiKeyBody(BaseModel):
    name: str


class TagsBody(BaseModel):
    tags: list[str] = []


def load_egg(egg_id: int) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM eggs WHERE id = ?", (egg_id,)).fetchone()
    egg = row_to_dict(row)
    if egg:
        try:
            files = json.loads(egg.get("files") or "{}")
        except json.JSONDecodeError:
            files = {}
        try:
            variables = json.loads(egg.get("variables") or "[]")
        except json.JSONDecodeError:
            variables = []
        egg["files"] = files if isinstance(files, dict) else {}
        egg["variables"] = variables if isinstance(variables, list) else []
        return egg
    return egg_by_id(egg_id)


def resolve_egg(egg_id: int) -> dict[str, Any] | None:
    """Resolve an egg and repair the built-in catalogue when a row is missing.

    ``load_egg`` falls back to the static catalogue so requests keep working
    during a rolling upgrade. The database row still has to exist because
    servers, nests and administration screens join against it. Re-syncing here
    makes the fallback self-healing instead of leaving an orphaned server.
    """
    with db() as conn:
        row = conn.execute("SELECT id FROM eggs WHERE id = ?", (egg_id,)).fetchone()
    if not row:
        with db() as conn:
            sync_catalog(conn)
    return load_egg(egg_id)


def builtin_egg_ids() -> list[int]:
    return sorted(int(egg["id"]) for egg in EGGS)


def catalog_health(conn: Any) -> dict[str, Any]:
    expected = {int(egg["id"]) for egg in EGGS}
    installed = {
        int(row["id"])
        for row in conn.execute("SELECT id FROM eggs").fetchall()
        if int(row["id"]) in expected
    }
    return {
        "expected": len(expected),
        "installed": len(installed),
        "missing": sorted(expected - installed),
    }


def hash_api_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_from_header(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Unauthenticated")
    raw = authorization.split(" ", 1)[1].strip()
    if raw.startswith("vt_"):
        token_hash = hash_api_key(raw)
        with db() as conn:
            key = row_to_dict(
                conn.execute("SELECT * FROM api_keys WHERE token_hash = ?", (token_hash,)).fetchone()
            )
            if not key:
                raise HTTPException(401, "Invalid token")
            conn.execute("UPDATE api_keys SET last_used = ? WHERE id = ?", (utcnow(), key["id"]))
            row = conn.execute("SELECT * FROM users WHERE id = ?", (key["user_id"],)).fetchone()
        user = row_to_dict(row)
        if not user:
            raise HTTPException(401, "User missing")
        user.pop("password_hash", None)
        user["api_key_id"] = key["id"]
        return user
    payload = decode_token(raw)
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


# ---------------------------------------------------------------------------
# Owner terminal
# ---------------------------------------------------------------------------

TERMINAL_TIMEOUT = 120
TERMINAL_OUTPUT_LIMIT = 1024 * 1024
TERMINAL_COMMAND_LIMIT = 4096
TERMINAL_CD_RE = re.compile(r"^\s*cd(?:\s+(.*?))?\s*$")


def terminal_allowed(server: dict[str, Any], user: dict[str, Any]) -> bool:
    """The terminal is deliberately narrower than normal server access.

    Subusers get the console and file manager, but shell access on the panel
    host stays with the owner and administrators.
    """

    return user.get("role") == "admin" or int(server.get("owner_id") or 0) == int(
        user.get("id") or 0
    )


def require_terminal(server: dict[str, Any], user: dict[str, Any]) -> None:
    if not terminal_allowed(server, user):
        raise HTTPException(403, "Terminal access is limited to the server owner and administrators")


def terminal_root(server_id: str) -> Path:
    root = SERVERS_DIR / server_id
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def sudo_available() -> bool:
    return os.name != "nt" and shutil.which("sudo") is not None


def terminal_shell_name() -> str:
    return "powershell" if os.name == "nt" else "bash"


def terminal_relative(path: Path, root: Path) -> str:
    try:
        rel = path.resolve().relative_to(root)
    except (ValueError, OSError):
        return "/"
    value = rel.as_posix().strip("/")
    return "/" + value if value else "/"


def terminal_resolve_directory(root: Path, current: Path, argument: str) -> Path:
    raw = (argument or "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
        raw = raw[1:-1]
    if raw in ("", "~"):
        target = root
    elif raw.startswith("/"):
        # A leading slash is rooted at the server directory, not the host.
        target = (root / raw.lstrip("/")).resolve()
    else:
        target = (current / raw).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("the path leaves this server's directory") from exc
    if not target.is_dir():
        raise ValueError("no such directory")
    return target


def terminal_environment(root: Path, server_id: str, server_name: str) -> dict[str, str]:
    if os.name == "nt":
        env = {
            key: os.environ[key]
            for key in ("SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE")
            if os.environ.get(key)
        }
        env.setdefault("PATH", os.environ.get("PATH", ""))
        env["HOME"] = str(root)
    else:
        env = {
            "PATH": os.environ.get(
                "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            ),
            "HOME": str(root),
            "USER": os.environ.get("USER", "vitestl"),
            "LOGNAME": os.environ.get("LOGNAME") or os.environ.get("USER", "vitestl"),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "TERM": "xterm-256color",
        }
    env.update(
        {
            "SERVER_ID": server_id,
            "SERVER_NAME": server_name,
            "SERVER_DIR": str(root),
            "PYTHONUNBUFFERED": "1",
        }
    )
    return env


def terminal_payload(server: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    return {
        "user": user.get("username") or "operator",
        "server": server.get("name") or "server",
        "cwd": "/",
        "root": "/",
        "sudo": bool(server.get("terminal_sudo")),
        "can_toggle_sudo": user.get("role") == "admin",
        "sudo_available": sudo_available(),
        "shell": terminal_shell_name(),
        "platform": platform.system(),
        "timeout_seconds": TERMINAL_TIMEOUT,
    }


async def sudo_ready() -> tuple[bool, str]:
    if not sudo_available():
        return False, "sudo is not installed on this node"
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo",
            "-n",
            "true",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=4)
    except (OSError, asyncio.TimeoutError) as exc:
        return False, f"sudo could not be verified: {exc}"
    if proc.returncode == 0:
        return True, ""
    detail = stderr.decode("utf-8", errors="replace").strip().splitlines()
    reason = detail[-1] if detail else "a password is required"
    return (
        False,
        f"Non-interactive sudo is unavailable ({reason}). Configure NOPASSWD in sudoers "
        "for the panel service account before enabling this control.",
    )


def signal_terminal_process(proc: asyncio.subprocess.Process, force: bool = False) -> None:
    if proc.returncode is not None:
        return
    if os.name == "nt":
        if force:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            proc.terminate()
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL if force else signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill() if force else proc.terminate()
        except (ProcessLookupError, OSError):
            pass


async def terminate_terminal_process(proc: asyncio.subprocess.Process) -> None:
    signal_terminal_process(proc, force=False)
    try:
        await asyncio.wait_for(proc.wait(), timeout=1.5)
    except asyncio.TimeoutError:
        signal_terminal_process(proc, force=True)
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            pass


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
    egg = resolve_egg(egg_id)
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


# ---------------------------------------------------------------------------
# Minecraft provisioning jobs
# ---------------------------------------------------------------------------

MC_JOBS: dict[str, dict[str, Any]] = {}
MC_JOB_LOCK = threading.Lock()


def _mc_job_log(job_id: str, message: str) -> None:
    line = f"[{utcnow()}] {str(message)[:800]}"
    with MC_JOB_LOCK:
        job = MC_JOBS.get(job_id)
        if not job:
            return
        job["logs"].append(line)
        if len(job["logs"]) > 600:
            del job["logs"][:100]
        job["updated_at"] = utcnow()


def _mc_job_update(job_id: str, **fields: Any) -> None:
    with MC_JOB_LOCK:
        job = MC_JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = utcnow()


def _mc_job_snapshot(job_id: str) -> dict[str, Any] | None:
    with MC_JOB_LOCK:
        job = MC_JOBS.get(job_id)
        if not job:
            return None
        data = {key: value for key, value in job.items() if key != "logs"}
        data["logs"] = list(job["logs"])
        return data


def _latest_mc_job(server_id: str) -> dict[str, Any] | None:
    with MC_JOB_LOCK:
        matches = [job for job in MC_JOBS.values() if job.get("server_id") == server_id]
    if not matches:
        return None
    matches.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return _mc_job_snapshot(matches[0]["id"])


def _mc_config(payload: dict[str, Any] | None, default_software: str) -> dict[str, Any]:
    raw = payload or {}
    meta = minecraft_software(str(raw.get("software") or default_software))
    version = str(raw.get("version") or "").strip()[:80]
    loader = str(raw.get("loader_version") or "").strip()[:128]
    properties = raw.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    clean_properties = {
        str(key)[:64]: str(value)[:256]
        for key, value in properties.items()
        if str(key) and "\n" not in str(key)
    }
    return {
        "software": meta["id"],
        "software_name": meta["name"],
        "edition": meta["edition"],
        "kind": meta["kind"],
        "version": version,
        "loader_version": loader,
        "accept_eula": bool(raw.get("accept_eula")),
        "properties": clean_properties,
    }


def _server_mc_software(server: dict[str, Any]) -> str:
    software_id = str(server.get("mc_software") or "").strip().lower()
    if software_id:
        return software_id
    if int(server.get("egg_id") or 0) == 28:
        return "bedrock"
    if int(server.get("egg_id") or 0) == 27:
        return "vanilla"
    return ""


def _mc_install_worker(job_id: str, server_id: str, config: dict[str, Any], actor_id: int | None) -> None:
    job = _mc_job_snapshot(job_id)
    if not job:
        return
    software_id = config["software"]
    version = config["version"]
    _mc_job_update(job_id, status="running", progress=5)
    _mc_job_log(job_id, f"Starting {config['software_name']} provisioning")
    with db() as conn:
        conn.execute(
            "UPDATE servers SET mc_status = 'installing', mc_message = ? WHERE id = ?",
            ("Downloading server files", server_id),
        )
    root = SERVERS_DIR / server_id
    try:
        result = minecraft_install_server(
            root,
            software_id,
            version=version,
            loader_version=config["loader_version"],
            memory=int(job.get("memory") or 2048),
            port=int(job.get("port") or 25565),
            accept_eula=bool(config["accept_eula"]),
            properties=config["properties"],
            log=lambda line: _mc_job_log(job_id, line),
        )
        _mc_job_update(job_id, progress=85)
        with db() as conn:
            row = conn.execute("SELECT environment FROM servers WHERE id = ?", (server_id,)).fetchone()
            try:
                environment = json.loads((row["environment"] if row else "") or "{}")
            except (json.JSONDecodeError, TypeError):
                environment = {}
            environment.update(
                {
                    "MC_SOFTWARE": result["software"],
                    "MC_VERSION": result["version"],
                    "MC_LOADER": result["loader_version"],
                    "MOTD": str(config["properties"].get("motd") or environment.get("MOTD") or ""),
                }
            )
            conn.execute(
                """UPDATE servers SET startup = ?, image = ?, environment = ?,
                   mc_software = ?, mc_version = ?, mc_loader_version = ?,
                   mc_status = 'installed', mc_message = ?, mc_installed_at = ?,
                   mc_eula = ?
                   WHERE id = ?""",
                (
                    result["startup"],
                    result["image"],
                    json.dumps(environment),
                    result["software"],
                    result["version"],
                    result["loader_version"],
                    "Ready to start",
                    utcnow(),
                    1 if config["accept_eula"] else 0,
                    server_id,
                ),
            )
        instance = manager.instances.get(server_id)
        if instance:
            instance.server.update(
                {
                    "startup": result["startup"],
                    "image": result["image"],
                    "environment": environment,
                }
            )
        _mc_job_update(
            job_id,
            status="completed",
            progress=100,
            message="Server installation completed",
            result=result,
        )
        _mc_job_log(job_id, f"Ready: {result['software_name']} {result['version']}")
        for note in result.get("notes") or []:
            _mc_job_log(job_id, note)
        log_activity(actor_id, server_id, "minecraft:install", {
            "software": result["software"],
            "version": result["version"],
            "loader_version": result["loader_version"],
        })
    except MinecraftError as exc:
        message = str(exc)[:400]
        _mc_job_update(job_id, status="failed", progress=100, message=message)
        _mc_job_log(job_id, f"Installation failed: {message}")
        with db() as conn:
            conn.execute(
                "UPDATE servers SET mc_status = 'failed', mc_message = ? WHERE id = ?",
                (message, server_id),
            )
        log_activity(actor_id, server_id, "minecraft:install-failed", {
            "software": software_id,
            "version": version,
            "error": message,
        })
    except Exception as exc:  # keep the job inspectable for unexpected failures
        message = f"Unexpected installer error: {exc}"[:400]
        _mc_job_update(job_id, status="failed", progress=100, message=message)
        _mc_job_log(job_id, message)
        with db() as conn:
            conn.execute(
                "UPDATE servers SET mc_status = 'failed', mc_message = ? WHERE id = ?",
                (message, server_id),
            )
        log_activity(actor_id, server_id, "minecraft:install-failed", {
            "software": software_id,
            "version": version,
            "error": message,
        })


async def _begin_mc_install(
    server: dict[str, Any], config: dict[str, Any], actor_id: int | None
) -> dict[str, Any]:
    server_id = server["id"]
    if _server_mc_software(server) == "bedrock" or config["edition"] == "bedrock":
        expected_egg = 28
    else:
        expected_egg = 27
    instance = manager.instances.get(server_id)
    if instance and instance.proc and instance.proc.returncode is None:
        await instance.stop(kill=False)
    with db() as conn:
        conn.execute(
            """UPDATE servers SET egg_id = ?, mc_software = ?, mc_version = ?,
               mc_loader_version = ?, mc_status = 'queued', mc_message = 'Queued for installation',
               mc_eula = ? WHERE id = ?""",
            (
                expected_egg,
                config["software"],
                config["version"],
                config["loader_version"],
                1 if config["accept_eula"] else 0,
                server_id,
            ),
        )
    job_id = uuid.uuid4().hex
    with MC_JOB_LOCK:
        MC_JOBS[job_id] = {
            "id": job_id,
            "server_id": server_id,
            "status": "queued",
            "progress": 0,
            "message": "Queued for installation",
            "software": config["software"],
            "software_name": config["software_name"],
            "version": config["version"],
            "loader_version": config["loader_version"],
            "memory": int(server.get("memory") or 2048),
            "port": int(server.get("allocation_port") or 25565),
            "logs": [],
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "actor_id": actor_id,
        }
    asyncio.create_task(
        asyncio.to_thread(_mc_install_worker, job_id, server_id, config, actor_id)
    )
    snapshot = _mc_job_snapshot(job_id) or {}
    return snapshot


def _plugin_rows(server_id: str) -> dict[str, dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM plugin_installs WHERE server_id = ?", (server_id,)
        ).fetchall()
    output: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = row_to_dict(row) or {}
        output[str(item.get("filename") or "")] = item
        base = str(item.get("filename") or "")
        if base.endswith(".disabled"):
            output[base[: -len(".disabled")]] = item
    return output


def _merge_installed_content(server_id: str, software_id: str) -> list[dict[str, Any]]:
    installed = minecraft_installed_content(SERVERS_DIR / server_id, software_id)
    tracked = _plugin_rows(server_id)
    merged = []
    for item in installed:
        row = tracked.get(item["filename"]) or tracked.get(item["base_name"])
        if row:
            item = {
                **item,
                "title": row.get("title") or item["base_name"],
                "project_id": row.get("project_id") or "",
                "project_slug": row.get("project_slug") or "",
                "version_id": row.get("version_id") or "",
                "version_number": row.get("version_number") or "",
                "icon_url": row.get("icon_url") or "",
                "source": row.get("source") or item.get("source"),
                "installed_at": row.get("installed_at"),
                "tracked": True,
            }
        else:
            item = {
                **item,
                "title": item["base_name"].rsplit(".", 1)[0].replace("_", " ").replace("-", " "),
                "project_id": "",
                "project_slug": "",
                "version_id": "",
                "version_number": "",
                "icon_url": "",
                "tracked": False,
            }
        merged.append(item)
    return merged


def _record_plugin(server_id: str, info: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            """INSERT INTO plugin_installs
               (server_id, filename, directory, project_id, project_slug, title,
                version_id, version_number, icon_url, source, size, installed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(server_id, filename) DO UPDATE SET
                 directory = excluded.directory,
                 project_id = excluded.project_id,
                 project_slug = excluded.project_slug,
                 title = excluded.title,
                 version_id = excluded.version_id,
                 version_number = excluded.version_number,
                 icon_url = excluded.icon_url,
                 source = excluded.source,
                 size = excluded.size,
                 installed_at = excluded.installed_at""",
            (
                server_id,
                info.get("filename"),
                info.get("directory") or "plugins",
                info.get("project_id") or "",
                info.get("project_slug") or "",
                info.get("title") or info.get("name") or "",
                info.get("version_id") or "",
                info.get("version_number") or "",
                info.get("icon_url") or "",
                info.get("source") or "modrinth",
                int(info.get("size") or 0),
                info.get("installed_at") or utcnow(),
            ),
        )


def _server_mc_payload(server: dict[str, Any]) -> dict[str, Any]:
    software_id = _server_mc_software(server)
    if not software_id:
        return {
            "available": False,
            "software": None,
            "capabilities": {"enabled": False, "kind": None, "loaders": []},
            "job": _latest_mc_job(server["id"]),
        }
    try:
        meta = minecraft_software(software_id)
    except MinecraftError:
        return {
            "available": False,
            "software": None,
            "capabilities": {"enabled": False, "kind": None, "loaders": []},
            "job": _latest_mc_job(server["id"]),
        }
    root = SERVERS_DIR / server["id"]
    manifest = minecraft_install_metadata(root)
    return {
        "available": True,
        "software": meta,
        "version": server.get("mc_version") or manifest.get("version") or "",
        "loader_version": server.get("mc_loader_version") or manifest.get("loader_version") or "",
        "status": server.get("mc_status") or ("installed" if manifest else ""),
        "message": server.get("mc_message") or "",
        "installed_at": server.get("mc_installed_at") or manifest.get("installed_at"),
        "eula": bool(server.get("mc_eula")),
        "capabilities": minecraft_capabilities(software_id),
        "properties": minecraft_read_properties(root, software_id),
        "job": _latest_mc_job(server["id"]),
        "manifest": manifest,
    }


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
    tags = parse_tags(server.get("tags"))
    return {
        **{k: server[k] for k in server if k not in ("environment", "tags")},
        "environment": env or {},
        "tags": tags,
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


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _cron_field_matches(spec: str, value: int, minimum: int, maximum: int) -> bool:
    spec = (spec or "*").strip()
    if spec in ("*", "?"):
        return True
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        step = 1
        if "/" in token:
            base, step_text = token.split("/", 1)
            try:
                step = max(1, int(step_text))
            except ValueError:
                continue
        else:
            base = token
        if base in ("*", "?"):
            start, end = minimum, maximum
        elif "-" in base:
            try:
                start_text, end_text = base.split("-", 1)
                start, end = int(start_text), int(end_text)
            except ValueError:
                continue
        else:
            try:
                start = end = int(base)
            except ValueError:
                continue
        if start > end:
            start, end = end, start
        if start < minimum or end > maximum:
            continue
        if start <= value <= end and (value - start) % step == 0:
            return True
    return False


def _legacy_interval(expr: str) -> int | None:
    """Interpret the historical ``*/N * * * *`` form as a minute interval.

    Values above 59 were accepted by older panel releases even though they are
    not valid cron minutes. Keep them working after the scheduler upgrade.
    """
    fields = (expr or "").split()
    if len(fields) != 5 or fields[1:] != ["*", "*", "*", "*"]:
        return None
    head = fields[0]
    if not head.startswith("*/"):
        return None
    try:
        minutes = int(head[2:])
    except ValueError:
        return None
    if minutes > 59:
        return max(60, minutes * 60)
    return None


def cron_next(expr: str, after: datetime | None = None) -> datetime:
    """Return the next UTC minute matching a standard five-field cron expression."""
    base = (after or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    legacy = _legacy_interval(expr)
    if legacy:
        return base + timedelta(seconds=legacy)
    fields = (expr or "").split()
    if len(fields) != 5:
        return base + timedelta(minutes=5)
    minute, hour, day, month, weekday = fields
    candidate = base + timedelta(minutes=1)
    for _ in range(60 * 24 * 366):
        cron_weekday = (candidate.weekday() + 1) % 7  # Sunday = 0
        day_restricted = day.strip() not in ("*", "?")
        weekday_restricted = weekday.strip() not in ("*", "?")
        day_match = _cron_field_matches(day, candidate.day, 1, 31)
        weekday_match = _cron_field_matches(weekday, cron_weekday, 0, 6) or (
            cron_weekday == 0 and _cron_field_matches(weekday, 7, 0, 7)
        )
        # Vixie cron treats day-of-month and day-of-week as an OR when both
        # are restricted, and as an AND otherwise.
        if day_restricted and weekday_restricted:
            date_match = day_match or weekday_match
        else:
            date_match = day_match and weekday_match
        if (
            date_match
            and _cron_field_matches(month, candidate.month, 1, 12)
            and _cron_field_matches(hour, candidate.hour, 0, 23)
            and _cron_field_matches(minute, candidate.minute, 0, 59)
        ):
            return candidate
        candidate += timedelta(minutes=1)
    return base + timedelta(minutes=5)


def schedule_next_run(expr: str, after: datetime | None = None) -> str:
    return cron_next(expr, after).strftime("%Y-%m-%dT%H:%M:%SZ")


async def run_due_schedules() -> None:
    now = datetime.now(timezone.utc)
    with db() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM schedules WHERE enabled = 1").fetchall())
    for sch in rows:
        expr = sch.get("cron") or "*/5 * * * *"
        last_run = _parse_utc(sch.get("last_run"))
        next_run = _parse_utc(sch.get("next_run"))
        interval = _legacy_interval(expr)
        if next_run is None:
            base = last_run or now
            next_run = (
                base + timedelta(seconds=interval)
                if interval
                else cron_next(expr, base)
            )
        if now < next_run:
            if sch.get("next_run") != next_run.strftime("%Y-%m-%dT%H:%M:%SZ"):
                with db() as conn:
                    conn.execute(
                        "UPDATE schedules SET next_run = ? WHERE id = ?",
                        (next_run.strftime("%Y-%m-%dT%H:%M:%SZ"), sch["id"]),
                    )
            continue
        server_id = sch["server_id"]
        with db() as conn:
            row = conn.execute("SELECT * FROM servers WHERE id = ?", (server_id,)).fetchone()
            server = row_to_dict(row)
        if not server or server.get("suspended"):
            with db() as conn:
                conn.execute(
                    "UPDATE schedules SET next_run = ? WHERE id = ?",
                    (schedule_next_run(expr, now), sch["id"]),
                )
            continue
        try:
            await execute_schedule_action(server, sch)
        except Exception:
            pass
        with db() as conn:
            conn.execute(
                "UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?",
                (utcnow(), schedule_next_run(expr, now), sch["id"]),
            )


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


@app.get("/api/account/api-keys")
def list_api_keys(user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    with db() as conn:
        rows = rows_to_list(
            conn.execute(
                "SELECT id, name, prefix, last_used, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC",
                (user["id"],),
            ).fetchall()
        )
    return {"data": rows}


@app.post("/api/account/api-keys")
def create_api_key(body: ApiKeyBody, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    name = (body.name or "").strip() or "API key"
    token = "vt_" + secrets.token_urlsafe(32)
    prefix = token[:12] + "..."
    with db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ?", (user["id"],)
        ).fetchone()["c"]
        if int(count) >= 20:
            raise HTTPException(400, "Maximum of 20 API keys per account")
        cur = conn.execute(
            """INSERT INTO api_keys (user_id, name, token_hash, prefix, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user["id"], name[:80], hash_api_key(token), prefix, utcnow()),
        )
        key_id = cur.lastrowid
    log_activity(user["id"], None, "account:api-key:create", {"id": key_id, "name": name})
    return {
        "data": {
            "id": key_id,
            "name": name[:80],
            "prefix": prefix,
            "token": token,
            "created_at": utcnow(),
        }
    }


@app.delete("/api/account/api-keys/{key_id}")
def delete_api_key(key_id: int, user: dict[str, Any] = Depends(user_from_header)) -> dict[str, str]:
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM api_keys WHERE id = ? AND user_id = ?", (key_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "API key not found")
        conn.execute("DELETE FROM api_keys WHERE id = ?", (key_id,))
    log_activity(user["id"], None, "account:api-key:delete", {"id": key_id})
    return {"status": "ok"}


@app.put("/api/servers/{server_id}/tags")
def update_server_tags(
    server_id: str, body: TagsBody, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    if user["role"] != "admin" and server["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the owner can update tags")
    tags = parse_tags(body.tags)
    with db() as conn:
        conn.execute("UPDATE servers SET tags = ? WHERE id = ?", (json.dumps(tags), server_id))
    log_activity(user["id"], server_id, "server:tags", {"tags": tags})
    return {"data": {"tags": tags}}


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


@app.get("/api/servers/{server_id}/terminal")
def server_terminal_info(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    require_terminal(server, user)
    terminal_root(server_id)
    return {"data": terminal_payload(server, user)}


@app.post("/api/servers/{server_id}/terminal/sudo")
async def server_terminal_sudo(
    server_id: str,
    body: TerminalSudoBody,
    admin: dict[str, Any] = Depends(admin_user),
) -> dict[str, Any]:
    server = get_server(server_id, admin)
    reject_suspended(server)
    terminal_root(server_id)
    if body.enabled:
        ready, reason = await sudo_ready()
        if not ready:
            raise HTTPException(400, reason)
    with db() as conn:
        conn.execute(
            "UPDATE servers SET terminal_sudo = ? WHERE id = ?",
            (1 if body.enabled else 0, server_id),
        )
        row = conn.execute(
            """SELECT s.*, e.name AS egg_name, n.name AS nest_name, u.username AS owner_name
               FROM servers s
               JOIN eggs e ON e.id = s.egg_id
               JOIN nests n ON n.id = e.nest_id
               JOIN users u ON u.id = s.owner_id
               WHERE s.id = ?""",
            (server_id,),
        ).fetchone()
    updated = row_to_dict(row) or server
    log_activity(
        admin["id"],
        server_id,
        "server:terminal-sudo",
        {"enabled": bool(body.enabled)},
    )
    return {"data": terminal_payload(updated, admin)}


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


# ---------------------------------------------------------------------------
# Minecraft catalogue and provisioning API
# ---------------------------------------------------------------------------


@app.get("/api/minecraft/catalog")
def minecraft_catalog_endpoint(_: dict[str, Any] = Depends(user_from_header)) -> dict[str, Any]:
    return {"data": minecraft_catalog()}


@app.get("/api/minecraft/catalog/{software_id}/versions")
def minecraft_version_catalog(
    software_id: str,
    version: str = Query(""),
    include_snapshots: bool = Query(False),
    _: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    try:
        return {"data": minecraft_versions(software_id, version, include_snapshots)}
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/servers/{server_id}/minecraft")
def server_minecraft(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    return {"data": _server_mc_payload(server)}


@app.get("/api/servers/{server_id}/minecraft/status")
async def server_minecraft_status(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    instance = manager.instances.get(server_id)
    running = bool(instance and instance.proc and instance.proc.returncode is None)
    if not running:
        return {
            "data": {
                "online": False,
                "latency_ms": 0,
                "error": "The server is not running",
            }
        }
    if minecraft_software(software_id)["edition"] == "bedrock":
        result = await asyncio.to_thread(
            minecraft_bedrock_status, "127.0.0.1", int(server["allocation_port"])
        )
    else:
        result = await asyncio.to_thread(
            minecraft_java_status, "127.0.0.1", int(server["allocation_port"])
        )
    return {"data": result}


@app.post("/api/servers/{server_id}/minecraft/install")
async def server_minecraft_install(
    server_id: str,
    body: MinecraftInstallBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    current = _server_mc_software(server)
    try:
        config = _mc_config(
            {
                "software": body.software,
                "version": body.version,
                "loader_version": body.loader_version,
                "accept_eula": body.accept_eula,
                "properties": body.properties,
            },
            current or "vanilla",
        )
    except MinecraftError as exc:
        raise HTTPException(400, str(exc)) from exc
    if current:
        current_meta = minecraft_software(current)
        if current_meta["edition"] != config["edition"]:
            raise HTTPException(
                400,
                "Java and Bedrock editions cannot share one server directory. "
                "Create a new workload for the other edition.",
            )
    active = _latest_mc_job(server_id)
    if active and active.get("status") in ("queued", "running"):
        raise HTTPException(409, "An installation is already running for this server")
    if body.accept_eula:
        config["accept_eula"] = True
    job = await _begin_mc_install(server, config, user["id"])
    return {"data": job}


@app.get("/api/servers/{server_id}/minecraft/jobs/{job_id}")
def server_minecraft_job(
    server_id: str,
    job_id: str,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    get_server(server_id, user)
    job = _mc_job_snapshot(job_id)
    if not job or job.get("server_id") != server_id:
        raise HTTPException(404, "Installation job not found")
    return {"data": job}


@app.get("/api/servers/{server_id}/minecraft/update")
async def server_minecraft_update(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        result = await asyncio.to_thread(
            minecraft_check_update,
            software_id,
            str(server.get("mc_version") or ""),
            str(server.get("mc_loader_version") or ""),
        )
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"data": result}


@app.post("/api/servers/{server_id}/minecraft/upgrade")
async def server_minecraft_upgrade(
    server_id: str,
    body: MinecraftUpgradeBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    active = _latest_mc_job(server_id)
    if active and active.get("status") in ("queued", "running"):
        raise HTTPException(409, "An installation or upgrade is already running")
    try:
        latest = await asyncio.to_thread(minecraft_latest_release, software_id)
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc
    version = (body.version or latest["version"]).strip()[:80]
    if not version:
        raise HTTPException(400, "A target Minecraft version is required")
    loader = body.loader_version if body.loader_version is not None else latest["loader_version"]
    accept_eula = bool(body.accept_eula) or bool(server.get("mc_eula"))
    try:
        config = _mc_config(
            {
                "software": software_id,
                "version": version,
                "loader_version": loader,
                "accept_eula": accept_eula,
                "properties": {},
            },
            software_id,
        )
    except MinecraftError as exc:
        raise HTTPException(400, str(exc)) from exc
    current_meta = minecraft_software(software_id)
    if current_meta["kind"] == "server" and config["edition"] != current_meta["edition"]:
        raise HTTPException(400, "Java and Bedrock editions cannot share one server directory")

    instance = manager.instances.get(server_id)
    if instance and instance.proc and instance.proc.returncode is None:
        await instance.stop(kill=False)

    backup: dict[str, Any] | None = None
    if body.backup:
        label = f"pre-upgrade-{server.get('mc_version') or 'unknown'}-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}"
        try:
            backup = await asyncio.to_thread(create_backup_file, server, label)
        except OSError as exc:
            raise HTTPException(500, f"Upgrade backup failed: {exc}") from exc

    job = await _begin_mc_install(server, config, user["id"])
    log_activity(
        user["id"],
        server_id,
        "minecraft:upgrade",
        {
            "from_version": server.get("mc_version") or "",
            "to_version": version,
            "from_loader": server.get("mc_loader_version") or "",
            "to_loader": loader or "",
            "backup": (backup or {}).get("id"),
        },
    )
    return {"data": job, "backup": backup}


@app.put("/api/servers/{server_id}/minecraft/properties")
def server_minecraft_properties(
    server_id: str,
    body: MinecraftPropertiesBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        values = minecraft_update_properties(
            SERVERS_DIR / server_id,
            software_id,
            body.properties,
            port=int(server["allocation_port"]),
            memory=int(server["memory"]),
        )
    except MinecraftError as exc:
        raise HTTPException(400, str(exc)) from exc
    log_activity(user["id"], server_id, "minecraft:properties", {
        "keys": list(body.properties.keys())[:20]
    })
    return {"data": values}


@app.get("/api/servers/{server_id}/plugins")
def server_plugins(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        return {
            "data": [],
            "capabilities": {"enabled": False, "kind": None, "loaders": [], "directory": ""},
            "counts": {"total": 0, "enabled": 0},
        }
    capabilities = minecraft_capabilities(software_id)
    rows = _merge_installed_content(server_id, software_id) if capabilities["enabled"] else []
    return {
        "data": rows,
        "capabilities": capabilities,
        "counts": {
            "total": len(rows),
            "enabled": sum(1 for row in rows if row.get("enabled")),
        },
    }


@app.get("/api/servers/{server_id}/plugins/search")
def server_plugins_search(
    server_id: str,
    query: str = Query(""),
    limit: int = Query(20),
    offset: int = Query(0),
    featured: bool = Query(False),
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        result = minecraft_search_content(
            software_id,
            query,
            game_version=str(server.get("mc_version") or ""),
            limit=limit,
            offset=offset,
            featured=featured,
        )
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc
    return result


@app.get("/api/servers/{server_id}/plugins/versions/{project_id}")
def server_plugin_versions(
    server_id: str,
    project_id: str,
    limit: int = Query(12),
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        return minecraft_content_versions(
            software_id,
            project_id,
            game_version=str(server.get("mc_version") or ""),
            limit=limit,
        )
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/servers/{server_id}/plugins")
async def server_plugin_install(
    server_id: str,
    body: PluginInstallBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    capabilities = minecraft_capabilities(software_id)
    if not capabilities["enabled"]:
        raise HTTPException(400, "This server software does not support plugins or mods")
    try:
        info = await asyncio.to_thread(
            minecraft_install_content,
            SERVERS_DIR / server_id,
            software_id,
            body.project_id,
            version_id=body.version_id or "",
            game_version=str(server.get("mc_version") or ""),
            log=lambda line: None,
        )
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc
    _record_plugin(server_id, info)
    log_activity(user["id"], server_id, "minecraft:content-install", {
        "project": info.get("project_id"),
        "title": info.get("title"),
        "filename": info.get("filename"),
    })
    return {"data": info}


@app.get("/api/servers/{server_id}/plugins/updates")
async def server_plugin_updates(
    server_id: str, user: dict[str, Any] = Depends(user_from_header)
) -> dict[str, Any]:
    server = get_server(server_id, user)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    capabilities = minecraft_capabilities(software_id)
    if not capabilities["enabled"]:
        return {"data": [], "checked": 0, "errors": []}
    rows = _merge_installed_content(server_id, software_id)
    tracked = [row for row in rows if row.get("project_id")]
    game_version = str(server.get("mc_version") or "")
    semaphore = asyncio.Semaphore(4)

    async def inspect(item: dict[str, Any]) -> dict[str, Any]:
        async with semaphore:
            try:
                latest = await asyncio.to_thread(
                    minecraft_content_update,
                    software_id,
                    str(item["project_id"]),
                    str(item.get("version_id") or ""),
                    game_version=game_version,
                )
            except MinecraftError as exc:
                return {
                    "filename": item["filename"],
                    "title": item.get("title") or item.get("base_name"),
                    "project_id": item.get("project_id") or "",
                    "error": str(exc)[:240],
                }
        if not latest:
            return {}
        return {
            "filename": item["filename"],
            "base_name": item.get("base_name") or item["filename"],
            "title": item.get("title") or item.get("base_name"),
            "project_id": item.get("project_id") or "",
            "project_slug": item.get("project_slug") or "",
            "icon_url": item.get("icon_url") or "",
            "current_version_id": item.get("version_id") or "",
            "current_version": item.get("version_number") or "",
            "latest": latest,
            "enabled": bool(item.get("enabled")),
        }

    results = await asyncio.gather(*(inspect(row) for row in tracked))
    updates = [row for row in results if row and row.get("latest")]
    errors = [row for row in results if row and row.get("error")]
    return {
        "data": updates,
        "checked": len(tracked),
        "errors": errors,
        "project_type": capabilities["project_type"],
    }


@app.post("/api/servers/{server_id}/plugins/{filename}/update")
async def server_plugin_update(
    server_id: str,
    filename: str,
    body: PluginUpdateBody,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    capabilities = minecraft_capabilities(software_id)
    if not capabilities["enabled"]:
        raise HTTPException(400, "This server software does not support plugins or mods")
    rows = _merge_installed_content(server_id, software_id)
    item = next(
        (row for row in rows if filename in (row.get("filename"), row.get("base_name"))),
        None,
    )
    if not item:
        raise HTTPException(404, "Installed content was not found")
    if not item.get("project_id"):
        raise HTTPException(400, "This file was uploaded locally and has no upstream project")

    version_id = (body.version_id or "").strip()
    if not version_id:
        try:
            latest = await asyncio.to_thread(
                minecraft_content_update,
                software_id,
                str(item["project_id"]),
                str(item.get("version_id") or ""),
                game_version=str(server.get("mc_version") or ""),
            )
        except MinecraftError as exc:
            raise HTTPException(502, str(exc)) from exc
        if not latest:
            return {"data": item, "updated": False, "message": "Already up to date"}
        version_id = str(latest["id"])

    old_filename = str(item["filename"])
    was_enabled = bool(item.get("enabled"))
    root = SERVERS_DIR / server_id
    try:
        info = await asyncio.to_thread(
            minecraft_install_content,
            root,
            software_id,
            str(item["project_id"]),
            version_id=version_id,
            game_version=str(server.get("mc_version") or ""),
            log=lambda line: None,
        )
        if not was_enabled:
            toggled = minecraft_toggle_content(root, software_id, str(info["filename"]))
            info["filename"] = toggled["filename"]
            info["enabled"] = False
    except MinecraftError as exc:
        raise HTTPException(502, str(exc)) from exc

    if info["filename"] != old_filename:
        try:
            minecraft_delete_content(root, software_id, old_filename)
        except MinecraftError:
            pass
        with db() as conn:
            conn.execute(
                "DELETE FROM plugin_installs WHERE server_id = ? AND filename = ?",
                (server_id, old_filename),
            )
    _record_plugin(server_id, info)
    log_activity(
        user["id"],
        server_id,
        "minecraft:content-update",
        {
            "project": info.get("project_id"),
            "title": info.get("title"),
            "from": item.get("version_number"),
            "to": info.get("version_number"),
        },
    )
    instance = manager.instances.get(server_id)
    running = bool(instance and instance.proc and instance.proc.returncode is None)
    return {"data": info, "updated": True, "restart_required": running}


@app.post("/api/servers/{server_id}/plugins/upload")
async def server_plugin_upload(
    server_id: str,
    upload: UploadFile = File(...),
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    capabilities = minecraft_capabilities(software_id)
    if not capabilities["enabled"]:
        raise HTTPException(400, "This server software does not support plugins or mods")
    filename = Path(upload.filename or "").name
    if not filename or not filename.lower().endswith((".jar", ".zip")):
        raise HTTPException(400, "Upload a .jar or .zip plugin or mod archive")
    temporary = SERVERS_DIR / server_id / ".vitestl-upload.tmp"
    temporary.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with temporary.open("wb") as handle:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > 256 * 1024 * 1024:
                    raise HTTPException(413, "Upload exceeds 256 MiB")
                handle.write(chunk)
        info = minecraft_store_upload(SERVERS_DIR / server_id, software_id, filename, temporary)
    except MinecraftError as exc:
        temporary.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    info.update(
        {
            "title": filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " "),
            "project_id": "",
            "project_slug": "",
            "version_id": "",
            "version_number": "",
            "icon_url": "",
            "project_type": capabilities["project_type"],
            "source": "upload",
            "installed_at": utcnow(),
        }
    )
    _record_plugin(server_id, info)
    log_activity(user["id"], server_id, "minecraft:content-upload", {
        "filename": filename,
        "size": written,
    })
    return {"data": info}


@app.post("/api/servers/{server_id}/plugins/{filename}/toggle")
def server_plugin_toggle(
    server_id: str,
    filename: str,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, Any]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        result = minecraft_toggle_content(SERVERS_DIR / server_id, software_id, filename)
    except MinecraftError as exc:
        raise HTTPException(400, str(exc)) from exc
    with db() as conn:
        conn.execute(
            "UPDATE OR REPLACE plugin_installs SET filename = ? WHERE server_id = ? AND filename = ?",
            (result["filename"], server_id, filename),
        )
    log_activity(user["id"], server_id, "minecraft:content-toggle", {
        "filename": filename,
        "enabled": result["enabled"],
    })
    return {"data": result}


@app.delete("/api/servers/{server_id}/plugins/{filename}")
def server_plugin_delete(
    server_id: str,
    filename: str,
    user: dict[str, Any] = Depends(user_from_header),
) -> dict[str, str]:
    server = get_server(server_id, user)
    reject_suspended(server)
    software_id = _server_mc_software(server)
    if not software_id:
        raise HTTPException(400, "This server is not a Minecraft workload")
    try:
        minecraft_delete_content(SERVERS_DIR / server_id, software_id, filename)
    except MinecraftError as exc:
        raise HTTPException(404, str(exc)) from exc
    base = filename
    for suffix in (".jar.disabled", ".zip.disabled", ".disabled"):
        if base.endswith(suffix):
            base = base[: -len(suffix)] + (".jar" if "jar" in suffix else ".zip")
            break
    with db() as conn:
        conn.execute(
            "DELETE FROM plugin_installs WHERE server_id = ? AND filename IN (?, ?, ?)",
            (server_id, filename, base, base + ".disabled"),
        )
    log_activity(user["id"], server_id, "minecraft:content-delete", {"filename": filename})
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
    digest = hashlib.sha256()
    with dest.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum = digest.hexdigest()
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
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Schedule name is required")
    if body.action not in ("start", "stop", "restart", "kill", "backup", "command"):
        raise HTTPException(400, "Unsupported schedule action")
    if body.action == "command" and not body.payload.strip():
        raise HTTPException(400, "A console command is required for this action")
    expr = body.cron.strip() or "*/5 * * * *"
    if len(expr.split()) != 5:
        raise HTTPException(400, "Cron expressions must contain five fields")
    next_run = schedule_next_run(expr)
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO schedules (server_id, name, cron, action, payload, enabled, next_run, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                server_id,
                name,
                expr,
                body.action,
                body.payload.strip(),
                1 if body.enabled else 0,
                next_run,
                utcnow(),
            ),
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
        next_run = schedule_next_run(str(row["cron"])) if body.enabled else None
        conn.execute(
            "UPDATE schedules SET enabled = ?, next_run = ? WHERE id = ? AND server_id = ?",
            (1 if body.enabled else 0, next_run, schedule_id, server_id),
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
        conn.execute(
            "UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?",
            (utcnow(), schedule_next_run(str(schedule.get("cron") or "*/5 * * * *")), schedule_id),
        )
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


@app.websocket("/ws/terminal/{server_id}")
async def ws_terminal(websocket: WebSocket, server_id: str, token: str = Query("")) -> None:
    await websocket.accept()
    try:
        user = ws_user(token)
        server = get_server(server_id, user)
        reject_suspended(server)
        require_terminal(server, user)
    except HTTPException as exc:
        await websocket.send_json({"event": "error", "message": exc.detail})
        await websocket.close()
        return

    root = terminal_root(server_id)
    shell_env = terminal_environment(root, server_id, str(server.get("name") or "server"))
    session: dict[str, Any] = {
        "cwd": root,
        "previous": root,
        "proc": None,
        "task": None,
    }
    send_lock = asyncio.Lock()

    async def send(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    def sudo_enabled() -> bool:
        with db() as conn:
            row = conn.execute(
                "SELECT terminal_sudo FROM servers WHERE id = ?", (server_id,)
            ).fetchone()
        return bool(row["terminal_sudo"]) if row else False

    async def async_send(payload: dict[str, Any]) -> None:
        try:
            await send(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass

    async def finish_command(command: str, use_sudo: bool, code: int, duration_ms: int) -> None:
        await async_send(
            {
                "event": "terminal exit",
                "code": code,
                "cwd": terminal_relative(session["cwd"], root),
                "duration_ms": duration_ms,
                "sudo": use_sudo,
                "timed_out": bool(session.pop("timed_out", False)),
                "truncated": bool(session.pop("truncated", False)),
            }
        )
        if command:
            log_activity(
                user["id"],
                server_id,
                "server:terminal",
                {
                    "command": command[:180],
                    "exit": code,
                    "sudo": use_sudo,
                    "duration_ms": duration_ms,
                },
            )

    async def run_command(command: str, use_sudo: bool) -> None:
        started = time.monotonic()
        if os.name == "nt":
            argv = [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                command,
            ]
        elif use_sudo:
            argv = ["sudo", "-n", "--", "bash", "-c", command]
        else:
            argv = ["bash", "-c", command]
        proc: asyncio.subprocess.Process | None = None
        guard: asyncio.Task[Any] | None = None
        code = 1
        session.pop("timed_out", None)
        session.pop("truncated", None)
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(session["cwd"]),
                env=shell_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=os.name != "nt",
            )
            session["proc"] = proc
            assert proc.stdout is not None

            async def timeout_guard() -> None:
                await asyncio.sleep(TERMINAL_TIMEOUT)
                if proc.returncode is not None:
                    return
                session["timed_out"] = True
                await async_send(
                    {
                        "event": "terminal output",
                        "data": (
                            f"\r\n\x1b[33m[vitestl] Command timed out after "
                            f"{TERMINAL_TIMEOUT} seconds.\x1b[0m\r\n"
                        ),
                    }
                )
                await terminate_terminal_process(proc)

            guard = asyncio.create_task(timeout_guard())
            total = 0
            while True:
                chunk = await proc.stdout.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total <= TERMINAL_OUTPUT_LIMIT:
                    await async_send(
                        {
                            "event": "terminal output",
                            "data": chunk.decode("utf-8", errors="replace"),
                        }
                    )
                elif not session.get("truncated"):
                    session["truncated"] = True
                    await async_send(
                        {
                            "event": "terminal output",
                            "data": (
                                "\r\n\x1b[33m[vitestl] Output limit reached. "
                                "The command was stopped.\x1b[0m\r\n"
                            ),
                        }
                    )
                    await terminate_terminal_process(proc)
            try:
                code = await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                await terminate_terminal_process(proc)
                code = await proc.wait()
            if session.get("timed_out"):
                code = 124
        except FileNotFoundError:
            code = 127
            await async_send(
                {
                    "event": "terminal output",
                    "data": f"\r\n\x1b[31m[vitestl] Shell not found: {argv[0]}\x1b[0m\r\n",
                }
            )
        except Exception as exc:
            code = 1
            await async_send(
                {
                    "event": "terminal output",
                    "data": f"\r\n\x1b[31m[vitestl] {str(exc)[:300]}\x1b[0m\r\n",
                }
            )
        finally:
            if guard:
                guard.cancel()
                try:
                    await guard
                except asyncio.CancelledError:
                    pass
            if proc and proc.returncode is None:
                await terminate_terminal_process(proc)
            session["proc"] = None
            session["task"] = None
            await finish_command(
                command, use_sudo, int(code), int((time.monotonic() - started) * 1000)
            )

    await async_send(
        {
            "event": "terminal ready",
            "data": terminal_payload(server, user),
        }
    )
    log_activity(user["id"], server_id, "server:terminal-open", {})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await async_send({"event": "terminal error", "message": "Malformed terminal frame"})
                continue
            event = str(payload.get("event") or "")
            if event == "exec":
                task = session.get("task")
                if task and not task.done():
                    await async_send(
                        {
                            "event": "terminal error",
                            "message": "Wait for the running command to finish or cancel it",
                        }
                    )
                    continue
                command = str(payload.get("command") or "").strip()
                if not command:
                    continue
                if len(command) > TERMINAL_COMMAND_LIMIT:
                    await async_send(
                        {
                            "event": "terminal error",
                            "message": f"Commands are limited to {TERMINAL_COMMAND_LIMIT} characters",
                        }
                    )
                    continue
                if command in ("exit", "logout"):
                    await async_send(
                        {
                            "event": "terminal output",
                            "data": "[vitestl] This terminal belongs to the panel session. "
                            "Use the power controls or close the tab.\r\n",
                        }
                    )
                    await finish_command(command, False, 0, 0)
                    continue
                cd_match = TERMINAL_CD_RE.match(command)
                if cd_match:
                    started = time.monotonic()
                    argument = (cd_match.group(1) or "").strip()
                    if argument == "-":
                        target = session["previous"]
                        if not target.is_dir():
                            target = root
                    else:
                        try:
                            target = terminal_resolve_directory(
                                root, session["cwd"], argument
                            )
                        except ValueError as exc:
                            await async_send(
                                {
                                    "event": "terminal output",
                                    "data": f"cd: {argument or '~'}: {exc}\r\n",
                                }
                            )
                            await async_send(
                                {
                                    "event": "terminal exit",
                                    "code": 1,
                                    "cwd": terminal_relative(session["cwd"], root),
                                    "duration_ms": int((time.monotonic() - started) * 1000),
                                    "sudo": False,
                                }
                            )
                            continue
                    session["previous"] = session["cwd"]
                    session["cwd"] = target
                    if argument == "-":
                        await async_send(
                            {
                                "event": "terminal output",
                                "data": terminal_relative(target, root) + "\r\n",
                            }
                        )
                    await async_send(
                        {
                            "event": "terminal exit",
                            "code": 0,
                            "cwd": terminal_relative(target, root),
                            "duration_ms": int((time.monotonic() - started) * 1000),
                            "sudo": False,
                        }
                    )
                    continue
                session["task"] = asyncio.create_task(
                    run_command(command, sudo_enabled())
                )
            elif event == "cancel":
                proc = session.get("proc")
                if proc and proc.returncode is None:
                    await async_send(
                        {
                            "event": "terminal output",
                            "data": "\r\n\x1b[38;5;244m[vitestl] Cancelling command...\x1b[0m\r\n",
                        }
                    )
                    await terminate_terminal_process(proc)
            else:
                await async_send(
                    {"event": "terminal error", "message": f"Unknown terminal event: {event}"}
                )
    except WebSocketDisconnect:
        pass
    finally:
        task = session.get("task")
        if task and not task.done():
            task.cancel()
        proc = session.get("proc")
        if proc and proc.returncode is None:
            await terminate_terminal_process(proc)


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
        health = catalog_health(conn)
        repaired = False
        if health["missing"]:
            sync_catalog(conn)
            repaired = True
            health = catalog_health(conn)
        nests = rows_to_list(conn.execute("SELECT * FROM nests ORDER BY id").fetchall())
        eggs = rows_to_list(conn.execute("SELECT * FROM eggs ORDER BY id").fetchall())
        deployments = {
            int(row["egg_id"]): int(row["total"] or 0)
            for row in conn.execute(
                "SELECT egg_id, COUNT(*) AS total FROM servers GROUP BY egg_id"
            ).fetchall()
        }
    for e in eggs:
        try:
            e["variables"] = json.loads(e.get("variables") or "[]")
        except json.JSONDecodeError:
            e["variables"] = []
        e.pop("files", None)
        e["custom"] = int(e.get("id") or 0) >= 1000
        e["deployments"] = deployments.get(int(e["id"]), 0)
        e["installed"] = e["deployments"] > 0
    return {
        "nests": nests,
        "eggs": eggs,
        "catalog": {"nests": len(NESTS), "eggs": len(EGGS), "version": PANEL_VERSION},
        "catalog_health": {
            **health,
            "repaired": repaired,
            "known_egg_ids": builtin_egg_ids(),
        },
    }


@app.post("/api/admin/nests/sync")
def admin_sync_nests(admin: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    with db() as conn:
        result = sync_catalog(conn)
    log_activity(admin["id"], None, "nests:sync", result)
    return {"status": "ok", **result}


@app.post("/api/admin/nests")
def admin_create_nest(body: NestBody, admin: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(400, "Nest name is required")
    description = (body.description or "").strip()
    with db() as conn:
        nest_id = next_custom_id(conn, "nests")
        conn.execute(
            "INSERT INTO nests (id, name, description) VALUES (?, ?, ?)",
            (nest_id, name, description),
        )
    log_activity(admin["id"], None, "nest:create", {"id": nest_id, "name": name})
    return {"data": {"id": nest_id, "name": name, "description": description}}


@app.post("/api/admin/eggs")
def admin_create_egg(body: EggBody, admin: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(400, "Egg name is required")
    startup = (body.startup or "python3 main.py").strip()
    runtime = (body.runtime or "process").strip() or "process"
    if runtime not in ("process", "docker"):
        raise HTTPException(400, "Runtime must be process or docker")
    files = body.files if isinstance(body.files, dict) and body.files else default_egg_files()
    variables = body.variables if isinstance(body.variables, list) else []
    with db() as conn:
        nest = conn.execute("SELECT id FROM nests WHERE id = ?", (body.nest_id,)).fetchone()
        if not nest:
            raise HTTPException(400, "Unknown nest")
        egg_id = next_custom_id(conn, "eggs")
        conn.execute(
            """INSERT INTO eggs
            (id, nest_id, name, description, docker_image, startup, stop_command, runtime, files, variables)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                egg_id,
                body.nest_id,
                name,
                (body.description or "").strip(),
                (body.docker_image or "python:3.11-slim").strip(),
                startup,
                body.stop_command or "^C",
                runtime,
                json.dumps(files),
                json.dumps(variables),
            ),
        )
    log_activity(admin["id"], None, "egg:create", {"id": egg_id, "name": name, "nest_id": body.nest_id})
    return {"data": {"id": egg_id, "nest_id": body.nest_id, "name": name}}


@app.get("/api/admin/eggs/{egg_id}")
def admin_egg_detail(egg_id: int, _: dict[str, Any] = Depends(admin_user)) -> dict[str, Any]:
    egg = resolve_egg(egg_id)
    if not egg:
        raise HTTPException(404, "Egg not found")
    return {"data": egg}


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
    mc_config: dict[str, Any] | None = None
    if body.minecraft or int(body.egg_id) in (27, 28):
        default_software = "bedrock" if int(body.egg_id) == 28 else "vanilla"
        try:
            mc_config = _mc_config(body.minecraft, default_software)
        except MinecraftError as exc:
            raise HTTPException(400, str(exc)) from exc
        body.egg_id = int(mc_config["kind"] == "bedrock" and 28 or 27)
        if body.accept_eula:
            mc_config["accept_eula"] = True
        body.environment.update(
            {
                "MC_SOFTWARE": mc_config["software"],
                "MC_VERSION": mc_config["version"],
                "MC_LOADER": mc_config["loader_version"],
                "MOTD": str(mc_config["properties"].get("motd") or ""),
            }
        )
    egg = resolve_egg(body.egg_id)
    if not egg:
        known = ", ".join(str(item) for item in builtin_egg_ids())
        raise HTTPException(
            400,
            f"Unknown egg {body.egg_id}. The built-in catalogue could not be "
            f"loaded. Run Administration -> Nests -> Sync catalogue, verify the "
            f"backend was deployed and restarted, then try again. Built-in egg "
            f"IDs: {known}.",
        )
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
    server_row = row_to_dict(row) or {}
    server = decorate_server(server_row)
    minecraft_job = None
    if mc_config:
        minecraft_job = await _begin_mc_install(
            {
                **server_row,
                "id": sid,
                "memory": body.memory,
                "allocation_port": port,
            },
            mc_config,
            admin["id"],
        )
        server["mc_software"] = mc_config["software"]
        server["mc_version"] = mc_config["version"]
        server["mc_loader_version"] = mc_config["loader_version"]
        server["mc_status"] = "queued"
        server["mc_message"] = "Queued for installation"
        if body.start_on_completion:
            server["mc_message"] = "The server will be ready to start after installation"
    elif body.start_on_completion:
        inst = manager.get(server_row)
        await inst.start()
        server["status"] = inst.status
        server["resources"] = inst.stats()
    return {"data": server, "minecraft_job": minecraft_job}


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
