from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from auth import hash_password
from config import (
    DB_PATH,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASS,
    DEFAULT_ADMIN_USER,
    PANEL_COMPANY,
)
from eggs import NESTS, EGGS

_lock = threading.RLock()


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    with _lock:
        conn = connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [{k: r[k] for k in r.keys()} for r in rows]


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL,
                totp_secret TEXT NOT NULL DEFAULT '',
                totp_enabled INTEGER NOT NULL DEFAULT 0,
                totp_last_step INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nests (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS eggs (
                id INTEGER PRIMARY KEY,
                nest_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                docker_image TEXT NOT NULL,
                startup TEXT NOT NULL,
                stop_command TEXT NOT NULL DEFAULT '^C',
                runtime TEXT NOT NULL DEFAULT 'process',
                files TEXT NOT NULL DEFAULT '{}',
                variables TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS servers (
                id TEXT PRIMARY KEY,
                short_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                egg_id INTEGER NOT NULL,
                owner_id INTEGER NOT NULL,
                memory INTEGER NOT NULL DEFAULT 512,
                cpu INTEGER NOT NULL DEFAULT 100,
                disk INTEGER NOT NULL DEFAULT 2048,
                swap INTEGER NOT NULL DEFAULT 0,
                io INTEGER NOT NULL DEFAULT 500,
                allocation_ip TEXT NOT NULL DEFAULT '0.0.0.0',
                allocation_port INTEGER NOT NULL,
                startup TEXT NOT NULL,
                image TEXT NOT NULL,
                environment TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'offline',
                created_at TEXT NOT NULL,
                installed INTEGER NOT NULL DEFAULT 1,
                terminal_sudo INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS databases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id TEXT NOT NULL,
                name TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                host TEXT NOT NULL DEFAULT '127.0.0.1',
                port INTEGER NOT NULL DEFAULT 3306,
                host_id INTEGER,
                engine TEXT NOT NULL DEFAULT 'sqlite',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS database_hosts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                engine TEXT NOT NULL DEFAULT 'mariadb',
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 3306,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                linked_ip TEXT NOT NULL DEFAULT '',
                max_databases INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backups (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                bytes INTEGER NOT NULL DEFAULT 0,
                checksum TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                path TEXT NOT NULL,
                successful INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id TEXT NOT NULL,
                name TEXT NOT NULL,
                cron TEXT NOT NULL,
                action TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run TEXT,
                next_run TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schedule_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schedule_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '',
                time_offset INTEGER NOT NULL DEFAULT 0,
                sequence INTEGER NOT NULL DEFAULT 0,
                continue_on_failure INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS user_recovery_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                code_hash TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS subusers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id TEXT NOT NULL,
                email TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                server_id TEXT,
                event TEXT NOT NULL,
                ip TEXT NOT NULL DEFAULT '127.0.0.1',
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                server_id TEXT,
                notes TEXT NOT NULL DEFAULT '',
                UNIQUE(ip, port)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                short_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL,
                location_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                fqdn TEXT NOT NULL,
                scheme TEXT NOT NULL DEFAULT 'http',
                memory INTEGER NOT NULL DEFAULT 8192,
                memory_overallocate INTEGER NOT NULL DEFAULT 0,
                disk INTEGER NOT NULL DEFAULT 51200,
                disk_overallocate INTEGER NOT NULL DEFAULT 0,
                cpu INTEGER NOT NULL DEFAULT 400,
                daemon_token TEXT NOT NULL,
                daemon_listen INTEGER NOT NULL DEFAULT 8080,
                daemon_sftp INTEGER NOT NULL DEFAULT 2022,
                behind_proxy INTEGER NOT NULL DEFAULT 0,
                maintenance INTEGER NOT NULL DEFAULT 0,
                public INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            """
        )
        migrate_schema(conn)

        if conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] == 0:
            conn.execute(
                "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    DEFAULT_ADMIN_USER,
                    DEFAULT_ADMIN_EMAIL,
                    hash_password(DEFAULT_ADMIN_PASS),
                    "admin",
                    utcnow(),
                ),
            )
            conn.execute(
                "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    "operator",
                    "operator@vitestl.local",
                    hash_password("operator"),
                    "user",
                    utcnow(),
                ),
            )

        sync_catalog(conn)

        if conn.execute("SELECT COUNT(*) AS c FROM settings").fetchone()["c"] == 0:
            defaults = {
                "company": PANEL_COMPANY,
                "registration": "false",
                "fqdn": hostname_safe(),
                "theme": "dark",
            }
            for k, v in defaults.items():
                conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (k, v))

        # Carry existing installations across the VITESTERTL rename without
        # touching a company name that an operator has customised.
        conn.execute(
            "UPDATE settings SET value = ? WHERE key = 'company' "
            "AND value IN ('Kestrel Control Plane', 'BUILDP CONTINUE')",
            (PANEL_COMPANY,),
        )
        conn.execute(
            "UPDATE OR IGNORE users SET email = REPLACE(email, '@kestrel.local', '@vitestl.local') "
            "WHERE email LIKE '%@kestrel.local'"
        )
        conn.execute(
            "UPDATE OR IGNORE users SET email = REPLACE(email, '@buildp.local', '@vitestl.local') "
            "WHERE email LIKE '%@buildp.local'"
        )

        _ensure_admin_identity(conn)
        _seed_locations_nodes(conn)


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(conn: sqlite3.Connection, table: str, name: str, ddl: str) -> None:
    if name not in _columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def migrate_schema(conn: sqlite3.Connection) -> None:
    _add_column(conn, "users", "first_name", "first_name TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "users", "last_name", "last_name TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "users", "last_login", "last_login TEXT")
    _add_column(conn, "servers", "node_id", "node_id INTEGER NOT NULL DEFAULT 1")
    _add_column(conn, "servers", "suspended", "suspended INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "servers", "suspended_reason", "suspended_reason TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "tags", "tags TEXT NOT NULL DEFAULT '[]'")
    _add_column(conn, "servers", "mc_software", "mc_software TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "mc_version", "mc_version TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "mc_loader_version", "mc_loader_version TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "mc_status", "mc_status TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "mc_message", "mc_message TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "mc_installed_at", "mc_installed_at TEXT")
    _add_column(conn, "servers", "mc_eula", "mc_eula INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "servers", "terminal_sudo", "terminal_sudo INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "schedules", "next_run", "next_run TEXT")
    _add_column(conn, "allocations", "node_id", "node_id INTEGER NOT NULL DEFAULT 1")
    _add_column(conn, "users", "totp_secret", "totp_secret TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "users", "totp_enabled", "totp_enabled INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "users", "totp_last_step", "totp_last_step INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "databases", "host_id", "host_id INTEGER")
    _add_column(conn, "databases", "engine", "engine TEXT NOT NULL DEFAULT 'sqlite'")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS database_hosts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            engine TEXT NOT NULL DEFAULT 'mariadb',
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 3306,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            linked_ip TEXT NOT NULL DEFAULT '',
            max_databases INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schedule_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '',
            time_offset INTEGER NOT NULL DEFAULT 0,
            sequence INTEGER NOT NULL DEFAULT 0,
            continue_on_failure INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_recovery_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code_hash TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            prefix TEXT NOT NULL,
            last_used TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plugin_installs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            directory TEXT NOT NULL,
            project_id TEXT NOT NULL DEFAULT '',
            project_slug TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            version_id TEXT NOT NULL DEFAULT '',
            version_number TEXT NOT NULL DEFAULT '',
            icon_url TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'modrinth',
            size INTEGER NOT NULL DEFAULT 0,
            installed_at TEXT NOT NULL,
            UNIQUE(server_id, filename)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'openai',
            base_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            headers TEXT NOT NULL DEFAULT '{}',
            max_tokens INTEGER NOT NULL DEFAULT 2048,
            temperature REAL NOT NULL DEFAULT 0.4,
            enabled INTEGER NOT NULL DEFAULT 1,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            provider_id INTEGER,
            model TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER,
            server_id TEXT NOT NULL DEFAULT '',
            user_id INTEGER NOT NULL DEFAULT 0,
            model TEXT NOT NULL DEFAULT '',
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            ok INTEGER NOT NULL DEFAULT 1,
            error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_servers_node ON servers(node_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_server ON activity(server_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(token_hash)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plugin_installs_server ON plugin_installs(server_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_schedule_tasks_schedule ON schedule_tasks(schedule_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes(user_id)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_databases_host ON databases(host_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_messages_server ON ai_messages(server_id, id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(provider_id, created_at)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_usage_server ON ai_usage(server_id)")


def sync_catalog(conn: sqlite3.Connection) -> dict[str, int]:
    for nest in NESTS:
        conn.execute(
            """INSERT INTO nests (id, name, description) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description""",
            (nest["id"], nest["name"], nest["description"]),
        )
    for egg in EGGS:
        conn.execute(
            """INSERT INTO eggs
            (id, nest_id, name, description, docker_image, startup, stop_command, runtime, files, variables)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                nest_id = excluded.nest_id,
                name = excluded.name,
                description = excluded.description,
                docker_image = excluded.docker_image,
                startup = excluded.startup,
                stop_command = excluded.stop_command,
                runtime = excluded.runtime,
                files = excluded.files,
                variables = excluded.variables""",
            (
                egg["id"],
                egg["nest_id"],
                egg["name"],
                egg["description"],
                egg["docker_image"],
                egg["startup"],
                egg["stop_command"],
                egg["runtime"],
                json.dumps(egg["files"]),
                json.dumps(egg["variables"]),
            ),
        )
    return {"nests": len(NESTS), "eggs": len(EGGS)}


def next_custom_id(conn: sqlite3.Connection, table: str) -> int:
    row = conn.execute(f"SELECT MAX(id) AS m FROM {table}").fetchone()
    current = int(row["m"] or 0)
    return max(current + 1, 1001)


def parse_tags(raw: Any) -> list[str]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = [part.strip() for part in raw.split(",") if part.strip()]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        tag = "".join(
            ch for ch in str(item).strip().lower().replace(" ", "-") if ch.isalnum() or ch in "._-"
        )[:32]
        if len(tag) < 1 or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= 12:
            break
    return out


def _ensure_admin_identity(conn: sqlite3.Connection) -> None:
    taken = conn.execute(
        "SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USER,)
    ).fetchone()
    if taken:
        conn.execute(
            "UPDATE users SET email = ?, role = 'admin' WHERE id = ?",
            (DEFAULT_ADMIN_EMAIL, taken["id"]),
        )
        return
    row = conn.execute(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE users SET username = ?, email = ? WHERE id = ?",
            (DEFAULT_ADMIN_USER, DEFAULT_ADMIN_EMAIL, row["id"]),
        )


def _seed_locations_nodes(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS c FROM locations").fetchone()["c"] == 0:
        conn.execute(
            "INSERT INTO locations (short_code, name, description, created_at) VALUES (?, ?, ?, ?)",
            ("local", "Local", "This control plane node.", utcnow()),
        )
    if conn.execute("SELECT COUNT(*) AS c FROM nodes").fetchone()["c"] == 0:
        loc = conn.execute("SELECT id FROM locations ORDER BY id LIMIT 1").fetchone()
        loc_id = loc["id"] if loc else 1
        conn.execute(
            """INSERT INTO nodes
            (uuid, location_id, name, fqdn, scheme, memory, disk, cpu, daemon_token,
             daemon_listen, daemon_sftp, created_at)
            VALUES (?, ?, ?, ?, 'http', 8192, 51200, 400, ?, 8080, 2022, ?)""",
            (
                str(uuid.uuid4()),
                loc_id,
                "node-01",
                hostname_safe(),
                secrets.token_urlsafe(32),
                utcnow(),
            ),
        )
    conn.execute("UPDATE servers SET node_id = 1 WHERE node_id IS NULL OR node_id = 0")
    conn.execute("UPDATE allocations SET node_id = 1 WHERE node_id IS NULL OR node_id = 0")


def hostname_safe() -> str:
    from config import hostname

    return hostname()


def log_activity(user_id: int | None, server_id: str | None, event: str, metadata: dict | None = None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO activity (user_id, server_id, event, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, server_id, event, json.dumps(metadata or {}), utcnow()),
        )


def next_port(conn: sqlite3.Connection) -> int:
    from config import ALLOC_PORT_END, ALLOC_PORT_START

    rows = conn.execute("SELECT allocation_port AS p FROM servers").fetchall()
    used = {r["p"] for r in rows}
    allocs = conn.execute("SELECT port AS p FROM allocations").fetchall()
    used |= {r["p"] for r in allocs}
    for port in range(ALLOC_PORT_START, ALLOC_PORT_END):
        if port not in used:
            return port
    raise RuntimeError("No free allocations on this node")


def new_server_id() -> tuple[str, str]:
    sid = str(uuid.uuid4())
    return sid, sid.split("-")[0]
