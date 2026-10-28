import {
  FormEvent,
  KeyboardEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Activity,
  DatabaseHostOption,
  PermissionGroup,
  Schedule,
  Server as Srv,
  ServerDatabase as ServerDatabaseRow,
  Stats,
  TerminalInfo,
  User,
  api,
  fmtBytes,
  fmtDate,
  fmtUptime,
  pct,
  timeAgo,
  wsUrl,
} from "../api";
import { Icon } from "../icons";
import { AiCopilot, type CopilotSeed } from "../copilot";
import { MinecraftPane, PluginsPane } from "../minecraft";
import { ResourceLimits } from "../resources";
import {
  activityInfo,
  activityText,
  ConfirmButton,
  CopyButton,
  EmptyState,
  LoadingPage,
  Modal,
  PageHeader,
  PasswordValue,
  plural,
  StatusPill,
  notify,
} from "../ui";

const TABS = [
  { id: "console", label: "Console", icon: "terminal" },
  { id: "files", label: "Files", icon: "folder-open" },
  { id: "databases", label: "Databases", icon: "database" },
  { id: "schedules", label: "Schedules", icon: "clock" },
  { id: "users", label: "Access", icon: "users-gear" },
  { id: "backups", label: "Backups", icon: "box-archive" },
  { id: "network", label: "Network", icon: "network-wired" },
  { id: "startup", label: "Startup", icon: "rocket" },
  { id: "settings", label: "Settings", icon: "sliders" },
  { id: "activity", label: "Activity", icon: "clock-rotate-left" },
];

const MINECRAFT_TABS = [
  { id: "minecraft", label: "Minecraft", icon: "cube" },
  { id: "plugins", label: "Content", icon: "puzzle-piece" },
];

const TERMINAL_TAB = { id: "terminal", label: "Terminal", icon: "square-terminal" };

const WORKBENCH_TABS = [
  { id: "copilot", label: "Copilot", icon: "brain" },
  { id: "session", label: "Session", icon: "gauge-high" },
  { id: "commands", label: "Commands", icon: "terminal" },
] as const;

const ServerAccessContext = createContext<string[]>([]);

function useServerCan(): (permission: string) => boolean {
  const permissions = useContext(ServerAccessContext);
  return (permission: string) => permissions.includes("*") || permissions.includes(permission);
}

const TAB_PERMISSIONS: Record<string, string> = {
  console: "websocket.connect",
  files: "file.read",
  databases: "database.read",
  schedules: "schedule.read",
  users: "user.read",
  backups: "backup.read",
  network: "allocation.read",
  startup: "startup.read",
  settings: "settings.rename",
  activity: "activity.read",
};

const CRON_PRESETS = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
  { value: "0 4 * * *", label: "Daily at 04:00 UTC" },
  { value: "0 4 * * 0", label: "Weekly on Sunday at 04:00 UTC" },
  { value: "0 4 1 * *", label: "Monthly on the 1st at 04:00 UTC" },
];

function joinPath(dir: string, name: string): string {
  return ("/" + [dir.replace(/^\/|\/$/g, ""), name].filter(Boolean).join("/")).replace(/\/+/g, "/");
}

function fileIcon(entry: any): { icon: string; tone: string } {
  if (!entry.is_file) return { icon: "folder", tone: "folder" };
  const name = String(entry.name || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(name)) return { icon: "file-image", tone: "image" };
  if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(name)) return { icon: "file-zipper", tone: "archive" };
  if (/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(name)) return { icon: "file-code", tone: "code" };
  if (/\.(py|java|rb|go|rs|php|sh|bash)$/.test(name)) return { icon: "file-code", tone: "code" };
  if (/\.(json|ya?ml|toml|ini|env|properties|xml)$/.test(name)) return { icon: "file-lines", tone: "config" };
  if (/\.(md|txt|log)$/.test(name)) return { icon: "file-lines", tone: "text" };
  return { icon: "file", tone: "text" };
}

