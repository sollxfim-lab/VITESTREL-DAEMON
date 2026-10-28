# VITESTERTL

<p align="center">
  <img src="frontend/public/favicon.svg" alt="VITESTERTL logo" width="120" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Linux-Server%20Control%20Plane-1F2937?logo=linux&logoColor=white" alt="Linux" />
  <img src="https://img.shields.io/badge/Debian-12%2F13-A81D33?logo=debian&logoColor=white" alt="Debian 12/13" />
  <img src="https://img.shields.io/badge/Ubuntu-Compatible-22.04%2F24.04-E95420?logo=ubuntu&logoColor=white" alt="Ubuntu compatible" />
  <img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18" />
</p>

VITESTERTL is a Debian-first, self-hosted control plane for application and game servers. It combines a FastAPI backend, a modern React dashboard, and a local node runtime to deliver a clean operational experience for running and managing workloads securely on your own infrastructure.

Version 2.1.0 introduces a more complete operations surface with fine-grained subuser permissions, TOTP-based two-factor authentication, audit visibility, automated recovery and upgrade workflows, and a built-in AI-assisted terminal copilot.

## Why VITESTERTL?

- Enterprise-style server operations in a self-hosted environment.
- Support for Linux workloads, Debian-native installation, and Ubuntu-compatible deployments.
- Native support for Minecraft servers including Java and Bedrock variants.
- Secure infrastructure controls with role-based permissions, API keys, and audit logging.
- Built-in runtime management, backups, terminal access, deployment catalogues, and automation tooling.
- AI-assisted operations via OpenAI-compatible, Anthropic, Gemini, Azure OpenAI, Ollama, and other provider backends.

## Core platform features

### Infrastructure and server management
- Linux-first deployment with Debian systemd integration.
- Local node automation and allocation management.
- Server lifecycle controls: start, stop, restart, kill, backup, reinstall, and upgrade.
- Built-in dashboard for fleet health, capacity monitoring, workload filtering, and recent activity.

### Minecraft operations
- Native support for Java and Bedrock servers.
- Upstream catalogue integration for Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity, Waterfall, BungeeCord, and Bedrock Dedicated Server.
- One-click upgrades, plugin/mod management, installation jobs, and compatibility checks.
- Automatic EULA and configuration handling with live status monitoring.

### Security and access controls
- Granular Pterodactyl-style subuser permissions.
- TOTP with single-use recovery codes.
- Signed bearer token authentication for the API.
- Secure terminal access, sudo controls, and role restrictions for administrator-managed workflows.
- API key handling with redaction and audit tracking.

### AI operations copilot
- Server-aware AI terminal assistant beside the live console.
- Streamed responses from OpenAI-compatible, Anthropic, Gemini, Azure OpenAI, Ollama, and similar providers.
- Command insertion, copy actions, and structured terminal context awareness.
- Usage tracking, latency monitoring, and provider-level security boundaries.

## Technology stack

| Layer | Technology |
| --- | --- |
| Panel API | FastAPI, SQLite, psutil |
| Interface | React 18, Vite 5, TypeScript, xterm.js |
| Real-time | WebSocket console streams and server-sent events |
| AI copilot | OpenAI-compatible, Anthropic, Gemini, Azure OpenAI, Ollama via httpx |
| Runtime | Python, Node.js, Java, Minecraft, databases, Docker OCI workloads |
| Platform | Debian-first, Ubuntu-compatible, Linux-native |

## System requirements

- Debian 12 (Bookworm) or 13 (Trixie), or a Debian derivative with systemd and nginx.
- Ubuntu-compatible hosts are supported in practice for management workflows and local deployments.
- Python 3.10+ (3.11/3.12 recommended)
- Node.js 18+ and npm
- Optional: Docker for OCI-based eggs
- Linux is required for workload execution; Windows is supported only for development convenience.

## Production installation

Clone the repository and install it as root on the host:

