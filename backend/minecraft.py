"""Minecraft provisioning, content discovery, and status helpers.

The module talks only to the official distribution APIs:

* Mojang piston metadata for Vanilla Java
* PaperMC Fill for Paper, Folia, Velocity and Waterfall
* PurpurMC for Purpur
* Fabric meta and Quilt meta for mod loaders
* MinecraftForge promotions/Maven and NeoForged Maven for installers
* Minecraft services for Bedrock Dedicated Server
* Modrinth for plugins, mods and their metadata

Every download is HTTPS, host-validated (including redirects), retried with
resume support, written through a temporary file, and optionally
checksum-verified. The module is synchronous; the panel runs it in a worker
thread so the API stays responsive.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

USER_AGENT = "Meridian/2.0.0 (Minecraft provisioning; +https://github.com/vitestl)"
HTTP_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 60
DOWNLOAD_ATTEMPTS = 4
DOWNLOAD_RETRY_DELAYS = (2, 5, 10)
DOWNLOAD_CHUNK = 256 * 1024
MAX_DOWNLOAD_BYTES = 768 * 1024 * 1024
MAX_CONTENT_BYTES = 256 * 1024 * 1024
PLUGIN_SUFFIXES = (".jar", ".zip")
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
SAFE_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._+()\[\]-]{0,180}$")
PROPERTY_KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

LogCallback = Callable[[str], None]


class MinecraftError(RuntimeError):
    """Raised for invalid selections, upstream failures and unsafe files."""


# ---------------------------------------------------------------------------
# Software catalogue
# ---------------------------------------------------------------------------

SOFTWARE: dict[str, dict[str, Any]] = {
    "vanilla": {
        "id": "vanilla",
        "name": "Vanilla",
        "edition": "java",
        "kind": "server",
        "description": "The official Mojang Java server. Maximum compatibility, no plugins.",
        "accent": "#5f9f3f",
        "icon": "cube",
        "content": None,
        "content_dir": "",
        "loaders": [],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "Mojang",
    },
    "paper": {
        "id": "paper",
        "name": "Paper",
        "edition": "java",
        "kind": "server",
        "description": "High-performance Spigot fork with a mature plugin ecosystem.",
        "accent": "#f0b429",
        "icon": "bolt",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["paper", "spigot", "bukkit", "purpur", "folia"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "PaperMC",
    },
    "purpur": {
        "id": "purpur",
        "name": "Purpur",
        "edition": "java",
        "kind": "server",
        "description": "Paper fork with extended gameplay and configuration options.",
        "accent": "#b37ae8",
        "icon": "gem",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["purpur", "paper", "spigot", "bukkit"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "PurpurMC",
    },
    "folia": {
        "id": "folia",
        "name": "Folia",
        "edition": "java",
        "kind": "server",
        "description": "Paper fork with regionised multithreading for very large worlds.",
        "accent": "#e8875a",
        "icon": "layer-group",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["folia", "paper", "spigot", "bukkit"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "PaperMC",
    },
    "fabric": {
        "id": "fabric",
        "name": "Fabric",
        "edition": "java",
        "kind": "server",
        "description": "Lightweight, fast-updating mod loader for modern Minecraft.",
        "accent": "#d5c68a",
        "icon": "feather",
        "content": "mod",
        "content_dir": "mods",
        "loaders": ["fabric"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "FabricMC",
    },
    "quilt": {
        "id": "quilt",
        "name": "Quilt",
        "edition": "java",
        "kind": "server",
        "description": "Fabric-compatible loader with an extended modding toolchain.",
        "accent": "#c993e6",
        "icon": "shapes",
        "content": "mod",
        "content_dir": "mods",
        "loaders": ["quilt", "fabric"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "QuiltMC",
    },
    "forge": {
        "id": "forge",
        "name": "Forge",
        "edition": "java",
        "kind": "server",
        "description": "The long-standing modding platform with the largest mod catalogue.",
        "accent": "#d97b4f",
        "icon": "hammer",
        "content": "mod",
        "content_dir": "mods",
        "loaders": ["forge"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "MinecraftForge",
    },
    "neoforge": {
        "id": "neoforge",
        "name": "NeoForge",
        "edition": "java",
        "kind": "server",
        "description": "Community successor to Forge for Minecraft 1.20.2 and newer.",
        "accent": "#e9a54a",
        "icon": "fire-flame-curved",
        "content": "mod",
        "content_dir": "mods",
        "loaders": ["neoforge"],
        "proxy": False,
        "requires_eula": True,
        "egg_id": 27,
        "source": "NeoForged",
    },
    "velocity": {
        "id": "velocity",
        "name": "Velocity",
        "edition": "java",
        "kind": "proxy",
        "description": "Modern, high-throughput Minecraft proxy for network backends.",
        "accent": "#54c8e8",
        "icon": "wind",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["velocity"],
        "proxy": True,
        "requires_eula": False,
        "egg_id": 27,
        "source": "PaperMC",
    },
    "waterfall": {
        "id": "waterfall",
        "name": "Waterfall",
        "edition": "java",
        "kind": "proxy",
        "description": "Maintained BungeeCord fork for legacy proxy networks.",
        "accent": "#5fa8e8",
        "icon": "water",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["waterfall"],
        "proxy": True,
        "requires_eula": False,
        "egg_id": 27,
        "source": "PaperMC",
    },
    "bungeecord": {
        "id": "bungeecord",
        "name": "BungeeCord",
        "edition": "java",
        "kind": "proxy",
        "description": "Classic proxy from the Spigot team. Latest successful build.",
        "accent": "#7893b8",
        "icon": "diagram-project",
        "content": "plugin",
        "content_dir": "plugins",
        "loaders": ["bungeecord"],
        "proxy": True,
        "requires_eula": False,
        "egg_id": 27,
        "source": "SpigotMC CI",
    },
    "bedrock": {
        "id": "bedrock",
        "name": "Bedrock",
        "edition": "bedrock",
        "kind": "bedrock",
        "description": "Official Bedrock Dedicated Server for Windows, console and mobile clients.",
        "accent": "#3fb984",
        "icon": "cubes-stacked",
        "content": None,
        "content_dir": "",
        "loaders": [],
        "proxy": False,
        "requires_eula": False,
        "egg_id": 28,
        "source": "Minecraft Services",
    },
}

CONTENT_CURATED_PLUGINS = (
    "essentialsx",
    "luckperms",
    "chunky",
    "coreprotect",
    "spark",
    "viaversion",
    "geyser",
    "floodgate",
    "worldedit",
    "placeholderapi",
)
CONTENT_CURATED_MODS = (
    "fabric-api",
    "lithium",
    "ferrite-core",
    "spark",
    "krypton",
    "chunky",
    "waystones",
    "c2me-fabric",
    "carpet",
)

# The Modrinth projects endpoint does not return author names. Curated cards use
# this map so attribution stays accurate without an extra request per project.
CONTENT_CURATED_AUTHORS = {
    "essentialsx": "mdcfe",
    "luckperms": "lucko",
    "chunky": "pop4959",
    "coreprotect": "Intelli",
    "spark": "lucko",
    "viaversion": "kennytv",
    "geyser": "GeyserMC",
    "floodgate": "GeyserMC",
    "worldedit": "me4502",
    "placeholderapi": "funnycube",
    "fabric-api": "modmuss50",
    "lithium": "jellysquid3",
    "ferrite-core": "malte0811",
    "krypton": "astei",
    "waystones": "BlayTheNinth",
    "c2me-fabric": "ishland",
    "carpet": "altrisi",
}

_ALLOWED_DOWNLOAD_DOMAINS = (
    "mojang.com",
    "minecraft.net",
    "minecraft-services.net",
    "papermc.io",
    "purpurmc.org",
    "fabricmc.net",
    "quiltmc.org",
    "minecraftforge.net",
    "neoforged.net",
    "md-5.net",
    "modrinth.com",
)
_ALLOWED_DOWNLOAD_HOSTS = {
    "minecraft.azureedge.net",
}

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def software(software_id: str) -> dict[str, Any]:
    key = (software_id or "").strip().lower()
    item = SOFTWARE.get(key)
    if not item:
        raise MinecraftError(f"Unknown Minecraft software: {software_id}")
    return dict(item)


def catalog() -> list[dict[str, Any]]:
    order = [
        "paper",
        "purpur",
        "folia",
        "vanilla",
        "fabric",
        "quilt",
        "forge",
        "neoforge",
        "velocity",
        "waterfall",
        "bungeecord",
        "bedrock",
    ]
    return [dict(SOFTWARE[key]) for key in order]


def content_capabilities(software_id: str) -> dict[str, Any]:
    meta = software(software_id)
    return {
        "enabled": bool(meta["content"]),
        "kind": meta["content"],
        "directory": meta["content_dir"],
        "loaders": list(meta["loaders"]),
        "project_type": "plugin" if meta["content"] == "plugin" else "mod",
        "edition": meta["edition"],
    }


# ---------------------------------------------------------------------------
# HTTP + cache helpers
# ---------------------------------------------------------------------------


def _cache_get(key: str, ttl: float) -> Any | None:
    now = time.time()
    with _cache_lock:
        item = _cache.get(key)
        if item and now - item[0] <= ttl:
            return item[1]
    return None


def _cache_put(key: str, value: Any) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), value)
        if len(_cache) > 512:
            oldest = sorted(_cache.items(), key=lambda entry: entry[1][0])[:128]
            for cache_key, _ in oldest:
                _cache.pop(cache_key, None)


def _fetch(url: str, *, ttl: float = 300, accept: str = "application/json") -> bytes:
    cached = _cache_get(url, ttl)
    if cached is not None:
        return cached
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Encoding": "identity",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            body = response.read()
    except Exception as exc:  # urllib raises many transport types
        raise MinecraftError(f"Upstream request failed for {url}: {exc}") from exc
    _cache_put(url, body)
    return body


def _json(url: str, *, ttl: float = 300) -> Any:
    body = _fetch(url, ttl=ttl)
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MinecraftError(f"Invalid JSON returned by {url}") from exc


def _check_download_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise MinecraftError("Refusing a non-HTTPS download")
    host = (parsed.hostname or "").lower().rstrip(".")
    allowed = host in _ALLOWED_DOWNLOAD_HOSTS or any(
        host == domain or host.endswith("." + domain)
        for domain in _ALLOWED_DOWNLOAD_DOMAINS
    )
    if not allowed:
        raise MinecraftError(f"Download host is not allow-listed: {host or 'unknown'}")


class _RetryableDownloadError(RuntimeError):
    """A transport failure that can be resumed or retried."""


def _hash_prefix(path: Path) -> tuple[Any, Any]:
    sha256 = hashlib.sha256()
    sha1 = hashlib.sha1()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            sha256.update(chunk)
            sha1.update(chunk)
    return sha256, sha1


def _download_total_size(response: Any, existing: int) -> int:
    """Return the total entity size when the response exposes one."""
    try:
        length = int(response.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        length = 0
    content_range = str(response.headers.get("Content-Range") or "").strip()
    match = re.match(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", content_range, re.IGNORECASE)
    if match:
        start = int(match.group(1))
        if start != existing:
            raise _RetryableDownloadError(
                "Upstream returned an unexpected resume range"
            )
        if match.group(3) == "*":
            return existing + length if length else 0
        return int(match.group(3))
    return existing + length if length else 0


def _download_once(
    url: str,
    destination: Path,
    temporary: Path,
    *,
    expected_sha256: str,
    expected_sha1: str,
    max_bytes: int,
    log: LogCallback | None,
) -> int:
    try:
        existing = temporary.stat().st_size
    except OSError:
        existing = 0
    if existing > max_bytes:
        temporary.unlink(missing_ok=True)
        existing = 0
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    if existing:
        headers["Range"] = f"bytes={existing}-"
        _log(log, "Resuming %s at %.1f MiB" % (destination.name, existing / (1024 * 1024)))
    request = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT)
    except urllib.error.HTTPError as exc:
        status = int(exc.code or 0)
        exc.close()
        if status == 416 and existing:
            temporary.unlink(missing_ok=True)
            raise _RetryableDownloadError(
                "Upstream rejected the resume position"
            ) from exc
        if status in (408, 425, 429) or status >= 500:
            raise _RetryableDownloadError(f"Upstream returned HTTP {status}") from exc
        raise MinecraftError(f"Download failed with HTTP {status}") from exc
    except Exception as exc:  # urllib raises many transport types
        raise _RetryableDownloadError(str(exc) or exc.__class__.__name__) from exc

    with response:
        _check_download_url(response.geturl() or url)
        status = int(getattr(response, "status", 0) or response.getcode() or 0)
        if status not in (200, 206):
            raise _RetryableDownloadError(f"Upstream returned HTTP {status}")
        resuming = status == 206 and existing > 0
        if not resuming:
            existing = 0
            temporary.unlink(missing_ok=True)
        try:
            total = _download_total_size(response, existing)
        except _RetryableDownloadError:
            if existing:
                temporary.unlink(missing_ok=True)
            raise
        if total and total > max_bytes:
            raise MinecraftError(
                f"Download is larger than the allowed limit ({total} bytes)"
            )
        if total and existing > total:
            temporary.unlink(missing_ok=True)
            raise _RetryableDownloadError(
                "Partial file is larger than the upstream file"
            )
        if resuming:
            sha256, sha1 = _hash_prefix(temporary)
        else:
            sha256 = hashlib.sha256()
            sha1 = hashlib.sha1()
        written = existing
        attempt_started = written
        started = time.time()
        report_at = (
            32 * 1024 * 1024
            if not total or total > 32 * 1024 * 1024
            else 0
        )
        with temporary.open("ab" if resuming else "wb") as handle:
            while True:
                try:
                    chunk = response.read(DOWNLOAD_CHUNK)
                except Exception as exc:
                    raise _RetryableDownloadError(
                        f"Connection dropped after {written} bytes: {exc}"
                    ) from exc
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise MinecraftError("Download exceeded the allowed size")
                sha256.update(chunk)
                sha1.update(chunk)
                handle.write(chunk)
                if report_at and written >= report_at:
                    if total:
                        _log(
                            log,
                            "Downloading %s: %.1f / %.1f MiB"
                            % (
                                destination.name,
                                written / (1024 * 1024),
                                total / (1024 * 1024),
                            ),
                        )
                    else:
                        _log(
                            log,
                            "Downloading %s: %.1f MiB"
                            % (destination.name, written / (1024 * 1024)),
                        )
                    report_at = written + 32 * 1024 * 1024
        if total and written < total:
            raise _RetryableDownloadError(
                f"Connection closed after {written} of {total} bytes"
            )
        if expected_sha256 and sha256.hexdigest().lower() != expected_sha256.lower():
            temporary.unlink(missing_ok=True)
            raise _RetryableDownloadError("Checksum verification failed")
        if expected_sha1 and sha1.hexdigest().lower() != expected_sha1.lower():
            temporary.unlink(missing_ok=True)
            raise _RetryableDownloadError("Checksum verification failed")
        os.replace(temporary, destination)
    elapsed = max(0.001, time.time() - started)
    transferred = written - attempt_started
    if log:
        log(
            "Downloaded %s (%.1f MiB at %.1f MiB/s)"
            % (
                destination.name,
                written / (1024 * 1024),
                transferred / (1024 * 1024) / elapsed,
            )
        )
    return written


def _download(
    url: str,
    destination: Path,
    *,
    expected_sha256: str = "",
    expected_sha1: str = "",
    max_bytes: int = MAX_DOWNLOAD_BYTES,
    log: LogCallback | None = None,
) -> int:
    _check_download_url(url)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    metadata = temporary.with_name(temporary.name + ".json")
    fingerprint = json.dumps(
        {
            "url": url,
            "sha256": expected_sha256.lower(),
            "sha1": expected_sha1.lower(),
            "max_bytes": int(max_bytes),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    if temporary.exists():
        try:
            previous = metadata.read_text(encoding="utf-8").strip()
        except OSError:
            previous = ""
        if previous != fingerprint:
            temporary.unlink(missing_ok=True)
    try:
        metadata.write_text(fingerprint, encoding="utf-8")
    except OSError:
        metadata.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)

    last_error = "unknown transport error"
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            result = _download_once(
                url,
                destination,
                temporary,
                expected_sha256=expected_sha256,
                expected_sha1=expected_sha1,
                max_bytes=max_bytes,
                log=log,
            )
        except _RetryableDownloadError as exc:
            last_error = str(exc)[:240] or "transport error"
            if attempt >= DOWNLOAD_ATTEMPTS:
                break
            delay = DOWNLOAD_RETRY_DELAYS[
                min(attempt - 1, len(DOWNLOAD_RETRY_DELAYS) - 1)
            ]
            _log(
                log,
                "Download interrupted: %s. Retrying in %ss (attempt %d of %d)"
                % (last_error, delay, attempt + 1, DOWNLOAD_ATTEMPTS),
            )
            time.sleep(delay)
        except MinecraftError:
            temporary.unlink(missing_ok=True)
            metadata.unlink(missing_ok=True)
            raise
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            metadata.unlink(missing_ok=True)
            raise MinecraftError(f"Download failed: {exc}") from exc
        else:
            metadata.unlink(missing_ok=True)
            return result

    if temporary.exists() and temporary.stat().st_size:
        _log(
            log,
            "Partial download retained at %.1f MiB; the next attempt will resume it"
            % (temporary.stat().st_size / (1024 * 1024)),
        )
    else:
        temporary.unlink(missing_ok=True)
        metadata.unlink(missing_ok=True)
    raise MinecraftError(
        f"Download failed after {DOWNLOAD_ATTEMPTS} attempts: {last_error}"
    )


def _log(log: LogCallback | None, message: str) -> None:
    if log:
        try:
            log(message)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Version discovery
# ---------------------------------------------------------------------------


def _mojang_manifest() -> dict[str, Any]:
    return _json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", ttl=600)


def _release_order() -> list[dict[str, Any]]:
    manifest = _mojang_manifest()
    return list(manifest.get("versions") or [])


def _release_ids() -> list[str]:
    return [entry["id"] for entry in _release_order() if entry.get("type") == "release"]


def _version_option(version_id: str, version_type: str = "release", **extra: Any) -> dict[str, Any]:
    item = {"id": version_id, "type": version_type}
    item.update(extra)
    return item


def _stable_loader(loaders: list[dict[str, Any]]) -> dict[str, Any] | None:
    for item in loaders:
        if item.get("stable"):
            return item
    return loaders[0] if loaders else None


def _fill_project(project: str) -> dict[str, Any]:
    return _json(f"https://fill.papermc.io/v3/projects/{project}", ttl=600)


def _fill_versions(project: str, include_snapshots: bool = False) -> list[dict[str, Any]]:
    data = _fill_project(project)
    groups = data.get("versions") or {}
    values: list[str] = []
    seen: set[str] = set()
    for group in groups.values():
        for value in group:
            if value in seen:
                continue
            seen.add(value)
            values.append(value)
    if not include_snapshots:
        values = [
            value
            for value in values
            if not re.search(r"-(pre|rc|snapshot)", value, re.IGNORECASE)
            and "SNAPSHOT" not in value
        ]
    return [_version_option(value) for value in values]


def _fill_builds(project: str, version: str) -> list[dict[str, Any]]:
    encoded = urllib.parse.quote(version, safe="")
    builds = _json(f"https://fill.papermc.io/v3/projects/{project}/versions/{encoded}/builds", ttl=180)
    if not isinstance(builds, list):
        return []
    output: list[dict[str, Any]] = []
    for build in builds:
        downloads = build.get("downloads") or {}
        if not downloads:
            continue
        output.append(
            {
                "id": str(build.get("id")),
                "label": f"Build {build.get('id')}",
                "channel": str(build.get("channel") or "STABLE").lower(),
                "stable": str(build.get("channel") or "").upper() == "STABLE",
                "time": build.get("time"),
            }
        )
    return output[:80]


def _fabric_versions(include_snapshots: bool = False) -> list[dict[str, Any]]:
    rows = _json("https://meta.fabricmc.net/v2/versions/game", ttl=600)
    output = []
    for row in rows or []:
        if not include_snapshots and not row.get("stable"):
            continue
        output.append(
            _version_option(
                str(row.get("version")),
                "release" if row.get("stable") else "snapshot",
            )
        )
    return output


def _quilt_versions(include_snapshots: bool = False) -> list[dict[str, Any]]:
    rows = _json("https://meta.quiltmc.org/v3/versions/game", ttl=600)
    output = []
    for row in rows or []:
        if not include_snapshots and not row.get("stable"):
            continue
        output.append(
            _version_option(
                str(row.get("version")),
                "release" if row.get("stable") else "snapshot",
            )
        )
    return output


def _promotions() -> dict[str, str]:
    data = _json(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        ttl=600,
    )
    promos = data.get("promos") or {}
    return promos if isinstance(promos, dict) else {}


def _forge_versions(include_snapshots: bool = False) -> list[dict[str, Any]]:
    promos = _promotions()
    supported = set()
    for key in promos:
        match = re.match(r"^(.+)-(latest|recommended)$", key)
        if match:
            supported.add(match.group(1))
    output = []
    for entry in _release_order():
        if entry.get("type") != "release" and not include_snapshots:
            continue
        if entry["id"] in supported:
            output.append(_version_option(entry["id"], entry.get("type") or "release"))
    return output


def _forge_loaders(version: str) -> list[dict[str, Any]]:
    try:
        body = _fetch(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
            ttl=900,
            accept="application/xml",
        )
        root = ET.fromstring(body)
        versions = [
            node.text
            for node in root.findall("./versioning/versions/version")
            if node.text and node.text.startswith(version + "-")
        ]
    except Exception:
        versions = []
    promos = _promotions()
    recommended = promos.get(f"{version}-recommended")
    latest = promos.get(f"{version}-latest")
    rows = []
    seen: set[str] = set()
    for loader in [recommended, latest] + list(reversed(versions)):
        if not loader:
            continue
        # Promotions only publish the build number, while the Maven metadata
        # prefixes it with the Minecraft version. Normalize both to the build
        # identifier used by the installer URL.
        build = loader
        if build.startswith(version + "-"):
            build = build[len(version) + 1 :]
        if not build or build in seen:
            continue
        seen.add(build)
        rows.append(
            {
                "id": build,
                "label": build
                + (" (recommended)" if loader == recommended else " (latest)" if loader == latest else ""),
                "stable": loader == recommended or loader == latest or "-beta" not in build,
            }
        )
    return rows[:60]


def _neoforge_mc_version(version: str) -> str | None:
    base = version.split("-", 1)[0]
    parts = base.split(".")
    if len(parts) < 2 or not all(part.isdigit() for part in parts[:2]):
        return None
    major = int(parts[0])
    minor = int(parts[1])
    if major >= 26:
        return f"{major}.{minor}"
    if major >= 20:
        return f"1.{major}.{minor}" if minor else f"1.{major}"
    return None


def _neoforge_rows() -> list[dict[str, Any]]:
    data = _json(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
        ttl=900,
    )
    rows = data.get("versions") or []
    return [str(row) for row in rows if _neoforge_mc_version(str(row))]


def _neoforge_versions(include_snapshots: bool = False) -> list[dict[str, Any]]:
    supported = {}
    for version in _neoforge_rows():
        mc = _neoforge_mc_version(version)
        if mc:
            supported.setdefault(mc, []).append(version)
    output = []
    order = _release_order()
    for entry in order:
        if entry.get("type") != "release" and not include_snapshots:
            continue
        if entry["id"] in supported:
            output.append(_version_option(entry["id"], entry.get("type") or "release"))
    # Keep entries that the manifest no longer lists (rare but possible).
    for mc in supported:
        if not any(item["id"] == mc for item in output):
            output.append(_version_option(mc))
    return output


def _neoforge_loaders(version: str) -> list[dict[str, Any]]:
    rows = [row for row in _neoforge_rows() if _neoforge_mc_version(row) == version]
    output = []
    for row in reversed(rows):
        output.append(
            {
                "id": row,
                "label": row + ("" if row.endswith("-beta") else " (stable)"),
                "stable": not row.endswith("-beta"),
            }
        )
    return output[:80]


def _bedrock_links() -> list[dict[str, Any]]:
    data = _json(
        "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links",
        ttl=600,
    )
    result = data.get("result") or {}
    links = result.get("links") if isinstance(result, dict) else None
    return list(links or [])


def _bedrock_versions() -> list[dict[str, Any]]:
    output = []
    for link in _bedrock_links():
        download_type = str(link.get("downloadType") or "")
        url = str(link.get("downloadUrl") or "")
        if "serverBedrock" not in download_type or "Windows" in download_type:
            continue
        preview = "Preview" in download_type
        match = re.search(r"bedrock-server-([0-9.]+)\.zip", url)
        version = match.group(1) if match else ("preview" if preview else "latest")
        output.append(
            _version_option(
                version,
                "preview" if preview else "release",
                download_url=url,
                channel="preview" if preview else "stable",
            )
        )
    return output


def _purpur_versions(include_snapshots: bool = False) -> list[dict[str, Any]]:
    data = _json("https://api.purpurmc.org/v2/purpur", ttl=600)
    rows = data.get("versions") or []
    if not include_snapshots:
        rows = [row for row in rows if not re.search(r"-(pre|rc|snapshot)", str(row), re.IGNORECASE)]
    return [_version_option(str(row)) for row in reversed(rows)]


def _purpur_loaders(version: str) -> list[dict[str, Any]]:
    encoded = urllib.parse.quote(version, safe="")
    data = _json(f"https://api.purpurmc.org/v2/purpur/{encoded}", ttl=300)
    builds = data.get("builds") or {}
    all_builds = builds.get("all") or []
    latest = str(builds.get("latest") or "")
    output = []
    for build in reversed(all_builds):
        value = str(build)
        output.append(
            {
                "id": value,
                "label": f"Build {value}" + (" (latest)" if value == latest else ""),
                "stable": True,
            }
        )
    return output[:80]


def latest_release(software_id: str) -> dict[str, Any]:
    """Return the current stable release and loader/build for a software family."""
    meta = software(software_id)
    catalog = versions(meta["id"], "", False)
    version = str(catalog["defaults"].get("version") or "")
    loader = str(catalog["defaults"].get("loader_version") or "")
    selected = next(
        (row for row in catalog.get("versions") or [] if str(row.get("id") or "") == version),
        {},
    )
    return {
        "software": meta["id"],
        "software_name": meta["name"],
        "edition": meta["edition"],
        "version": version,
        "loader_version": loader,
        "released": selected.get("released"),
        "type": selected.get("type") or "release",
        "notes": list(catalog.get("notes") or []),
        "fetched_at": _now(),
    }


def check_update(
    software_id: str,
    current_version: str,
    current_loader: str = "",
) -> dict[str, Any]:
    """Compare an installed server against the current upstream release."""
    latest = latest_release(software_id)
    # BungeeCord intentionally exposes a floating "latest" build. Comparing it
    # textually would always report an update.
    floating = latest["version"].lower() == "latest"
    version_update = bool(latest["version"]) and not floating and current_version != latest["version"]
    loader_update = bool(latest["loader_version"]) and current_loader != latest["loader_version"]
    return {
        "current": {
            "software": software_id,
            "version": current_version,
            "loader_version": current_loader,
        },
        "latest": latest,
        "update_available": bool(current_version) and (version_update or loader_update),
        "version_update": bool(current_version) and version_update,
        "loader_update": bool(current_version) and bool(latest["loader_version"]) and loader_update,
        "floating_channel": floating,
    }


def content_update(
    software_id: str,
    project_id: str,
    current_version_id: str,
    *,
    game_version: str = "",
) -> dict[str, Any] | None:
    """Return the newest compatible Modrinth version when it differs from the installed one."""
    result = content_versions(
        software_id,
        project_id,
        game_version=game_version,
        limit=12,
    )
    rows = [row for row in result.get("data") or [] if row.get("id")]
    if not rows:
        return None
    latest = rows[0]
    if latest["id"] == current_version_id:
        return None
    return {
        "id": latest["id"],
        "name": latest.get("name") or "",
        "version_number": latest.get("version_number") or "",
        "game_versions": latest.get("game_versions") or [],
        "loaders": latest.get("loaders") or [],
        "date_published": latest.get("date_published"),
        "files": latest.get("files") or [],
    }


def versions(software_id: str, version: str = "", include_snapshots: bool = False) -> dict[str, Any]:
    meta = software(software_id)
    key = meta["id"]
    items: list[dict[str, Any]] = []
    loaders: list[dict[str, Any]] = []
    notes: list[str] = []

    if key == "vanilla":
        manifest = _mojang_manifest()
        for entry in manifest.get("versions") or []:
            if not include_snapshots and entry.get("type") != "release":
                continue
            items.append(
                _version_option(
                    str(entry["id"]),
                    str(entry.get("type") or "release"),
                    released=entry.get("releaseTime"),
                )
            )
        version = version or str((manifest.get("latest") or {}).get("release") or "")
    elif key in ("paper", "folia", "velocity", "waterfall"):
        items = _fill_versions(key, include_snapshots)
        version = version or (items[0]["id"] if items else "")
        if version and key in ("paper", "folia", "velocity", "waterfall"):
            loaders = _fill_builds(key, version)
    elif key == "purpur":
        items = _purpur_versions(include_snapshots)
        if version:
            loaders = _purpur_loaders(version)
        elif items:
            version = items[0]["id"]
            loaders = _purpur_loaders(version)
    elif key == "fabric":
        items = _fabric_versions(include_snapshots)
        version = version or (items[0]["id"] if items else "")
        if version:
            rows = _json(
                f"https://meta.fabricmc.net/v2/versions/loader/{urllib.parse.quote(version, safe='')}",
                ttl=600,
            )
            for row in rows or []:
                loader = row.get("loader") or {}
                loaders.append(
                    {
                        "id": str(loader.get("version")),
                        "label": str(loader.get("version")),
                        "stable": bool(loader.get("stable")),
                    }
                )
    elif key == "quilt":
        items = _quilt_versions(include_snapshots)
        version = version or (items[0]["id"] if items else "")
        if version:
            rows = _json(
                f"https://meta.quiltmc.org/v3/versions/loader/{urllib.parse.quote(version, safe='')}",
                ttl=600,
            )
            for row in rows or []:
                loader = row.get("loader") or {}
                loaders.append(
                    {
                        "id": str(loader.get("version")),
                        "label": str(loader.get("version")),
                        "stable": not str(loader.get("version", "")).endswith("-beta")
                        and not str(loader.get("version", "")).endswith("-alpha"),
                    }
                )
            notes.append("Quilt support varies by mod. Quilt-compatible Fabric mods are enabled.")
    elif key == "forge":
        items = _forge_versions(include_snapshots)
        version = version or (items[0]["id"] if items else "")
        if version:
            loaders = _forge_loaders(version)
    elif key == "neoforge":
        items = _neoforge_versions(include_snapshots)
        version = version or (items[0]["id"] if items else "")
        if version:
            loaders = _neoforge_loaders(version)
    elif key == "bungeecord":
        items = [_version_option("latest", released=None)]
        loaders = [{"id": "latest", "label": "Latest successful build", "stable": True}]
        version = "latest"
        notes.append("BungeeCord has no published version matrix; the latest successful CI build is used.")
    elif key == "bedrock":
        items = _bedrock_versions()
        version = version or (items[0]["id"] if items else "")
        notes.append("Preview builds may corrupt production worlds. Use them only for testing.")
    else:
        raise MinecraftError("Unsupported Minecraft software")

    default_loader = ""
    if loaders:
        preferred = _stable_loader(loaders)
        default_loader = str(preferred.get("id") if preferred else loaders[0]["id"])
    return {
        "software": meta,
        "versions": items,
        "loaders": loaders,
        "defaults": {"version": version, "loader_version": default_loader},
        "notes": notes,
        "fetched_at": _now(),
    }


# ---------------------------------------------------------------------------
# Server installation
# ---------------------------------------------------------------------------


def _java_image(version: str) -> str:
    match = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", version or "")
    if not match:
        return "eclipse-temurin:21-jre"
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    patch = int(match.group(3) or 0)
    if major >= 26:
        return "eclipse-temurin:25-jre"
    if major > 1:
        return "eclipse-temurin:21-jre"
    if major == 1:
        if (minor, patch) >= (20, 5):
            return "eclipse-temurin:21-jre"
        if minor >= 18:
            return "eclipse-temurin:17-jre"
        if minor >= 17:
            return "eclipse-temurin:16-jre"
        return "eclipse-temurin:8-jre"
    return "eclipse-temurin:21-jre"


def _aikar_flags(jar: str = "server.jar", nogui: bool = True) -> str:
    command = (
        "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M "
        "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 "
        "-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch "
        "-XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M "
        "-XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 "
        "-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 "
        "-XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 "
        "-XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 "
        f"-jar {jar}"
    )
    return command + (" nogui" if nogui else "")


def _proxy_startup(jar: str = "server.jar") -> str:
    return (
        "java -Xms512M -Xmx{{SERVER_MEMORY}}M -XX:+UseG1GC "
        "-XX:G1HeapRegionSize=4M -XX:+ParallelRefProcEnabled "
        f"-jar {jar}"
    )


def _write_start_script(root: Path, installer_name: str, flavour: str) -> None:
    script = f"""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
