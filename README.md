# VITESTERTL

VITESTERTL is a Debian-first, self-hosted control plane for application and game servers. It pairs a FastAPI panel with a responsive React interface and a local node runtime covering the day-to-day work of running workloads: live console, resource telemetry, file management, backups, schedules, databases, allocations, subusers, and a complete audit trail.

Version **2.1.0** expands the control plane into a complete operations surface: granular Pterodactyl-style subuser permissions, TOTP two-factor authentication with single-use recovery codes, archive, extract, chmod and copy operations in the file manager, multi-task schedules, managed MySQL and MariaDB database hosts, a Debian and Ubuntu host health view, self-healing egg catalogues with deployment coverage and bulk installation, an owner terminal with administrator-controlled per-server sudo, a server-aware AI operations copilot with multi-provider support, safe Minecraft version upgrades with automatic pre-upgrade backups, and Modrinth plugin and mod update detection.

## Highlights

- **Minecraft servers** — install Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity, Waterfall, BungeeCord, or Bedrock Dedicated Server, choose the Minecraft version and loader build, accept the EULA, edit `server.properties`, query live status, and install plugins or mods from Modrinth or local uploads.
- **Safe maintenance** — compare installed server software with the current upstream release, upgrade with one click, and keep an automatic pre-upgrade backup. Check tracked plugins and mods for newer compatible Modrinth builds and update them individually.
- **Catalogue integrity** — built-in nests and eggs are upserted on startup and repaired automatically if a database row is missing, so Minecraft Java egg 27 and Bedrock egg 28 remain available after an upgrade.
- **Deployment coverage** — the nests catalogue marks installed eggs in green and those without a deployment in yellow, previews node capacity, and can install selected eggs or every missing egg in one sequential batch.
- **Owner terminal** — server owners and administrators get an xterm terminal scoped to the server directory, with command history, cancellation, output limits, activity auditing, and an administrator-controlled per-server sudo switch.
- **Operations copilot** — a server-aware assistant lives beside the terminal, reads the egg, limits, power state, startup command and optional terminal buffer, and streams answers from OpenAI-compatible gateways, Anthropic, Gemini, Azure OpenAI or local Ollama. Commands are inserted for review, never executed automatically.
- **Operations dashboard** — fleet health, node capacity, workload filters, live CPU/memory/disk figures, and recent activity.
- **Server workspace** — console over WebSocket, power controls, command input, file editor and uploads, backups with download and restore, cron schedules, databases, network allocations, startup variables, access lists, and settings.
- **Node management** — auto-install the local Debian host, inspect capacity, regenerate daemon tokens, copy the node configuration, and manage allocations in bulk.
- **Administration** — server creation, suspend/unsuspend, ownership transfer, and full cleanup delete; user, location, nest, and egg management; paginated audit log; branding and panel settings.
- **Account controls** — profile editing, password changes, session context, and revocable API keys (`vt_` bearer tokens).
- **Interface** — Plus Jakarta Sans and JetBrains Mono, Font Awesome icons, local SVG artwork, a responsive dark design system, accessible dialogs, confirmations, and toasts. All assets are bundled locally; the UI makes no CDN requests.

## Stack

| Layer | Technology |
|-------|------------|
| Panel API | FastAPI, SQLite, psutil |
| Interface | React 18, Vite 5, TypeScript, xterm.js |
| Realtime | WebSocket console and resource streams; server-sent events for copilot streaming |
| AI copilot | Native OpenAI-compatible, Anthropic, Gemini, Azure OpenAI and Ollama APIs over httpx |
| Runtime | Python, Node.js, Java, Minecraft, voice, databases, bots, Go/Rust/PHP/Deno, static HTTP, shell, or Docker OCI images |
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

Version 2.1.0 migrates the schedules, database hosts, schedule tasks, recovery codes and TOTP columns automatically and upserts the built-in nests and eggs during startup. If a panel upgrade ever leaves an egg missing, open **Administration → Nests & eggs** and use **Sync catalogue**; missing built-in rows are also repaired the first time the catalogue is read.

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

