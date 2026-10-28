import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  Activity,
  Server,
  User,
  api,
  fmtBytes,
  fmtUptime,
  pct,
  timeAgo,
} from "../api";
import { Icon } from "../icons";
import {
  activityInfo,
  activityText,
  CopyButton,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  PageHeader,
  plural,
  StatusPill,
  notify,
} from "../ui";

type Filter = "all" | "running" | "offline" | "suspended";

const FILTERS: { id: Filter; label: string; icon: string }[] = [
  { id: "all", label: "All workloads", icon: "layer-group" },
  { id: "running", label: "Running", icon: "play" },
  { id: "offline", label: "Offline", icon: "stop" },
  { id: "suspended", label: "Suspended", icon: "ban" },
];

function eggIcon(nest: string): string {
  const value = (nest || "").toLowerCase();
  if (value.includes("python")) return "python";
  if (value.includes("node")) return "node-js";
  if (value.includes("java")) return "java";
  if (value.includes("docker")) return "docker";
  if (value.includes("minecraft")) return "cube";
  if (value.includes("voice")) return "microphone";
  if (value.includes("database")) return "database";
  if (value.includes("bot")) return "robot";
  if (value.includes("system")) return "gears";
  return "cube";
}

function eggBrand(nest: string): boolean {
  return /python|node|java|docker/i.test(nest || "");
}