MEM="${{SERVER_MEMORY:-2048}}"
if [ ! -f user_jvm_args.txt ]; then
  printf -- "-Xms%sM\\n-Xmx%sM\\n" "$MEM" "$MEM" > user_jvm_args.txt
fi
if [ ! -f run.sh ]; then
  echo "[meridian] first start: installing {flavour} server libraries"
  java -jar "{installer_name}" --installServer
fi
exec bash run.sh nogui
"""
    path = root / "start.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    path.chmod(0o755)


def _write_jvm_args(root: Path, memory: int) -> None:
    path = root / "user_jvm_args.txt"
    if path.exists():
        return
    path.write_text(
        f"-Xms{max(512, int(memory))}M\n-Xmx{max(512, int(memory))}M\n"
        "-XX:+UseG1GC\n-XX:+ParallelRefProcEnabled\n-XX:MaxGCPauseMillis=200\n",
        encoding="utf-8",
    )


def _run_installer(root: Path, installer: Path, log: LogCallback | None) -> bool:
    java = shutil.which("java")
    if not java:
        _log(log, "Java is not available on the panel host; the installer will run on first start")
        return False
    _log(log, "Running the server installer. This can take several minutes")
    try:
        process = subprocess.Popen(
            [java, "-jar", str(installer), "--installServer"],
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            text = line.strip()
            if text:
                _log(log, text[:600])
        code = process.wait(timeout=1200)
    except subprocess.TimeoutExpired:
        process.kill()
        _log(log, "Installer timed out; the start script will retry on first launch")
        return False
    except OSError as exc:
        _log(log, f"Installer could not run: {exc}")
        return False
    if code != 0:
        _log(log, f"Installer exited with code {code}; the start script will retry")
        return False
    _log(log, "Server libraries installed")
    return True


def _download_vanilla(root: Path, version: str, log: LogCallback | None) -> str:
    manifest = _mojang_manifest()
    version = version or str((manifest.get("latest") or {}).get("release") or "")
    entry = next((row for row in manifest.get("versions") or [] if row.get("id") == version), None)
    if not entry:
        raise MinecraftError(f"Minecraft version {version} was not found")
    meta = _json(str(entry["url"]), ttl=1800)
    server = (meta.get("downloads") or {}).get("server") or {}
    if not server.get("url"):
        raise MinecraftError("This Minecraft version does not publish a server download")
    _download(
        str(server["url"]),
        root / "server.jar",
        expected_sha1=str(server.get("sha1") or ""),
        log=log,
    )
    return version


def _download_fill(
    root: Path,
    project: str,
    version: str,
    build_id: str,
    log: LogCallback | None,
) -> str:
    encoded = urllib.parse.quote(version, safe="")
    builds = _json(f"https://fill.papermc.io/v3/projects/{project}/versions/{encoded}/builds", ttl=180)
    if not isinstance(builds, list) or not builds:
        raise MinecraftError(f"No {project} builds are available for {version}")
    build: dict[str, Any] | None = None
    if build_id:
        build = next((row for row in builds if str(row.get("id")) == str(build_id)), None)
    if build is None:
        stable = [row for row in builds if str(row.get("channel") or "").upper() == "STABLE"]
        build = (stable or builds)[0]
    downloads = build.get("downloads") or {}
    artifact = downloads.get("server:default")
    if not artifact:
        artifact = next(iter(downloads.values()), None)
    if not artifact or not artifact.get("url"):
        raise MinecraftError(f"No download is available for {project} {version}")
    sha256 = str((artifact.get("checksums") or {}).get("sha256") or "")
    _download(
        str(artifact["url"]),
        root / "server.jar",
        expected_sha256=sha256,
        log=log,
    )
    return str(build.get("id") or build_id or "")


def _download_purpur(root: Path, version: str, build_id: str, log: LogCallback | None) -> str:
    encoded = urllib.parse.quote(version, safe="")
    if not build_id:
        info = _json(f"https://api.purpurmc.org/v2/purpur/{encoded}/latest", ttl=180)
        build_id = str(info.get("build") or "latest")
    url = f"https://api.purpurmc.org/v2/purpur/{encoded}/{urllib.parse.quote(build_id, safe='')}/download"
    _download(url, root / "server.jar", log=log)
    return build_id


def _download_fabric(
    root: Path,
    version: str,
    loader: str,
    log: LogCallback | None,
) -> str:
    rows = _json(
        f"https://meta.fabricmc.net/v2/versions/loader/{urllib.parse.quote(version, safe='')}",
        ttl=600,
    )
    candidates = [
        {
            "id": (row.get("loader") or {}).get("version"),
            "stable": (row.get("loader") or {}).get("stable"),
        }
        for row in rows or []
    ]
    chosen = _stable_loader(candidates)
    if not loader:
        loader = str((chosen or {}).get("id") or "")
    if not loader:
        raise MinecraftError(f"Fabric has no loader for Minecraft {version}")
    installers = _json("https://meta.fabricmc.net/v2/versions/installer", ttl=900)
    installer = _stable_loader(
        [{"id": row.get("version"), "stable": row.get("stable")} for row in installers or []]
    )
    installer_version = str((installer or {}).get("id") or "")
    if not installer_version:
        raise MinecraftError("Fabric installer metadata is unavailable")
    url = (
        "https://meta.fabricmc.net/v2/versions/loader/"
        f"{urllib.parse.quote(version, safe='')}/{urllib.parse.quote(loader, safe='')}/"
        f"{urllib.parse.quote(installer_version, safe='')}/server/jar"
    )
    _download(url, root / "server.jar", log=log)
    return loader


def _download_quilt(
    root: Path,
    version: str,
    loader: str,
    log: LogCallback | None,
) -> str:
    rows = _json(
        f"https://meta.quiltmc.org/v3/versions/loader/{urllib.parse.quote(version, safe='')}",
        ttl=600,
    )
    candidates = []
    for row in rows or []:
        item = row.get("loader") or {}
        candidates.append({"id": item.get("version"), "stable": item.get("version") and not str(item.get("version")).endswith(("-beta", "-alpha"))})
    chosen = _stable_loader(candidates)
    if not loader:
        loader = str((chosen or {}).get("id") or "")
    if not loader:
        raise MinecraftError(f"Quilt has no loader for Minecraft {version}")
    installers = _json("https://meta.quiltmc.org/v3/versions/installer", ttl=900)
    installer = installers[0] if isinstance(installers, list) and installers else {}
    installer_version = str(installer.get("version") or "")
    if not installer_version:
        raise MinecraftError("Quilt installer metadata is unavailable")
    url = (
        "https://meta.quiltmc.org/v3/versions/loader/"
        f"{urllib.parse.quote(version, safe='')}/{urllib.parse.quote(loader, safe='')}/"
        f"{urllib.parse.quote(installer_version, safe='')}/server/jar"
    )
    _download(url, root / "server.jar", log=log)
    return loader


def _install_forge(
    root: Path, version: str, loader: str, memory: int, log: LogCallback | None
) -> str:
    promos = _promotions()
    if not loader:
        loader = str(
            promos.get(f"{version}-recommended")
            or promos.get(f"{version}-latest")
            or ""
        )
    if not loader:
        raise MinecraftError(f"Forge has no published build for Minecraft {version}")
    installer_name = f"forge-{version}-{loader}-installer.jar"
    url = (
        "https://maven.minecraftforge.net/net/minecraftforge/forge/"
        f"{urllib.parse.quote(version, safe='')}-{urllib.parse.quote(loader, safe='')}/"
        f"{urllib.parse.quote(installer_name, safe='')}"
    )
    _download(url, root / installer_name, log=log)
    _write_jvm_args(root, memory)
    _write_start_script(root, installer_name, "Forge")
    _run_installer(root, root / installer_name, log)
    return loader


def _install_neoforge(
    root: Path, version: str, loader: str, memory: int, log: LogCallback | None
) -> str:
    rows = [row for row in _neoforge_rows() if _neoforge_mc_version(row) == version]
    if not loader:
        stable = [row for row in rows if not row.endswith("-beta")]
        loader = (stable or rows or [""])[-1]
    if not loader:
        raise MinecraftError(f"NeoForge has no published build for Minecraft {version}")
    installer_name = f"neoforge-{loader}-installer.jar"
    url = (
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/"
        f"{urllib.parse.quote(loader, safe='')}/{urllib.parse.quote(installer_name, safe='')}"
    )
    _download(url, root / installer_name, log=log)
    _write_jvm_args(root, memory)
    _write_start_script(root, installer_name, "NeoForge")
    _run_installer(root, root / installer_name, log)
    return loader


def _install_bungeecord(root: Path, log: LogCallback | None) -> str:
    build = _json(
        "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/api/json?tree=number,artifacts[fileName,relativePath]",
        ttl=300,
    )
    artifact = next(
        (
            row
            for row in build.get("artifacts") or []
            if str(row.get("fileName") or "").lower() == "bungeecord.jar"
        ),
        None,
    )
    if not artifact:
        raise MinecraftError("BungeeCord CI did not expose a server artifact")
    url = (
        "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/"
        + urllib.parse.quote(str(artifact["relativePath"]), safe="/")
    )
    _download(url, root / "server.jar", log=log)
    return str(build.get("number") or "latest")


def _safe_extract(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if root not in target.parents and target != root:
                raise MinecraftError("Archive contains an unsafe path")
        bundle.extractall(destination)


def _install_bedrock(root: Path, version: str, log: LogCallback | None) -> str:
    links = _bedrock_versions()
    selected = next((row for row in links if str(row["id"]) == str(version)), None)
    if not selected:
        selected = next((row for row in links if row.get("type") == "release"), None)
    if not selected:
        raise MinecraftError("Bedrock download metadata is unavailable")
    resolved = str(selected["id"])
    url = str(selected.get("download_url") or "")
    archive = root / f".bedrock-{resolved}.zip"
    _download(url, archive, log=log)
    _safe_extract(archive, root)
    archive.unlink(missing_ok=True)
    executable = root / "bedrock_server"
    if executable.exists():
        executable.chmod(0o755)
    (root / "bedrock_server.sh").write_text(
        "#!/usr/bin/env bash\nset -euo pipefail\ncd \"$(dirname \"$0\")\"\n"
        "export LD_LIBRARY_PATH=\"$PWD:${LD_LIBRARY_PATH:-}\"\nexec ./bedrock_server\n",
        encoding="utf-8",
        newline="\n",
    )
    (root / "bedrock_server.sh").chmod(0o755)
    return resolved


def _read_properties(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            result[key.strip()] = value.strip()
    except OSError:
        return {}
    return result


def _validate_properties(values: dict[str, Any] | None) -> dict[str, str]:
    output: dict[str, str] = {}
    for key, value in (values or {}).items():
        name = str(key).strip()
        text = str(value).replace("\r", " ").replace("\n", " ").strip()[:256]
        if not PROPERTY_KEY_RE.match(name):
            continue
        output[name] = text
    return output


def _write_properties(path: Path, updates: dict[str, str]) -> None:
    existing: dict[str, str] = {}
    order: list[str] = []
    comments: list[str] = []
    if path.exists():
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith("#"):
                    comments.append(line)
                    continue
                if "=" in stripped:
                    key, value = stripped.split("=", 1)
                    key = key.strip()
                    existing[key] = value.strip()
                    order.append(key)
        except OSError:
            pass
    existing.update(updates)
    lines = ["# Minecraft server properties managed by Meridian"]
    if comments:
        lines.extend(comments[:20])
    for key in order:
        if key in existing:
            lines.append(f"{key}={existing[key]}")
    for key in sorted(existing):
        if key not in order:
            lines.append(f"{key}={existing[key]}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _base_properties(
    meta: dict[str, Any],
    port: int,
    memory: int,
    overrides: dict[str, str],
) -> dict[str, str]:
    if meta["id"] == "bedrock":
        values = {
            "server-name": overrides.get("motd", overrides.get("server-name", "Meridian Bedrock")),
            "server-port": str(port),
            "server-portv6": "19133",
            "max-players": overrides.get("max-players", "20"),
            "gamemode": overrides.get("gamemode", "survival"),
            "difficulty": overrides.get("difficulty", "easy"),
            "online-mode": overrides.get("online-mode", "true"),
            "allow-cheats": overrides.get("allow-cheats", "false"),
            "view-distance": overrides.get("view-distance", "10"),
            "tick-distance": overrides.get("tick-distance", "4"),
            "player-idle-timeout": overrides.get("player-idle-timeout", "30"),
            "level-name": overrides.get("level-name", "Bedrock level"),
            "default-player-permission-level": overrides.get(
                "default-player-permission-level", "member"
            ),
        }
        values.update(overrides)
        return values
    if meta["proxy"]:
        return overrides
    return {
        "server-port": str(port),
        "server-ip": "0.0.0.0",
        "motd": overrides.get("motd", f"{meta['name']} on Meridian"),
        "max-players": overrides.get("max-players", "20"),
        "gamemode": overrides.get("gamemode", "survival"),
        "difficulty": overrides.get("difficulty", "easy"),
        "online-mode": overrides.get("online-mode", "true"),
        "pvp": overrides.get("pvp", "true"),
        "allow-flight": overrides.get("allow-flight", "false"),
        "enable-command-block": overrides.get("enable-command-block", "false"),
        "view-distance": overrides.get("view-distance", "10"),
        "simulation-distance": overrides.get("simulation-distance", "10"),
        "spawn-protection": overrides.get("spawn-protection", "16"),
        "max-tick-time": overrides.get("max-tick-time", "60000"),
        "enforce-secure-profile": overrides.get("enforce-secure-profile", "true"),
        "white-list": overrides.get("white-list", "false"),
        "level-name": overrides.get("level-name", "world"),
        **overrides,
    }


def read_server_properties(root: Path, software_id: str) -> dict[str, str]:
    name = "server.properties"
    return _read_properties(Path(root) / name)


def update_properties(
    root: str | Path,
    software_id: str,
    values: dict[str, Any] | None,
    *,
    port: int,
    memory: int = 2048,
) -> dict[str, str]:
    meta = software(software_id)
    path = Path(root) / "server.properties"
    overrides = _validate_properties(values)
    existing = _read_properties(path)
    merged = {**existing, **overrides}
    final = _base_properties(meta, int(port), int(memory), merged)
    _write_properties(path, final)
    return _read_properties(path)


def install_server(
    root: str | Path,
    software_id: str,
    *,
    version: str = "",
    loader_version: str = "",
    memory: int = 2048,
    port: int = 25565,
    accept_eula: bool = False,
    properties: dict[str, Any] | None = None,
    log: LogCallback | None = None,
) -> dict[str, Any]:
    """Install or update a Minecraft server in ``root``.

    World data, plugins and mods are intentionally preserved. Only server
    binaries, launch metadata and managed configuration keys are replaced.
    """

    meta = software(software_id)
    path = Path(root).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    memory = max(512, int(memory or 2048))
    port = int(port or (19132 if meta["edition"] == "bedrock" else 25565))
    overrides = _validate_properties(properties)
    resolved_version = version.strip()
    resolved_loader = loader_version.strip()
    info_lines: list[str] = []

    _log(log, f"Preparing {meta['name']} for Minecraft {resolved_version or 'latest'}")

    if meta["id"] == "vanilla":
        resolved_version = _download_vanilla(path, resolved_version, log)
        startup = _aikar_flags("server.jar")
        image = _java_image(resolved_version)
    elif meta["id"] in ("paper", "folia", "velocity", "waterfall"):
        if not resolved_version:
            resolved_version = str(_fill_versions(meta["id"])[0]["id"])
        resolved_loader = _download_fill(
            path, meta["id"], resolved_version, resolved_loader, log
        )
        startup = _proxy_startup("server.jar") if meta["proxy"] else _aikar_flags("server.jar")
        image = _java_image(resolved_version)
    elif meta["id"] == "purpur":
        if not resolved_version:
            resolved_version = str(_purpur_versions()[0]["id"])
        resolved_loader = _download_purpur(path, resolved_version, resolved_loader, log)
        startup = _aikar_flags("server.jar")
        image = _java_image(resolved_version)
    elif meta["id"] == "fabric":
        if not resolved_version:
            resolved_version = str(_fabric_versions()[0]["id"])
        resolved_loader = _download_fabric(path, resolved_version, resolved_loader, log)
        startup = _aikar_flags("server.jar")
        image = _java_image(resolved_version)
    elif meta["id"] == "quilt":
        if not resolved_version:
            resolved_version = str(_quilt_versions()[0]["id"])
        resolved_loader = _download_quilt(path, resolved_version, resolved_loader, log)
        startup = _aikar_flags("server.jar")
        image = _java_image(resolved_version)
    elif meta["id"] == "forge":
        if not resolved_version:
            resolved_version = str(_forge_versions()[0]["id"])
        resolved_loader = _install_forge(
            path, resolved_version, resolved_loader, memory, log
        )
        startup = "bash start.sh"
        image = _java_image(resolved_version)
    elif meta["id"] == "neoforge":
        if not resolved_version:
            resolved_version = str(_neoforge_versions()[0]["id"])
        resolved_loader = _install_neoforge(
            path, resolved_version, resolved_loader, memory, log
        )
        startup = "bash start.sh"
        image = _java_image(resolved_version)
    elif meta["id"] == "bungeecord":
        resolved_version = "latest"
        resolved_loader = _install_bungeecord(path, log)
        startup = _proxy_startup("server.jar")
        image = "eclipse-temurin:21-jre"
    elif meta["id"] == "bedrock":
        resolved_version = _install_bedrock(path, resolved_version, log)
        startup = "bash bedrock_server.sh"
        image = "debian:bookworm-slim"
    else:
        raise MinecraftError("Unsupported Minecraft software")

    if meta["content_dir"]:
        (path / meta["content_dir"]).mkdir(parents=True, exist_ok=True)

    if meta["kind"] == "server":
        eula_path = path / "eula.txt"
        eula_value = accept_eula
        if not eula_value and eula_path.exists():
            current = _read_properties(eula_path).get("eula", "").lower()
            eula_value = current == "true"
        eula_path.write_text(
            f"# Set by the Meridian Minecraft installer\n"
            f"# https://aka.ms/MinecraftEULA\n"
            f"eula={'true' if eula_value else 'false'}\n",
            encoding="utf-8",
        )
        if not eula_value:
            info_lines.append(
                "The Minecraft EULA is not accepted. Set eula=true in eula.txt or reinstall with acceptance."
            )

    if not meta["proxy"]:
        properties_path = path / "server.properties"
        # Preserve values an operator changed outside the installer. The
        # current file is merged into the generated defaults before writing,
        # so upgrades and reinstalls never reset MOTD, difficulty, whitelist
        # or other gameplay settings.
        current_properties = _read_properties(properties_path)
        values = _base_properties(
            meta,
            port,
            memory,
            {**current_properties, **overrides},
        )
        _write_properties(properties_path, values)
        _log(log, "Applied server.properties with the allocation port")

    metadata = {
        "panel": "meridian",
        "software": meta["id"],
        "software_name": meta["name"],
        "edition": meta["edition"],
        "kind": meta["kind"],
        "version": resolved_version,
        "loader_version": resolved_loader,
        "memory_mib": memory,
        "port": port,
        "installed_at": _now(),
    }
    (path / ".meridian-minecraft.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    _log(log, f"Installation complete: {meta['name']} {resolved_version}")
    return {
        **metadata,
        "startup": startup,
        "image": image,
        "content_directory": meta["content_dir"],
        "notes": info_lines,
    }


def read_install_metadata(root: str | Path) -> dict[str, Any]:
    base = Path(root)
    # Installations created before the Meridian rename keep their original
    # manifest name; read it as a fallback so upgrades preserve the install.
    for name in (".meridian-minecraft.json", ".vitestl-minecraft.json"):
        path = base / name
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            continue
    return {}


# ---------------------------------------------------------------------------
# Content (plugins and mods) via Modrinth
# ---------------------------------------------------------------------------


def _facets(parts: list[list[str]]) -> str:
    return json.dumps(parts, separators=(",", ":"))


def _normalize_project(row: dict[str, Any], project_type: str) -> dict[str, Any]:
    return {
        "id": str(row.get("project_id") or row.get("id") or ""),
        "slug": str(row.get("slug") or ""),
        "title": str(row.get("title") or row.get("name") or "Untitled"),
        "description": str(row.get("description") or ""),
        "author": str(row.get("author") or ""),
        "icon_url": str(row.get("icon_url") or row.get("icon") or ""),
        "downloads": int(row.get("downloads") or 0),
        "follows": int(row.get("follows") or 0),
        "categories": [str(item) for item in (row.get("categories") or [])][:12],
        "loaders": [str(item) for item in (row.get("loaders") or [])][:12],
        "game_versions": [str(item) for item in (row.get("game_versions") or row.get("versions") or [])][-12:],
        "project_type": project_type,
        "client_side": str(row.get("client_side") or ""),
        "server_side": str(row.get("server_side") or ""),
        "url": f"https://modrinth.com/{project_type}/{row.get('slug') or ''}",
        "updated": row.get("updated") or row.get("date_modified"),
    }


def _content_loader_meta(software_id: str) -> tuple[str, list[str]]:
    caps = content_capabilities(software_id)
    if not caps["enabled"]:
        raise MinecraftError("This Minecraft software does not support plugins or mods")
    return str(caps["project_type"]), list(caps["loaders"])


def project_details(project_id: str) -> dict[str, Any]:
    if not SLUG_RE.match(project_id or ""):
        raise MinecraftError("Invalid project identifier")
    return _json(
        "https://api.modrinth.com/v2/project/" + urllib.parse.quote(project_id, safe=""),
        ttl=600,
    )


def _search_facets(project_type: str, loaders: list[str], game_version: str) -> str:
    facets: list[list[str]] = [[f"project_type:{project_type}"]]
    if loaders:
        facets.append([f"categories:{loader}" for loader in loaders])
    if game_version:
        facets.append([f"versions:{game_version}"])
    return _facets(facets)


def search_content(
    software_id: str,
    query: str,
    *,
    game_version: str = "",
    limit: int = 20,
    offset: int = 0,
    featured: bool = False,
) -> dict[str, Any]:
    project_type, loaders = _content_loader_meta(software_id)
    limit = max(1, min(40, int(limit)))
    offset = max(0, int(offset))
    if featured and offset == 0 and not query.strip():
        result = _curated_content(project_type, loaders, game_version, limit)
        if result:
            return {
                "data": result,
                "total": len(result),
                "featured": True,
                "project_type": project_type,
                "loaders": loaders,
                "source": "modrinth",
            }
    facet = _search_facets(project_type, loaders, game_version)
    params = {
        "query": query.strip(),
        "limit": str(limit),
        "offset": str(offset),
        "index": "downloads" if not query.strip() else "relevance",
        "facets": facet,
    }
    url = "https://api.modrinth.com/v2/search?" + urllib.parse.urlencode(params)
    data = _json(url, ttl=180)
    hits = data.get("hits") or []
    if not hits and game_version:
        params.pop("facets")
        params["facets"] = _search_facets(project_type, loaders, "")
        data = _json(
            "https://api.modrinth.com/v2/search?" + urllib.parse.urlencode(params), ttl=180
        )
        hits = data.get("hits") or []
    rows = [_normalize_project(row, project_type) for row in hits]
    rows = [row for row in rows if row["id"]]
    return {
        "data": rows,
        "total": int(data.get("total_hits") or len(rows)),
        "featured": False,
        "project_type": project_type,
        "loaders": loaders,
        "source": "modrinth",
    }


def _curated_content(
    project_type: str,
    loaders: list[str],
    game_version: str,
    limit: int,
) -> list[dict[str, Any]]:
    slugs = CONTENT_CURATED_PLUGINS if project_type == "plugin" else CONTENT_CURATED_MODS
    params = {"ids": json.dumps(list(slugs), separators=(",", ":"))}
    try:
        rows = _json(
            "https://api.modrinth.com/v2/projects?" + urllib.parse.urlencode(params),
            ttl=900,
        )
    except MinecraftError:
        return []
    output = []
    for row in rows or []:
        if row.get("server_side") == "unsupported":
            continue
        categories = [str(item).lower() for item in (row.get("categories") or [])]
        row_loaders = [str(item).lower() for item in (row.get("loaders") or [])]
        if loaders and not any(loader in categories or loader in row_loaders for loader in loaders):
            continue
        if game_version and game_version not in (row.get("game_versions") or []):
            continue
        item = _normalize_project(row, project_type)
        if not item["author"]:
            item["author"] = CONTENT_CURATED_AUTHORS.get(str(row.get("slug") or ""), "")
        item["server_side"] = str(row.get("server_side") or "")
        output.append(item)
        if len(output) >= limit:
            break
    return output


def content_versions(
    software_id: str,
    project_id: str,
    *,
    game_version: str = "",
    limit: int = 12,
) -> dict[str, Any]:
    project_type, loaders = _content_loader_meta(software_id)
    if not SLUG_RE.match(project_id):
        raise MinecraftError("Invalid project identifier")
    params: dict[str, str] = {"limit": str(max(1, min(40, limit)))}
    if loaders:
        params["loaders"] = json.dumps(loaders, separators=(",", ":"))
    if game_version:
        params["game_versions"] = json.dumps([game_version], separators=(",", ":"))
    url = (
        "https://api.modrinth.com/v2/project/"
        + urllib.parse.quote(project_id, safe="")
        + "/version?"
        + urllib.parse.urlencode(params)
    )
    rows = _json(url, ttl=180)
    if not rows and game_version:
        params.pop("game_versions", None)
        rows = _json(
            "https://api.modrinth.com/v2/project/"
            + urllib.parse.quote(project_id, safe="")
            + "/version?"
            + urllib.parse.urlencode(params),
            ttl=180,
        )
    data = []
    for row in rows or []:
        data.append(
            {
                "id": str(row.get("id") or ""),
                "name": str(row.get("name") or row.get("version_number") or ""),
                "version_number": str(row.get("version_number") or ""),
                "game_versions": row.get("game_versions") or [],
                "loaders": row.get("loaders") or [],
                "date_published": row.get("date_published"),
                "files": [
                    {
                        "filename": str(file.get("filename") or ""),
                        "primary": bool(file.get("primary")),
                        "size": int(file.get("size") or 0),
                    }
                    for file in row.get("files") or []
                ],
            }
        )
    return {"data": data, "project_type": project_type, "loaders": loaders}


def install_content(
    root: str | Path,
    software_id: str,
    project_id: str,
    *,
    version_id: str = "",
    game_version: str = "",
    log: LogCallback | None = None,
) -> dict[str, Any]:
    if not SLUG_RE.match(project_id):
        raise MinecraftError("Invalid project identifier")
    project_type, loaders = _content_loader_meta(software_id)
    directory = Path(root) / ("plugins" if project_type == "plugin" else "mods")
    directory.mkdir(parents=True, exist_ok=True)
    version: dict[str, Any] | None = None
    details: dict[str, Any] | None = None
    if version_id:
        if not re.match(r"^[A-Za-z0-9]{6,32}$", version_id):
            raise MinecraftError("Invalid version identifier")
        version = _json(
            f"https://api.modrinth.com/v2/version/{urllib.parse.quote(version_id, safe='')}",
            ttl=300,
        )
        owner_id = str(version.get("project_id") or "")
        if owner_id and owner_id != project_id:
            details = project_details(project_id)
            aliases = {str(details.get("id") or ""), str(details.get("slug") or "")}
            if owner_id not in aliases:
                raise MinecraftError("The selected version belongs to another project")
    else:
        params: dict[str, str] = {}
        if loaders:
            params["loaders"] = json.dumps(loaders, separators=(",", ":"))
        if game_version:
            params["game_versions"] = json.dumps([game_version], separators=(",", ":"))
        query = urllib.parse.urlencode(params)
        rows = _json(
            "https://api.modrinth.com/v2/project/"
            + urllib.parse.quote(project_id, safe="")
            + "/version"
            + (("?" + query) if query else ""),
            ttl=180,
        )
        if not rows and game_version:
            params.pop("game_versions", None)
            rows = _json(
                "https://api.modrinth.com/v2/project/"
                + urllib.parse.quote(project_id, safe="")
                + "/version?"
                + urllib.parse.urlencode(params),
                ttl=180,
            )
        if rows:
            version = rows[0]
    if not version:
        raise MinecraftError(
            "No compatible version was found for this server. "
            "Check the Minecraft version and loader."
        )
    files = version.get("files") or []
    file = next((row for row in files if row.get("primary")), files[0] if files else None)
    if not file or not file.get("url"):
        raise MinecraftError("This version does not expose a downloadable file")
    filename = Path(str(file.get("filename") or "")).name
    if not SAFE_FILE_RE.match(filename):
        raise MinecraftError("The upstream file name is not safe to store")
    if not filename.lower().endswith(PLUGIN_SUFFIXES):
        raise MinecraftError("The upstream file is not a plugin or mod archive")
    size = int(file.get("size") or 0)
    if size and size > MAX_CONTENT_BYTES:
        raise MinecraftError("The content file is too large")
    destination = directory / filename
    _download(str(file["url"]), destination, max_bytes=MAX_CONTENT_BYTES, log=log)
    project_name = str(version.get("name") or filename)
    project_slug = ""
    project_icon = ""
    try:
        details = details or project_details(project_id)
        project_name = str(details.get("title") or project_name)
        project_slug = str(details.get("slug") or "")
        project_icon = str(details.get("icon_url") or "")
    except MinecraftError:
        pass
    _log(log, f"Installed {project_name} into {directory.name}/")
    return {
        "filename": filename,
        "directory": directory.name,
        "project_id": project_id,
        "project_slug": project_slug,
        "title": project_name,
        "icon_url": project_icon,
        "version_id": str(version.get("id") or ""),
        "version_number": str(version.get("version_number") or version.get("name") or ""),
        "name": project_name,
        "project_type": project_type,
        "size": destination.stat().st_size if destination.exists() else size,
        "game_versions": version.get("game_versions") or [],
        "loaders": version.get("loaders") or [],
        "source": "modrinth",
        "installed_at": _now(),
    }


def content_directory(software_id: str) -> str:
    caps = content_capabilities(software_id)
    if not caps["enabled"]:
        raise MinecraftError("This server does not support plugins or mods")
    return str(caps["directory"])


def safe_content_name(filename: str) -> str:
    name = Path(filename or "").name
    if not SAFE_FILE_RE.match(name):
        raise MinecraftError("Invalid file name")
    if not name.lower().endswith(PLUGIN_SUFFIXES + (".disabled", ".jar.disabled", ".zip.disabled")):
        raise MinecraftError("Only plugin or mod archives are allowed")
    return name


def content_path(root: str | Path, software_id: str, filename: str) -> Path:
    directory = Path(root) / content_directory(software_id)
    name = safe_content_name(filename)
    path = (directory / name).resolve()
    if path.parent != directory.resolve():
        raise MinecraftError("Path escapes the content directory")
    return path


def installed_content(root: str | Path, software_id: str) -> list[dict[str, Any]]:
    caps = content_capabilities(software_id)
    if not caps["enabled"]:
        return []
    directory = Path(root) / str(caps["directory"])
    if not directory.exists():
        return []
    rows = []
    for entry in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        if not entry.is_file():
            continue
        name = entry.name
        enabled = True
        base = name
        if name.lower().endswith(".jar.disabled"):
            enabled = False
            base = name[:-9]
        elif name.lower().endswith(".zip.disabled"):
            enabled = False
            base = name[:-9]
        if not base.lower().endswith(PLUGIN_SUFFIXES):
            continue
        try:
            size = entry.stat().st_size
            modified = datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except OSError:
            size = 0
            modified = None
        rows.append(
            {
                "filename": name,
                "base_name": base,
                "enabled": enabled,
                "size": size,
                "modified_at": modified,
                "directory": str(caps["directory"]),
                "project_type": caps["project_type"],
                "source": "local",
            }
        )
    return rows


def toggle_content(root: str | Path, software_id: str, filename: str) -> dict[str, Any]:
    path = content_path(root, software_id, filename)
    if not path.exists():
        raise MinecraftError("Plugin or mod file was not found")
    name = path.name
    if name.lower().endswith(".jar"):
        target = path.with_name(name + ".disabled")
        enabled = False
    elif name.lower().endswith(".zip"):
        target = path.with_name(name + ".disabled")
        enabled = False
    elif name.lower().endswith(".jar.disabled"):
        target = path.with_name(name[: -len(".disabled")])
        enabled = True
    elif name.lower().endswith(".zip.disabled"):
        target = path.with_name(name[: -len(".disabled")])
        enabled = True
    else:
        raise MinecraftError("This file cannot be toggled")
    if target.exists():
        raise MinecraftError("A file with the target name already exists")
    os.replace(path, target)
    return {"filename": target.name, "enabled": enabled}


def delete_content(root: str | Path, software_id: str, filename: str) -> None:
    path = content_path(root, software_id, filename)
    if not path.exists():
        raise MinecraftError("Plugin or mod file was not found")
    path.unlink()


def store_uploaded_content(
    root: str | Path,
    software_id: str,
    filename: str,
    source: Path,
) -> dict[str, Any]:
    name = safe_content_name(filename)
    destination_dir = Path(root) / content_directory(software_id)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / name
    destination.unlink(missing_ok=True)
    shutil.move(str(source), str(destination))
    return {
        "filename": name,
        "directory": destination_dir.name,
        "size": destination.stat().st_size,
        "source": "upload",
        "installed_at": _now(),
    }


# ---------------------------------------------------------------------------
# Server list ping (Java)
# ---------------------------------------------------------------------------


def _read_varint_socket(connection: socket.socket) -> int:
    value = 0
    shift = 0
    for _ in range(5):
        raw = connection.recv(1)
        if not raw:
            raise MinecraftError("Server closed the status connection")
        byte = raw[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7
    raise MinecraftError("Invalid status packet")


def _write_varint(value: int) -> bytes:
    output = bytearray()
    value &= 0xFFFFFFFF
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            output.append(byte | 0x80)
        else:
            output.append(byte)
            return bytes(output)


def _packet(packet_id: int, payload: bytes) -> bytes:
    body = _write_varint(packet_id) + payload
    return _write_varint(len(body)) + body


def _motd_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_motd_text(item) for item in value)
    if isinstance(value, dict):
        text = str(value.get("text") or "")
        extra = value.get("extra")
        if extra:
            text += _motd_text(extra)
        return text
    return ""


def java_status(host: str, port: int, timeout: float = 3.5) -> dict[str, Any]:
    started = time.time()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout) as connection:
            connection.settimeout(timeout)
            host_bytes = host.encode("utf-8")
            handshake = (
                _write_varint(-1)
                + _write_varint(len(host_bytes))
                + host_bytes
                + struct.pack(">H", int(port))
                + _write_varint(1)
            )
            connection.sendall(_packet(0, handshake))
            connection.sendall(_packet(0, b""))
            length = _read_varint_socket(connection)
            if length <= 0 or length > 2 * 1024 * 1024:
                raise MinecraftError("Invalid status response size")
            data = b""
            while len(data) < length:
                chunk = connection.recv(length - len(data))
                if not chunk:
                    break
                data += chunk
            index = 0
            packet_id, index = _read_varint(data, index)
            if packet_id != 0:
                raise MinecraftError("Unexpected status packet")
            json_length, index = _read_varint(data, index)
            payload = json.loads(data[index : index + json_length].decode("utf-8", errors="replace"))
        players = payload.get("players") or {}
        version = payload.get("version") or {}
        description = _motd_text(payload.get("description"))
        sample = []
        for player in players.get("sample") or []:
            if isinstance(player, dict):
                sample.append(
                    {
                        "name": str(player.get("name") or ""),
                        "id": str(player.get("id") or ""),
                    }
                )
        icon = str(payload.get("icon") or "")
        if icon and (not icon.startswith("data:image/png;base64,") or len(icon) > 524288):
            icon = ""
        return {
            "online": True,
            "latency_ms": int((time.time() - started) * 1000),
            "motd": description[:600],
            "version": str(version.get("name") or ""),
            "protocol": version.get("protocol"),
            "players": {
                "online": int(players.get("online") or 0),
                "max": int(players.get("max") or 0),
                "sample": sample[:8],
            },
            "icon": icon,
        }
    except Exception as exc:
        return {
            "online": False,
            "latency_ms": int((time.time() - started) * 1000),
            "error": str(exc)[:240],
        }


def _read_varint(data: bytes, index: int) -> tuple[int, int]:
    value = 0
    shift = 0
    for _ in range(5):
        if index >= len(data):
            raise MinecraftError("Truncated varint")
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7
    raise MinecraftError("Invalid varint")


_RAKNET_MAGIC = bytes.fromhex("00ffff00fefefefefdfdfdfd12345678")


def bedrock_status(host: str, port: int = 19132, timeout: float = 3.0) -> dict[str, Any]:
    started = time.time()
    payload = b"\x01" + struct.pack(">Q", int(time.time() * 1000)) + _RAKNET_MAGIC + struct.pack(
        ">Q", 0x564954455354524C
    )
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            sock.sendto(payload, (host, int(port)))
            data, _ = sock.recvfrom(8192)
        if len(data) < 35 or data[0] != 0x1C:
            raise MinecraftError("Unexpected Bedrock pong")
        offset = 1 + 8 + 8 + 16
        length = struct.unpack(">H", data[offset : offset + 2])[0]
        offset += 2
        text = data[offset : offset + length].decode("utf-8", errors="replace")
        status = json.loads(text)
        motd = str(status.get("motd") or "").split("\n")
        return {
            "online": True,
            "latency_ms": int((time.time() - started) * 1000),
            "motd": (motd[0] if motd else "")[:600],
            "secondary_motd": (motd[1] if len(motd) > 1 else "")[:600],
            "version": str(status.get("version") or ""),
            "protocol": status.get("protocol"),
            "players": {
                "online": int(status.get("online") or 0),
                "max": int(status.get("max") or 0),
                "sample": [],
            },
            "gamemode": str(status.get("gamemode") or ""),
            "icon": "",
        }
    except Exception as exc:
        return {
            "online": False,
            "latency_ms": int((time.time() - started) * 1000),
            "error": str(exc)[:240],
        }