## Runtime modes

When Docker is available, eggs marked `docker` are launched as OCI containers with memory limits applied. The native process runtime launches workloads directly and is the default when Docker is absent. Process mode does not provide cgroup isolation; CPU and memory figures are observed usage against configured limits.

Each server receives an allocation. Start it from the console, then use **Open allocation** to reach the bound port through the panel proxy.

## Minecraft servers

Minecraft is a first-class workload type with dedicated eggs:

| Edition | Egg | Software |
|---------|-----|----------|
| Java | Minecraft Java (auto-installer), egg 27 | Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity, Waterfall, BungeeCord |
| Bedrock | Minecraft Bedrock (auto-installer), egg 28 | Bedrock Dedicated Server |

The version picker reads live upstream catalogues rather than a bundled list:

- **Vanilla** uses Mojang piston metadata.
- **Paper**, **Folia**, and **Velocity** use the PaperMC Fill v3 API.
- **Purpur** uses the PurpurMC API.
- **Fabric** and **Quilt** use their loader metadata APIs.
- **Forge** uses the promotions feed and Maven metadata; **NeoForge** uses the NeoForged Maven metadata.
- **Waterfall** and **BungeeCord** use the PaperMC and SpigotMC CI APIs.
- **Bedrock** uses Minecraft Services download metadata.

Every server download is HTTPS-only and host-validated. Transient failures are retried with backoff, partial transfers resume with HTTP Range requests, and Java artifacts are checksum-verified whenever the upstream publishes a digest.

Installations run as background jobs with live progress and logs. Existing worlds, plugins, mods, and configuration are preserved on reinstall. The panel writes the EULA choice, `server.properties`, and a restart-safe start script, and selects a matching Java runtime image from the version metadata. Java and Bedrock editions use different server directories and cannot share a single workload; choose the edition when creating the server.

The **Minecraft** tab shows the installed build, live Java server-list or Bedrock RakNet status, and editable gameplay properties. When a newer release or loader build is available, the maintenance card offers a one-click upgrade. The server is stopped first, a full backup is written, and the new binary is installed while worlds, plugins, mods, `server.properties` and the EULA decision are preserved.

The **Content** tab installs plugins or mods from Modrinth using the catalogues and loaders appropriate to the selected software. **Check updates** compares every tracked Modrinth project with the latest build compatible with the installed Minecraft version and loader; update buttons replace the old archive and keep disabled files disabled. The tab can also toggle or remove installed files and accept `.jar` or `.zip` uploads. Vanilla, Bedrock, and proxy software expose only the capabilities that apply to them.

If an older installation is missing built-in eggs, opening **Administration → Nests & eggs**, or creating a server, re-syncs the catalogue before failing. The API error includes the requested egg ID and the known built-in IDs, which distinguishes a stale deployment from an invalid request.

## Catalogue deployment coverage

The nests screen treats an egg as **installed** when at least one server already exists for it. Installed egg names are green; eggs without a deployment are yellow. The All, Installed, and Not installed filters make gaps visible, and the coverage meter summarises how much of the bundled catalogue has been deployed.

Use **Install all missing** to deploy one default server for every egg that does not yet have one. Use the per-egg **Install** action, or select any combination of eggs and choose **Install selected**, for a custom batch. Every selection creates a separate server; existing deployments are never replaced or modified.

The bulk installer asks for an owner, node, optional name prefix, and per-application memory and disk. Minecraft Java defaults to 2048 MiB and 10240 MiB, Bedrock to 1024 MiB and 5120 MiB, and other eggs to 256 MiB and 1024 MiB. It previews memory and disk usage against the node's free capacity before starting. Provisioning runs sequentially, reports success or the exact failure reason for each egg, and requires the Minecraft EULA checkbox when Java or Bedrock is included. The **Start each server** option is off by default so a large batch does not consume CPU and memory immediately.

