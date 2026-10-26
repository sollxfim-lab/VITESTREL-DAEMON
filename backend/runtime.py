from __future__ import annotations

import asyncio
import json
import os
import shlex
import signal
import time
from collections import deque
from pathlib import Path
from typing import Any

import psutil

from config import SERVERS_DIR, docker_available

MAX_HISTORY = 800


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            fp = Path(root) / name
            try:
                total += fp.stat().st_size
            except OSError:
                continue
    return total


def substitute(command: str, env: dict[str, str]) -> str:
    out = command
    for key, value in env.items():
        out = out.replace("{{" + key + "}}", str(value))
        out = out.replace("{{" + key.upper() + "}}", str(value))
    return out


class Instance:
    def __init__(self, server: dict[str, Any]):
        self.server_id: str = server["id"]
        self.server = server
        self.proc: asyncio.subprocess.Process | None = None
        self.pid: int | None = None
        self.started_at: float | None = None
        self.status: str = "offline"
        self.history: deque[str] = deque(maxlen=MAX_HISTORY)
        self.subscribers: set[asyncio.Queue[str]] = set()
        self.reader_task: asyncio.Task | None = None
        self.mode: str = "process"
        self.docker_name: str | None = None
        self.last_cpu: float = 0.0
        self.last_net_in: int = 0
        self.last_net_out: int = 0
        self.ps: psutil.Process | None = None
        self._cpu_t: float = 0.0
        self._cpu_n: float = 0.0
        self.lock = asyncio.Lock()

    def emit(self, line: str) -> None:
        if not line.endswith("\n"):
            line = line + "\n"
        self.history.append(line)
        for q in list(self.subscribers):
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=400)
        for line in self.history:
            try:
                q.put_nowait(line)
            except asyncio.QueueFull:
                break
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self.subscribers.discard(q)

    def cwd(self) -> Path:
        return SERVERS_DIR / self.server_id

    def build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        extra: dict[str, Any] = {}
        raw = self.server.get("environment") or {}
        if isinstance(raw, str):
            try:
                extra = json.loads(raw)
            except json.JSONDecodeError:
                extra = {}
        elif isinstance(raw, dict):
            extra = dict(raw)
        merged = {
            "SERVER_NAME": self.server["name"],
            "SERVER_MEMORY": str(self.server["memory"]),
            "SERVER_IP": self.server.get("allocation_ip") or "0.0.0.0",
            "SERVER_PORT": str(self.server["allocation_port"]),
            "TZ": "UTC",
            "PYTHONUNBUFFERED": "1",
        }
        merged.update({str(k): str(v) for k, v in extra.items()})
        env.update(merged)
        return env

    def startup_command(self) -> str:
        env = self.build_env()
        cmd = substitute(self.server.get("startup") or "", env)
        return substitute(cmd, env)

    async def _read_stdout(self) -> None:
        proc = self.proc
        if proc is None or proc.stdout is None:
            return
        try:
            while True:
                chunk = await proc.stdout.readline()
                if not chunk:
                    break
                try:
                    text = chunk.decode("utf-8", errors="replace")
                except Exception:
                    text = str(chunk)
                self.emit(text.rstrip("\r"))
        finally:
            code = proc.returncode
            if code is None:
                try:
                    code = await proc.wait()
                except Exception:
                    code = -1
            self.emit(f"[vitestl] process exited with code {code}")
            self.status = "offline"
            self.pid = None
            self.ps = None
            self.proc = None

    async def start(self) -> None:
        async with self.lock:
            if self.proc and self.proc.returncode is None:
                return
            self.status = "starting"
            self.emit("[vitestl] starting instance...")
            cwd = self.cwd()
            cwd.mkdir(parents=True, exist_ok=True)
            env = self.build_env()
            command = self.startup_command()
            if not command.strip():
                self.status = "offline"
                self.emit("[vitestl] abort: empty startup command")
                raise RuntimeError("Empty startup command")

            prefer_docker = self.server.get("egg_runtime") == "docker" or self.server.get("runtime") == "docker"

            if prefer_docker and docker_available():
                await self._start_docker(command, env, cwd)
            else:
                if prefer_docker and not docker_available():
                    self.emit("[vitestl] docker engine unavailable on this node; using process runtime")
                await self._start_process(command, env, cwd)

            self.started_at = time.time()
            self.status = "running"
            self.emit(f"[vitestl] online  pid={self.pid}  mode={self.mode}  cmd={command}")

    async def _start_process(self, command: str, env: dict[str, str], cwd: Path) -> None:
        self.mode = "process"
        self.proc = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "-lc",
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.PIPE,
            cwd=str(cwd),
            env=env,
            start_new_session=True,
            limit=1024 * 256,
        )
        self.pid = self.proc.pid
        try:
            self.ps = psutil.Process(self.pid)
        except psutil.Error:
            self.ps = None
        self.reader_task = asyncio.create_task(self._read_stdout())

    async def _start_docker(self, command: str, env: dict[str, str], cwd: Path) -> None:
        self.mode = "docker"
        name = f"vitestl-{self.server_id[:8]}"
        self.docker_name = name
        image = env.get("IMAGE") or self.server.get("image") or "python:3.11-slim"
        port = self.server["allocation_port"]
        mem = int(self.server["memory"])
        docker_cmd = [
            "docker",
            "run",
            "--rm",
            "--name",
            name,
            "-p",
            f"{port}:{port}",
            "-v",
            f"{cwd}:/data",
            "-w",
            "/data",
            "--memory",
            f"{mem}m",
        ]
        for key in ("SERVER_NAME", "SERVER_MEMORY", "SERVER_IP", "SERVER_PORT", "PYTHONUNBUFFERED"):
            docker_cmd.extend(["-e", f"{key}={env.get(key, '')}"])
        docker_cmd.append(image)
        docker_cmd.extend(["/bin/sh", "-lc", command])
        self.emit("[vitestl] docker " + " ".join(shlex.quote(p) for p in docker_cmd))
        self.proc = await asyncio.create_subprocess_exec(
            *docker_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.PIPE,
            cwd=str(cwd),
            start_new_session=True,
        )
        self.pid = self.proc.pid
        try:
            self.ps = psutil.Process(self.pid)
        except psutil.Error:
            self.ps = None
        self.reader_task = asyncio.create_task(self._read_stdout())

    async def send(self, data: str) -> None:
        if self.proc and self.proc.stdin and self.proc.returncode is None:
            raw = (data if data.endswith("\n") else data + "\n").encode()
            self.proc.stdin.write(raw)
            try:
                await self.proc.stdin.drain()
            except Exception:
                pass
            self.emit(data if data.endswith("\n") else data + "\n")

    async def stop(self, kill: bool = False) -> None:
        async with self.lock:
            if not self.proc or self.proc.returncode is not None:
                self.status = "offline"
                return
            self.status = "stopping"
            self.emit("[vitestl] stopping instance...")
            pid = self.proc.pid
            try:
                os.killpg(pid, signal.SIGKILL if kill else signal.SIGTERM)
            except ProcessLookupError:
                pass
            except PermissionError:
                self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=8)
            except asyncio.TimeoutError:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                try:
                    await asyncio.wait_for(self.proc.wait(), timeout=4)
                except Exception:
                    pass
            if self.docker_name and docker_available():
                await asyncio.create_subprocess_exec(
                    "docker", "rm", "-f", self.docker_name,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            self.status = "offline"
            self.pid = None
            self.ps = None
            self.emit("[vitestl] instance offline")

    def stats(self) -> dict[str, Any]:
        cpu = 0.0
        memory = 0
        uptime = 0
        state = self.status
        if self.proc and self.proc.returncode is None:
            state = "running"
            if self.started_at:
                uptime = int(time.time() - self.started_at)
            proc = self.ps
            if proc is not None:
                try:
                    if not proc.is_running():
                        proc = None
                    else:
                        children = proc.children(recursive=True)
                        group = [proc, *children]
                        cpu = 0.0
                        memory = 0
                        for p in group:
                            try:
                                cpu += p.cpu_percent(interval=None)
                                memory += p.memory_info().rss
                            except psutil.Error:
                                continue
                except psutil.Error:
                    pass
        disk = dir_size(self.cwd())
        limit_mem = int(self.server.get("memory") or 0) * 1024 * 1024
        limit_disk = int(self.server.get("disk") or 0) * 1024 * 1024
        return {
            "state": state,
            "cpu_absolute": round(cpu, 1),
            "memory_bytes": int(memory),
            "memory_limit_bytes": limit_mem,
            "disk_bytes": int(disk),
            "disk_limit_bytes": limit_disk,
            "network": {"rx_bytes": self.last_net_in, "tx_bytes": self.last_net_out},
            "uptime": uptime,
            "pid": self.pid,
            "mode": self.mode,
        }


class Runtime:
    def __init__(self) -> None:
        self.instances: dict[str, Instance] = {}

    def get(self, server: dict[str, Any]) -> Instance:
        inst = self.instances.get(server["id"])
        if inst is None:
            inst = Instance(server)
            self.instances[server["id"]] = inst
        else:
            inst.server = server
        return inst

    def status_of(self, server_id: str) -> str:
        inst = self.instances.get(server_id)
        if not inst:
            return "offline"
        if inst.proc and inst.proc.returncode is None:
            return "running"
        return inst.status if inst.status != "running" else "offline"


manager = Runtime()