export default function Dashboard() {
  const { user } = useOutletContext<{ user: User }>();
  const nav = useNavigate();
  const admin = user.role === "admin";
  const [servers, setServers] = useState<Server[] | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(
    async (silent = false) => {
      try {
        const requests: Promise<any>[] = [api.servers(), api.activity(10)];
        if (admin) requests.push(api.adminOverview(), api.adminNodes());
        const result = await Promise.all(requests);
        setServers(result[0].data);
        setActivity(result[1].data);
        if (admin) {
          setOverview(result[2].data);
          setNodes(result[3].data);
        }
        setError("");
      } catch (err: any) {
        if (!silent) setError(err.message || "Unable to load the workspace");
      }
    },
    [admin]
  );

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 6000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = servers || [];
  const running = items.filter((server) => server.status === "running").length;
  const suspended = items.filter((server) => server.suspended).length;
  const offline = items.length - running - suspended;
  const usedMemory = items.reduce((sum, server) => sum + (server.resources?.memory_bytes || 0), 0);
  const usedDisk = items.reduce((sum, server) => sum + (server.resources?.disk_bytes || 0), 0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((server) => {
        if (filter === "running") return server.status === "running";
        if (filter === "offline") return server.status === "offline";
        if (filter === "suspended") return server.suspended;
        return true;
      })
      .filter((server) => {
        if (!needle) return true;
        return (
          server.name.toLowerCase().includes(needle) ||
          (server.description || "").toLowerCase().includes(needle) ||
          (server.egg_name || "").toLowerCase().includes(needle) ||
          (server.nest_name || "").toLowerCase().includes(needle) ||
          (server.owner_name || "").toLowerCase().includes(needle) ||
          (server.tags || []).some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => {
        const rank = (server: Server) => (server.status === "running" ? 0 : server.suspended ? 2 : 1);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [items, query, filter]);

  if (!servers && !error) return <LoadingPage label="Loading workloads and telemetry" />;
  if (!servers && error) return <ErrorPanel message={error} retry={() => load()} />;

  const memberCount = overview ? Math.max(0, overview.users - overview.admins) : 0;

  const kpis = admin && overview
    ? [
        {
          label: "Workloads",
          value: overview.servers,
          sub: `${overview.running} running now`,
          icon: "server",
          tone: "accent",
        },
        {
          label: "Node fleet",
          value: overview.nodes,
          sub: plural(overview.locations, "location"),
          icon: "network-wired",
          tone: "info",
        },
        {
          label: "Panel users",
          value: overview.users,
          sub: `${plural(overview.admins, "admin")} · ${plural(memberCount, "member")}`,
          icon: "users",
          tone: "neutral",
        },
        {
          label: "Backups",
          value: overview.backups,
          sub: `${fmtBytes(overview.backup_bytes)} archived`,
          icon: "box-archive",
          tone: "success",
        },
      ]
    : [
        {
          label: "Workloads",
          value: items.length,
          sub: `${running} running`,
          icon: "server",
          tone: "accent",
        },
        {
          label: "Memory in use",
          value: fmtBytes(usedMemory),
          sub: "Across your instances",
          icon: "memory",
          tone: "info",
        },
        {
          label: "Disk in use",
          value: fmtBytes(usedDisk),
          sub: "Working directories",
          icon: "hard-drive",
          tone: "neutral",
        },
        {
          label: "Access",
          value: user.role === "admin" ? "Admin" : "Member",
          sub: user.email,
          icon: "shield-halved",
          tone: "success",
        },
      ];

  const systemCards = admin && overview
    ? [
        { label: "CPU load", value: overview.cpu, detail: plural(overview.cores, "logical core"), tone: "accent" },
        { label: "Memory", value: overview.memory.percent, detail: `${fmtBytes(overview.memory.used)} of ${fmtBytes(overview.memory.total)}`, tone: "violet" },
        { label: "Disk", value: overview.disk.percent, detail: `${fmtBytes(overview.disk.used)} of ${fmtBytes(overview.disk.total)}`, tone: "success" },
      ]
    : [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace"
        title={admin ? "Control center" : "Your workloads"}
        description={
          admin
            ? "Live health across the panel, its nodes and every registered workload."
            : "Monitor runtime health, resource use and recent activity for your instances."
        }
        actions={
          <>
            {admin && (
              <Link className="btn" to="/admin/users/new">
                <Icon name="user-plus" /> Create user
              </Link>
            )}
            {admin && (
              <Link className="btn btn-primary" to="/admin/servers/new">
                <Icon name="plus" /> Provision server
              </Link>
            )}
          </>
        }
      />

      <section className="kpi-grid">
        {kpis.map((kpi) => (
          <article className={`kpi kpi-${kpi.tone}`} key={kpi.label}>
            <span className="kpi-icon">
              <Icon name={kpi.icon} />
            </span>
            <div>
              <span className="kpi-label">{kpi.label}</span>
              <strong className="kpi-value">{kpi.value}</strong>
              <span className="kpi-sub">{kpi.sub}</span>
            </div>
          </article>
        ))}
      </section>

      {admin && systemCards.length > 0 && (
        <section className="system-strip">
          <div className="system-strip-head">
            <div>
              <span className="eyebrow">Node health</span>
              <h2>{overview.hostname}</h2>
            </div>
            <span className={`pill ${overview.docker ? "pill-ok" : "pill-neutral"}`}>
              <Icon name={overview.docker ? "docker" : "microchip"} brand={overview.docker} />
              {overview.docker ? "Docker engine" : "Process runtime"}
            </span>
          </div>
          <div className="system-meters">
            {systemCards.map((card) => (
              <div className="meter-card" key={card.label}>
                <div className={`meter-ring tone-${card.tone}`} style={{ "--value": `${Math.min(100, card.value)}%` } as CSSProperties}>
                  <span>{Math.round(card.value)}<small>%</small></span>
                </div>
                <div className="meter-copy">
                  <span>{card.label}</span>
                  <strong>{card.detail}</strong>
                </div>
              </div>
            ))}
            <div className="meter-card allocation-card">
              <span className="allocation-icon">
                <Icon name="plug" />
              </span>
              <div className="meter-copy">
                <span>Allocations</span>
                <strong>
                  {overview.allocations.free} free of {overview.allocations.total}
                </strong>
              </div>
              <Link to="/admin/nodes" className="icon-btn" aria-label="Manage allocations">
                <Icon name="arrow-right" />
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className={`dashboard-layout ${admin ? "with-rail" : ""}`}>
        <div className="dashboard-main">
          <div className="section-head">
            <div>
              <h2>Workloads</h2>
              <span className="section-meta">
                {items.length} instance{items.length === 1 ? "" : "s"}
                <span className="dot-separator" />
                {running} running
                {suspended > 0 && (
                  <>
                    <span className="dot-separator" />
                    {suspended} suspended
                  </>
                )}
              </span>
            </div>
            <div className="segmented" role="tablist" aria-label="Workload status">
              {FILTERS.map((item) => {
                const count =
                  item.id === "all"
                    ? items.length
                    : item.id === "running"
                      ? running
                      : item.id === "offline"
                        ? offline
                        : suspended;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={filter === item.id ? "active" : ""}
                    onClick={() => setFilter(item.id)}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    <em>{count}</em>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="toolbar">
            <div className="search-field">
              <Icon name="magnifying-glass" />
              <input
                type="search"
                placeholder="Search workloads, nests, eggs, tags or owners"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search workloads"
              />
              {query && (
                <button type="button" className="input-action" onClick={() => setQuery("")} aria-label="Clear search">
                  <Icon name="xmark" />
                </button>
              )}
            </div>
            <span className="toolbar-note">
              <Icon name="arrows-rotate" /> Auto-refresh every 6 seconds
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="server"
                title={items.length ? "No workloads match this view" : "No workloads yet"}
                description={
                  items.length
                    ? "Adjust the status filter or search query to see more instances."
                    : admin
                      ? "Provision your first server. Egg files, allocations and limits are configured during setup."
                      : "An administrator has not assigned a workload to this account yet."
                }
                action={
                  items.length ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setFilter("all");
                        setQuery("");
                      }}
                    >
                      <Icon name="filter-circle-xmark" /> Reset filters
                    </button>
                  ) : admin ? (
                    <Link className="btn btn-primary" to="/admin/servers/new">
                      <Icon name="plus" /> Provision server
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="server-grid">
              {filtered.map((server) => (
                <ServerCard key={server.id} server={server} onOpen={() => nav(`/server/${server.id}`)} onRefresh={() => load(true)} />
              ))}
            </div>
          )}
        </div>

        {admin && (
          <aside className="dashboard-rail">
            <section className="rail-card">
              <div className="rail-head">
                <div>
                  <span className="eyebrow">Infrastructure</span>
                  <h3>Fleet status</h3>
                </div>
                <Link className="icon-btn" to="/admin/nodes" aria-label="Open nodes">
                  <Icon name="arrow-up-right-from-square" />
                </Link>
              </div>
              <div className="node-mini-list">
                {nodes.map((node) => (
                  <Link className="node-mini" key={node.id} to={`/admin/nodes/${node.id}`}>
                    <span className={`node-mini-icon ${node.daemon === "connected" ? "online" : ""}`}>
                      <Icon name="server" />
                    </span>
                    <div className="node-mini-body">
                      <div className="node-mini-title">
                        <strong>{node.name}</strong>
                        <span className={`status-text ${node.daemon === "connected" ? "ok" : "muted"}`}>
                          {node.daemon}
                        </span>
                      </div>
                      <span className="node-mini-meta">
                        {node.running}/{node.servers} running · {node.location_short || node.location}
                      </span>
                      <div className="mini-bars">
                        <i style={{ width: `${Math.min(100, node.utilization?.memory || 0)}%` }} />
                        <i style={{ width: `${Math.min(100, node.utilization?.disk || 0)}%` }} />
                      </div>
                    </div>
                  </Link>
                ))}
                {!nodes.length && <p className="muted small">No nodes registered.</p>}
              </div>
            </section>

            <section className="rail-card">
              <div className="rail-head">
                <div>
                  <span className="eyebrow">Audit trail</span>
                  <h3>Recent activity</h3>
                </div>
                <Link className="icon-btn" to="/admin/activity" aria-label="Open audit log">
                  <Icon name="arrow-up-right-from-square" />
                </Link>
              </div>
              <ActivityList items={activity} />
            </section>
          </aside>
        )}
      </div>

      {!admin && activity.length > 0 && (
        <section className="card activity-card">
          <div className="card-head">
            <div>
              <h2>Recent activity</h2>
              <span className="section-meta">Actions across your workloads</span>
            </div>
          </div>
          <ActivityList items={activity.slice(0, 8)} />
        </section>
      )}
    </div>
  );
}

function ServerCard({
  server,
  onOpen,
  onRefresh,
}: {
  server: Server;
  onOpen: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState("");
  const stats = server.resources;
  const status = server.suspended ? "suspended" : server.status || stats?.state || "offline";
  const online = status === "running";
  const memPct = pct(stats?.memory_bytes || 0, stats?.memory_limit_bytes || 1);
  const diskPct = pct(stats?.disk_bytes || 0, stats?.disk_limit_bytes || 1);
  const cpuPct = Math.min(100, ((stats?.cpu_absolute || 0) / Math.max(server.limits?.cpu || 100, 1)) * 100);

  async function power(signal: string) {
    setBusy(signal);
    try {
      await api.power(server.id, signal);
      notify(`${server.name}: ${signal} signal sent`);
      onRefresh();
    } catch (err: any) {
      notify(err.message || "Power action failed", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <article
      className={`server-card ${online ? "is-online" : ""} ${server.suspended ? "is-suspended" : ""}`}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="server-card-head">
        <div className="server-ident">
          <span className={`server-egg ${server.suspended ? "suspended" : online ? "online" : ""}`}>
            <Icon name={eggIcon(server.nest_name)} brand={eggBrand(server.nest_name)} />
          </span>
          <div>
            <div className="server-name-row">
              <h3>{server.name}</h3>
              <StatusPill status={status} />
            </div>
            <span className="server-sub">
              {server.nest_name} / {server.egg_name}
              <span className="dot-separator" />
              {server.owner_name}
            </span>
          </div>
        </div>
        <div className="server-actions" onClick={(event) => event.stopPropagation()}>
          {online ? (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Restart workload"
                aria-label="Restart workload"
                disabled={!!busy || server.suspended}
                onClick={() => power("restart")}
              >
                <Icon name={busy === "restart" ? "circle-notch" : "rotate-right"} className={busy === "restart" ? "spin" : ""} />
              </button>
              <button
                type="button"
                className="icon-btn danger-hover"
                title="Stop workload"
                aria-label="Stop workload"
                disabled={!!busy || server.suspended}
                onClick={() => power("stop")}
              >
                <Icon name={busy === "stop" ? "circle-notch" : "stop"} className={busy === "stop" ? "spin" : ""} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="icon-btn success-hover"
              title="Start workload"
              aria-label="Start workload"
              disabled={!!busy || server.suspended}
              onClick={() => power("start")}
            >
              <Icon name={busy === "start" ? "circle-notch" : "play"} className={busy === "start" ? "spin" : ""} />
            </button>
          )}
        </div>
      </div>

      <p className="server-desc">{server.description || "No description provided."}</p>
      {(server.tags || []).length > 0 && (
        <div className="tag-row">
          {(server.tags || []).map((tag) => (
            <span className="tag-chip" key={tag}>{tag}</span>
          ))}
        </div>
      )}

      <div className="server-address">
        <Icon name="globe" />
        <code>
          {server.allocation.alias}:{server.allocation.port}
        </code>
        <CopyButton value={`${server.allocation.alias}:${server.allocation.port}`} label="Copy address" />
      </div>

      <div className="server-metrics">
        <Metric label="CPU" value={`${(stats?.cpu_absolute || 0).toFixed(1)}%`} percent={cpuPct} tone="cpu" />
        <Metric
          label="Memory"
          value={`${fmtBytes(stats?.memory_bytes || 0)} / ${fmtBytes(stats?.memory_limit_bytes || 0)}`}
          percent={memPct}
          tone="mem"
        />
        <Metric
          label="Disk"
          value={`${fmtBytes(stats?.disk_bytes || 0)} / ${fmtBytes(stats?.disk_limit_bytes || 0)}`}
          percent={diskPct}
          tone="disk"
        />
      </div>

      <div className="server-card-foot">
        <span>
          <Icon name="clock" /> {online ? fmtUptime(stats?.uptime || 0) : server.suspended ? "Suspended" : "Stopped"}
        </span>
        <span>
          <Icon name="id-card" /> {server.identifier}
        </span>
        <span className="server-open">
          Open <Icon name="arrow-right" />
        </span>
      </div>
    </article>
  );
}

function Metric({ label, value, percent, tone }: { label: string; value: string; percent: number; tone: string }) {
  return (
    <div className="server-metric">
      <div className="metric-row">
        <span>{label}</span>
        <em>{value}</em>
      </div>
      <div className={`track ${tone}`}>
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function ActivityList({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (!items.length) {
    return <p className="muted small rail-empty">No activity has been recorded yet.</p>;
  }
  return (
    <div className={`activity-list ${compact ? "compact" : ""}`}>
      {items.map((item) => {
        const info = activityInfo(item.event);
        return (
          <div className="activity-row" key={item.id}>
            <span className={`activity-icon tone-${info.tone}`}>
              <Icon name={info.icon} />
            </span>
            <div className="activity-body">
              <div className="activity-title">
                <strong>{activityText(item.event)}</strong>
                {item.server_name && <span>{item.server_name}</span>}
              </div>
              <span className="activity-meta">
                {item.username || "System"}
                <span className="dot-separator" />
                {timeAgo(item.created_at)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
