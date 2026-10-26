import {
  FormEvent,
  KeyboardEvent,
  useCallback,
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
  Server as Srv,
  Stats,
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
  }, [id]);

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

  return (
    <div className="page server-page">
      <div className="server-head">
        <div className="server-head-left">
          <Link to={admin ? "/admin/servers" : "/"} className="back-link">
            <Icon name="arrow-left" /> {admin ? "All servers" : "Overview"}
          </Link>
          <div className="server-title-row">
            <span className={`server-title-icon ${online ? "online" : ""}`}>
              <Icon name="server" />
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
          <button className="btn btn-success" disabled={online || !!busy || server.suspended} onClick={() => power("start")}>
            <Icon name={busy === "start" ? "circle-notch" : "play"} className={busy === "start" ? "spin" : ""} />
            Start
          </button>
          <button className="btn btn-ghost" disabled={!online || !!busy || server.suspended} onClick={() => power("restart")}>
            <Icon name={busy === "restart" ? "circle-notch" : "rotate-right"} className={busy === "restart" ? "spin" : ""} />
            Restart
          </button>
          <button className="btn btn-ghost" disabled={!online || !!busy || server.suspended} onClick={() => power("stop")}>
            <Icon name={busy === "stop" ? "circle-notch" : "stop"} className={busy === "stop" ? "spin" : ""} />
            Stop
          </button>
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

      <nav className="tabs" aria-label="Server sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setSearchParams({ tab: item.id })}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {tab === "console" && <ConsolePane id={id} server={server} stats={stats} online={online} />}
      {tab === "files" && <FilesPane id={id} />}
      {tab === "databases" && <DatabasesPane id={id} />}
      {tab === "schedules" && <SchedulesPane id={id} />}
      {tab === "users" && <AccessPane id={id} />}
      {tab === "backups" && <BackupsPane id={id} />}
      {tab === "network" && <NetworkPane id={id} server={server} />}
      {tab === "startup" && <StartupPane id={id} />}
      {tab === "settings" && (
        <SettingsPane
          id={id}
          server={server}
          isAdmin={admin}
          onSaved={load}
          onDeleted={() => nav("/admin/servers")}
        />
      )}
      {tab === "activity" && <ActivityPane id={id} />}
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
            placeholder={online ? "Type a command and press Enter" : "Instance is offline"}
            spellCheck={false}
            autoComplete="off"
            aria-label="Console command"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!online}>
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