## Owner terminal and per-server sudo

The **Terminal** tab is available to the server owner and panel administrators. Subusers are intentionally excluded: normal server access grants the console and file manager, not a shell on the panel host. Commands run in the server directory as the panel service account (`vitestl` on Debian), with a 120-second timeout, a 1 MiB output cap, cancellation support, history, and activity logging. The terminal confines `cd` to the server directory, but it is not a chroot or container boundary; commands can still read and write anything the service account can access.

Each server has a separate sudo switch controlled only by administrators. When enabled, new commands run with `sudo -n -- bash -c ...`. Enabling the switch verifies the exact non-interactive `bash` execution path first; if that is not permitted without a password, the API returns an error and the setting stays off. The panel never edits sudoers and never grants operating-system privileges by itself. To make the switch usable on Debian, an administrator can create an explicit sudoers drop-in:

```bash
sudo visudo -f /etc/sudoers.d/vitestl-terminal
```

```sudoers
vitestl ALL=(root) NOPASSWD: /usr/bin/bash
```

Use the path printed by `command -v bash`; on Debian it is `/usr/bin/bash`. This is effectively host-root access for every server whose sudo switch is enabled. Grant it only when server owners are trusted with the host, keep the panel behind TLS and strong authentication, and remove the drop-in to revoke the capability. Use `sudo -l -U vitestl` to verify what the service account may run. Disabling the switch takes effect for the next command; the WebSocket re-reads the setting before each execution.

## AI operations copilot

The Terminal workspace has three panes: **Copilot**, **Session** and **Commands**. The copilot is available to the server owner and administrators, matching terminal access. It receives a structured system prompt containing the server name, identifier, egg and nest, power state, owner, allocation, resource limits, Minecraft software and version, startup command, current directory, and sudo mode. When the buffer toggle is on, the visible terminal transcript is attached as untrusted context. The model is instructed never to claim that it executed a command, to flag destructive steps, and to avoid exposing secrets.

Replies stream over server-sent events. Fenced commands carry **Copy** and single-line **Insert** actions. Insert writes the command to the shell prompt for review; it is not submitted, and multi-line snippets must be copied manually. Conversations are stored per server, capped at 24 messages of history and 8,000 characters per user message, with an optional 12,000-character terminal attachment. Operators can stop generation, clear history, copy or download the transcript, and send a terminal selection to the copilot for explanation.

### Provider support

Administrators connect backends under **Administration → AI providers**. Presets are provided for OpenAI, OpenRouter, Anthropic, Google Gemini, Groq, DeepSeek, xAI, Mistral, Azure OpenAI, Ollama, and a custom OpenAI-compatible gateway. Provider families use their native wire formats rather than a compatibility shim:

| Family | Request path | Authentication | Notes |
|--------|--------------|----------------|-------|
| OpenAI-compatible | `/chat/completions` | `Authorization: Bearer` | OpenAI, OpenRouter, Groq, DeepSeek, xAI, Mistral, vLLM, LiteLLM, LM Studio, and custom gateways |
| Anthropic | `/messages` | `x-api-key` and `anthropic-version` | Claude models with native message streaming |
| Google Gemini | `/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key` | Generation tokens and block reasons are reported |
| Azure OpenAI | `{deployment}/chat/completions` | `api-key` | The model field is the deployment name; catalogue discovery is disabled |
| Ollama | `/api/chat` | none | Local models; point the base URL at the Ollama service |

Choose a preset, confirm the base URL, paste the key, and set the exact model identifier. **Test connection** performs a cheap read or short completion, and **Discover models** lists the provider catalogue when one is exposed. A provider can be enabled, disabled, or marked as the default. Operators can switch providers per conversation without seeing any key material.

Custom headers are accepted as a JSON object and merged into every outbound request. This is useful for gateways that require an `X-Title`, `HTTP-Referer`, or routing header. Provider authentication is applied after custom headers, so the configured key cannot be overridden from this field.

