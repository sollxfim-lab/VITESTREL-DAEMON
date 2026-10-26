# VITESTERTL

VITESTERTL is a Debian-first, self-hosted control plane for application and game servers. It pairs a FastAPI panel with a responsive React interface and a local node runtime covering the day-to-day work of running workloads: live console, resource telemetry, file management, backups, schedules, databases, allocations, subusers, and a complete audit trail.

Version **1.7.0** adds the Debian production installer, an illustrated local-node auto-install workflow, local SVG artwork, and the VITESTERTL identity.

## Highlights

- **Operations dashboard** — fleet health, node capacity, workload filters, live CPU/memory/disk figures, and recent activity.
- **Server workspace** — console over WebSocket, power controls, command input, file editor and uploads, backups with download and restore, cron schedules, databases, network allocations, startup variables, access lists, and settings.
- **Node management** — auto-install the local Debian host, inspect capacity, regenerate daemon tokens, copy the node configuration, and manage allocations in bulk.
- **Administration** — server creation, suspend/unsuspend, ownership transfer, and full cleanup delete; user, location, nest, and egg management; paginated audit log; branding and panel settings.
- **Account controls** — profile editing, password changes, and session termination.
- **Interface** — Plus Jakarta Sans and JetBrains Mono, Font Awesome icons, local SVG artwork, a responsive dark design system, accessible dialogs, confirmations, and toasts. All assets are bundled locally; the UI makes no CDN requests.

## Stack

| Layer | Technology |
|-------|------------|
| Panel API | FastAPI, SQLite, psutil |
| Interface | React 18, Vite 5, TypeScript, xterm.js |
| Realtime | WebSocket console and resource streams |
| Runtime | Python, Node.js, Java, static HTTP, shell, or Docker OCI images |
| Assets | npm-bundled Font Awesome, Plus Jakarta Sans, JetBrains Mono, local SVG art |

## Requirements

- Debian **12 (bookworm)** or **13 (trixie)**, or a Debian derivative with systemd and nginx
- Python **3.10+** (3.11/3.12 recommended)
- Node.js **18+** and npm (the installer provisions Node 20 when needed)
- Optional: Docker for OCI-based eggs
- Linux for workload execution. The panel can be started on Windows for development, but the process runtime depends on POSIX process groups.

## Debian production install

Clone the repository onto the host, then run the installer as root:

```bash
git clone <your-repository-url> /opt/vitestl
cd /opt/vitestl
sudo bash deploy/install.sh --domain panel.example.com
```

With Docker-backed eggs and the Docker group drop-in:

```bash
sudo bash deploy/install.sh --domain panel.example.com --with-docker
```

The installer:

1. Installs Python, Node.js, nginx, SQLite, and build tooling.
2. Copies the application to `/opt/vitestl` when run from another directory.
3. Creates the `vitestl` system account and the `/var/lib/vitestl` data directory.
4. Builds `frontend/dist` and installs the Python environment.
5. Generates `/etc/vitestl.env` with a random JWT secret and a random initial admin password.
6. Installs and starts `vitestl.service`.
7. Installs nginx as the static frontend and reverse proxy for `/api`, `/ws`, and `/gate`.
8. Saves the initial credentials to `/root/vitestl-credentials.txt`.

Useful installer options:

| Option | Purpose |
|--------|---------|
| `--domain NAME` | nginx `server_name`; use `_` for an IP-only install |
| `--port PORT` | nginx listen port (default `80`) |
| `--app-dir PATH` | application directory (default `/opt/vitestl`) |
| `--data-dir PATH` | writable data directory (default `/var/lib/vitestl`) |
| `--admin-pass PASS` | initial password for a fresh database |
| `--with-docker` | install Docker and grant the service access to the socket |
| `--no-build` | reuse an existing `frontend/dist` build |
| `--no-nginx` | do not install or reload nginx |
| `--force` | continue on a non-Debian distribution |

After DNS points at the host, add TLS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.example.com
```

The service binds only to `127.0.0.1:8000`; nginx is the public entry point. The systemd unit uses `ProtectSystem=strict`, a dedicated account, and a single writable data path.

### Upgrade

```bash
cd /opt/vitestl
sudo git pull
sudo bash deploy/install.sh --domain panel.example.com --with-docker
```

The installer preserves an existing `/etc/vitestl.env` and `/var/lib/vitestl` database. It rebuilds the frontend and restarts the service.

## Node auto-install

VITESTERTL executes workloads on the panel host. The auto-installer does not pretend to install a remote agent; it provisions the local host as a first-class node:

- Audits the distribution, Python, systemd, Docker, privileges, storage, and free ports.
- Reuses an existing local node (matching this hostname) instead of creating duplicates.
- Registers or updates the node, capacity, and location.
- Reserves a contiguous allocation block in `9000–9999`.
- Writes `<data>/nodes/node-<id>/node.json` and `install.log`.
- Streams a live step-by-step log to the admin interface.

Open **Administration → Nodes → Auto-install**, review the host audit, adjust capacity and ports, then run the installer. The resulting node is connected to the local runtime and can accept workloads immediately.

System packages are never installed by the web process. Install Docker during host setup with `sudo bash deploy/install.sh --with-docker`; the installer reports Docker as an optional warning when it is absent and uses the native process runtime.

## Development quick start

### Linux / macOS

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

cd frontend
npm install
cd ..

bash start.sh
```