export default function ServerPage() {
  const { id = "" } = useParams();
  const { user } = useOutletContext<{ user: User }>();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "console";
  const [server, setServer] = useState<Srv | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const can = (permission: string) =>
    !!server?.permissions?.includes("*") || !!server?.permissions?.includes(permission);

  const load = useCallback(async () => {
    const response = await api.server(id);
    setServer(response.data);
    setStats(response.data.resources);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  useEffect(() => {
    setError("");
    if (server && !can("websocket.connect")) return;
    const socket = new WebSocket(wsUrl(`/ws/stats/${id}`));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.event === "stats") setStats(message.args[0]);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, server?.permissions]);

  async function power(signal: string) {
    setBusy(signal);
    setError("");
    try {
      await api.power(id, signal);
      notify(`${signal.charAt(0).toUpperCase() + signal.slice(1)} signal sent`);
      await load();
    } catch (err: any) {
      setError(err.message);
      notify(err.message || "Power action failed", "error");
    } finally {
      setBusy("");
    }
  }

  if (!server) {
    return error ? (
      <div className="error-panel">
        <span className="error-panel-icon"><Icon name="triangle-exclamation" /></span>
        <div>
          <h3>Unable to open this server</h3>
          <p>{error}</p>
        </div>
        <Link className="btn btn-ghost" to="/">Back to overview</Link>
      </div>
    ) : (
      <LoadingPage label="Loading server" />
    );
  }

  const state = server.suspended ? "suspended" : stats?.state || server.status;
  const online = state === "running";
  const admin = user.role === "admin";
  const canTerminal = admin || Number(server.owner_id) === Number(user.id);
  const isMinecraft = !!server.mc_software || server.egg_id === 27 || server.egg_id === 28;
  const canRead = (tabId: string) => {
    const permission = TAB_PERMISSIONS[tabId];
    if (!permission) return true;
    return can(permission);
  };
  const consoleTab = TABS[0];
  const remainingTabs = TABS.slice(1).filter((item) => canRead(item.id));
  const tabs = [
    ...(can("websocket.connect") ? [consoleTab] : []),
    ...(canTerminal ? [TERMINAL_TAB] : []),
    ...(isMinecraft && can("file.read") ? MINECRAFT_TABS : []),
    ...remainingTabs,
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id || "console";

  return (
    <div className="page server-page">
      <div className="server-head">
        <div className="server-head-left">
          <Link to={admin ? "/admin/servers" : "/"} className="back-link">
            <Icon name="arrow-left" /> {admin ? "All servers" : "Overview"}
          </Link>
          <div className="server-title-row">
            <span className={`server-title-icon ${online ? "online" : ""}`}>
              <Icon name={isMinecraft ? "cube" : "server"} />
            </span>
            <div>
              <div className="server-title">
                <h1>{server.name}</h1>
                <StatusPill status={state} />
              </div>
              <div className="server-meta">
                <span>{server.nest_name} / {server.egg_name}</span>
                <span className="dot-separator" />
                <span className="mono">{server.identifier}</span>
                <span className="dot-separator" />
                <span>Owner {server.owner_name}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="server-power">
          <a
            className={`btn btn-ghost ${!online || server.suspended ? "is-disabled" : ""}`}
            href={`/gate/${id}/`}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!online || server.suspended}
            onClick={(event) => {
              if (!online || server.suspended) event.preventDefault();
            }}
          >
            <Icon name="arrow-up-right-from-square" /> Open allocation
          </a>
          <button className="btn btn-success" hidden={!can("control.start")} disabled={online || !!busy || server.suspended} onClick={() => power("start")}>
            <Icon name={busy === "start" ? "circle-notch" : "play"} className={busy === "start" ? "spin" : ""} />
            Start
          </button>
          <button className="btn btn-ghost" hidden={!can("control.restart")} disabled={!online || !!busy || server.suspended} onClick={() => power("restart")}>
            <Icon name={busy === "restart" ? "circle-notch" : "rotate-right"} className={busy === "restart" ? "spin" : ""} />
            Restart
          </button>
          <button className="btn btn-ghost" hidden={!can("control.stop")} disabled={!online || !!busy || server.suspended} onClick={() => power("stop")}>
            <Icon name={busy === "stop" ? "circle-notch" : "stop"} className={busy === "stop" ? "spin" : ""} />
            Stop
          </button>
          {can("control.stop") && (
            <ConfirmButton
              className="btn btn-danger-ghost"
              icon="power-off"
              title={`Terminate ${server.name}?`}
              description="Kill sends an immediate termination signal. Unsaved process state will be lost."
              confirmLabel="Kill process"
              onConfirm={() => power("kill")}
              disabled={!online || !!busy || server.suspended}
            >
              Kill
            </ConfirmButton>
          )}
        </div>
      </div>

      {server.suspended && (
        <div className="banner banner-warning">
          <Icon name="ban" />
          <div>
            <strong>This server is suspended</strong>
            <span>{server.suspended_reason || "Contact a panel administrator for more information."}</span>
          </div>
        </div>
      )}
      {error && <div className="banner banner-error"><Icon name="circle-exclamation" /><span>{error}</span></div>}

      <section className="resource-strip">
        <ResourceMini
          icon="microchip"
          label="CPU"
          value={`${(stats?.cpu_absolute || 0).toFixed(1)}%`}
          detail={`${server.limits?.cpu || 100}% limit`}
          percent={Math.min(100, ((stats?.cpu_absolute || 0) / Math.max(server.limits?.cpu || 100, 1)) * 100)}
          tone="cpu"
        />
        <ResourceMini
          icon="memory"
          label="Memory"
          value={fmtBytes(stats?.memory_bytes || 0)}
          detail={`${fmtBytes(stats?.memory_limit_bytes || 0)} limit`}
          percent={pct(stats?.memory_bytes || 0, stats?.memory_limit_bytes || 1)}
          tone="mem"
        />
        <ResourceMini
          icon="hard-drive"
          label="Disk"
          value={fmtBytes(stats?.disk_bytes || 0)}
          detail={`${fmtBytes(stats?.disk_limit_bytes || 0)} limit`}
          percent={pct(stats?.disk_bytes || 0, stats?.disk_limit_bytes || 1)}
          tone="disk"
        />
        <ResourceMini
          icon="clock"
          label="Uptime"
          value={online ? fmtUptime(stats?.uptime || 0) : "—"}
          detail={online ? `PID ${stats?.pid || "—"}` : "Not running"}
          percent={online ? 100 : 0}
          tone="uptime"
        />
        <ResourceMini
          icon="network-wired"
          label="Network"
          value={online ? `${fmtBytes((stats?.network?.rx_bytes || 0) + (stats?.network?.tx_bytes || 0))}` : "—"}
          detail="RX + TX"
          percent={online ? 60 : 0}
          tone="network"
        />
      </section>

      {tabs.length > 0 && (
        <nav className="tabs" aria-label="Server sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeTab === item.id ? "active" : ""}
              onClick={() => setSearchParams({ tab: item.id })}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {tabs.length === 0 && (
        <div className="card">
          <EmptyState
            icon="lock"
            title="No sections available"
            description="Your account has no permissions on this server. Ask the owner to grant access in the Access tab."
          />
        </div>
      )}

      <ServerAccessContext.Provider value={server.permissions || []}>
        {activeTab === "console" && <ConsolePane id={id} server={server} stats={stats} online={online} />}
        {activeTab === "terminal" && canTerminal && (
          <TerminalPane id={id} server={server} user={user} onSudoChanged={load} />
        )}
        {activeTab === "files" && <FilesPane id={id} />}
        {activeTab === "minecraft" && <MinecraftPane id={id} server={server} onChanged={load} />}
        {activeTab === "plugins" && <PluginsPane id={id} />}
        {activeTab === "databases" && <DatabasesPane id={id} />}
        {activeTab === "schedules" && <SchedulesPane id={id} />}
        {activeTab === "users" && <AccessPane id={id} />}
        {activeTab === "backups" && <BackupsPane id={id} />}
        {activeTab === "network" && <NetworkPane id={id} server={server} />}
        {activeTab === "startup" && <StartupPane id={id} />}
        {activeTab === "settings" && (
          <SettingsPane
            id={id}
            server={server}
            isAdmin={admin}
            onSaved={load}
            onDeleted={() => nav("/admin/servers")}
          />
        )}
        {activeTab === "activity" && <ActivityPane id={id} />}
      </ServerAccessContext.Provider>
    </div>
  );
}

function ResourceMini({
  icon,
  label,
  value,
  detail,
  percent,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  percent: number;
  tone: string;
}) {
  return (
    <div className={`resource-mini tone-${tone}`}>
      <div className="resource-mini-head">
        <span className="resource-mini-icon"><Icon name={icon} /></span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <span className="resource-mini-detail">{detail}</span>
      <div className={`track ${tone}`}><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function ConsolePane({ id, server, stats, online }: { id: string; server: Srv; stats: Stats | null; online: boolean }) {
  const can = useServerCan();
  const canCommand = can("control.console");
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [command, setCommand] = useState("");
  const [state, setState] = useState("connecting");

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.45,
      theme: {
        background: "#080b10",
        foreground: "#d5e0ec",
        cursor: "#43b8f5",
        selectionBackground: "#1d4b66",
        black: "#080b10",
        brightBlack: "#617086",
        blue: "#43b8f5",
        brightBlue: "#8ed7ff",
        green: "#3ddc97",
        brightGreen: "#74f0b6",
        red: "#f16c75",
        yellow: "#f0bd5c",
        magenta: "#aa9bf5",
        cyan: "#59d6d6",
      },
      convertEol: true,
      scrollback: 3000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    window.setTimeout(() => fit.fit(), 30);
    termRef.current = terminal;

    const socket = new WebSocket(wsUrl(`/ws/console/${id}`));
    socketRef.current = socket;
    socket.onopen = () => {
      setState("connected");
      terminal.writeln("\x1b[38;5;245m[vitestl] Console stream attached.\x1b[0m");
    };
    socket.onclose = () => {
      setState("disconnected");
      terminal.writeln("\x1b[38;5;245m[vitestl] Console stream closed.\x1b[0m");
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.event === "console output") terminal.write(message.args[0]);
        else if (message.event === "error") {
          setState("error");
          terminal.writeln(`\x1b[31m[vitestl] ${message.message}\x1b[0m`);
        }
      } catch {
        terminal.write(event.data);
      }
    };

    const resize = () => fit.fit();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      socket.close();
      terminal.dispose();
      termRef.current = null;
    };
  }, [id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      notify("Console is not connected", "error");
      return;
    }
    socket.send(JSON.stringify({ event: "send command", args: [command] }));
    if (command.trim()) historyRef.current.push(command);
    historyIndex.current = -1;
    setCommand("");
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    const history = historyRef.current;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      historyIndex.current = historyIndex.current < 0 ? history.length - 1 : Math.max(0, historyIndex.current - 1);
      setCommand(history[historyIndex.current]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex.current < 0) return;
      const next = historyIndex.current + 1;
      if (next >= history.length) {
        historyIndex.current = -1;
        setCommand("");
      } else {
        historyIndex.current = next;
        setCommand(history[next]);
      }
    }
  }

  return (
    <div className="console-layout">
      <div className="terminal-card">
        <div className="terminal-bar">
          <div className="terminal-dots" aria-hidden="true"><i /><i /><i /></div>
          <span className="terminal-title">
            <Icon name="terminal" /> stdin / stdout
          </span>
          <span className={`terminal-state ${state}`}>
            <span className={`status-dot ${state === "connected" ? "running" : state === "error" ? "error" : "warning"}`} />
            {state}
          </span>
          <div className="terminal-tools">
            <button type="button" className="icon-btn" title="Clear console" onClick={() => termRef.current?.clear()}>
              <Icon name="eraser" />
            </button>
          </div>
        </div>
        <div className="terminal-host" ref={host} />
        <form className="terminal-input" onSubmit={submit}>
          <span className="terminal-prompt">$</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={onKey}
            placeholder={!canCommand ? "You do not have console command permission" : online ? "Type a command and press Enter" : "Instance is offline"}
            spellCheck={false}
            autoComplete="off"
            aria-label="Console command"
            disabled={!canCommand}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!online || !canCommand}>
            <Icon name="paper-plane" /> Send
          </button>
        </form>
      </div>

      <aside className="console-side">
        <div className="info-card">
          <div className="info-card-head">
            <span className="eyebrow">Connection</span>
            <CopyButton value={`${server.allocation.alias}:${server.allocation.port}`} label="Copy address" />
          </div>
          <div className="endpoint">
            <code>{server.allocation.alias}:{server.allocation.port}</code>
            <span className={`pill ${online ? "pill-ok" : "pill-neutral"}`}>{online ? "reachable" : "offline"}</span>
          </div>
          <dl className="info-list">
            <div><dt>Runtime</dt><dd>{stats?.mode || "process"}</dd></div>
            <div><dt>PID</dt><dd>{stats?.pid || "—"}</dd></div>
            <div><dt>Uptime</dt><dd>{online ? fmtUptime(stats?.uptime || 0) : "—"}</dd></div>
            <div><dt>Node</dt><dd>node-{String(server.node_id).padStart(2, "0")}</dd></div>
          </dl>
        </div>

        <div className="info-card">
          <div className="info-card-head"><span className="eyebrow">Resource usage</span></div>
          <div className="usage-stack">
            <div>
              <div className="usage-row"><span>CPU</span><em>{(stats?.cpu_absolute || 0).toFixed(1)}%</em></div>
              <div className="track cpu"><i style={{ width: `${Math.min(100, ((stats?.cpu_absolute || 0) / Math.max(server.limits.cpu || 100, 1)) * 100)}%` }} /></div>
            </div>
            <div>
              <div className="usage-row"><span>Memory</span><em>{fmtBytes(stats?.memory_bytes || 0)} / {fmtBytes(stats?.memory_limit_bytes || 0)}</em></div>
              <div className="track mem"><i style={{ width: `${pct(stats?.memory_bytes || 0, stats?.memory_limit_bytes || 1)}%` }} /></div>
            </div>
            <div>
              <div className="usage-row"><span>Disk</span><em>{fmtBytes(stats?.disk_bytes || 0)} / {fmtBytes(stats?.disk_limit_bytes || 0)}</em></div>
              <div className="track disk"><i style={{ width: `${pct(stats?.disk_bytes || 0, stats?.disk_limit_bytes || 1)}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-head"><span className="eyebrow">Server identity</span></div>
          <div className="identity-value">
            <code>{server.uuid}</code>
            <CopyButton value={server.uuid} label="Copy UUID" />
          </div>
          <div className="image-chip"><Icon name="cube" /> {server.image}</div>
        </div>
      </aside>
    </div>
  );
}

function TerminalPane({
  id,
  server,
  user,
  onSudoChanged,
}: {
  id: string;
  server: Srv;
  user: User;
  onSudoChanged: () => Promise<void> | void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const promptRef = useRef<((note?: string) => void) | null>(null);
  const runRef = useRef<((command: string) => void) | null>(null);
  const insertRef = useRef<((command: string) => void) | null>(null);
  const sessionRef = useRef({
    cwd: "/",
    sudo: Boolean(server.terminal_sudo),
    running: false,
    buffer: "",
    cursor: 0,
    history: [] as string[],
    historyIndex: -1,
    lastCommand: "",
  });
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [cwd, setCwd] = useState("/");
  const [running, setRunning] = useState(false);
  const [sudo, setSudo] = useState(Boolean(server.terminal_sudo));
  const [connectionNonce, setConnectionNonce] = useState(0);
  const [workbenchTab, setWorkbenchTab] = useState<"copilot" | "session" | "commands">("copilot");
  const [fontSize, setFontSize] = useState(12.5);
  const [fullscreen, setFullscreen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [aiSeed, setAiSeed] = useState<CopilotSeed>(null);
  const [lastRun, setLastRun] = useState<{
    command: string;
    code: number;
    duration_ms: number;
    sudo: boolean;
    timed_out?: boolean;
    truncated?: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .terminalInfo(id)
      .then((response) => {
        if (!alive) return;
        setInfo(response.data);
        setSudo(response.data.sudo);
        sessionRef.current.sudo = response.data.sudo;
      })
      .catch(() => {
        /* the socket reports actionable errors */
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    const session = sessionRef.current;
    session.cwd = "/";
    session.buffer = "";
    session.cursor = 0;
    session.historyIndex = -1;
    session.running = false;
    setCwd("/");
    setRunning(false);
    setState("connecting");

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace',
      fontSize,
      fontWeight: "400",
      fontWeightBold: "700",
      letterSpacing: 0.2,
      lineHeight: 1.5,
      theme: {
        background: "#0a0f16",
        foreground: "#d6e0ea",
        cursor: "#f0bd5c",
        cursorAccent: "#0a0f16",
        selectionBackground: "#24465c",
        selectionForeground: "#f5f9fd",
        black: "#0a0f16",
        brightBlack: "#6b7c90",
        blue: "#65b8f2",
        brightBlue: "#9bd8ff",
        green: "#5fd6a3",
        brightGreen: "#8cf0c5",
        red: "#ef7d88",
        brightRed: "#ff9da6",
        yellow: "#f0c674",
        brightYellow: "#ffdda0",
        magenta: "#b3a4ff",
        brightMagenta: "#d0c6ff",
        cyan: "#66d9d9",
        brightCyan: "#9af0ef",
        white: "#d6e0ea",
        brightWhite: "#f7fbff",
      },
      convertEol: true,
      scrollback: 8000,
      scrollOnUserInput: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    terminal.open(element);
    window.setTimeout(() => {
      try {
        fit.fit();
      } catch {
        /* the pane can be hidden while the tab changes */
      }
    }, 30);
    termRef.current = terminal;

    const promptParts = () => {
      const hostName =
        (server.name || "server")
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 28) || "server";
      const path = session.cwd === "/" ? "~" : `~${session.cwd}`;
      const prefix = `${session.sudo ? "root" : user.username}@${hostName}:${path}`;
      return {
        plain: `${prefix}$ `,
        ansi: `\x1b[38;5;81m${prefix}\x1b[0m$ `,
      };
    };

    const writePrompt = () => {
      terminal.write(promptParts().ansi);
      session.buffer = "";
      session.cursor = 0;
    };

    const redrawLine = () => {
      const prompt = promptParts();
      terminal.write(`\r\x1b[2K${prompt.ansi}${session.buffer}`);
      const back = session.buffer.length - session.cursor;
      if (back > 0) terminal.write(`\x1b[${back}D`);
    };

    const writeOutput = (value: string) => {
      if (!value) return;
      terminal.write(value);
      sessionRef.current.running = session.running;
    };

    const finishLine = () => {
      if (!session.running) return;
      terminal.write("\r\n");
    };

    const submitCommand = (command: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        notify("Terminal is not connected", "error");
        return;
      }
      if (session.running) {
        notify("A command is already running. Cancel it or wait for it to finish.", "info");
        return;
      }
      const value = command;
      session.buffer = "";
      session.cursor = 0;
      terminal.write("\r\n");
      if (!value.trim()) {
        writePrompt();
        return;
      }
      if (/^(clear|cls)$/i.test(value.trim())) {
        terminal.clear();
        writePrompt();
        return;
      }
      session.history.push(value);
      if (session.history.length > 100) session.history.shift();
      session.historyIndex = -1;
      session.lastCommand = value;
      setRecent((current) => [value, ...current.filter((item) => item !== value)].slice(0, 14));
      session.running = true;
      setRunning(true);
      socket.send(JSON.stringify({ event: "exec", command: value }));
    };

    const runQuick = (command: string) => {
      if (session.running) {
        notify("Wait for the running command to finish", "info");
        return;
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        notify("Terminal is not connected", "error");
        return;
      }
      terminal.write(`\r\x1b[2K${promptParts().ansi}${command}`);
      submitCommand(command);
    };

    promptRef.current = (note?: string) => {
      if (note) terminal.write(`\r\n${note}\r\n`);
      else terminal.write("\r\n");
      writePrompt();
    };
    runRef.current = runQuick;
    insertRef.current = (command: string) => {
      const value = command.replace(/^\$\s+/, "").replace(/\r/g, "").trim();
      if (!value || value.includes("\n")) {
        notify("Multi-line snippets cannot be inserted into the prompt", "info");
        return;
      }
      session.buffer = value;
      session.cursor = value.length;
      redrawLine();
      terminal.focus();
      notify("Inserted at the prompt. Review it, then press Enter.", "info");
    };

    const disposable = terminal.onData((raw: string) => {
      if (disposed) return;
      const data = raw.startsWith("\x1b[200~") && raw.endsWith("\x1b[201~")
        ? raw.slice(6, -6)
        : raw;
      if (session.running) {
        if (data === "\u0003") {
          const socket = socketRef.current;
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: "cancel" }));
          } else {
            notify("Terminal is not connected", "error");
          }
        }
        return;
      }
      if (data === "\u001b[A") {
        if (!session.history.length) return;
        if (session.historyIndex < 0) session.historyIndex = session.history.length - 1;
        else if (session.historyIndex > 0) session.historyIndex -= 1;
        session.buffer = session.history[session.historyIndex] || "";
        session.cursor = session.buffer.length;
        redrawLine();
        return;
      }
      if (data === "\u001b[B") {
        if (session.historyIndex < 0) return;
        if (session.historyIndex >= session.history.length - 1) {
          session.historyIndex = -1;
          session.buffer = "";
          session.cursor = 0;
        } else {
          session.historyIndex += 1;
          session.buffer = session.history[session.historyIndex] || "";
          session.cursor = session.buffer.length;
        }
        redrawLine();
        return;
      }
      if (data === "\u001b[D") {
        if (session.cursor > 0) {
          session.cursor -= 1;
          terminal.write("\u001b[D");
        }
        return;
      }
      if (data === "\u001b[C") {
        if (session.cursor < session.buffer.length) {
          session.cursor += 1;
          terminal.write("\u001b[C");
        }
        return;
      }
      if (data === "\u001b[H" || data === "\u0001") {
        session.cursor = 0;
        redrawLine();
        return;
      }
      if (data === "\u001b[F" || data === "\u0005") {
        session.cursor = session.buffer.length;
        redrawLine();
        return;
      }
      if (data === "\u0003") {
        terminal.write("^C\r\n");
        writePrompt();
        return;
      }
      if (data === "\u000c") {
        terminal.clear();
        writePrompt();
        return;
      }
      if (data === "\u0015") {
        session.buffer = "";
        session.cursor = 0;
        redrawLine();
        return;
      }
      if (data === "\u007f") {
        if (session.cursor > 0) {
          session.buffer =
            session.buffer.slice(0, session.cursor - 1) + session.buffer.slice(session.cursor);
          session.cursor -= 1;
          redrawLine();
        }
        return;
      }
      if (data === "\r" || data === "\n") {
        const command = session.buffer;
        session.buffer = "";
        session.cursor = 0;
        submitCommand(command);
        return;
      }
      for (const char of data) {
        if (char === "\r" || char === "\n") {
          submitCommand(session.buffer);
          break;
        }
        if (char === "\u007f") {
          if (session.cursor > 0) {
            session.buffer =
              session.buffer.slice(0, session.cursor - 1) + session.buffer.slice(session.cursor);
            session.cursor -= 1;
          }
          continue;
        }
        if (char === "\u0003") {
          terminal.write("^C\r\n");
          session.buffer = "";
          session.cursor = 0;
          writePrompt();
          break;
        }
        if (char < " ") continue;
        session.buffer =
          session.buffer.slice(0, session.cursor) + char + session.buffer.slice(session.cursor);
        session.cursor += 1;
      }
      if (!session.running) redrawLine();
    });

    const socket = new WebSocket(wsUrl(`/ws/terminal/${id}`));
    socketRef.current = socket;
    socket.onopen = () => {
      if (!disposed) setState("connected");
    };
    socket.onclose = () => {
      if (disposed) return;
      setState("disconnected");
      session.running = false;
      setRunning(false);
      terminal.write("\r\n\x1b[38;5;244m[vitestl] Terminal stream closed.\x1b[0m\r\n");
    };
    socket.onerror = () => {
      if (disposed) return;
      setState("error");
      terminal.write("\r\n\x1b[31m[vitestl] Terminal connection failed.\x1b[0m\r\n");
    };
    socket.onmessage = (event) => {
      if (disposed) return;
      let message: any;
      try {
        message = JSON.parse(event.data);
      } catch {
        terminal.write(event.data);
        return;
      }
      if (message.event === "terminal ready") {
        const ready = message.data as TerminalInfo;
        setInfo(ready);
        setSudo(ready.sudo);
        session.sudo = ready.sudo;
        session.cwd = ready.cwd || "/";
        setCwd(session.cwd);
        setState("connected");
        terminal.writeln("\x1b[38;5;179mVITESTERTL shell workspace\x1b[0m");
        terminal.writeln(
          "\x1b[38;5;242mCommands run as the panel service account inside the server directory.\x1b[0m"
        );
        if (ready.sudo) {
          terminal.writeln(
            "\x1b[38;5;222msudo is enabled; commands use non-interactive elevation.\x1b[0m"
          );
        }
        writePrompt();
        window.setTimeout(() => terminal.focus(), 20);
        return;
      }
      if (message.event === "terminal output") {
        writeOutput(String(message.data || ""));
        return;
      }
      if (message.event === "terminal exit") {
        const wasRunning = session.running;
        session.running = false;
        setRunning(false);
        session.cwd = String(message.cwd || session.cwd);
        setCwd(session.cwd);
        const code = Number(message.code || 0);
        finishLine();
        if (code !== 0) {
          terminal.write(
            `\x1b[38;5;244m[exit ${code}${message.timed_out ? " · timed out" : ""}${message.truncated ? " · truncated" : ""}]\x1b[0m\r\n`
          );
        }
        if (wasRunning || session.lastCommand) {
          setLastRun({
            command: session.lastCommand,
            code,
            duration_ms: Number(message.duration_ms || 0),
            sudo: Boolean(message.sudo),
            timed_out: Boolean(message.timed_out),
            truncated: Boolean(message.truncated),
          });
        }
        writePrompt();
        return;
      }
      if (message.event === "terminal error") {
        terminal.write(`\r\n\x1b[31m[vitestl] ${message.message}\x1b[0m\r\n`);
        if (!session.running) writePrompt();
        return;
      }
      if (message.event === "error") {
        setState("error");
        terminal.write(`\r\n\x1b[31m[vitestl] ${message.message}\x1b[0m\r\n`);
      }
    };

    const resize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore resize while the panel is not visible */
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      disposable.dispose();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      promptRef.current = null;
      runRef.current = null;
      insertRef.current = null;
      fitRef.current = null;
      socket.close();
      terminal.dispose();
      termRef.current = null;
      socketRef.current = null;
    };
  }, [id, connectionNonce, server.name, user.username]);

  const canToggleSudo = info?.can_toggle_sudo ?? user.role === "admin";
  const quickCommands =
    info?.platform === "Windows"
      ? [
          { label: "List files", command: "Get-ChildItem -Force" },
          { label: "Disk usage", command: "Get-PSDrive -PSProvider FileSystem" },
          { label: "Processes", command: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12" },
        ]
      : [
          { label: "List files", command: "ls -lah" },
          { label: "Disk usage", command: "df -h ." },
          { label: "Largest entries", command: "du -sh * .[!.]* 2>/dev/null | sort -h | tail -n 12" },
          { label: "Top processes", command: "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 12" },
        ];

  async function changeSudo(enabled: boolean) {
    const response = await api.setTerminalSudo(id, enabled);
    setInfo(response.data);
    setSudo(response.data.sudo);
    sessionRef.current.sudo = response.data.sudo;
    sessionRef.current.buffer = "";
    sessionRef.current.cursor = 0;
    promptRef.current?.(
      enabled
        ? "\x1b[38;5;222msudo enabled. New commands run elevated.\x1b[0m"
        : "\x1b[38;5;242msudo disabled. New commands run as the service account.\x1b[0m"
    );
    await onSudoChanged();
    notify(enabled ? "Sudo enabled for this server" : "Sudo disabled for this server");
  }

  const readTranscript = useCallback(() => {
    const terminal = termRef.current;
    if (!terminal) return "";
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (line) lines.push(line.translateToString(true));
    }
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(-12000);
  }, []);

  const copyTranscript = useCallback(async () => {
    const transcript = readTranscript();
    if (!transcript) {
      notify("The terminal buffer is empty", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(transcript);
      notify("Terminal transcript copied");
    } catch {
      notify("Clipboard access was blocked by the browser", "error");
    }
  }, [readTranscript]);

  const downloadTranscript = useCallback(() => {
    const transcript = readTranscript();
    if (!transcript) {
      notify("The terminal buffer is empty", "info");
      return;
    }
    const blob = new Blob([`${transcript}\n`], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${(server.name || "server")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .toLowerCase()}-terminal.log`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    notify("Terminal log downloaded");
  }, [readTranscript, server.name]);

  const insertCommand = useCallback((command: string) => {
    if (sessionRef.current.running) {
      notify("Wait for the running command to finish", "info");
      return;
    }
    if (!command.trim()) return;
    if (command.trim().includes("\n")) {
      notify("Multi-line snippets must be copied and pasted manually", "info");
      return;
    }
    insertRef.current?.(command);
  }, []);

  const explainSelection = useCallback(() => {
    const selection = termRef.current?.getSelection()?.trim();
    if (!selection) {
      notify("Select terminal text first, then choose Explain selection", "info");
      return;
    }
    setAiSeed({ text: selection, nonce: Date.now() + Math.random() });
    setWorkbenchTab("copilot");
  }, []);

  const changeFont = useCallback((delta: number) => {
    setFontSize((current) => {
      const next = Math.min(20, Math.max(10, Math.round((current + delta) * 2) / 2));
      if (termRef.current) termRef.current.options.fontSize = next;
      window.setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore while the pane is hidden */
        }
      }, 40);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    }, 80);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [fullscreen]);

  const stateTone = state === "connected" ? "running" : state === "error" ? "error" : "warning";

  return (
    <div
      className={`terminal-layout terminal-layout-pro ${fullscreen ? "is-fullscreen" : ""}`}
    >
      <div className="terminal-card terminal-card-pro">
        <div className="terminal-bar terminal-bar-pro">
          <div className="terminal-brand">
            <span className="terminal-brand-mark">
              <Icon name="square-terminal" />
            </span>
            <span className="terminal-brand-copy">
              <strong>{server.name}</strong>
              <em>shell workspace</em>
            </span>
          </div>
          <span className="terminal-cwd" title={`Server directory: ${cwd}`}>
            <Icon name="folder-tree" />
            <span className="mono">{cwd === "/" ? "~" : `~${cwd}`}</span>
          </span>
          <span className="terminal-running">
            {running ? (
              <>
                <Icon name="circle-notch" className="spin" /> running
              </>
            ) : (
              <>
                <Icon name="keyboard" /> ready
              </>
            )}
          </span>
          <span className={`terminal-state ${state}`}>
            <span className={`status-dot ${stateTone}`} />
            {state}
          </span>
          <div className="terminal-tools">
            <div className="terminal-font-group" role="group" aria-label="Terminal font size">
              <button type="button" onClick={() => changeFont(-0.5)} title="Decrease font size">
                A-
              </button>
              <span>{fontSize}</span>
              <button type="button" onClick={() => changeFont(0.5)} title="Increase font size">
                A+
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              title="Explain selected text with the copilot"
              onClick={explainSelection}
            >
              <Icon name="quote-left" />
            </button>
            <button type="button" className="icon-btn" title="Copy transcript" onClick={copyTranscript}>
              <Icon name="copy" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Download transcript"
              onClick={downloadTranscript}
            >
              <Icon name="download" />
            </button>
            <button
              type="button"
              className={`icon-btn ${fullscreen ? "is-active" : ""}`}
              title={fullscreen ? "Exit full screen" : "Full screen workspace"}
              onClick={() => setFullscreen((value) => !value)}
            >
              <Icon name={fullscreen ? "compress" : "expand"} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Reconnect terminal"
              onClick={() => setConnectionNonce((value) => value + 1)}
            >
              <Icon name="rotate-right" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Clear terminal"
              onClick={() => {
                termRef.current?.clear();
                promptRef.current?.();
              }}
            >
              <Icon name="eraser" />
            </button>
          </div>
        </div>
        <div className="terminal-host terminal-host-pro" ref={host} />
        <div className="terminal-footbar">
          <div className="terminal-keys">
            <span><kbd>Enter</kbd> run</span>
            <span><kbd>↑</kbd><kbd>↓</kbd> history</span>
            <span><kbd>Ctrl</kbd>+<kbd>C</kbd> cancel</span>
            <span><kbd>Ctrl</kbd>+<kbd>L</kbd> clear</span>
          </div>
          <div className="terminal-run-state">
            {lastRun ? (
              <>
                <span className={`terminal-exit ${lastRun.code === 0 ? "ok" : "bad"}`}>
                  <Icon name={lastRun.code === 0 ? "circle-check" : "circle-exclamation"} />
                  exit {lastRun.code}
                </span>
                <span className="terminal-run-meta">
                  {lastRun.duration_ms}ms
                  {lastRun.sudo ? " · sudo" : ""}
                  {lastRun.timed_out ? " · timed out" : ""}
                  {lastRun.truncated ? " · truncated" : ""}
                </span>
                <code title={lastRun.command}>{lastRun.command}</code>
              </>
            ) : (
              <span className="terminal-idle">
                <Icon name="keyboard" /> ready for input
              </span>
            )}
            <span className="terminal-foot-note">
              <Icon name={sudo ? "shield-halved" : "user-shield"} />
              {sudo ? "elevated" : "service account"}
            </span>
          </div>
        </div>
      </div>

      <aside className="terminal-workbench">
        <div className="terminal-workbench-tabs" role="tablist" aria-label="Terminal workspace">
          {WORKBENCH_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={workbenchTab === item.id}
              className={workbenchTab === item.id ? "active" : ""}
              onClick={() => setWorkbenchTab(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="terminal-workbench-body">
          {workbenchTab === "copilot" && (
            <AiCopilot
              serverId={id}
              serverName={server.name}
              getContext={readTranscript}
              onInsert={insertCommand}
              seed={aiSeed}
              canConfigure={user.role === "admin"}
              cwd={cwd}
              sudo={sudo}
            />
          )}
          {workbenchTab === "session" && (
            <div className="terminal-workbench-scroll">
              <div className="info-card terminal-access-card">
                <div className="info-card-head">
                  <span className="eyebrow">Session</span>
                  <span className={`pill ${state === "connected" ? "pill-ok" : "pill-warning"}`}>
                    {state}
                  </span>
                </div>
                <dl className="info-list">
                  <div><dt>Account</dt><dd>{user.username} · {user.role === "admin" ? "administrator" : "owner"}</dd></div>
                  <div><dt>Shell</dt><dd>{info?.shell || "connecting"}</dd></div>
                  <div><dt>Directory</dt><dd className="mono">{cwd === "/" ? "~" : `~${cwd}`}</dd></div>
                  <div><dt>Timeout</dt><dd>{info?.timeout_seconds || 120}s per command</dd></div>
                  <div><dt>Node</dt><dd>node-{String(server.node_id).padStart(2, "0")}</dd></div>
                </dl>
                <p className="terminal-note">
                  Shell activity is recorded in this server's activity log. The terminal is scoped to
                  the server directory, but it is not a container boundary.
                </p>
              </div>

              <div className="info-card terminal-sudo-card">
                <div className="info-card-head">
                  <span className="eyebrow">Privilege</span>
                  <span className={`pill ${sudo ? "pill-danger" : "pill-neutral"}`}>
                    {sudo ? "sudo on" : "sudo off"}
                  </span>
                </div>
                {canToggleSudo ? (
                  <ConfirmButton
                    className={`sudo-toggle ${sudo ? "is-on" : "is-off"}`}
                    icon=""
                    title={sudo ? "Disable sudo for this server?" : "Enable sudo for this server?"}
                    description={
                      sudo
                        ? "New terminal commands will run as the panel service account instead of elevated."
                        : "New terminal commands will use sudo -n. The panel service account must already have NOPASSWD configured; enabling this control does not modify sudoers or grant operating-system privileges."
                    }
                    confirmLabel={sudo ? "Disable sudo" : "Enable sudo"}
                    tone={sudo ? "danger" : "warning"}
                    disabled={!sudo && !info?.sudo_available}
                    onConfirm={() => changeSudo(!sudo)}
                  >
                    <span className="sudo-switch-track"><i /></span>
                    <span className="sudo-switch-copy">
                      <strong>{sudo ? "Elevated shell" : "Standard shell"}</strong>
                      <em>
                        {sudo
                          ? "Next commands run with sudo -n"
                          : info && !info.sudo_available
                            ? "sudo is unavailable on this node"
                            : "Administrator-controlled elevation"}
                      </em>
                    </span>
                  </ConfirmButton>
                ) : (
                  <div className={`sudo-toggle is-readonly ${sudo ? "is-on" : "is-off"}`}>
                    <span className="sudo-switch-track"><i /></span>
                    <span className="sudo-switch-copy">
                      <strong>{sudo ? "Elevated shell" : "Standard shell"}</strong>
                      <em>{sudo ? "Enabled by an administrator" : "Administrators can enable sudo"}</em>
                    </span>
                  </div>
                )}
                <p className="terminal-note">
                  Sudo uses non-interactive execution. The panel never edits sudoers and never grants
                  OS privileges from the web interface.
                </p>
              </div>
            </div>
          )}
          {workbenchTab === "commands" && (
            <div className="terminal-workbench-scroll">
              <div className="info-card terminal-quick-card">
                <div className="info-card-head">
                  <span className="eyebrow">Quick commands</span>
                  <span className="terminal-quick-hint">insert, then run</span>
                </div>
                <div className="terminal-quick-list">
                  {quickCommands.map((item) => (
                    <button
                      type="button"
                      key={item.label}
                      className="terminal-quick-btn"
                      disabled={state !== "connected"}
                      onClick={() => insertRef.current?.(item.command)}
                    >
                      <Icon name="arrow-turn-down" />
                      <span>{item.label}</span>
                      <code>{item.command}</code>
                    </button>
                  ))}
                </div>
              </div>

              <div className="info-card terminal-history-card">
                <div className="info-card-head">
                  <span className="eyebrow">Command history</span>
                  <span className="pill pill-neutral">{recent.length}</span>
                </div>
                {recent.length ? (
                  <div className="terminal-history-list">
                    {recent.map((command, index) => (
                      <button
                        type="button"
                        key={`${command}-${index}`}
                        onClick={() => insertRef.current?.(command)}
                        disabled={state !== "connected"}
                        title="Insert at the terminal prompt"
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <code>{command}</code>
                        <Icon name="arrow-turn-down" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="terminal-note">
                    Commands you run in this session appear here. Select one to put it back at the
                    prompt for review.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function FilesPane({ id }: { id: string }) {
  const can = useServerCan();
  const [directory, setDirectory] = useState("/");
  const [entries, setEntries] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveName, setArchiveName] = useState("");
  const [chmodOpen, setChmodOpen] = useState(false);
  const [chmodMode, setChmodMode] = useState("644");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySource, setCopySource] = useState("");
  const [copyName, setCopyName] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const parts = useMemo(() => directory.split("/").filter(Boolean), [directory]);

  const load = useCallback(async (path = directory) => {
    setLoading(true);
    try {
      const response = await api.files(id, path);
      setEntries(response.data);
      setDirectory(path);
      setEditing(null);
      setDirty(false);
      setSelected(new Set());
    } catch (err: any) {
      notify(err.message || "Unable to list files", "error");
    } finally {
      setLoading(false);
    }
  }, [directory, id]);

  useEffect(() => {
    load("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!editing) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, content]);

  async function openEntry(entry: any) {
    const next = joinPath(directory, entry.name);
    if (!entry.is_file) {
      await load(next);
      return;
    }
    try {
      const response = await api.fileContents(id, next);
      setEditing(next);
      setContent(response.content);
      setDirty(false);
      window.setTimeout(() => editorRef.current?.focus(), 60);
    } catch (err: any) {
      notify(err.message || "Unable to open file", "error");
    }
  }

  async function save() {
    if (!editing) return;
    setBusy("save");
    try {
      await api.fileSave(id, editing, content);
      setDirty(false);
      notify("File saved");
    } catch (err: any) {
      notify(err.message || "Unable to save file", "error");
    } finally {
      setBusy("");
    }
  }

  async function create(directoryFlag: boolean) {
    if (!name.trim()) {
      notify("Enter a file or folder name first", "info");
      return;
    }
    setBusy("create");
    try {
      await api.fileCreate(id, directory, name.trim(), directoryFlag);
      setName("");
      notify(directoryFlag ? "Folder created" : "File created");
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to create entry", "error");
    } finally {
      setBusy("");
    }
  }

  async function remove(entryName: string) {
    await api.fileDelete(id, directory, [entryName]);
    notify("Entry deleted");
    await load(directory);
  }

  function openRename(entryName: string) {
    setRenameTarget(entryName);
    setRenameValue(entryName);
    setRenameOpen(true);
  }

  async function rename() {
    if (!renameValue.trim() || renameValue === renameTarget) {
      setRenameOpen(false);
      return;
    }
    setBusy("rename");
    try {
      await api.fileRename(id, directory, renameTarget, renameValue.trim());
      setRenameOpen(false);
      notify("Entry renamed");
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to rename entry", "error");
    } finally {
      setBusy("");
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    try {
      for (const file of Array.from(files)) {
        await api.fileUpload(id, directory, file);
      }
      notify(`${files.length} file${files.length === 1 ? "" : "s"} uploaded`);
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Upload failed", "error");
    } finally {
      setBusy("");
    }
  }

  function toggleSelected(entryName: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(entryName)) next.delete(entryName);
      else next.add(entryName);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === entries.length ? new Set() : new Set(entries.map((entry) => entry.name))
    );
  }

  async function removeSelected() {
    if (!selected.size) return;
    setBusy("delete");
    try {
      await api.fileDelete(id, directory, Array.from(selected));
      notify(`${selected.size} entr${selected.size === 1 ? "y" : "ies"} deleted`);
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to delete the selection", "error");
    } finally {
      setBusy("");
    }
  }

  function openArchive() {
    const base = selected.size === 1 ? Array.from(selected)[0].replace(/\.[^.]+$/, "") : "archive";
    setArchiveName(`${base}.zip`);
    setArchiveOpen(true);
  }

  async function archive() {
    if (!selected.size || !archiveName.trim()) return;
    setBusy("archive");
    try {
      const response = await api.fileCompress(id, directory, Array.from(selected), archiveName.trim());
      setArchiveOpen(false);
      notify(`${response.name} created`);
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to create archive", "error");
    } finally {
      setBusy("");
    }
  }

  async function extract(entry: any) {
    setBusy(`extract:${entry.name}`);
    try {
      const response = await api.fileExtract(id, directory, joinPath(directory, entry.name));
      notify(`${response.entries} entr${response.entries === 1 ? "y" : "ies"} extracted`);
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to extract archive", "error");
    } finally {
      setBusy("");
    }
  }

  function openChmod(entryName?: string) {
    if (entryName && !selected.has(entryName)) setSelected(new Set([entryName]));
    setChmodMode("644");
    setChmodOpen(true);
  }

  async function chmod() {
    if (!selected.size) return;
    setBusy("chmod");
    try {
      const response = await api.fileChmod(id, directory, Array.from(selected), chmodMode.trim());
      setChmodOpen(false);
      notify(`Permissions changed on ${response.changed} entr${response.changed === 1 ? "y" : "ies"}`);
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to change permissions", "error");
    } finally {
      setBusy("");
    }
  }

  function openCopy(entryName: string) {
    const suffixIndex = entryName.lastIndexOf(".");
    const suggested =
      suffixIndex > 0
        ? `${entryName.slice(0, suffixIndex)} copy${entryName.slice(suffixIndex)}`
        : `${entryName} copy`;
    setCopySource(entryName);
    setCopyName(suggested);
    setCopyOpen(true);
  }

  async function copy() {
    if (!copySource || !copyName.trim()) return;
    setBusy("copy");
    try {
      await api.fileCopy(id, directory, copySource, copyName.trim());
      setCopyOpen(false);
      notify("Entry copied");
      await load(directory);
    } catch (err: any) {
      notify(err.message || "Unable to copy entry", "error");
    } finally {
      setBusy("");
    }
  }

  if (editing) {
    return (
      <div className="file-editor">
        <div className="editor-bar">
          <div className="editor-file">
            <span className="file-icon tone-code"><Icon name="file-code" /></span>
            <div>
              <code>{editing}</code>
              <span>{dirty ? "Unsaved changes" : "Saved"} · Ctrl+S to save</span>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => { setEditing(null); setDirty(false); }}>
              <Icon name="xmark" /> Close
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy === "save"}>
              <Icon name={busy === "save" ? "circle-notch" : "floppy-disk"} className={busy === "save" ? "spin" : ""} />
              Save changes
            </button>
          </div>
        </div>
        <textarea
          ref={editorRef}
          className="editor"
          value={content}
          onChange={(event) => { setContent(event.target.value); setDirty(true); }}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="files-pane">
      <div className="files-toolbar">
        <div className="files-path">
          <button type="button" onClick={() => load("/")} title="Server root">
            <Icon name="house" />
          </button>
          {parts.map((part, index) => (
            <span key={`${part}-${index}`}>
              <Icon name="chevron-right" className="path-sep" />
              <button type="button" onClick={() => load("/" + parts.slice(0, index + 1).join("/"))}>{part}</button>
            </span>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={() => load(directory)} title="Refresh directory">
          <Icon name="arrows-rotate" className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="files-actions">
        {can("file.create") && (
          <>
            <div className="inline-input">
              <Icon name="pen" />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="New file or folder name"
                onKeyDown={(event) => {
                  if (event.key === "Enter") create(false);
                }}
              />
            </div>
            <button type="button" className="btn" onClick={() => create(false)} disabled={busy === "create"}>
              <Icon name="file-circle-plus" /> New file
            </button>
            <button type="button" className="btn" onClick={() => create(true)} disabled={busy === "create"}>
              <Icon name="folder-plus" /> New folder
            </button>
          </>
        )}
        {can("file.upload") && (
          <label className="btn btn-ghost upload-button">
            <Icon name={busy === "upload" ? "circle-notch" : "cloud-arrow-up"} className={busy === "upload" ? "spin" : ""} />
            Upload
            <input type="file" hidden multiple onChange={(event) => { upload(event.target.files); event.target.value = ""; }} />
          </label>
        )}
        <span className="files-count">{entries.length} item{entries.length === 1 ? "" : "s"}</span>
      </div>

      {selected.size > 0 && (
        <div className="file-selection-bar">
          <span><Icon name="square-check" /> {selected.size} selected</span>
          {can("file.archive") && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={openArchive}>
              <Icon name="file-zipper" /> Archive
            </button>
          )}
          {can("file.chmod") && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openChmod()}>
              <Icon name="key" /> Permissions
            </button>
          )}
          {can("file.delete") && (
            <ConfirmButton
              className="btn btn-danger-ghost btn-sm"
              icon="trash-can"
              title={`Delete ${selected.size} selected entr${selected.size === 1 ? "y" : "ies"}?`}
              description="The selected files and folders will be permanently removed from the server volume."
              confirmLabel="Delete selection"
              onConfirm={removeSelected}
            >
              Delete
            </ConfirmButton>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="card file-table-card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading directory</div>
        ) : (
          <table className="table file-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all entries"
                    checked={entries.length > 0 && selected.size === entries.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const info = fileIcon(entry);
                const isArchive = entry.is_file && /\.(zip|tar|gz|tgz|bz2|xz)$/i.test(entry.name);
                return (
                  <tr key={entry.name} className={selected.has(entry.name) ? "is-selected" : ""}>
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.name}`}
                        checked={selected.has(entry.name)}
                        onChange={() => toggleSelected(entry.name)}
                      />
                    </td>
                    <td>
                      <button type="button" className="file-name" onClick={() => openEntry(entry)}>
                        <span className={`file-icon tone-${info.tone}`}><Icon name={info.icon} /></span>
                        <span>{entry.name}</span>
                        {entry.is_symlink && <Icon name="link" className="muted" />}
                      </button>
                    </td>
                    <td className="mono muted">{entry.is_file ? fmtBytes(entry.size) : "-"}</td>
                    <td className="muted">{fmtDate(entry.modified_at)}</td>
                    <td>
                      <div className="row-actions">
                        {entry.is_file && can("file.download") && (
                          <button type="button" className="icon-btn" title="Download" onClick={() => api.fileDownload(id, joinPath(directory, entry.name), entry.name)}>
                            <Icon name="download" />
                          </button>
                        )}
                        {isArchive && can("file.extract") && (
                          <button type="button" className="icon-btn" title="Extract here" disabled={busy === `extract:${entry.name}`} onClick={() => extract(entry)}>
                            <Icon name={busy === `extract:${entry.name}` ? "circle-notch" : "file-export"} className={busy === `extract:${entry.name}` ? "spin" : ""} />
                          </button>
                        )}
                        {can("file.create") && (
                          <button type="button" className="icon-btn" title="Copy" onClick={() => openCopy(entry.name)}>
                            <Icon name="copy" />
                          </button>
                        )}
                        {can("file.chmod") && (
                          <button type="button" className="icon-btn" title="Change permissions" onClick={() => openChmod(entry.name)}>
                            <Icon name="key" />
                          </button>
                        )}
                        {can("file.update") && (
                          <button type="button" className="icon-btn" title="Rename" onClick={() => openRename(entry.name)}>
                            <Icon name="pen" />
                          </button>
                        )}
                        {can("file.delete") && (
                          <ConfirmButton
                            className="icon-btn danger-hover"
                            icon="trash-can"
                            title={`Delete ${entry.name}?`}
                            description={entry.is_file ? "This file will be permanently removed from the server volume." : "This folder and everything inside it will be permanently removed."}
                            confirmLabel="Delete"
                            onConfirm={() => remove(entry.name)}
                          >
                            <span className="sr-only">Delete</span>
                          </ConfirmButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!entries.length && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState icon="folder-open" title="This directory is empty" description="Create a file or upload an archive to get started." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename entry"
        description={`Renaming in ${directory}`}
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRenameOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={rename} disabled={busy === "rename"}>
              <Icon name="check" /> Rename
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="rename-input">New name</label>
          <input id="rename-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") rename(); }} />
        </div>
      </Modal>

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Create archive"
        description={`${selected.size} selected item${selected.size === 1 ? "" : "s"} in ${directory}`}
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setArchiveOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={archive} disabled={busy === "archive" || !archiveName.trim()}>
              <Icon name={busy === "archive" ? "circle-notch" : "file-zipper"} className={busy === "archive" ? "spin" : ""} /> Create archive
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="archive-name">Archive name</label>
          <input
            id="archive-name"
            value={archiveName}
            onChange={(event) => setArchiveName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") archive(); }}
            placeholder="backup.zip"
          />
          <span className="field-help">Supports .zip and .tar.gz. The archive is written to {directory}.</span>
        </div>
      </Modal>

      <Modal
        open={chmodOpen}
        onClose={() => setChmodOpen(false)}
        title="Change permissions"
        description={`${selected.size} selected item${selected.size === 1 ? "" : "s"}`}
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setChmodOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={chmod} disabled={busy === "chmod" || !/^[0-7]{3,4}$/.test(chmodMode.trim())}>
              <Icon name={busy === "chmod" ? "circle-notch" : "key"} className={busy === "chmod" ? "spin" : ""} /> Apply
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="chmod-mode">Octal mode</label>
          <input
            id="chmod-mode"
            value={chmodMode}
            onChange={(event) => setChmodMode(event.target.value.replace(/[^0-7]/g, "").slice(0, 4))}
            onKeyDown={(event) => { if (event.key === "Enter") chmod(); }}
            placeholder="644"
            inputMode="numeric"
            className="mono"
          />
          <span className="field-help">Three or four octal digits, for example 644, 755 or 0755.</span>
        </div>
        <div className="chmod-presets">
          {["644", "664", "755", "775"].map((mode) => (
            <button key={mode} type="button" className={`chip ${chmodMode === mode ? "is-active" : ""}`} onClick={() => setChmodMode(mode)}>
              {mode}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Copy entry"
        description={`Copy ${copySource} to a new name in ${directory}`}
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCopyOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={copy} disabled={busy === "copy" || !copyName.trim()}>
              <Icon name={busy === "copy" ? "circle-notch" : "copy"} className={busy === "copy" ? "spin" : ""} /> Copy
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="copy-name">Destination name</label>
          <input
            id="copy-name"
            value={copyName}
            onChange={(event) => setCopyName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") copy(); }}
          />
        </div>
      </Modal>
    </div>
  );
}

function DatabasesPane({ id }: { id: string }) {
  const can = useServerCan();
  const [rows, setRows] = useState<ServerDatabaseRow[]>([]);
  const [hosts, setHosts] = useState<DatabaseHostOption[]>([]);
  const [limit, setLimit] = useState(2);
  const [name, setName] = useState("");
  const [hostId, setHostId] = useState<"local" | number>("local");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.databases(id);
      setRows(response.data);
      setHosts(response.meta.hosts || []);
      setLimit(response.meta.limit || 2);
      if (response.meta.hosts?.length && hostId === "local") {
        setHostId(response.meta.hosts[0].id);
      }
    } catch (err: any) {
      notify(err.message || "Unable to load databases", "error");
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const atLimit = rows.length >= limit;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || atLimit) return;
    setBusy(true);
    try {
      await api.createDatabase(
        id,
        name.trim(),
        hostId === "local" ? null : hostId,
        hostId === "local" ? "sqlite" : undefined
      );
      setName("");
      notify("Database created");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to create database", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(dbId: number) {
    await api.deleteDatabase(id, dbId);
    notify("Database deleted");
    await load();
  }

  return (
    <div className="pane-stack">
      <div className="pane-intro">
        <div>
          <h2>Databases</h2>
          <p>Provision MySQL, MariaDB or local SQLite credentials for this workload.</p>
        </div>
        <span className={`pill ${atLimit ? "pill-warn" : "pill-neutral"}`}>
          <Icon name="database" /> {rows.length} of {limit} used
        </span>
      </div>
      {can("database.create") && (
        <form className="inline-form database-form" onSubmit={create}>
          <div className="inline-input">
            <Icon name="database" />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Database name"
              disabled={atLimit}
            />
          </div>
          <label className="select-wrap">
            <Icon name="server" />
            <select
              value={hostId}
              onChange={(event) => setHostId(event.target.value === "local" ? "local" : Number(event.target.value))}
              disabled={atLimit}
              aria-label="Database host"
            >
              <option value="local">Local SQLite</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name} ({host.engine} at {host.host}:{host.port})
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || atLimit || !name.trim()}>
            <Icon name={busy ? "circle-notch" : "plus"} className={busy ? "spin" : ""} /> Create database
          </button>
        </form>
      )}
      {atLimit && (
        <div className="notice notice-warn">
          <Icon name="circle-info" />
          <span>This server has reached its database limit of {limit}. Delete an existing database to create another.</span>
        </div>
      )}
      <div className="card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading databases</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Database</th><th>Engine</th><th>Username</th><th>Password</th><th>Endpoint</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className="name-with-icon"><span className="file-icon tone-archive"><Icon name="database" /></span><code>{row.name}</code></span></td>
                  <td>
                    <span className={`pill ${row.engine === "sqlite" ? "pill-neutral" : "pill-ok"}`}>
                      {row.engine === "sqlite" ? "SQLite" : row.engine === "mysql" ? "MySQL" : "MariaDB"}
                    </span>
                  </td>
                  <td><span className="copyable"><code>{row.username}</code><CopyButton value={row.username} label="Copy username" /></span></td>
                  <td><PasswordValue value={row.password} /></td>
                  <td className="mono muted">{row.host}:{row.port}</td>
                  <td>
                    {can("database.delete") && (
                      <ConfirmButton
                        className="icon-btn danger-hover"
                        icon="trash-can"
                        title={`Delete database ${row.name}?`}
                        description={
                          row.engine === "sqlite"
                            ? "Credentials and the local SQLite file will be removed. This cannot be undone."
                            : `The database and its MySQL user will be dropped from ${row.host_name || "the database host"}. This cannot be undone.`
                        }
                        confirmLabel="Delete database"
                        onConfirm={() => remove(row.id)}
                      >
                        <span className="sr-only">Delete</span>
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6}><EmptyState icon="database" title="No databases" description="Create a database to generate credentials and a local SQLite file or a managed MySQL database." /></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const SCHEDULE_ACTIONS = [
  { id: "start", label: "Start server", icon: "play" },
  { id: "stop", label: "Stop server", icon: "stop" },
  { id: "restart", label: "Restart server", icon: "rotate-right" },
  { id: "kill", label: "Kill server", icon: "power-off" },
  { id: "backup", label: "Create backup", icon: "box-archive" },
  { id: "command", label: "Send console command", icon: "terminal" },
  { id: "delete_files", label: "Delete files", icon: "trash-can" },
];

type ScheduleTaskDraft = {
  action: string;
  payload: string;
  time_offset: number;
  continue_on_failure: boolean;
};

function blankTask(): ScheduleTaskDraft {
  return { action: "restart", payload: "", time_offset: 0, continue_on_failure: true };
}

function scheduleIcon(action: string): string {
  return SCHEDULE_ACTIONS.find((item) => item.id === action)?.icon || "clock";
}

function scheduleActionLabel(action: string): string {
  return SCHEDULE_ACTIONS.find((item) => item.id === action)?.label || action;
}

function SchedulesPane({ id }: { id: string }) {
  const can = useServerCan();
  const [rows, setRows] = useState<Schedule[]>([]);
  const [name, setName] = useState("Nightly restart");
  const [cron, setCron] = useState("0 4 * * *");
  const [tasks, setTasks] = useState<ScheduleTaskDraft[]>([blankTask()]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.schedules(id)).data);
    } catch (err: any) {
      notify(err.message || "Unable to load schedules", "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setName("Nightly restart");
    setCron("0 4 * * *");
    setTasks([blankTask()]);
    setEditingId(null);
  }

  function startEdit(row: Schedule) {
    setEditingId(row.id);
    setName(row.name);
    setCron(row.cron);
    const source = row.tasks?.length
      ? row.tasks
      : [{ action: row.action || "restart", payload: row.payload || "", time_offset: 0, continue_on_failure: true }];
    setTasks(
      source.map((task) => ({
        action: task.action,
        payload: task.payload || "",
        time_offset: Number(task.time_offset) || 0,
        continue_on_failure: Boolean(Number(task.continue_on_failure)),
      }))
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateTask(index: number, patch: Partial<ScheduleTaskDraft>) {
    setTasks((current) => current.map((task, position) => (position === index ? { ...task, ...patch } : task)));
  }

  function addTask() {
    if (tasks.length >= 20) return;
    setTasks((current) => [...current, blankTask()]);
  }

  function removeTask(index: number) {
    setTasks((current) => (current.length === 1 ? current : current.filter((_, position) => position !== index)));
  }

  function moveTask(index: number, direction: -1 | 1) {
    setTasks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !tasks.length) return;
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        cron: cron.trim(),
        tasks: tasks.map((task) => ({
          action: task.action,
          payload: task.payload,
          time_offset: Math.max(0, Math.min(3600, Number(task.time_offset) || 0)),
          continue_on_failure: task.continue_on_failure,
        })),
      };
      if (editingId) {
        await api.updateSchedule(id, editingId, body);
        notify("Schedule updated");
      } else {
        await api.createSchedule(id, body);
        notify("Schedule created");
      }
      resetForm();
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to save schedule", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: Schedule) {
    try {
      await api.setSchedule(id, row.id, !row.enabled);
      notify(row.enabled ? "Schedule paused" : "Schedule enabled");
      await load();
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  async function runNow(row: Schedule) {
    try {
      const response = await api.runSchedule(id, row.id);
      const failed = (response.tasks || []).filter((task) => task.status === "failed").length;
      notify(
        failed
          ? `${row.name} ran with ${failed} failed task${failed === 1 ? "" : "s"}`
          : `Ran ${row.name}`,
        failed ? "error" : "success"
      );
      await load();
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  const totalOffset = tasks.reduce((sum, task) => sum + Math.max(0, Number(task.time_offset) || 0), 0);
  const canEdit = editingId ? can("schedule.update") : can("schedule.create");

  return (
    <div className="two-pane schedule-pane">
      <form className="card form-card" onSubmit={submit}>
        <div className="card-head">
          <div>
            <h2>{editingId ? "Edit schedule" : "New schedule"}</h2>
            <p>Chain up to 20 ordered tasks with per-task delays and failure handling.</p>
          </div>
          {editingId && <span className="pill pill-warn"><Icon name="pen" /> Editing</span>}
        </div>
        <div className="card-body">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="field">
            <label>Schedule</label>
            <select
              value={CRON_PRESETS.some((preset) => preset.value === cron) ? cron : "custom"}
              onChange={(event) => {
                if (event.target.value !== "custom") setCron(event.target.value);
              }}
            >
              {CRON_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
              <option value="custom">Custom cron expression</option>
            </select>
            <input
              className="mono"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 4 * * *"
              aria-label="Cron expression"
            />
            <span className="field-help">
              Five fields in UTC: minute, hour, day of month, month, weekday.{" "}
              <code>0 4 * * *</code> runs daily at 04:00 and <code>0 4 * * 0</code> every Sunday.
            </span>
          </div>

          <div className="task-builder">
            <div className="task-builder-head">
              <div>
                <strong>Tasks</strong>
                <span>{tasks.length} of 20 | {totalOffset}s combined delay</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addTask} disabled={tasks.length >= 20}>
                <Icon name="plus" /> Add task
              </button>
            </div>
            {tasks.map((task, index) => (
              <div className="task-card" key={index}>
                <div className="task-card-head">
                  <span className="task-index">{index + 1}</span>
                  <select
                    value={task.action}
                    onChange={(event) => updateTask(index, { action: event.target.value, payload: "" })}
                    aria-label={`Task ${index + 1} action`}
                  >
                    {SCHEDULE_ACTIONS.map((action) => (
                      <option key={action.id} value={action.id}>{action.label}</option>
                    ))}
                  </select>
                  <div className="task-card-actions">
                    <button type="button" className="icon-btn" onClick={() => moveTask(index, -1)} disabled={index === 0} title="Move up">
                      <Icon name="arrow-up" />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => moveTask(index, 1)} disabled={index === tasks.length - 1} title="Move down">
                      <Icon name="arrow-down" />
                    </button>
                    <button type="button" className="icon-btn danger-hover" onClick={() => removeTask(index)} disabled={tasks.length === 1} title="Remove task">
                      <Icon name="trash-can" />
                    </button>
                  </div>
                </div>
                {(task.action === "command" || task.action === "delete_files") && (
                  <input
                    value={task.payload}
                    onChange={(event) => updateTask(index, { payload: event.target.value })}
                    placeholder={task.action === "command" ? "say Restarting in five minutes" : "plugins/old-plugin.jar"}
                    required
                    aria-label={task.action === "command" ? "Console command" : "Path to delete"}
                  />
                )}
                <div className="task-card-meta">
                  <label className="task-delay">
                    <span>Delay</span>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      step={5}
                      value={task.time_offset}
                      onChange={(event) =>
                        updateTask(index, {
                          time_offset: Math.max(0, Math.min(3600, Number(event.target.value) || 0)),
                        })
                      }
                    />
                    <span>seconds</span>
                  </label>
                  <label className="task-continue">
                    <input
                      type="checkbox"
                      checked={task.continue_on_failure}
                      onChange={(event) => updateTask(index, { continue_on_failure: event.target.checked })}
                    />
                    Continue if this task fails
                  </label>
                </div>
              </div>
            ))}
            {totalOffset > 7200 && (
              <div className="notice notice-warn">
                <Icon name="circle-exclamation" />
                <span>Combined task delays cannot exceed 7200 seconds.</span>
              </div>
            )}
          </div>

          <div className="btn-row">
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel edit
              </button>
            )}
            <button className="btn btn-primary" disabled={busy || !canEdit || totalOffset > 7200}>
              <Icon name={busy ? "circle-notch" : editingId ? "check" : "plus"} className={busy ? "spin" : ""} />
              {editingId ? "Save schedule" : "Create schedule"}
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <div><h2>Configured schedules</h2><p>{rows.length} automation rule{rows.length === 1 ? "" : "s"}</p></div>
          <button type="button" className="icon-btn" onClick={load} title="Refresh"><Icon name="arrows-rotate" /></button>
        </div>
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading schedules</div>
        ) : (
          <div className="schedule-list">
            {rows.map((row) => (
              <div className={`schedule-row ${row.enabled ? "" : "is-paused"}`} key={row.id}>
                <span className={`schedule-icon ${row.enabled ? "active" : ""}`}><Icon name={scheduleIcon(row.action)} /></span>
                <div className="schedule-body">
                  <strong>{row.name}</strong>
                  <span>
                    <code>{row.cron}</code> | {row.task_count || row.tasks?.length || 1} task
                    {(row.task_count || row.tasks?.length || 1) === 1 ? "" : "s"} |{" "}
                    {row.last_run ? `last run ${timeAgo(row.last_run)}` : "never run"}
                    {row.next_run ? ` | next ${fmtDate(row.next_run)}` : ""}
                  </span>
                  <div className="schedule-task-chips">
                    {(row.tasks || []).slice(0, 4).map((task, index) => (
                      <span className="chip" key={`${row.id}-${index}`}>
                        {task.time_offset ? `+${task.time_offset}s ` : ""}{scheduleActionLabel(task.action)}
                      </span>
                    ))}
                    {(row.tasks?.length || 0) > 4 && <span className="chip">+{(row.tasks?.length || 0) - 4} more</span>}
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" className={`switch ${row.enabled ? "on" : ""}`} onClick={() => toggle(row)} title={row.enabled ? "Pause schedule" : "Enable schedule"} disabled={!can("schedule.update")}>
                    <span />
                  </button>
                  {can("schedule.update") && (
                    <button type="button" className="icon-btn" onClick={() => runNow(row)} title="Run now"><Icon name="play" /></button>
                  )}
                  {can("schedule.update") && (
                    <button type="button" className="icon-btn" onClick={() => startEdit(row)} title="Edit schedule"><Icon name="pen" /></button>
                  )}
                  {can("schedule.delete") && (
                    <ConfirmButton
                      className="icon-btn danger-hover"
                      icon="trash-can"
                      title={`Delete ${row.name}?`}
                      description="The automation rule and its tasks will be removed."
                      confirmLabel="Delete schedule"
                      onConfirm={async () => {
                        await api.deleteSchedule(id, row.id);
                        notify("Schedule deleted");
                        if (editingId === row.id) resetForm();
                        await load();
                      }}
                    >
                      <span className="sr-only">Delete</span>
                    </ConfirmButton>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && <EmptyState icon="clock" title="No schedules" description="Create a schedule to keep this server maintained automatically." />}
          </div>
        )}
      </div>
    </div>
  );
}

const PERMISSION_TEMPLATES: Array<{ label: string; description: string; permissions: string[] }> = [
  {
    label: "Viewer",
    description: "Read-only visibility",
    permissions: ["websocket.connect", "file.read", "database.read", "schedule.read", "allocation.read", "activity.read"],
  },
  {
    label: "Operator",
    description: "Day-to-day operations",
    permissions: [
      "websocket.connect",
      "control.console",
      "control.start",
      "control.stop",
      "control.restart",
      "file.read",
      "file.create",
      "file.update",
      "file.upload",
      "file.download",
      "file.archive",
      "file.extract",
      "backup.read",
      "backup.create",
      "schedule.read",
      "allocation.read",
      "activity.read",
    ],
  },
  {
    label: "Manager",
    description: "Full control except access",
    permissions: [
      "websocket.connect",
      "control.console",
      "control.start",
      "control.stop",
      "control.restart",
      "file.read",
      "file.create",
      "file.update",
      "file.delete",
      "file.upload",
      "file.download",
      "file.archive",
      "file.extract",
      "file.chmod",
      "database.read",
      "database.create",
      "database.delete",
      "backup.read",
      "backup.create",
      "backup.restore",
      "backup.delete",
      "schedule.read",
      "schedule.create",
      "schedule.update",
      "schedule.delete",
      "allocation.read",
      "allocation.create",
      "allocation.update",
      "allocation.delete",
      "startup.read",
      "startup.update",
      "settings.rename",
      "activity.read",
    ],
  },
];

function PermissionPicker({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: PermissionGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(permission: string) {
    if (disabled) return;
    onChange(value.includes(permission) ? value.filter((item) => item !== permission) : [...value, permission]);
  }

  function toggleGroup(group: PermissionGroup) {
    if (disabled) return;
    const ids = group.permissions.map((permission) => permission.id);
    const allSelected = ids.every((permission) => value.includes(permission));
    onChange(
      allSelected
        ? value.filter((permission) => !ids.includes(permission))
        : Array.from(new Set([...value, ...ids]))
    );
  }

  return (
    <div className="permission-groups">
      {groups.map((group) => {
        const ids = group.permissions.map((permission) => permission.id);
        const selectedCount = ids.filter((permission) => value.includes(permission)).length;
        return (
          <section className="permission-group" key={group.group}>
            <div className="permission-group-head">
              <div>
                <strong>{group.group}</strong>
                <span>{selectedCount} of {ids.length} enabled</span>
              </div>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => toggleGroup(group)} disabled={disabled}>
                {selectedCount === ids.length ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="permission-group-grid">
              {group.permissions.map((permission) => (
                <label className={`permission ${value.includes(permission.id) ? "selected" : ""}`} key={permission.id}>
                  <input
                    type="checkbox"
                    checked={value.includes(permission.id)}
                    onChange={() => toggle(permission.id)}
                    disabled={disabled}
                  />
                  <span className="permission-check"><Icon name="check" /></span>
                  <span className="permission-label">
                    {permission.label}
                    <code>{permission.id}</code>
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AccessPane({ id }: { id: string }) {
  const can = useServerCan();
  const [rows, setRows] = useState<any[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["control.console", "file.read"]);
  const [editing, setEditing] = useState<any | null>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.users(id);
      setRows(response.data);
      setGroups(response.meta.permission_groups || []);
    } catch (err: any) {
      notify(err.message || "Unable to load access list", "error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createUser(id, { email: email.trim(), permissions });
      setEmail("");
      setPermissions(["control.console", "file.read"]);
      notify("Subuser invited");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to invite subuser", "error");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(row: any) {
    setEditing(row);
    setEditPermissions(Array.isArray(row.permissions) ? row.permissions : []);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    try {
      await api.updateUser(id, editing.id, { email: editing.email, permissions: editPermissions });
      notify("Permissions updated");
      setEditing(null);
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to update permissions", "error");
    } finally {
      setEditBusy(false);
    }
  }

  function applyTemplate(template: (typeof PERMISSION_TEMPLATES)[number], target: "invite" | "edit") {
    const setter = target === "invite" ? setPermissions : setEditPermissions;
    setter(Array.from(new Set(template.permissions)));
  }

  return (
    <div className="two-pane access-pane">
      {can("user.create") ? (
        <form className="card form-card" onSubmit={invite}>
          <div className="card-head">
            <div><h2>Invite subuser</h2><p>Grant another existing panel account scoped access to this server.</p></div>
          </div>
          <div className="card-body">
            <div className="field">
              <label>Panel account email</label>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@example.com" required />
              <span className="field-help">The account must already exist in the panel. The server owner always keeps full access.</span>
            </div>
            <div className="field">
              <label>Permission templates</label>
              <div className="template-row">
                {PERMISSION_TEMPLATES.map((template) => (
                  <button key={template.label} type="button" className="template-chip" onClick={() => applyTemplate(template, "invite")}>
                    <strong>{template.label}</strong>
                    <span>{template.description}</span>
                  </button>
                ))}
                <button type="button" className="template-chip" onClick={() => setPermissions([])}>
                  <strong>Clear</strong>
                  <span>No permissions</span>
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field-label-row">
                <label>Permissions</label>
                <span className="field-note">{permissions.length} selected</span>
              </div>
              <PermissionPicker groups={groups} value={permissions} onChange={setPermissions} />
            </div>
            <button className="btn btn-primary" disabled={busy || !permissions.length}>
              <Icon name={busy ? "circle-notch" : "user-plus"} className={busy ? "spin" : ""} /> Invite subuser
            </button>
          </div>
        </form>
      ) : (
        <div className="card">
          <div className="card-head"><h2>Access</h2></div>
          <div className="card-body">
            <EmptyState icon="shield" title="Read-only access" description="You can view subusers but not invite or change them." />
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div><h2>Access list</h2><p>Accounts with scoped access to this server.</p></div>
          <span className="pill pill-neutral">{rows.length} subuser{rows.length === 1 ? "" : "s"}</span>
        </div>
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading access list</div>
        ) : (
          <div className="access-list">
            {rows.map((row) => (
              <div className="access-row" key={row.id}>
                <span className="avatar avatar-sm">{String(row.email || "?").slice(0, 1).toUpperCase()}</span>
                <div className="access-body">
                  <strong>{row.email}</strong>
                  <span>{Array.isArray(row.permissions) && row.permissions.length ? plural(row.permissions.length, "permission") : "No permissions assigned"}</span>
                </div>
                <div className="permission-chips">
                  {(Array.isArray(row.permissions) ? row.permissions : []).slice(0, 3).map((permission: string) => (
                    <span className="chip" key={permission}>{permission.split(".")[0]}</span>
                  ))}
                  {(row.permissions?.length || 0) > 3 && <span className="chip">+{(row.permissions?.length || 0) - 3}</span>}
                </div>
                <div className="row-actions">
                  {can("user.update") && (
                    <button type="button" className="icon-btn" title="Edit permissions" onClick={() => openEdit(row)}>
                      <Icon name="pen" />
                    </button>
                  )}
                  {can("user.delete") && (
                    <ConfirmButton className="icon-btn danger-hover" icon="user-minus" title="Remove subuser?" description={`${row.email} will immediately lose access to this server.`} confirmLabel="Remove access" onConfirm={async () => { await api.deleteUser(id, row.id); notify("Subuser removed"); await load(); }}>
                      <span className="sr-only">Remove</span>
                    </ConfirmButton>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && <EmptyState icon="users" title="No subusers" description="Invite a panel account to collaborate on this server." />}
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit subuser permissions"
        description={editing?.email}
        size="wide"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={editBusy || !editPermissions.length}>
              <Icon name={editBusy ? "circle-notch" : "check"} className={editBusy ? "spin" : ""} /> Save permissions
            </button>
          </>
        }
      >
        <div className="field">
          <label>Permission templates</label>
          <div className="template-row">
            {PERMISSION_TEMPLATES.map((template) => (
              <button key={template.label} type="button" className="template-chip" onClick={() => applyTemplate(template, "edit")}>
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </button>
            ))}
            <button type="button" className="template-chip" onClick={() => setEditPermissions([])}>
              <strong>Clear</strong>
              <span>No permissions</span>
            </button>
          </div>
        </div>
        <PermissionPicker groups={groups} value={editPermissions} onChange={setEditPermissions} />
      </Modal>
    </div>
  );
}

function BackupsPane({ id }: { id: string }) {
  const can = useServerCan();
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.backups(id)).data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      await api.createBackup(id);
      notify("Backup archive created");
      await load();
    } catch (err: any) {
      notify(err.message || "Backup failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const totalBytes = rows.reduce((sum, row) => sum + (row.bytes || 0), 0);

  return (
    <div className="pane-stack">
      <div className="pane-intro">
        <div><h2>Backups</h2><p>Point-in-time archives of the complete server volume, compressed and checksummed.</p></div>
        {can("backup.create") && (
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            <Icon name={busy ? "circle-notch" : "box-archive"} className={busy ? "spin" : ""} /> {busy ? "Creating archive" : "Create backup"}
          </button>
        )}
      </div>
      <div className="stat-inline">
        <span><Icon name="box-archive" /> {rows.length} archive{rows.length === 1 ? "" : "s"}</span>
        <span><Icon name="database" /> {fmtBytes(totalBytes)} stored</span>
        <span><Icon name="shield-halved" /> SHA-256 checked</span>
      </div>
      <div className="card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading archives</div>
        ) : (
          <table className="table">
            <thead><tr><th>Archive</th><th>Size</th><th>Checksum</th><th>Created</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="name-with-icon">
                      <span className="file-icon tone-archive"><Icon name="file-zipper" /></span>
                      <span><strong>{row.name}</strong><small className="mono">{row.uuid?.slice(0, 8)}</small></span>
                    </span>
                  </td>
                  <td className="mono">{fmtBytes(row.bytes)}</td>
                  <td className="mono muted">{(row.checksum || "").slice(0, 12)}</td>
                  <td className="muted">{fmtDate(row.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {can("backup.download") && (
                        <button type="button" className="icon-btn" title="Download archive" onClick={() => api.backupDownload(id, row.id, row.name)}><Icon name="download" /></button>
                      )}
                      {can("backup.restore") && (
                        <ConfirmButton className="btn btn-ghost btn-sm" icon="rotate-left" title={`Restore ${row.name}?`} description="Files are extracted over the current server volume. Existing files with the same names will be replaced." confirmLabel="Restore archive" onConfirm={async () => { await api.restoreBackup(id, row.id); notify("Backup restored"); }}>Restore</ConfirmButton>
                      )}
                      {can("backup.delete") && (
                        <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${row.name}?`} description="This archive will be removed from disk permanently." confirmLabel="Delete archive" onConfirm={async () => { await api.deleteBackup(id, row.id); notify("Backup deleted"); await load(); }}>
                          <span className="sr-only">Delete</span>
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5}><EmptyState icon="box-archive" title="No backup archives" description="Create a backup before making changes to your workload files." /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function NetworkPane({ id, server }: { id: string; server: Srv }) {
  const can = useServerCan();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ node_name: string; free: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.network(id);
      setRows(response.data);
      setMeta(response.meta);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true);
    try {
      await api.addAllocation(id);
      notify("Allocation assigned");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to assign allocation", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane-stack">
      <div className="pane-intro">
        <div><h2>Network allocations</h2><p>Ports bound to this server on {meta?.node_name || "its node"}. The primary allocation is used for the public endpoint.</p></div>
        {can("allocation.create") && (
          <button type="button" className="btn btn-primary" onClick={add} disabled={busy || !meta?.free}>
            <Icon name={busy ? "circle-notch" : "plug"} className={busy ? "spin" : ""} /> Assign allocation
          </button>
        )}
      </div>
      <div className="stat-inline">
        <span><Icon name="plug" /> {rows.length} assigned</span>
        <span><Icon name="circle-check" /> {meta?.free ?? 0} free on node</span>
        <span><Icon name="server" /> Primary {server.allocation.ip}:{server.allocation.port}</span>
      </div>
      <div className="card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading allocations</div>
        ) : (
          <table className="table">
            <thead><tr><th>Address</th><th>Role</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className="mono address-cell"><Icon name="globe" /> {row.ip}:{row.port}</span></td>
                  <td>{row.primary ? <span className="pill pill-ok"><Icon name="star" /> Primary</span> : <span className="pill pill-neutral">Additional</span>}</td>
                  <td className="muted">{row.notes || "—"}</td>
                  <td>
                    <div className="row-actions">
                      <CopyButton value={`${row.ip}:${row.port}`} label="Copy address" />
                      {!row.primary && can("allocation.update") && (
                        <button type="button" className="icon-btn" title="Make primary" onClick={async () => { await api.setPrimaryAllocation(id, row.id); notify("Primary allocation updated"); await load(); }}><Icon name="star" /></button>
                      )}
                      {!row.primary && can("allocation.delete") && (
                        <ConfirmButton className="icon-btn danger-hover" icon="unlink" title="Release allocation?" description="The port will return to the node's free allocation pool." confirmLabel="Release" onConfirm={async () => { await api.deleteAllocation(id, row.id); notify("Allocation released"); await load(); }}>
                          <span className="sr-only">Release</span>
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4}><EmptyState icon="network-wired" title="No allocations" description="Assign a free port from the node pool." /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StartupPane({ id }: { id: string }) {
  const can = useServerCan();
  const canEdit = can("startup.update");
  const [data, setData] = useState<any>(null);
  const [startup, setStartup] = useState("");
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.startup(id).then((response) => {
      setData(response.data);
      setStartup(response.data.startup || "");
      setEnvironment(response.data.environment || {});
    });
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.saveStartup(id, { startup, environment });
      notify("Startup configuration saved");
    } catch (err: any) {
      notify(err.message || "Unable to save startup", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <LoadingPage label="Loading startup configuration" />;

  return (
    <form className="startup-layout" onSubmit={save}>
      <div className="card">
        <div className="card-head"><div><h2>Startup command</h2><p>Variables are resolved from the environment at launch.</p></div><span className="pill pill-neutral"><Icon name="cube" /> {data.image}</span></div>
        <div className="card-body">
          <div className="field">
            <label>Invocation</label>
            <input className="mono" value={startup} onChange={(event) => setStartup(event.target.value)} disabled={!canEdit} />
            <span className="field-help">{canEdit ? "Restart the server after changing the invocation." : "Your account has read-only startup access."}</span>
          </div>
          {(data.variables || []).length > 0 && (
            <div className="variable-grid">
              {(data.variables || []).map((variable: any) => (
                <div className="field" key={variable.env}>
                  <label>{variable.name} {variable.rules?.includes("required") && <span className="required">required</span>}</label>
                  <input value={environment[variable.env] ?? variable.default ?? ""} onChange={(event) => setEnvironment({ ...environment, [variable.env]: event.target.value })} disabled={!canEdit} />
                  <span className="field-help mono">{variable.env}</span>
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save startup</button>
          )}
        </div>
      </div>
      <aside className="startup-aside">
        <div className="info-card">
          <div className="info-card-head"><span className="eyebrow">Runtime image</span></div>
          <div className="image-display"><Icon name="cube" /><code>{data.image}</code><CopyButton value={data.image} label="Copy image" /></div>
          <p className="muted small">Docker is used when available on the node. Otherwise the command runs in the native process runtime.</p>
        </div>
        <div className="info-card">
          <div className="info-card-head"><span className="eyebrow">Effective command</span></div>
          <pre className="command-preview">{startup}</pre>
        </div>
      </aside>
    </form>
  );
}

function SettingsPane({
  id,
  server,
  isAdmin,
  onSaved,
  onDeleted,
}: {
  id: string;
  server: Srv;
  isAdmin: boolean;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [image, setImage] = useState(server.image);
  const [limits, setLimits] = useState({ memory: server.limits.memory, cpu: server.limits.cpu, disk: server.limits.disk });
  const [busy, setBusy] = useState(false);
  const [suspendReason, setSuspendReason] = useState(server.suspended_reason || "");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState((server.tags || []).join(", "));
  const [tagBusy, setTagBusy] = useState(false);
  const can = useServerCan();
  const canRename = can("settings.rename") || isAdmin;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body: any = { name, description, image };
      if (isAdmin) Object.assign(body, limits);
      await api.saveSettings(id, body);
      notify("Server settings updated");
      await onSaved();
    } catch (err: any) {
      notify(err.message || "Unable to save settings", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspension() {
    await api.adminSuspendServer(id, !server.suspended, suspendReason);
    notify(server.suspended ? "Server restored" : "Server suspended");
    setSuspendOpen(false);
    await onSaved();
  }

  return (
    <div className="settings-layout">
      <form className="card" onSubmit={save}>
        <div className="card-head"><div><h2>Instance settings</h2><p>Display metadata and the runtime image used for deployment.</p></div></div>
        <div className="card-body">
          <div className="field"><label>Server name</label><input value={name} onChange={(event) => setName(event.target.value)} required /></div>
          <div className="field"><label>Description</label><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional notes visible in the workload list" /></div>
          <div className="field"><label>Docker image</label><input className="mono" value={image} onChange={(event) => setImage(event.target.value)} /></div>
          {isAdmin && (
            <div className="field">
              <label>Resource limits</label>
              <ResourceLimits
                memoryMib={limits.memory}
                cpu={limits.cpu}
                diskMib={limits.disk}
                onChange={setLimits}
                memoryMaxGb={64}
                diskMaxGb={500}
              />
            </div>
          )}
          {canRename && (
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save settings</button>
          )}
        </div>
      </form>

      <div className="settings-side">
        <form
          className="card"
          onSubmit={async (event) => {
            event.preventDefault();
            setTagBusy(true);
            try {
              const tags = tagDraft.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
              await api.saveTags(id, tags);
              notify("Tags updated");
              await onSaved();
            } catch (err: any) {
              notify(err.message || "Unable to save tags", "error");
            } finally {
              setTagBusy(false);
            }
          }}
        >
          <div className="card-head"><div><h2>Tags</h2><p>Labels used to filter workloads on the dashboard.</p></div></div>
          <div className="card-body">
            <div className="field">
              <label>Comma-separated tags</label>
              <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="prod, api, eu" />
              <span className="field-help">Letters, numbers, dots, dashes. Maximum 12 tags.</span>
            </div>
            {(server.tags || []).length > 0 && (
              <div className="tag-row">
                {(server.tags || []).map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}
              </div>
            )}
            <button className="btn btn-primary" disabled={tagBusy}><Icon name={tagBusy ? "circle-notch" : "tags"} className={tagBusy ? "spin" : ""} /> Save tags</button>
          </div>
        </form>
        <div className="card">
          <div className="card-head"><div><h2>Maintenance</h2><p>Reinstall egg defaults onto the volume.</p></div></div>
          <div className="card-body">
            <p className="muted">Default files from the selected egg are written into the working directory. Existing files with the same names are replaced.</p>
            <ConfirmButton className="btn btn-ghost" icon="arrows-rotate" title={`Reinstall ${server.name}?`} description="Egg files will be rewritten. Custom files with matching names will be overwritten." confirmLabel="Reinstall files" tone="warning" onConfirm={async () => { await api.reinstall(id); notify("Egg files reinstalled"); }}>Reinstall egg files</ConfirmButton>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><h2>Identity</h2><p>Immutable server identifiers.</p></div></div>
          <div className="card-body identity-list">
            <div><span>UUID</span><code>{server.uuid}</code><CopyButton value={server.uuid} label="Copy UUID" /></div>
            <div><span>Short ID</span><code>{server.identifier}</code></div>
            <div><span>Owner</span><span>{server.owner_name}</span></div>
            <div><span>Node</span><span>node-{String(server.node_id).padStart(2, "0")}</span></div>
            <div><span>Created</span><span>{fmtDate(server.created_at)}</span></div>
          </div>
        </div>

        {isAdmin && (
          <div className="card danger-card">
            <div className="card-head"><div><h2>Danger zone</h2><p>Administrative actions are logged to the audit trail.</p></div></div>
            <div className="card-body">
              <div className="danger-action">
                <div><strong>{server.suspended ? "Restore server" : "Suspend server"}</strong><span>{server.suspended ? "Allow power actions and access again." : "Stop the process and block all management actions."}</span></div>
                <button type="button" className="btn btn-warning" onClick={() => setSuspendOpen(true)}>
                  <Icon name="ban" /> {server.suspended ? "Restore" : "Suspend"}
                </button>
              </div>
              <div className="danger-action">
                <div><strong>Delete server</strong><span>Remove the server, allocations, archives and volume files.</span></div>
                <ConfirmButton
                  className="btn btn-danger"
                  icon="trash-can"
                  title={`Delete ${server.name} permanently?`}
                  description="The workload will stop immediately. Database records, allocations, schedules, backups and all files on the server volume will be removed. This action cannot be undone."
                  confirmLabel="Delete server"
                  onConfirm={async () => {
                    await api.adminDeleteServer(id);
                    notify("Server deleted");
                    onDeleted();
                  }}
                >
                  Delete
                </ConfirmButton>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={server.suspended ? "Restore this server?" : "Suspend this server?"}
        description={server.suspended ? "The server will become manageable again." : "The process will be stopped and further actions blocked."}
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setSuspendOpen(false)}>Cancel</button>
            <button className={`btn ${server.suspended ? "btn-primary" : "btn-warning"}`} onClick={toggleSuspension}>
              <Icon name={server.suspended ? "circle-check" : "ban"} /> {server.suspended ? "Restore server" : "Suspend server"}
            </button>
          </>
        }
      >
        {!server.suspended && (
          <div className="field">
            <label>Reason (optional)</label>
            <input value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} placeholder="Outstanding invoice, policy review..." />
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActivityPane({ id }: { id: string }) {
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.serverActivity(id)
      .then((response) => setRows(response.data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingPage label="Loading audit history" />;

  return (
    <div className="card activity-card">
      <div className="card-head"><div><h2>Activity log</h2><p>Every power, file, backup and configuration event for this server.</p></div><span className="pill pill-neutral">{plural(rows.length, "event")}</span></div>
      <div className="timeline">
        {rows.map((row) => {
          const info = activityInfo(row.event);
          return (
            <div className="timeline-row" key={row.id}>
              <span className={`activity-icon tone-${info.tone}`}><Icon name={info.icon} /></span>
              <div className="timeline-body">
                <strong>{info.label}</strong>
                <span>{activityText(row.event)}</span>
                <small>{row.username || "System"} · {fmtDate(row.created_at)}</small>
              </div>
            </div>
          );
        })}
        {!rows.length && <EmptyState icon="clock-rotate-left" title="No activity yet" description="Server events will appear here as they happen." />}
      </div>
    </div>
  );
}