### Security boundaries

- API keys are stored in the panel SQLite database, redacted from every API response, and never included in conversation history or activity metadata. Updating a provider with a blank key preserves the stored secret.
- Outbound requests go only to the configured base URL. The panel sends no telemetry and uses the existing `httpx` dependency; no vendor SDK is installed.
- The copilot follows terminal access and rejects subusers even when they have console or file permissions.
- Provider results are suggestions. The panel does not create a shell bridge for the model, and **Insert** always leaves the command editable at the prompt.
- Token counts, latency, failures, provider, server and operator are recorded in `ai_usage`; each chat turn also writes a `server:ai-chat` audit event. Approximate usage is estimated when a provider omits token metadata.
- Terminal output can contain passwords, tokens, or player data. Turn the buffer toggle off before discussing sensitive output, and review the provider's retention and training policy before connecting a hosted model.

## Permissions and subusers

Subusers are existing panel accounts invited by email. The owner and administrators always receive the `*` wildcard. Every other account receives an explicit allow-list using Pterodactyl-style identifiers such as `control.start`, `file.read`, `database.create`, `backup.restore`, `schedule.update`, `allocation.delete`, `startup.update`, `settings.rename`, and `user.create`. Unknown identifiers are discarded before storage, and every API route enforces the matching permission server-side.

The Access tab presents permissions grouped by Console, Files, Databases, Backups, Schedules, Network, Access and Configuration, with select-all controls per group and Viewer, Operator and Manager templates. Editing permissions requires `user.update`; removing a subuser requires `user.delete`. Server payloads redact `environment` and `startup` from accounts without `startup.read`, so secrets are not leaked to read-only collaborators.

## Two-factor authentication

Any account can enroll a TOTP authenticator from **Account ? Two-factor authentication**. Enrollment requires the account password, displays the Base32 secret and `otpauth://` URI, and activates only after a valid six-digit code is entered. Activation generates ten recovery codes; only their SHA-256 hashes are stored. The login endpoint returns a short-lived two-factor challenge instead of a session token when TOTP is enabled. The challenge is exchanged for a session with a current code or a recovery code, and codes from a previously accepted time step are rejected to prevent replay. Recovery codes are single use. Password or code failures use the same rate limiter as normal sign-in.

## File manager

The Files tab supports multi-select operations and a full editor. Selected entries can be deleted in bulk, compressed into `.zip` or `.tar.gz`, copied to a new name, or assigned an octal mode such as `644`, `664`, `755` or `775`. Archives can be extracted in place. Uploads, downloads, rename, and text editing remain available. Every operation is resolved through the server root, rejects path escapes, runs with the panel service account, and writes an audit event. Symlinks are displayed but not followed outside the server volume.

## Managed databases

Administrators create database hosts under **Administration ? Database hosts**, choosing MariaDB or MySQL, hostname, port, administrator credentials, an optional linked client address, and a database limit. Credentials are never returned by the API after creation. Provisioning shells out to the panel host's `mariadb` or `mysql` client with the password passed through the environment, then creates a database, a scoped user, and a grant. If no host exists or the local SQLite option is selected, the panel creates a local SQLite file instead. Deleting a managed database drops the remote database and user when the host is reachable.

Install the client on Debian or Ubuntu with `sudo apt-get install -y mariadb-client` or `mysql-client`. A missing client returns a clear HTTP 503 with the same guidance rather than silently falling back to an unusable endpoint. Hosts that still manage databases cannot be deleted until those databases are removed.

## Host health

**Administration ? System health** reads the panel host directly, without package-manager or network calls. It reports OS release, kernel, architecture, uptime, logical and physical cores, per-core utilisation, load averages, memory and swap, every mounted filesystem, systemd state for the panel runtime and common dependencies, failed units, the top processes by CPU and memory, Docker availability and container count, panel storage usage, SSH password and root-login policy, firewall state for ufw, firewalld or nftables, AppArmor, unattended upgrades, and whether a reboot is pending. The endpoint is administrator-only and refreshes automatically unless disabled.