### Windows (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

cd frontend
npm install
cd ..

# Terminal 1
cd backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal 2
cd frontend
npm run dev
```

Open **http://localhost:5173**. The API listens on port 8000; Vite proxies `/api`, `/ws`, and `/gate` to it.

For a production-style local preview:

```bash
cd frontend
npm run build
npm run preview
```

## First sign-in

The initial administrator is seeded on first start. For a Debian install, use the random credentials in `/root/vitestl-credentials.txt`.

The development fallback is:

- Username: `Yanxzyx`
- Password: `Kestrel.admin1` (retained from older databases for compatibility)

Change the password from **Account** immediately. Override the seeded account with environment variables before the first launch:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITESTL_DATA_DIR` | `./data` | Writable database, server, backup, and node directory |
| `KESTREL_ADMIN_USER` | `Yanxzyx` | Initial administrator username |
| `KESTREL_ADMIN_PASS` | `Kestrel.admin1` | Initial administrator password |
| `KESTREL_ADMIN_EMAIL` | `yanxzyx@vitestl.local` | Initial administrator email |
| `KESTREL_SECRET` | development value | Token signing secret |

`BUILDP_DATA_DIR` and `KESTREL_DATA_DIR` remain accepted as fallbacks for existing installations. Internal compatibility identifiers such as `kestrel.db`, `kestrel.token`, and the `KESTREL_*` variable names are intentionally retained so existing databases upgrade in place.

Set `KESTREL_SECRET` to a long random value in every non-development deployment.

## Architecture

```text
backend/
  main.py          API routes, authorization, server lifecycle, node installer
  db.py            SQLite schema, migrations, seed data, activity logging
  auth.py          Password hashing and JWT issue/verify
  runtime.py       Local process and Docker runtime, console streams
  eggs.py          Nests, eggs, startup templates, variables
  config.py        Paths, versions, defaults
frontend/
  src/pages/       Login, dashboard, server workspace, administration, account
  src/layout/      Sidebar, topbar, responsive shell
  src/assets/      Local SVG illustrations
  src/ui.tsx       Shared controls, dialogs, confirmations, toasts
  src/styles.css   Design system and responsive layout
deploy/
  install.sh       Debian installer and upgrader
  vitestl.service  systemd unit
  nginx.conf       Static frontend + API/WebSocket proxy
data/
  kestrel.db       SQLite database
  servers/         Per-server working directories
  backups/         Compressed backup archives
  nodes/           Auto-installed node manifests and logs
```

## Runtime modes

When Docker is available, eggs marked `docker` are launched as OCI containers with memory limits applied. The native process runtime launches workloads directly and is the default when Docker is absent. Process mode does not provide cgroup isolation; CPU and memory figures are observed usage against configured limits.

Each server receives an allocation. Start it from the console, then use **Open allocation** to reach the bound port through the panel proxy.

## Security checklist

- Change the seeded administrator password and email.
- Set a strong, unique `KESTREL_SECRET`.
- Terminate TLS at nginx and do not expose the API directly to the public internet.
- Restrict access to `/var/lib/vitestl` and the SQLite database; they contain server files and account data.
- Review admin roles and subuser permissions regularly.
- Keep Python and npm dependencies patched, and rebuild the frontend after updates.
- Backups are stored on the same host by default; replicate them off-host for disaster recovery.
- Run the service as `vitestl`, not root. The auto-installer only writes inside the data directory.

Login attempts are rate-limited by the panel. API access uses signed bearer tokens; console and resource streams authenticate with the same signed token. Put the panel behind TLS so tokens are never sent in clear text.

## API overview

All panel routes live under `/api`:

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/password`
- `GET /api/servers`, server detail, resources, power, command, activity
- Files, startup, settings, reinstall, databases, backups, schedules, network, subusers
- `GET /api/admin/overview`, users, nodes, allocations, locations, nests, activity, settings
- `GET /api/admin/node-installer/audit`
- `POST /api/admin/node-installer/install`
- `GET /api/admin/node-installer/jobs/{job_id}`
- `PUT /api/account` for profile changes

Interactive API documentation is available at **http://localhost:8000/docs** while the API is running. It is not exposed by the production nginx configuration.

## Troubleshooting

- **Port already in use** — stop the previous panel or frontend process, or change the port in `start.sh`, the uvicorn command, and `frontend/vite.config.ts`.
- **Blank page or missing icons** — run `npm install` in `frontend/` and rebuild. Fonts and icons are resolved from `node_modules`, so a partial install breaks asset loading.
- **Node shows `awaiting`** — the node must match the panel hostname (or `localhost`/`127.0.0.1`). Run the auto-installer again to repair the local node record.
- **Docker eggs fall back to process mode** — install Docker with `--with-docker` and verify `systemctl status docker` and `docker info`.
- **Processes do not start on Windows** — the process runtime uses POSIX process groups. Use Linux for workload execution.
- **Auto-install reports a port conflict** — choose another first allocation port in the installer; it searches for the next free contiguous block.
- **Service fails to start** — inspect `journalctl -u vitestl -n 80 --no-pager` and confirm `/var/lib/vitestl` is writable by `vitestl`.
