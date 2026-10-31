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
                    "operator@meridian.local",
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

        # Carry existing installations across the Meridian rename without
        # touching a company name that an operator has customised.
        conn.execute(
            "UPDATE settings SET value = ? WHERE key = 'company' "
            "AND value IN ('VITESTERTL', 'Kestrel Control Plane', 'BUILDP CONTINUE')",
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
        conn.execute(
            "UPDATE OR IGNORE users SET email = REPLACE(email, '@vitestl.local', '@meridian.local') "
            "WHERE email LIKE '%@vitestl.local'"
        )
        conn.execute(
            "UPDATE payment_methods SET account_name = 'Meridian Payments' "
            "WHERE account_name = 'VITESTERTL Payments'"
        )

        _ensure_admin_identity(conn)
        _seed_locations_nodes(conn)
        _seed_commerce(conn)
        _ensure_security_settings(conn)


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
    _add_column(conn, "users", "banned", "banned INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "users", "banned_at", "banned_at TEXT")
    _add_column(conn, "users", "ban_reason", "ban_reason TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "servers", "plan_id", "plan_id INTEGER")
    _add_column(conn, "servers", "plan_activated_at", "plan_activated_at TEXT")
    _add_column(conn, "servers", "plan_expires_at", "plan_expires_at TEXT")
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            tagline TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            price_cents INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'MYR',
            billing_period TEXT NOT NULL DEFAULT 'month',
            memory INTEGER NOT NULL DEFAULT 1024,
            cpu INTEGER NOT NULL DEFAULT 100,
            disk INTEGER NOT NULL DEFAULT 5120,
            swap INTEGER NOT NULL DEFAULT 0,
            io INTEGER NOT NULL DEFAULT 500,
            server_slots INTEGER NOT NULL DEFAULT 1,
            database_limit INTEGER NOT NULL DEFAULT 1,
            backup_limit INTEGER NOT NULL DEFAULT 3,
            allocation_limit INTEGER NOT NULL DEFAULT 1,
            features TEXT NOT NULL DEFAULT '[]',
            artifact TEXT NOT NULL DEFAULT '{}',
            accent TEXT NOT NULL DEFAULT '#43b8f5',
            badge TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            featured INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS payment_methods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'manual',
            account_name TEXT NOT NULL DEFAULT '',
            account_id TEXT NOT NULL DEFAULT '',
            qr_image TEXT NOT NULL DEFAULT '',
            instructions TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            plan_id INTEGER NOT NULL,
            payment_method_id INTEGER,
            server_id TEXT,
            target_server_id TEXT,
            server_name TEXT NOT NULL DEFAULT '',
            egg_id INTEGER,
            node_id INTEGER,
            amount_cents INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'MYR',
            status TEXT NOT NULL DEFAULT 'pending',
            reference TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            proof_data TEXT NOT NULL DEFAULT '',
            admin_note TEXT NOT NULL DEFAULT '',
            reviewed_by INTEGER,
            reviewed_at TEXT,
            terms_accepted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS redeem_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            plan_id INTEGER NOT NULL,
            max_uses INTEGER NOT NULL DEFAULT 1,
            uses INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            note TEXT NOT NULL DEFAULT '',
            created_by INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS redeem_uses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            order_id INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL DEFAULT 'global',
            server_id TEXT,
            egg_id INTEGER,
            nest_id INTEGER,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Operations',
            severity TEXT NOT NULL DEFAULT 'info',
            sort_order INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS security_strikes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            server_id TEXT,
            source TEXT NOT NULL DEFAULT 'terminal',
            pattern TEXT NOT NULL,
            label TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            severity TEXT NOT NULL DEFAULT 'critical',
            snippet TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL DEFAULT '',
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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_plan ON orders(plan_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_servers_plan ON servers(plan_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_redeem_uses_code ON redeem_uses(code_id, user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_redeem_uses_user ON redeem_uses(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rules_scope ON rules(scope, sort_order)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rules_server ON rules(server_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rules_egg ON rules(egg_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_security_user ON security_strikes(user_id, id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_security_server ON security_strikes(server_id, id)")


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


def _seed_commerce(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS c FROM plans").fetchone()["c"] == 0:
        plans = [
            {
                "slug": "starter",
                "name": "Starter",
                "tagline": "A clean first deployment",
                "description": "A focused runtime for one Minecraft world, a small bot or a first service. "
                "Everything needed to launch, with no unused capacity.",
                "price_cents": 1500,
                "memory": 1024,
                "cpu": 100,
                "disk": 5120,
                "database_limit": 1,
                "backup_limit": 2,
                "allocation_limit": 1,
                "server_slots": 1,
                "features": [
                    "1 deployment slot",
                    "1 GB dedicated memory",
                    "Java or Bedrock runtime",
                    "DDoS-aware monitoring",
                    "Daily snapshot window",
                ],
                "artifact": {"motif": "foundation", "serial": "ST-01", "caption": "Foundation"},
                "accent": "#7f95ab",
                "badge": "Entry",
                "sort_order": 10,
                "featured": 0,
            },
            {
                "slug": "standard",
                "name": "Standard",
                "tagline": "The working server",
                "description": "The balanced tier for a live community. More memory, room for plugins and "
                "scheduled backups without spending on headroom you will not use.",
                "price_cents": 3500,
                "memory": 4096,
                "cpu": 150,
                "disk": 15360,
                "database_limit": 2,
                "backup_limit": 5,
                "allocation_limit": 2,
                "server_slots": 2,
                "features": [
                    "2 deployment slots",
                    "4 GB dedicated memory",
                    "Java and Bedrock ready",
                    "Modrinth plugin workspace",
                    "Scheduled backup retention",
                ],
                "artifact": {"motif": "orbit", "serial": "SD-02", "caption": "Momentum"},
                "accent": "#43b8f5",
                "badge": "Most chosen",
                "sort_order": 20,
                "featured": 1,
            },
            {
                "slug": "pro",
                "name": "Pro",
                "tagline": "Built for busy worlds",
                "description": "Performance headroom for modpacks, larger player counts and parallel services. "
                "Tuned for operators who watch their telemetry.",
                "price_cents": 6900,
                "memory": 8192,
                "cpu": 250,
                "disk": 30720,
                "database_limit": 4,
                "backup_limit": 10,
                "allocation_limit": 3,
                "server_slots": 4,
                "features": [
                    "4 deployment slots",
                    "8 GB dedicated memory",
                    "Performance-tuned node placement",
                    "Advanced schedule automation",
                    "Extended backup retention",
                ],
                "artifact": {"motif": "lattice", "serial": "PR-03", "caption": "Velocity"},
                "accent": "#aa9bf5",
                "badge": "Performance",
                "sort_order": 30,
                "featured": 0,
            },
            {
                "slug": "premium",
                "name": "Premium",
                "tagline": "Your flagship estate",
                "description": "Maximum capacity and white-glove onboarding for a network of worlds, events and "
                "production services that cannot wait for capacity.",
                "price_cents": 12900,
                "memory": 16384,
                "cpu": 400,
                "disk": 61440,
                "database_limit": 8,
                "backup_limit": 20,
                "allocation_limit": 5,
                "server_slots": 8,
                "features": [
                    "8 deployment slots",
                    "16 GB dedicated memory",
                    "Priority node placement",
                    "Migration and launch assistance",
                    "Concierge support channel",
                ],
                "artifact": {"motif": "crest", "serial": "PM-04", "caption": "Flagship"},
                "accent": "#e3b664",
                "badge": "Flagship",
                "sort_order": 40,
                "featured": 0,
            },
        ]
        stamp = utcnow()
        for plan in plans:
            conn.execute(
                """INSERT INTO plans
                (slug, name, tagline, description, price_cents, currency, billing_period,
                 memory, cpu, disk, swap, io, server_slots, database_limit, backup_limit,
                 allocation_limit, features, artifact, accent, badge, sort_order, featured,
                 active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'MYR', 'month', ?, ?, ?, 0, 500, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                (
                    plan["slug"],
                    plan["name"],
                    plan["tagline"],
                    plan["description"],
                    plan["price_cents"],
                    plan["memory"],
                    plan["cpu"],
                    plan["disk"],
                    plan["server_slots"],
                    plan["database_limit"],
                    plan["backup_limit"],
                    plan["allocation_limit"],
                    json.dumps(plan["features"]),
                    json.dumps(plan["artifact"]),
                    plan["accent"],
                    plan["badge"],
                    plan["sort_order"],
                    plan["featured"],
                    stamp,
                    stamp,
                ),
            )

    if conn.execute("SELECT COUNT(*) AS c FROM payment_methods").fetchone()["c"] == 0:
        methods = [
            {
                "name": "DANA QR",
                "kind": "dana_qr",
                "account_name": "Meridian Payments",
                "account_id": "",
                "qr_image": "",
                "instructions": "Open DANA, choose Scan QR, and send the exact order total. "
                "Upload the receipt in the checkout form and keep the order code as your reference.",
                "sort_order": 10,
            },
            {
                "name": "DANA account",
                "kind": "dana_account",
                "account_name": "Meridian Payments",
                "account_id": "",
                "qr_image": "",
                "instructions": "Transfer the exact total to the DANA account shown above. "
                "Use the order code as the transfer note, then attach the receipt.",
                "sort_order": 20,
            },
            {
                "name": "Touch 'n Go QR",
                "kind": "tng_qr",
                "account_name": "Meridian Payments",
                "account_id": "",
                "qr_image": "",
                "instructions": "Open Touch 'n Go eWallet, choose Scan QR, and send the exact order total. "
                "Attach the receipt so the owner can verify the payment.",
                "sort_order": 30,
            },
            {
                "name": "Touch 'n Go account",
                "kind": "tng_account",
                "account_name": "Meridian Payments",
                "account_id": "",
                "qr_image": "",
                "instructions": "Transfer the exact total to the Touch 'n Go eWallet number above. "
                "Enter the order code as the reference and attach the receipt.",
                "sort_order": 40,
            },
            {
                "name": "Manual bank transfer",
                "kind": "bank_transfer",
                "account_name": "Meridian Payments",
                "account_id": "",
                "qr_image": "",
                "instructions": "Use the bank details published by the owner. "
                "Include the order code in the transfer note and attach the receipt.",
                "sort_order": 50,
            },
        ]
        stamp = utcnow()
        for method in methods:
            conn.execute(
                """INSERT INTO payment_methods
                (name, kind, account_name, account_id, qr_image, instructions, enabled,
                 sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                (
                    method["name"],
                    method["kind"],
                    method["account_name"],
                    method["account_id"],
                    method["qr_image"],
                    method["instructions"],
                    method["sort_order"],
                    stamp,
                    stamp,
                ),
            )

    if conn.execute("SELECT COUNT(*) AS c FROM rules").fetchone()["c"] == 0:
        stamp = utcnow()
        rules = [
            {
                "scope": "global",
                "title": "Zero tolerance for network abuse",
                "body": "Do not launch DDoS tooling, traffic flood scripts, unauthorised port scans or stress "
                "tests against any target. The panel blocks known attack code, immediately suspends the "
                "deployment on critical findings and bans accounts after four recorded attempts.",
                "category": "Security",
                "severity": "critical",
                "sort_order": 10,
            },
            {
                "scope": "global",
                "title": "Protect account and payment details",
                "body": "Never share your panel password, two-factor codes, API keys or payment receipt with "
                "another person. The owner will never ask for your password in chat.",
                "category": "Account",
                "severity": "warning",
                "sort_order": 20,
            },
            {
                "scope": "global",
                "title": "Keep changes recoverable",
                "body": "Create a backup before replacing a world, upgrading a major version or changing a "
                "startup command. The panel records every destructive action in the activity log.",
                "category": "Operations",
                "severity": "info",
                "sort_order": 30,
            },
            {
                "scope": "global",
                "title": "Respect capacity and neighbours",
                "body": "Stay within the memory, CPU and disk limits shown on your plan. Sustained abuse of "
                "shared nodes can lead to throttling, suspension or a plan review.",
                "category": "Fair use",
                "severity": "warning",
                "sort_order": 40,
            },
            {
                "scope": "nest",
                "nest_id": 6,
                "title": "Minecraft content policy",
                "body": "Install plugins, mods and packs from sources you trust. Do not distribute malware, "
                "griefing tools, credential stealers or content that breaks the Minecraft EULA.",
                "category": "Minecraft",
                "severity": "warning",
                "sort_order": 10,
            },
            {
                "scope": "egg",
                "egg_id": 27,
                "title": "Java editions and plugin integrity",
                "body": "Use the built-in installer or verified Modrinth projects. Test major version upgrades "
                "on a backup, and keep the EULA acknowledgement current for the account that operates the server.",
                "category": "Minecraft Java",
                "severity": "info",
                "sort_order": 20,
            },
            {
                "scope": "egg",
                "egg_id": 28,
                "title": "Bedrock compatibility",
                "body": "Bedrock packs, behaviour packs and scripts must match the installed server version. "
                "Remove incompatible packs before a version change rather than disabling the safety checks.",
                "category": "Minecraft Bedrock",
                "severity": "info",
                "sort_order": 30,
            },
        ]
        for rule in rules:
            conn.execute(
                """INSERT INTO rules
                (scope, server_id, egg_id, nest_id, title, body, category, severity,
                 sort_order, enabled, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                (
                    rule["scope"],
                    rule.get("egg_id"),
                    rule.get("nest_id"),
                    rule["title"],
                    rule["body"],
                    rule["category"],
                    rule["severity"],
                    rule["sort_order"],
                    stamp,
                    stamp,
                ),
            )


def _ensure_security_settings(conn: sqlite3.Connection) -> None:
    defaults = {
        "security_detection": "true",
        "security_auto_suspend": "true",
        "security_ban_threshold": "4",
    }
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value)
        )


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