## Scheduled automation

Schedules use standard five-field cron expressions in UTC: minute, hour, day of month, month, and weekday (Sunday is `0` or `7`). The interface includes presets for hourly, six-hourly, daily, weekly, and monthly maintenance, plus a free-form expression field. Each row stores its next run time, so a restart does not duplicate or skip work.

A schedule can chain up to 20 ordered tasks. Actions cover start, stop, restart, kill, backup, console commands, and file deletion. Each task has its own delay of up to 3600 seconds, and combined delays are capped at 7200 seconds. Every task records whether later tasks should continue after a failure. Schedules can be edited in place, run on demand, paused, or deleted, and on-demand runs return a per-task result list.

Examples:

| Expression | Meaning |
|------------|---------|
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour at minute 0 |
| `0 4 * * *` | Daily at 04:00 UTC |
| `0 4 * * 0` | Every Sunday at 04:00 UTC |
| `0 4 1 * *` | The first day of each month at 04:00 UTC |

Legacy `*/N * * * *` rows created by earlier releases continue to work, including the non-standard values above 59 minutes that older panels accepted.

## Security checklist

- Change the seeded administrator password and email.
- Set a strong, unique `KESTREL_SECRET`.
- Terminate TLS at nginx and do not expose the API directly to the public internet.
- Restrict access to `/var/lib/vitestl` and the SQLite database; they contain server files and account data.
- Review admin roles and subuser permissions regularly; use the smallest template that works.
- Enable TOTP on administrator accounts and store recovery codes offline.
- Restrict database host administrator credentials and prefer a dedicated MySQL account with grant privileges over `root`.
- Keep Python and npm dependencies patched, and rebuild the frontend after updates.
- Backups are stored on the same host by default; replicate them off-host for disaster recovery.
- Run the service as `vitestl`, not root. The auto-installer only writes inside the data directory.
- Treat the owner terminal as host shell access for the service account. It is not a sandbox; restrict who can be a server owner.
- Only add the NOPASSWD sudoers rule when owners should be able to elevate to root, and review `terminal_sudo` on each server regularly.
- Treat AI provider keys as production secrets: scope them to the smallest budget and model access you need, rotate them when an administrator leaves, and choose providers whose data-retention terms match your policy.
- Review terminal buffer attachment before sending output that contains credentials, tokens, or player data to a hosted model.

Password, TOTP and recovery-code attempts are rate-limited by the panel. API access uses signed bearer tokens; console and resource streams authenticate with the same signed token. Put the panel behind TLS so tokens are never sent in clear text.

## API overview

All panel routes live under `/api`:

- `POST /api/auth/login`, `POST /api/auth/2fa`, `GET /api/auth/me`, `POST /api/auth/password`
- `GET /api/account/2fa`, `POST /api/account/2fa/setup|enable|disable`
- `GET /api/servers`, server detail, resources, power, command, activity
- Files, including `compress`, `extract`, `chmod` and `copy`; startup, settings, reinstall, databases, backups, schedules, network and subusers
- `PUT /api/servers/{id}/users/{sub_id}` for granular subuser permission changes
- `GET /api/admin/database-hosts` and CRUD plus connection tests under `/api/admin/database-hosts`
- `GET /api/admin/system` for Debian and Ubuntu host health
- `GET /api/minecraft/catalog`, version and loader catalogues, Minecraft status and install jobs
- `GET|PUT /api/servers/{id}/minecraft/properties`, `POST /api/servers/{id}/minecraft/install`
- `GET /api/servers/{id}/minecraft/update`, `POST /api/servers/{id}/minecraft/upgrade`
- Plugin and mod search, versions, install, upload, toggle, and delete under `/api/servers/{id}/plugins`
- `GET /api/servers/{id}/plugins/updates`, `POST /api/servers/{id}/plugins/{filename}/update`
- `GET /api/servers/{id}/terminal`, `POST /api/servers/{id}/terminal/sudo` (administrators only)
- `WS /ws/terminal/{id}` for the owner terminal; owners and administrators only
- `GET|POST /api/admin/ai/providers`, `PUT|DELETE /api/admin/ai/providers/{id}`, plus `default`, `test` and `models` actions
- `POST /api/admin/ai/providers/test` and `POST /api/admin/ai/providers/models` test unsaved drafts
- `GET /api/admin/ai/usage?days=30` for request, token, latency and failure analytics
- `GET|DELETE /api/servers/{id}/ai` for conversation history, `POST /api/servers/{id}/ai/chat` for server-sent-event streaming
- `GET /api/admin/nests` returns `catalog_health`, per-egg `installed`, and deployment counts; `POST /api/admin/nests/sync` repairs built-in nests and eggs
- `GET /api/admin/overview`, users, nodes, allocations, locations, nests, activity, settings
- `GET /api/admin/node-installer/audit`
- `POST /api/admin/node-installer/install`
- `GET /api/admin/node-installer/jobs/{job_id}`
- `PUT /api/account` for profile changes

Interactive API documentation is available at **http://localhost:8000/docs** while the API is running. It is not exposed by the production nginx configuration.

## Troubleshooting

- **Port already in use** — stop the previous panel or frontend process, or change the port in `start.sh`, the uvicorn command, and `frontend/vite.config.ts`.
- **Blank page or missing icons** — run `npm install` in `frontend/` and rebuild. Fonts and icons are resolved from `node_modules`, so a partial install breaks asset loading.
- **`Unknown egg` when creating a Minecraft server** — the panel could not find the requested egg in both SQLite and the bundled catalogue, which means the running backend is older than the frontend or the catalogue rows were deleted. Run `sudo bash deploy/install.sh` to rebuild and restart the service, then open **Administration → Nests & eggs → Sync catalogue**. Version 2.1.0 also repairs missing built-in eggs automatically and includes the submitted egg ID in the error message.
- **Sudo cannot be enabled** — the panel requires non-interactive sudo. Confirm `sudo` is installed, the service account has the NOPASSWD rule shown above, and `sudo -u vitestl sudo -n -- bash -c 'exit 0'` succeeds. The panel deliberately refuses to store a password or modify sudoers.
- **Terminal reconnects or closes immediately** — verify nginx is proxying `/ws/` with the `Upgrade` and `Connection` headers, the panel is behind TLS, and the signed session token is still valid. Subusers cannot open the owner terminal even when they can use the console.
- **Copilot says no provider is configured** — open **Administration → AI providers**, connect at least one provider, confirm it is enabled, and mark one as the default. The copilot follows terminal access, so subusers receive HTTP 403 by design.
- **Copilot test or model discovery fails** — confirm the base URL includes the API version root, the key is valid for that endpoint, and the model identifier is exact. Azure uses the deployment name and does not expose a model catalogue. Ollama must be reachable from the panel service account at the configured URL.
- **Copilot replies arrive in one block behind a proxy** — server-sent events require response buffering to be disabled for `/api/`. Confirm nginx uses `proxy_buffering off` and does not cache the chat route.
- **Node shows `awaiting`** — the node must match the panel hostname (or `localhost`/`127.0.0.1`). Run the auto-installer again to repair the local node record.
- **Docker eggs fall back to process mode** — install Docker with `--with-docker` and verify `systemctl status docker` and `docker info`.
- **Processes do not start on Windows** — the process runtime uses POSIX process groups. Use Linux for workload execution.
- **Auto-install reports a port conflict** — choose another first allocation port in the installer; it searches for the next free contiguous block.
- **Service fails to start** — inspect `journalctl -u vitestl -n 80 --no-pager` and confirm `/var/lib/vitestl` is writable by `vitestl`.