```bash
git clone <your-repository-url> /opt/vitestl
cd /opt/vitestl
sudo bash deploy/install.sh --domain panel.example.com
```

With Docker-backed eggs:

```bash
sudo bash deploy/install.sh --domain panel.example.com --with-docker
```

The installer will:

1. Install required OS packages and build tooling.
2. Prepare the application directory and data path.
3. Configure the `vitestl` system account and persistent storage.
4. Build the frontend and Python environment.
5. Generate the environment configuration and secure initial credentials.
6. Install and start the `vitestl.service` service.
7. Configure nginx as the frontend and reverse proxy.

Useful installation options:

| Option | Purpose |
| --- | --- |
| `--domain NAME` | nginx `server_name` |
| `--port PORT` | listener port |
| `--app-dir PATH` | application directory |
| `--data-dir PATH` | writable data directory |
| `--admin-pass PASS` | initial admin password |
| `--with-docker` | install Docker and grant service access |
| `--no-build` | reuse existing frontend build |
| `--no-nginx` | skip nginx setup |
| `--force` | continue on unsupported distros |

After DNS is active, add TLS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.example.com
```

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

Open `http://localhost:5173` to access the panel. The API runs on port 8000.

## First sign-in

The initial administrator is seeded on first launch. On a Debian installation, credentials are stored in `/root/vitestl-credentials.txt`.

Development fallback:

- Username: `Yanxzyx`
- Password: `Kestrel.admin1`

Important security note: set a strong password immediately after the first login and define a secure `KESTREL_SECRET` for all non-development deployments.

## Architecture

```text
backend/
  main.py          API routes, authorization, server lifecycle, node installer
  db.py            SQLite schema, migrations, seed data, activity logging
  auth.py          Password hashing and JWT issue/verify
  runtime.py       Local process and Docker runtime, console streams
  minecraft.py     Minecraft catalogues, installers, properties, content and pings
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

## Security checklist

- Change the seeded administrator password and email immediately.
- Set a strong, unique `KESTREL_SECRET`.
- Terminate TLS at nginx and avoid exposing the API directly to the internet.
- Restrict access to `/var/lib/vitestl` and the SQLite database.
- Review admin roles and subuser permissions regularly.
- Enable TOTP on administrator accounts and store recovery codes offline.
- Keep Python and npm dependencies patched.
- Treat AI provider keys as production secrets.
- Only enable terminal sudo when truly required.
- Review terminal output before sending it to external AI providers.

## API overview

All panel routes live under `/api` and include authentication, server controls, AI integration, node management, system health, and admin management endpoints. Interactive API documentation is available at `http://localhost:8000/docs` while the backend is running.

## Troubleshooting

- Port already in use: stop the previous panel or frontend process, or adjust the port in `start.sh` and `frontend/vite.config.ts`.
- Blank page or missing icons: run `npm install` in `frontend/` and rebuild.
- Unknown egg during Minecraft setup: ensure the backend and frontend versions are compatible.
- Sudo cannot be enabled: confirm the service account has a valid NOPASSWD rule.
- Terminal reconnects or closes immediately: verify websocket proxying and valid session tokens.
- Copilot says no provider is configured: add and enable a default AI provider.
- Node shows `awaiting`: repair or re-run the local node installer.
- Docker eggs fall back to process mode: ensure Docker is installed and active.
- Service fails to start: inspect `journalctl -u vitestl -n 80 --no-pager`.

## License and project status

VITESTERTL is designed for self-hosted Linux infrastructure and operational control. It is intended for secure, locally managed hosting environments where administrators want full visibility and control over server lifecycle, automation, and workload operations.

For deployment, operations, and support guidance, use the repository documentation and the built-in production installer workflow for Debian-based systems.

---

<p align="center">
  <strong>Built for Debian, Ubuntu-compatible hosts, and Linux-first operations.</strong>
</p>