function FilesPane({ id }: { id: string }) {
  const [directory, setDirectory] = useState("/");
  const [entries, setEntries] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [renameValue, setRenameValue] = useState("");
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
        <label className="btn btn-ghost upload-button">
          <Icon name={busy === "upload" ? "circle-notch" : "cloud-arrow-up"} className={busy === "upload" ? "spin" : ""} />
          Upload
          <input type="file" hidden multiple onChange={(event) => { upload(event.target.files); event.target.value = ""; }} />
        </label>
        <span className="files-count">{entries.length} item{entries.length === 1 ? "" : "s"}</span>
      </div>

      <div className="card file-table-card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading directory</div>
        ) : (
          <table className="table file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const info = fileIcon(entry);
                return (
                  <tr key={entry.name}>
                    <td>
                      <button type="button" className="file-name" onClick={() => openEntry(entry)}>
                        <span className={`file-icon tone-${info.tone}`}><Icon name={info.icon} /></span>
                        <span>{entry.name}</span>
                        {entry.is_symlink && <Icon name="link" className="muted" />}
                      </button>
                    </td>
                    <td className="mono muted">{entry.is_file ? fmtBytes(entry.size) : "—"}</td>
                    <td className="muted">{fmtDate(entry.modified_at)}</td>
                    <td>
                      <div className="row-actions">
                        {entry.is_file && (
                          <button type="button" className="icon-btn" title="Download" onClick={() => api.fileDownload(id, joinPath(directory, entry.name), entry.name)}>
                            <Icon name="download" />
                          </button>
                        )}
                        <button type="button" className="icon-btn" title="Rename" onClick={() => openRename(entry.name)}>
                          <Icon name="pen" />
                        </button>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!entries.length && (
                <tr>
                  <td colSpan={4}>
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
    </div>
  );
}

function DatabasesPane({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.databases(id)).data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createDatabase(id, name.trim());
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
          <p>Provision connection credentials and a local SQLite file for this workload.</p>
        </div>
      </div>
      <form className="inline-form" onSubmit={create}>
        <div className="inline-input">
          <Icon name="database" />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Database name" />
        </div>
        <button className="btn btn-primary" disabled={busy}>
          <Icon name={busy ? "circle-notch" : "plus"} className={busy ? "spin" : ""} /> Create database
        </button>
      </form>
      <div className="card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading databases</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Database</th><th>Username</th><th>Password</th><th>Endpoint</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className="name-with-icon"><span className="file-icon tone-archive"><Icon name="database" /></span><code>{row.name}</code></span></td>
                  <td><span className="copyable"><code>{row.username}</code><CopyButton value={row.username} label="Copy username" /></span></td>
                  <td><PasswordValue value={row.password} /></td>
                  <td className="mono muted">{row.host}:{row.port}</td>
                  <td>
                    <ConfirmButton
                      className="icon-btn danger-hover"
                      icon="trash-can"
                      title={`Delete database ${row.name}?`}
                      description="Credentials and the local SQLite file will be removed. This cannot be undone."
                      confirmLabel="Delete database"
                      onConfirm={() => remove(row.id)}
                    >
                      <span className="sr-only">Delete</span>
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={5}><EmptyState icon="database" title="No databases" description="Create a database to generate credentials and a local SQLite file." /></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SchedulesPane({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "Nightly restart", cron: "*/30 * * * *", action: "restart", payload: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.schedules(id)).data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createSchedule(id, form);
      notify("Schedule created");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to create schedule", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: any) {
    try {
      await api.setSchedule(id, row.id, !row.enabled);
      notify(row.enabled ? "Schedule paused" : "Schedule enabled");
      await load();
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  async function runNow(row: any) {
    try {
      await api.runSchedule(id, row.id);
      notify(`Ran ${row.name}`);
      await load();
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  return (
    <div className="two-pane">
      <form className="card form-card" onSubmit={create}>
        <div className="card-head">
          <div>
            <h2>New schedule</h2>
            <p>Automate power actions, backups or console commands.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div className="field">
            <label>Interval</label>
            <select value={form.cron} onChange={(event) => setForm({ ...form, cron: event.target.value })}>
              <option value="*/5 * * * *">Every 5 minutes</option>
              <option value="*/15 * * * *">Every 15 minutes</option>
              <option value="*/30 * * * *">Every 30 minutes</option>
              <option value="*/60 * * * *">Every hour</option>
              <option value="*/360 * * * *">Every 6 hours</option>
              <option value="*/720 * * * *">Every 12 hours</option>
            </select>
            <span className="field-help">The scheduler resolves the first cron field as a minute interval.</span>
          </div>
          <div className="field">
            <label>Action</label>
            <select value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}>
              <option value="start">Start server</option>
              <option value="stop">Stop server</option>
              <option value="restart">Restart server</option>
              <option value="backup">Create backup</option>
              <option value="command">Send console command</option>
            </select>
          </div>
          {form.action === "command" && (
            <div className="field">
              <label>Console command</label>
              <input value={form.payload} onChange={(event) => setForm({ ...form, payload: event.target.value })} placeholder="say Server restarting" />
            </div>
          )}
          <button className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "plus"} className={busy ? "spin" : ""} /> Create schedule
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <div><h2>Configured schedules</h2><p>{rows.length} automation rule{rows.length === 1 ? "" : "s"}</p></div>
          <button type="button" className="icon-btn" onClick={load}><Icon name="arrows-rotate" /></button>
        </div>
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading schedules</div>
        ) : (
          <div className="schedule-list">
            {rows.map((row) => (
              <div className={`schedule-row ${row.enabled ? "" : "is-paused"}`} key={row.id}>
                <span className={`schedule-icon ${row.enabled ? "active" : ""}`}><Icon name={row.action === "restart" ? "rotate-right" : row.action === "backup" ? "box-archive" : row.action === "command" ? "terminal" : "power-off"} /></span>
                <div className="schedule-body">
                  <strong>{row.name}</strong>
                  <span><code>{row.cron}</code> · {row.action} · {row.last_run ? `last run ${timeAgo(row.last_run)}` : "never run"}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className={`switch ${row.enabled ? "on" : ""}`} onClick={() => toggle(row)} title={row.enabled ? "Pause schedule" : "Enable schedule"}>
                    <span />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => runNow(row)} title="Run now"><Icon name="play" /></button>
                  <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${row.name}?`} description="The automation rule will be removed." confirmLabel="Delete schedule" onConfirm={async () => { await api.deleteSchedule(id, row.id); notify("Schedule deleted"); await load(); }}>
                    <span className="sr-only">Delete</span>
                  </ConfirmButton>
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

const PERMISSIONS = [
  { id: "control.console", label: "Console access" },
  { id: "control.start", label: "Start server" },
  { id: "control.stop", label: "Stop server" },
  { id: "control.restart", label: "Restart server" },
  { id: "file.read", label: "Read files" },
  { id: "file.write", label: "Write files" },
  { id: "backup.create", label: "Create backups" },
  { id: "backup.restore", label: "Restore backups" },
  { id: "schedule.manage", label: "Manage schedules" },
];

function AccessPane({ id }: { id: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["control.console", "file.read"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.users(id)).data);
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
      notify("Subuser invited");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to invite subuser", "error");
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(permission: string) {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]
    );
  }

  return (
    <div className="two-pane access-pane">
      <form className="card form-card" onSubmit={invite}>
        <div className="card-head">
          <div><h2>Invite subuser</h2><p>Grant another panel account scoped access to this server.</p></div>
        </div>
        <div className="card-body">
          <div className="field">
            <label>Panel account email</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@example.com" required />
          </div>
          <div className="field">
            <label>Permissions</label>
            <div className="permission-grid">
              {PERMISSIONS.map((permission) => (
                <label className={`permission ${permissions.includes(permission.id) ? "selected" : ""}`} key={permission.id}>
                  <input type="checkbox" checked={permissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} />
                  <span className="permission-check"><Icon name="check" /></span>
                  {permission.label}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "user-plus"} className={busy ? "spin" : ""} /> Invite subuser
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-head"><h2>Access list</h2><span className="pill pill-neutral">{rows.length} subuser{rows.length === 1 ? "" : "s"}</span></div>
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading access list</div>
        ) : (
          <div className="access-list">
            {rows.map((row) => (
              <div className="access-row" key={row.id}>
                <span className="avatar avatar-sm">{row.email.slice(0, 1).toUpperCase()}</span>
                <div className="access-body">
                  <strong>{row.email}</strong>
                  <span>{Array.isArray(row.permissions) && row.permissions.length ? `${row.permissions.length} permissions` : "No permissions assigned"}</span>
                </div>
                <div className="permission-chips">
                  {(Array.isArray(row.permissions) ? row.permissions : []).slice(0, 3).map((permission: string) => (
                    <span className="chip" key={permission}>{permission.split(".")[0]}</span>
                  ))}
                </div>
                <ConfirmButton className="icon-btn danger-hover" icon="user-minus" title="Remove subuser?" description={`${row.email} will immediately lose access to this server.`} confirmLabel="Remove access" onConfirm={async () => { await api.deleteUser(id, row.id); notify("Subuser removed"); await load(); }}>
                  <span className="sr-only">Remove</span>
                </ConfirmButton>
              </div>
            ))}
            {!rows.length && <EmptyState icon="users" title="No subusers" description="Invite a panel account to collaborate on this server." />}
          </div>
        )}
      </div>
    </div>
  );
}

function BackupsPane({ id }: { id: string }) {
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
        <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
          <Icon name={busy ? "circle-notch" : "box-archive"} className={busy ? "spin" : ""} /> {busy ? "Creating archive" : "Create backup"}
        </button>
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
                      <button type="button" className="icon-btn" title="Download archive" onClick={() => api.backupDownload(id, row.id, row.name)}><Icon name="download" /></button>
                      <ConfirmButton className="btn btn-ghost btn-sm" icon="rotate-left" title={`Restore ${row.name}?`} description="Files are extracted over the current server volume. Existing files with the same names will be replaced." confirmLabel="Restore archive" onConfirm={async () => { await api.restoreBackup(id, row.id); notify("Backup restored"); }}>Restore</ConfirmButton>
                      <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${row.name}?`} description="This archive will be removed from disk permanently." confirmLabel="Delete archive" onConfirm={async () => { await api.deleteBackup(id, row.id); notify("Backup deleted"); await load(); }}>
                        <span className="sr-only">Delete</span>
                      </ConfirmButton>
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
        <button type="button" className="btn btn-primary" onClick={add} disabled={busy || !meta?.free}>
          <Icon name={busy ? "circle-notch" : "plug"} className={busy ? "spin" : ""} /> Assign allocation
        </button>
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
                      {!row.primary && (
                        <>
                          <button type="button" className="icon-btn" title="Make primary" onClick={async () => { await api.setPrimaryAllocation(id, row.id); notify("Primary allocation updated"); await load(); }}><Icon name="star" /></button>
                          <ConfirmButton className="icon-btn danger-hover" icon="unlink" title="Release allocation?" description="The port will return to the node's free allocation pool." confirmLabel="Release" onConfirm={async () => { await api.deleteAllocation(id, row.id); notify("Allocation released"); await load(); }}>
                            <span className="sr-only">Release</span>
                          </ConfirmButton>
                        </>
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
            <input className="mono" value={startup} onChange={(event) => setStartup(event.target.value)} />
            <span className="field-help">Restart the server after changing the invocation.</span>
          </div>
          {(data.variables || []).length > 0 && (
            <div className="variable-grid">
              {(data.variables || []).map((variable: any) => (
                <div className="field" key={variable.env}>
                  <label>{variable.name} {variable.rules?.includes("required") && <span className="required">required</span>}</label>
                  <input value={environment[variable.env] ?? variable.default ?? ""} onChange={(event) => setEnvironment({ ...environment, [variable.env]: event.target.value })} />
                  <span className="field-help mono">{variable.env}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save startup</button>
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
          <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save settings</button>
        </div>
      </form>

      <div className="settings-side">
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
      <div className="card-head"><div><h2>Activity log</h2><p>Every power, file, backup and configuration event for this server.</p></div><span className="pill pill-neutral">{rows.length} events</span></div>
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
