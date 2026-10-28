import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  api,
  fmtBytes,
  fmtDate,
  fmtUptime,
  timeAgo,
  type AdminDatabaseHost,
  type EggCatalogEntry,
} from "../api";
import { Icon } from "../icons";
import { ResourceLimits } from "../resources";
import {
  MinecraftSetup,
  minecraftSetupReady,
  type MinecraftSetupValue,
} from "../minecraft";
import nodeInstallArt from "../assets/node-install.svg";
import {
  activityInfo,
  activityText,
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  Modal,
  PageHeader,
  plural,
  StatusPill,
  notify,
} from "../ui";

function eggVars(egg: any): any[] {
  if (!egg) return [];
  if (Array.isArray(egg.variables)) return egg.variables;
  if (typeof egg.variables === "string") {
    try {
      const parsed = JSON.parse(egg.variables);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

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

function eggInstalled(egg: EggCatalogEntry | any): boolean {
  return !!egg?.installed || Number(egg?.deployments || 0) > 0;
}

function eggDefaults(egg: EggCatalogEntry | any): { memory: number; disk: number } {
  if (Number(egg?.id) === 27) return { memory: 2048, disk: 10240 };
  if (Number(egg?.id) === 28) return { memory: 1024, disk: 5120 };
  return { memory: 256, disk: 1024 };
}

function fmtMiB(value: number): string {
  const amount = Math.max(0, Number(value || 0));
  return amount >= 1024 ? `${(amount / 1024).toFixed(amount % 1024 ? 1 : 0)} GiB` : `${amount} MiB`;
}

type BulkInstallResult = {
  eggId: number;
  name: string;
  status: "pending" | "running" | "created" | "failed";
  message: string;
  serverId?: string;
};

function daemonTone(daemon: string): string {
  if (daemon === "connected") return "ok";
  if (daemon === "maintenance") return "warning";
  return "danger";
}

export default function Admin() {
  return <Outlet />;
}

export function Overview() {
  const [data, setData] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [overview, fleet, log] = await Promise.all([
        api.adminOverview(),
        api.adminNodes(),
        api.adminActivity(12),
      ]);
      setData(overview.data);
      setNodes(fleet.data);
      setActivity(log.data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load administration");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!data) return <LoadingPage label="Loading administration" />;

  const meters = [
    {
      label: "CPU",
      value: data.cpu,
      detail: plural(data.cores, "logical core"),
      tone: "accent",
      icon: "microchip",
    },
    {
      label: "Memory",
      value: data.memory.percent,
      detail: `${fmtBytes(data.memory.used)} of ${fmtBytes(data.memory.total)}`,
      tone: "violet",
      icon: "memory",
    },
    {
      label: "Disk",
      value: data.disk.percent,
      detail: `${fmtBytes(data.disk.used)} of ${fmtBytes(data.disk.total)}`,
      tone: "success",
      icon: "hard-drive",
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Control plane overview"
        description={`${data.hostname} · Panel ${data.version} · Runtime ${data.wings}`}
        actions={
          <>
            <Link className="btn" to="/admin/users/new"><Icon name="user-plus" /> Create user</Link>
            <Link className="btn" to="/admin/nodes/new"><Icon name="server" /> Register node</Link>
            <Link className="btn btn-primary" to="/admin/servers/new"><Icon name="plus" /> Provision server</Link>
          </>
        }
      />

      <section className="kpi-grid kpi-grid-wide">
        <Kpi label="Workloads" value={data.servers} sub={`${data.running} running · ${data.suspended} suspended`} icon="server" tone="accent" />
        <Kpi label="Node fleet" value={data.nodes} sub={`${data.locations} location${data.locations === 1 ? "" : "s"}`} icon="network-wired" tone="info" />
        <Kpi label="Panel users" value={data.users} sub={`${plural(data.eggs, "egg")} available`} icon="users" tone="neutral" />
        <Kpi label="Archives" value={data.backups} sub={`${fmtBytes(data.backup_bytes)} stored`} icon="box-archive" tone="success" />
        <Kpi label="Allocations" value={data.allocations.free} sub={`free of ${data.allocations.total}`} icon="plug" tone="violet" />
      </section>

      <div className="overview-layout">
        <div className="overview-main">
          <section className="card system-overview">
            <div className="card-head">
              <div>
                <span className="eyebrow">This node</span>
                <h2>{data.hostname}</h2>
                <p>Health and capacity for the panel instance and its primary daemon.</p>
              </div>
              <span className={`pill ${data.docker ? "pill-ok" : "pill-neutral"}`}>
                <Icon name={data.docker ? "docker" : "microchip"} brand={data.docker} />
                {data.docker ? "Docker" : "Process"}
              </span>
            </div>
            <div className="system-overview-body">
              <div className="meter-row">
                {meters.map((meter) => (
                  <div className="meter-tile" key={meter.label}>
                    <div className={`meter-ring tone-${meter.tone}`} style={{ "--value": `${Math.min(100, meter.value)}%` } as CSSProperties}>
                      <span>{Math.round(meter.value)}<small>%</small></span>
                    </div>
                    <div>
                      <span className="meter-label"><Icon name={meter.icon} /> {meter.label}</span>
                      <strong>{meter.detail}</strong>
                    </div>
                  </div>
                ))}
              </div>
              <div className="quick-actions">
                <Link to="/admin/servers/new" className="quick-action">
                  <span><Icon name="server" /></span>
                  <div><strong>Provision server</strong><small>Install an egg and bind an allocation</small></div>
                  <Icon name="arrow-right" />
                </Link>
                <Link to="/admin/nodes" className="quick-action">
                  <span><Icon name="network-wired" /></span>
                  <div><strong>Manage fleet</strong><small>Nodes, ports and daemon tokens</small></div>
                  <Icon name="arrow-right" />
                </Link>
                <Link to="/admin/users" className="quick-action">
                  <span><Icon name="users" /></span>
                  <div><strong>Access control</strong><small>Accounts, roles and ownership</small></div>
                  <Icon name="arrow-right" />
                </Link>
                <Link to="/admin/activity" className="quick-action">
                  <span><Icon name="clock-rotate-left" /></span>
                  <div><strong>Audit trail</strong><small>Every administrative event</small></div>
                  <Icon name="arrow-right" />
                </Link>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Node fleet</h2><p>Live capacity and daemon status.</p></div>
              <Link className="btn btn-ghost btn-sm" to="/admin/nodes"><Icon name="arrow-up-right-from-square" /> Manage</Link>
            </div>
            <div className="node-overview-grid">
              {nodes.map((node) => (
                <Link className="node-overview-card" key={node.id} to={`/admin/nodes/${node.id}`}>
                  <div className="node-overview-top">
                    <span className={`node-icon ${node.daemon === "connected" ? "online" : ""}`}><Icon name="server" /></span>
                    <div>
                      <strong>{node.name}</strong>
                      <span>{node.fqdn}</span>
                    </div>
                    <span className={`pill pill-${daemonTone(node.daemon)}`}>{node.daemon}</span>
                  </div>
                  <div className="node-overview-stats">
                    <span><em>{node.servers}</em> workloads</span>
                    <span><em>{node.running}</em> running</span>
                    <span><em>{node.allocations?.free ?? 0}</em> free ports</span>
                  </div>
                  <div className="node-overview-bars">
                    <div>
                      <div className="usage-row"><span>Memory</span><em>{node.utilization?.memory ?? 0}%</em></div>
                      <div className="track mem"><i style={{ width: `${Math.min(100, node.utilization?.memory || 0)}%` }} /></div>
                    </div>
                    <div>
                      <div className="usage-row"><span>Disk</span><em>{node.utilization?.disk ?? 0}%</em></div>
                      <div className="track disk"><i style={{ width: `${Math.min(100, node.utilization?.disk || 0)}%` }} /></div>
                    </div>
                  </div>
                </Link>
              ))}
              {!nodes.length && <EmptyState icon="network-wired" title="No nodes registered" description="Register a local or remote node before provisioning workloads." />}
            </div>
          </section>
        </div>

        <aside className="overview-rail">
          <section className="card">
            <div className="card-head">
              <div><h2>Recent activity</h2><p>Latest panel events.</p></div>
              <Link className="icon-btn" to="/admin/activity" aria-label="Open audit log"><Icon name="arrow-up-right-from-square" /></Link>
            </div>
            <div className="activity-list rail-list">
              {activity.map((item) => {
                const info = activityInfo(item.event);
                return (
                  <div className="activity-row" key={item.id}>
                    <span className={`activity-icon tone-${info.tone}`}><Icon name={info.icon} /></span>
                    <div className="activity-body">
                      <div className="activity-title"><strong>{activityText(item.event)}</strong></div>
                      <span className="activity-meta">{item.username || "System"}{item.server_name ? ` · ${item.server_name}` : ""} · {timeAgo(item.created_at)}</span>
                    </div>
                  </div>
                );
              })}
              {!activity.length && <p className="muted small">No events recorded.</p>}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Panel facts</h2><p>Deployment summary.</p></div></div>
            <div className="card-body identity-list">
              <div><span>Panel version</span><code>{data.version}</code></div>
              <div><span>Runtime</span><code>{data.wings}</code></div>
              <div><span>Runtime</span><span>{data.docker ? "Docker" : "Process"}</span></div>
              <div><span>Databases</span><span>{data.databases}</span></div>
              <div><span>Assigned ports</span><span>{data.allocations.assigned}</span></div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub: string; icon: string; tone: string }) {
  return (
    <article className={`kpi kpi-${tone}`}>
      <span className="kpi-icon"><Icon name={icon} /></span>
      <div>
        <span className="kpi-label">{label}</span>
        <strong className="kpi-value">{value}</strong>
        <span className="kpi-sub">{sub}</span>
      </div>
    </article>
  );
}

export function AdminServers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [transferTarget, setTransferTarget] = useState<any>(null);
  const [transferOwner, setTransferOwner] = useState(0);
  const [transferBusy, setTransferBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [servers, accounts, fleet] = await Promise.all([
        api.servers(),
        api.adminUsers(),
        api.adminNodes(),
      ]);
      setRows(servers.data);
      setUsers(accounts.data);
      setNodes(fleet.data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load servers");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchStatus =
        status === "all" ||
        (status === "suspended" ? row.suspended : !row.suspended && row.status === status);
      if (!matchStatus) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.owner_name || "").toLowerCase().includes(needle) ||
        (row.egg_name || "").toLowerCase().includes(needle) ||
        String(row.allocation?.port || "").includes(needle)
      );
    });
  }, [rows, query, status]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!rows) return <LoadingPage label="Loading servers" />;

  const running = rows.filter((row) => row.status === "running").length;
  const suspended = rows.filter((row) => row.suspended).length;
  const nodeName = (id: number) => nodes.find((node) => node.id === id)?.name || `node-${id}`;

  async function suspend(row: any) {
    await api.adminSuspendServer(row.id, !row.suspended, row.suspended ? "" : "Administrative suspension");
    notify(row.suspended ? "Server restored" : "Server suspended");
    await load();
  }

  async function transfer() {
    if (!transferTarget || !transferOwner) return;
    setTransferBusy(true);
    try {
      await api.adminTransferServer(transferTarget.id, transferOwner);
      notify("Server ownership transferred");
      setTransferTarget(null);
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to transfer server", "error");
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Servers"
        description={`${plural(rows.length, "workload")} · ${running} running · ${suspended} suspended`}
        actions={<Link className="btn btn-primary" to="/admin/servers/new"><Icon name="plus" /> Provision server</Link>}
      />

      <div className="toolbar">
        <div className="search-field">
          <Icon name="magnifying-glass" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by server, owner, egg or port" aria-label="Search servers" />
        </div>
        <div className="segmented">
          {["all", "running", "offline", "suspended"].map((item) => (
            <button type="button" key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>
              {item}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Server</th><th>Owner</th><th>Node</th><th>Allocation</th><th>Limits</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="entity-cell">
                      <span className={`server-egg icon-only ${row.status === "running" ? "online" : ""}`}>
                        <Icon name={eggIcon(row.nest_name)} brand={eggBrand(row.nest_name)} />
                      </span>
                      <div>
                        <Link className="entity-name" to={`/server/${row.id}`}>{row.name}</Link>
                        <span className="entity-meta">{row.nest_name} / {row.egg_name} · <code>{row.identifier}</code></span>
                      </div>
                    </div>
                  </td>
                  <td>{row.owner_name}</td>
                  <td><span className="muted">{nodeName(row.node_id)}</span></td>
                  <td><code className="address-inline">{row.allocation?.alias}:{row.allocation?.port}</code></td>
                  <td><span className="limit-inline"><Icon name="memory" /> {fmtBytes((row.limits?.memory || 0) * 1024 * 1024)}</span></td>
                  <td><StatusPill status={row.suspended ? "suspended" : row.status} /></td>
                  <td>
                    <div className="row-actions">
                      <Link className="icon-btn" to={`/server/${row.id}?tab=settings`} title="Manage server"><Icon name="sliders" /></Link>
                      <button type="button" className="icon-btn" title="Transfer ownership" onClick={() => { setTransferTarget(row); setTransferOwner(users.find((user) => user.id !== row.owner_id)?.id || 0); }}><Icon name="right-left" /></button>
                      <ConfirmButton
                        className="icon-btn"
                        icon={row.suspended ? "circle-check" : "ban"}
                        title={row.suspended ? `Restore ${row.name}?` : `Suspend ${row.name}?`}
                        description={row.suspended ? "The workload will be manageable again. It remains stopped until started." : "The workload will stop immediately and management actions will be blocked."}
                        confirmLabel={row.suspended ? "Restore server" : "Suspend server"}
                        tone={row.suspended ? "primary" : "warning"}
                        onConfirm={() => suspend(row)}
                      >
                        <span className="sr-only">{row.suspended ? "Restore" : "Suspend"}</span>
                      </ConfirmButton>
                      <ConfirmButton
                        className="icon-btn danger-hover"
                        icon="trash-can"
                        title={`Delete ${row.name}?`}
                        description="Stops the workload and permanently removes its allocation, schedules, databases, backups and all files on the server volume."
                        confirmLabel="Delete server"
                        onConfirm={async () => { await api.adminDeleteServer(row.id); notify("Server deleted"); await load(); }}
                      >
                        <span className="sr-only">Delete</span>
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7}><EmptyState icon="server" title="No servers match this view" description="Adjust your search or status filter, or provision a new server." action={<Link className="btn btn-primary" to="/admin/servers/new"><Icon name="plus" /> Provision server</Link>} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        title={`Transfer ${transferTarget?.name || "server"}`}
        description="Ownership controls who can manage this workload from the workspace."
        size="small"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setTransferTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={transfer} disabled={!transferOwner || transferBusy}>
              <Icon name={transferBusy ? "circle-notch" : "right-left"} className={transferBusy ? "spin" : ""} /> Transfer
            </button>
          </>
        }
      >
        <div className="field">
          <label>New owner</label>
          <select value={transferOwner} onChange={(event) => setTransferOwner(Number(event.target.value))}>
            <option value={0}>Select an account</option>
            {users.filter((user) => user.id !== transferTarget?.owner_id).map((user) => (
              <option key={user.id} value={user.id}>{user.username} · {user.email}</option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  );
}

export function NewServer() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const presetEgg = Number(params.get("egg") || 0);
  const [step, setStep] = useState(presetEgg ? 2 : 1);
  const [eggs, setEggs] = useState<any[]>([]);
  const [nests, setNests] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [eggWarning, setEggWarning] = useState("");
  const [syncingEggs, setSyncingEggs] = useState(false);
  const [catalogToken, setCatalogToken] = useState(0);
  const [minecraftConfig, setMinecraftConfig] = useState<MinecraftSetupValue | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    egg_id: presetEgg || 2,
    owner_id: 0,
    node_id: 0,
    allocation_id: 0,
    memory: presetEgg === 27 || presetEgg === 28 ? 2048 : 512,
    cpu: 100,
    disk: presetEgg === 27 || presetEgg === 28 ? 10240 : 2048,
    start_on_completion: false,
    environment: {} as Record<string, string>,
  });

  useEffect(() => {
    let alive = true;
    async function loadCatalog() {
      try {
        let response = await api.adminNests();
        if (
          presetEgg &&
          !response.eggs.some((item: any) => item.id === presetEgg) &&
          response.catalog_health?.missing?.length
        ) {
          setSyncingEggs(true);
          await api.adminSyncNests();
          response = await api.adminNests();
        }
        if (!alive) return;
        setEggs(response.eggs);
        setNests(response.nests);
        const requested = presetEgg
          ? response.eggs.find((item: any) => item.id === presetEgg)
          : null;
        const egg = requested || response.eggs.find((item: any) => item.id === 2) || response.eggs[0];
        if (presetEgg && !requested) {
          setEggWarning(
            `Egg ${presetEgg} is not present in this panel's catalogue. ` +
              `Known built-in IDs: ${(response.catalog_health?.known_egg_ids || []).join(", ") || "unavailable"}. ` +
              "Run Administration -> Nests -> Sync catalogue, then reload this page."
          );
        } else {
          setEggWarning("");
        }
        if (egg) {
          setForm((current) => ({
            ...current,
            egg_id: egg.id,
            environment: Object.fromEntries(eggVars(egg).map((variable) => [variable.env, variable.default || ""])),
          }));
        } else {
          setEggWarning("No eggs are installed. Sync the catalogue or deploy the current backend.");
        }
      } catch (err: any) {
        if (!alive) return;
        setEggWarning(err?.message || "Unable to load the egg catalogue");
      } finally {
        if (alive) setSyncingEggs(false);
      }
    }
    loadCatalog();
    api.adminUsers().then((response) => {
      setUsers(response.data);
      const owner = response.data.find((user: any) => user.role === "admin") || response.data[0];
      if (owner) setForm((current) => ({ ...current, owner_id: owner.id }));
    });
    api.adminNodes().then((response) => {
      setNodes(response.data);
      const local = response.data.find((node: any) => node.daemon === "connected") || response.data[0];
      if (local) setForm((current) => ({ ...current, node_id: local.id }));
    });
    return () => {
      alive = false;
    };
  }, [presetEgg, catalogToken]);

  useEffect(() => {
    if (!form.node_id) return;
    api.adminAllocations(form.node_id, true).then((response) => {
      setAllocations(response.data);
      setForm((current) => ({ ...current, allocation_id: 0 }));
    });
  }, [form.node_id]);

  const selectedEgg = eggs.find((egg) => egg.id === form.egg_id);
  const selectedNode = nodes.find((node) => node.id === form.node_id);
  const selectedOwner = users.find((user) => user.id === form.owner_id);
  const variables = eggVars(selectedEgg);
  const isMinecraftEgg = form.egg_id === 27 || form.egg_id === 28;
  const minecraftEdition: "java" | "bedrock" = form.egg_id === 28 ? "bedrock" : "java";

  function pickEgg(id: number) {
    const egg = eggs.find((item) => item.id === id);
    const minecraft = id === 27 || id === 28;
    setMinecraftConfig(null);
    setForm((current) => ({
      ...current,
      egg_id: id,
      memory: minecraft ? Math.max(current.memory, 2048) : current.memory,
      disk: minecraft ? Math.max(current.disk, 10240) : current.disk,
      environment: Object.fromEntries(eggVars(egg).map((variable) => [variable.env, variable.default || ""])),
    }));
  }

  async function syncEggCatalog() {
    setSyncingEggs(true);
    try {
      const result = await api.adminSyncNests();
      notify(`Catalogue synced: ${plural(result.nests, "nest")} and ${plural(result.eggs, "egg")}`);
      setCatalogToken((value) => value + 1);
    } catch (err: any) {
      notify(err?.message || "Catalogue sync failed", "error");
    } finally {
      setSyncingEggs(false);
    }
  }

  const canContinue =
    (step === 1 && form.name.trim().length >= 2 && form.owner_id > 0) ||
    (step === 2 && !!form.egg_id && (!isMinecraftEgg || minecraftSetupReady(minecraftConfig))) ||
    (step === 3 && form.node_id > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 3) {
      if (canContinue) setStep(step + 1);
      return;
    }
    if (!canContinue) return;
    setBusy(true);
    setError("");
    try {
      const payload: any = {
        name: form.name.trim(),
        description: form.description.trim(),
        egg_id: form.egg_id,
        owner_id: form.owner_id,
        node_id: form.node_id,
        memory: form.memory,
        cpu: form.cpu,
        disk: form.disk,
        environment: form.environment,
        start_on_completion: form.start_on_completion,
      };
      if (form.allocation_id) payload.allocation_id = form.allocation_id;
      if (isMinecraftEgg && minecraftConfig) {
        payload.minecraft = {
          software: minecraftConfig.software,
          version: minecraftConfig.version,
          loader_version: minecraftConfig.loader_version,
          accept_eula: minecraftConfig.accept_eula,
          properties: minecraftConfig.properties,
        };
        payload.accept_eula = minecraftConfig.accept_eula;
      }
      const response = await api.adminCreateServer(payload);
      notify(
        isMinecraftEgg ? "Server created - Minecraft installation queued" : "Server provisioned",
        isMinecraftEgg ? "info" : "success"
      );
      nav(`/server/${response.data.id}?tab=minecraft`);
    } catch (err: any) {
      setError(err.message || "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Provisioning"
        title="Create server"
        description="Install an egg, bind a network allocation and set resource boundaries."
        actions={<Link className="btn btn-ghost" to="/admin/servers"><Icon name="arrow-left" /> Back to servers</Link>}
      />

      <ol className="wizard-steps">
        {["Details", "Software", "Deployment"].map((label, index) => (
          <li key={label} className={step === index + 1 ? "on" : step > index + 1 ? "done" : ""}>
            <span>{step > index + 1 ? <Icon name="check" /> : index + 1}</span>
            <div><strong>{label}</strong><small>{index === 0 ? "Identity & owner" : index === 1 ? "Egg & runtime" : "Node & limits"}</small></div>
          </li>
        ))}
      </ol>

      <div className="wizard-layout">
        <form className="card wizard-card" onSubmit={submit}>
          <div className="card-body">
            {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
            {step === 1 && (
              <div className="form-grid">
                <div className="field">
                  <label>Server name</label>
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="atlas-api" required />
                  <span className="field-help">A short, unique label for this workload.</span>
                </div>
                <div className="field">
                  <label>Owner</label>
                  <select value={form.owner_id} onChange={(event) => setForm({ ...form, owner_id: Number(event.target.value) })}>
                    <option value={0}>Select an account</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.username} · {user.email}</option>)}
                  </select>
                </div>
                <div className="field full">
                  <label>Description</label>
                  <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What this instance is responsible for" />
                </div>
              </div>
            )}
            {step === 2 && (
              <div>
                {eggWarning && (
                  <div className="err egg-catalog-warning">
                    <Icon name="circle-exclamation" />
                    <span>{eggWarning}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={syncEggCatalog} disabled={syncingEggs}>
                      <Icon name={syncingEggs ? "circle-notch" : "rotate"} className={syncingEggs ? "spin" : ""} />
                      Sync catalogue
                    </button>
                  </div>
                )}
                <div className="field">
                  <label>Nest and egg</label>
                  <select value={form.egg_id} onChange={(event) => pickEgg(Number(event.target.value))}>
                    {nests.map((nest) => (
                      <optgroup key={nest.id} label={nest.name}>
                        {eggs.filter((egg) => egg.nest_id === nest.id).map((egg) => <option key={egg.id} value={egg.id}>{egg.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {selectedEgg && (
                  <div className="egg-card">
                    <div className="egg-card-head">
                      <span className="server-egg icon-only"><Icon name={eggIcon(nests.find((nest) => nest.id === selectedEgg.nest_id)?.name || "")} brand={eggBrand(nests.find((nest) => nest.id === selectedEgg.nest_id)?.name || "")} /></span>
                      <div><strong>{selectedEgg.name}</strong><span>{selectedEgg.description}</span></div>
                      <span className="pill pill-neutral">{selectedEgg.runtime}</span>
                    </div>
                    <div className="egg-card-details">
                      <div><span>Runtime image</span><code>{selectedEgg.docker_image}</code></div>
                      <div><span>Startup</span><code>{selectedEgg.startup}</code></div>
                    </div>
                  </div>
                )}
                {isMinecraftEgg ? (
                  <>
                    <div className="mc-wizard-note">
                      <Icon name="circle-info" />
                      <span>
                        This egg runs the panel Minecraft installer. Choose the edition with the egg selector:
                        Minecraft Java (auto-installer) or Minecraft Bedrock (auto-installer).
                      </span>
                    </div>
                    <MinecraftSetup
                      key={`minecraft-${minecraftEdition}`}
                      edition={minecraftEdition}
                      initial={minecraftConfig}
                      onChange={setMinecraftConfig}
                    />
                  </>
                ) : (
                  variables.length > 0 && (
                    <div className="variable-grid">
                      {variables.map((variable) => (
                        <div className="field" key={variable.env}>
                          <label>{variable.name} <span className="field-env">{variable.env}</span></label>
                          <input value={form.environment[variable.env] || ""} onChange={(event) => setForm({ ...form, environment: { ...form.environment, [variable.env]: event.target.value } })} />
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
            {step === 3 && (
              <div>
                <div className="form-grid">
                  <div className="field">
                    <label>Node</label>
                    <select value={form.node_id} onChange={(event) => setForm({ ...form, node_id: Number(event.target.value) })}>
                      {nodes.map((node) => <option key={node.id} value={node.id} disabled={!!node.maintenance}>{node.name} · {node.location_short || node.location} · {node.daemon}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Network allocation</label>
                    <select value={form.allocation_id} onChange={(event) => setForm({ ...form, allocation_id: Number(event.target.value) })}>
                      <option value={0}>Auto-assign next free port</option>
                      {allocations.map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.ip}:{allocation.port}{allocation.notes ? ` · ${allocation.notes}` : ""}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field resource-field">
                  <label>Resource limits</label>
                  <ResourceLimits
                    memoryMib={form.memory}
                    cpu={form.cpu}
                    diskMib={form.disk}
                    onChange={(next) => setForm({ ...form, ...next })}
                    memoryMaxGb={Math.max(1, Math.floor((selectedNode?.memory || 8192) / 1024))}
                    cpuMax={Math.max(100, selectedNode?.cpu || 400)}
                    diskMaxGb={Math.max(1, Math.floor((selectedNode?.disk || 51200) / 1024))}
                  />
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={form.start_on_completion} onChange={(event) => setForm({ ...form, start_on_completion: event.target.checked })} />
                  <span className="checkbox-ui"><Icon name="check" /></span>
                  <span>Start the workload as soon as provisioning completes</span>
                </label>
              </div>
            )}
          </div>
          <div className="wizard-nav">
            {step > 1 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}><Icon name="arrow-left" /> Back</button>
            ) : <span />}
            <button className="btn btn-primary" disabled={!canContinue || busy}>
              {step < 3 ? <><span>Continue</span> <Icon name="arrow-right" /></> : busy ? <><Icon name="circle-notch" className="spin" /> Provisioning</> : <><Icon name="server" /> Create server</>}
            </button>
          </div>
        </form>

        <aside className="wizard-summary">
          <div className="card">
            <div className="card-head"><div><span className="eyebrow">Summary</span><h2>{form.name || "Untitled server"}</h2><p>{form.description || "No description yet"}</p></div></div>
            <div className="card-body identity-list">
              <div><span>Owner</span><span>{selectedOwner?.username || "Not assigned"}</span></div>
              <div><span>Egg</span><span>{selectedEgg?.name || "Not selected"}</span></div>
              {isMinecraftEgg && (
                <>
                  <div><span>Minecraft software</span><span>{minecraftConfig?.software_name || "Not selected"}</span></div>
                  <div><span>Minecraft version</span><span>{minecraftConfig?.version || "Latest"}</span></div>
                  <div><span>Loader / build</span><span>{minecraftConfig?.loader_version || "Default"}</span></div>
                </>
              )}
              <div><span>Node</span><span>{selectedNode?.name || "Not selected"}</span></div>
              <div><span>Primary port</span><span>{form.allocation_id ? allocations.find((allocation) => allocation.id === form.allocation_id)?.port : "Auto"}</span></div>
              <div><span>Memory</span><span>{form.memory} MiB</span></div>
              <div><span>CPU</span><span>{form.cpu}%</span></div>
              <div><span>Disk</span><span>{form.disk} MiB</span></div>
            </div>
          </div>
          <div className="wizard-note">
            <Icon name="circle-info" />
            <p>Egg files are written to the node volume during provisioning. The record is available immediately after creation.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function installCheckIcon(status: string): string {
  if (status === "ok") return "circle-check";
  if (status === "fail") return "circle-xmark";
  if (status === "warn") return "triangle-exclamation";
  return "circle";
}

function NodeAutoInstall({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [audit, setAudit] = useState<any>(null);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    location_id: 1,
    memory: 8192,
    disk: 51200,
    cpu: 400,
    port_start: 9000,
    port_count: 10,
  });

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    setJob(null);
    try {
      const { data } = await api.adminNodeAudit();
      const existing = data.existing_node;
      setAudit(data);
      setForm({
        name: existing?.name || data.recommended.name || "vitestl-local",
        location_id: existing?.location_id || data.recommended.location_id || 1,
        memory: existing?.memory || data.recommended.memory || 8192,
        disk: existing?.disk || data.recommended.disk || 51200,
        cpu: existing?.cpu || data.recommended.cpu || 400,
        port_start: data.recommended.port_start || 9000,
        port_count: data.recommended.port_count || 10,
      });
    } catch (err: any) {
      setError(err.message || "Unable to audit this host");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadAudit();
  }, [open, loadAudit]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api.adminAutoInstallJob(job.id);
        setJob(data);
        if (data.status === "success") {
          notify("Node installed and attached to this host");
          onDone();
        }
        if (data.status === "failed") {
          notify(data.error || "Node installation failed", "error");
        }
      } catch (err: any) {
        setError(err.message || "Unable to read installer progress");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [job, onDone]);

  const running = job?.status === "queued" || job?.status === "running";
  const succeeded = job?.status === "success";

  async function install() {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.adminAutoInstallNode({
        ...form,
        name: form.name.trim(),
      });
      setJob(data);
    } catch (err: any) {
      setError(err.message || "Unable to start the installer");
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (running) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Auto-install local node"
      description="Audit this Debian host, register it as a node, reserve allocations, and write the runtime manifest."
      size="wide"
      footer={
        succeeded ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Close
            </button>
            <Link
              className="btn btn-primary"
              to={`/admin/nodes/${job.result.node_id}`}
              onClick={onClose}
            >
              <Icon name="arrow-right" /> Open node
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={running}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={install}
              disabled={busy || running || loading || !audit?.ready}
            >
              <Icon
                name={busy || running ? "circle-notch" : "wand-magic-sparkles"}
                className={busy || running ? "spin" : ""}
              />
              {running ? "Installing" : audit?.existing_node ? "Verify & update node" : "Install node"}
            </button>
          </>
        )
      }
    >
      <div className="installer-hero">
        <img src={nodeInstallArt} alt="" aria-hidden="true" />
        <div>
          <span className="eyebrow">
            <span className="live-dot ok" /> Debian-native provisioning
          </span>
          <h3>One host, one click, a complete local node.</h3>
          <p>
            VITESTERTL runs workloads on this host. The installer verifies Python,
            systemd, storage and the container runtime, then registers the node, reserves a
            contiguous port block and writes <code>&lt;data&gt;/nodes/node-&lt;id&gt;/node.json</code>.
          </p>
          <div className="installer-tags">
            <span><Icon name="server" /> Local runtime</span>
            <span><Icon name="plug" /> Port reservations</span>
            <span><Icon name="file-shield" /> Node manifest</span>
          </div>
        </div>
      </div>

      {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}

      {loading && (
        <div className="installer-loading">
          <Icon name="circle-notch" className="spin" /> Auditing host capabilities...
        </div>
      )}

      {!loading && audit && !job && (
        <>
          <div className="installer-check-grid">
            {audit.checks.map((check: any) => (
              <div className={`installer-check ${check.status}`} key={check.id}>
                <Icon name={installCheckIcon(check.status)} />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                  {check.status !== "ok" && <small>{check.hint}</small>}
                </div>
              </div>
            ))}
          </div>

          {audit.existing_node && (
            <div className="installer-note">
              <Icon name="circle-info" />
              <span>
                <strong>Local node detected.</strong> Auto-install will update{" "}
                <Link to={`/admin/nodes/${audit.existing_node.id}`} onClick={onClose}>
                  #{audit.existing_node.id} {audit.existing_node.name}
                </Link>{" "}
                and add any missing allocations instead of creating a duplicate.
              </span>
            </div>
          )}

          <div className="installer-form">
            <div className="field">
              <label>Node name</label>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                maxLength={64}
                placeholder="vitestl-local"
              />
            </div>
            <div className="field">
              <label>Location</label>
              <input value={audit.recommended.location || "Local"} readOnly />
            </div>
            <div className="field">
              <label>Memory (MiB)</label>
              <input
                type="number"
                min={512}
                value={form.memory}
                onChange={(event) => setForm({ ...form, memory: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Disk (MiB)</label>
              <input
                type="number"
                min={1024}
                value={form.disk}
                onChange={(event) => setForm({ ...form, disk: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>CPU (%)</label>
              <input
                type="number"
                min={100}
                step={100}
                value={form.cpu}
                onChange={(event) => setForm({ ...form, cpu: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>First allocation port</label>
              <input
                type="number"
                min={9000}
                max={9999}
                value={form.port_start}
                onChange={(event) => setForm({ ...form, port_start: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Ports to reserve</label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.port_count}
                onChange={(event) => setForm({ ...form, port_count: Number(event.target.value) })}
              />
            </div>
            {audit.existing_node && (
              <div className="installer-existing">
                <span>Existing node</span>
                <strong>#{audit.existing_node.id} · {audit.existing_node.daemon}</strong>
              </div>
            )}
          </div>
        </>
      )}

      {job && (
        <div className="installer-progress" aria-live="polite">
          <div className="installer-steps">
            {job.steps.map((step: any) => (
              <div className={`installer-step ${step.status}`} key={step.id}>
                <span className="installer-step-icon">
                  <Icon
                    name={
                      step.status === "success"
                        ? "circle-check"
                        : step.status === "failed"
                          ? "circle-xmark"
                          : step.status === "running"
                            ? "circle-notch"
                            : "circle"
                    }
                    className={step.status === "running" ? "spin" : ""}
                  />
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail || (step.status === "pending" ? "Waiting" : step.status)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={`installer-job-state ${job.status}`}>
            <Icon
              name={
                succeeded
                  ? "circle-check"
                  : job.status === "failed"
                    ? "circle-xmark"
                    : "circle-notch"
              }
              className={running ? "spin" : ""}
            />
            <div>
              <strong>
                {succeeded
                  ? "Node ready"
                  : job.status === "failed"
                    ? "Installation failed"
                    : "Installing node"}
              </strong>
              <span>
                {succeeded
                  ? `#${job.result.node_id} · ${plural(job.result.allocations, "allocation")} · ${job.result.runtime} runtime`
                  : job.error || "The installer is working through the host audit."}
              </span>
            </div>
          </div>

          <pre className="installer-log">
            {job.logs.map((entry: any, index: number) => (
              <span className={`log-${entry.level}`} key={`${entry.at}-${index}`}>
                {new Date(entry.at).toLocaleTimeString([], { hour12: false })}{" "}
                {entry.message}
                {"\n"}
              </span>
            ))}
            {!job.logs.length && "Waiting for installer output...\n"}
          </pre>
        </div>
      )}
    </Modal>
  );
}

export function Nodes() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [installerOpen, setInstallerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.adminNodes()).data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load nodes");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!rows) return <LoadingPage label="Loading node fleet" />;

  const connected = rows.filter((node) => node.daemon === "connected").length;
  const totalMemory = rows.reduce((sum, node) => sum + (node.memory || 0), 0);
  const allocatedMemory = rows.reduce((sum, node) => sum + (node.memory_allocated || 0), 0);
  const freePorts = rows.reduce((sum, node) => sum + (node.allocations?.free || 0), 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Node fleet"
        description={`${plural(rows.length, "registered node")} · ${connected} connected · ${plural(freePorts, "free allocation")}`}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setInstallerOpen(true)}>
              <Icon name="wand-magic-sparkles" /> Auto-install
            </button>
            <Link className="btn btn-ghost" to="/admin/nodes/new"><Icon name="plus" /> Register node</Link>
          </>
        }
      />

      <section className="node-install-banner">
        <div className="node-install-copy">
          <span className="eyebrow">
            <span className="live-dot ok" /> Debian auto-install
          </span>
          <h2>Turn this host into a production-ready node.</h2>
          <p>
            The installer audits the local Debian runtime, attaches the node, reserves a
            contiguous allocation block and writes an on-disk manifest. No remote agent, no
            copied token, no manual port bookkeeping.
          </p>
          <div className="node-install-points">
            <span><Icon name="list-check" /> Runtime audit</span>
            <span><Icon name="plug" /> Port reservation</span>
            <span><Icon name="file-shield" /> Manifest + log</span>
          </div>
          <div className="node-install-actions">
            <button type="button" className="btn btn-primary" onClick={() => setInstallerOpen(true)}>
              <Icon name="wand-magic-sparkles" /> Auto-install node
            </button>
            <Link className="btn btn-ghost" to="/admin/nodes/new">
              <Icon name="pen-ruler" /> Manual register
            </Link>
          </div>
        </div>
        <img src={nodeInstallArt} alt="" aria-hidden="true" />
      </section>

      <section className="kpi-grid kpi-grid-compact">
        <Kpi label="Connected" value={`${connected}/${rows.length}`} sub="Node runtime attached" icon="tower-broadcast" tone="success" />
        <Kpi label="Memory capacity" value={fmtBytes(totalMemory * 1024 * 1024)} sub={`${fmtBytes(allocatedMemory * 1024 * 1024)} allocated`} icon="memory" tone="violet" />
        <Kpi label="Free allocations" value={freePorts} sub="Ready to assign" icon="plug" tone="accent" />
        <Kpi label="Maintenance" value={rows.filter((node) => node.maintenance).length} sub="Nodes paused" icon="screwdriver-wrench" tone="neutral" />
      </section>

      <div className="node-grid">
        {rows.map((node) => (
          <Link className="node-card" key={node.id} to={`/admin/nodes/${node.id}`}>
            <div className="node-card-head">
              <span className={`node-icon ${node.daemon === "connected" ? "online" : ""}`}><Icon name="server" /></span>
              <div className="node-card-title">
                <strong>{node.name}</strong>
                <span>{node.fqdn} · <span className="mono">{node.location_short || node.location}</span></span>
              </div>
              <span className={`pill pill-${daemonTone(node.daemon)}`}>{node.daemon}</span>
            </div>
            <div className="node-card-body">
              <div className="node-card-metrics">
                <div>
                  <span><Icon name="memory" /> Memory</span>
                  <strong>{node.memory_allocated}<small> / {node.memory} MiB</small></strong>
                  <div className="track mem"><i style={{ width: `${Math.min(100, (node.memory_allocated / Math.max(node.memory, 1)) * 100)}%` }} /></div>
                </div>
                <div>
                  <span><Icon name="hard-drive" /> Disk</span>
                  <strong>{node.disk_allocated}<small> / {node.disk} MiB</small></strong>
                  <div className="track disk"><i style={{ width: `${Math.min(100, (node.disk_allocated / Math.max(node.disk, 1)) * 100)}%` }} /></div>
                </div>
              </div>
              <div className="node-card-live">
                <div><span>Workloads</span><strong>{node.running}<small> / {node.servers}</small></strong></div>
                <div><span>Free ports</span><strong>{node.allocations?.free ?? 0}</strong></div>
                <div><span>Engine</span><strong className="capitalize">{node.runtime}</strong></div>
              </div>
            </div>
            <div className="node-card-foot">
              <span><Icon name="code-branch" /> Runtime {node.wings}</span>
              {node.live ? (
                <span className="live-metric"><Icon name="microchip" /> {node.live.cpu}% CPU · {node.live.memory.percent}% RAM</span>
              ) : (
                <span className="muted"><Icon name="plug-circle-xmark" /> Awaiting daemon</span>
              )}
              <span className="node-open"><Icon name="arrow-right" /></span>
            </div>
          </Link>
        ))}
        {!rows.length && <div className="card"><EmptyState icon="network-wired" title="No nodes registered" description="Auto-install the local host or register a node manually to begin assigning workloads and allocations." action={<button type="button" className="btn btn-primary" onClick={() => setInstallerOpen(true)}><Icon name="wand-magic-sparkles" /> Auto-install node</button>} /></div>}
      </div>

      <NodeAutoInstall
        open={installerOpen}
        onClose={() => setInstallerOpen(false)}
        onDone={load}
      />
    </div>
  );
}

export function NewNode() {
  const nav = useNavigate();
  const [locations, setLocations] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    fqdn: "",
    location_id: 1,
    memory: 8192,
    disk: 51200,
    cpu: 400,
    scheme: "http",
    daemon_listen: 8080,
    daemon_sftp: 2022,
    memory_overallocate: 0,
    disk_overallocate: 0,
    public: true,
    behind_proxy: false,
  });

  useEffect(() => {
    api.adminLocations().then((response) => {
      setLocations(response.data);
      if (response.data[0]) setForm((current) => ({ ...current, location_id: response.data[0].id }));
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.adminCreateNode(form);
      notify("Node registered");
      nav(`/admin/nodes/${response.data.id}`);
    } catch (err: any) {
      setError(err.message || "Unable to register node");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Infrastructure"
        title="Register node"
        description="Add a node endpoint that can host workloads and allocation ranges."
        actions={<Link className="btn btn-ghost" to="/admin/nodes"><Icon name="arrow-left" /> Back to nodes</Link>}
      />
      <form className="card form-page" onSubmit={submit}>
        <div className="card-body">
          {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
          <div className="form-section">
            <div className="form-section-head"><h3>Identity</h3><p>Name and public address for this node.</p></div>
            <div className="form-grid">
              <div className="field"><label>Node name</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="node-02" required /></div>
              <div className="field"><label>FQDN or IP</label><input value={form.fqdn} onChange={(event) => setForm({ ...form, fqdn: event.target.value })} placeholder="node.example.net" required /></div>
              <div className="field"><label>Location</label><select value={form.location_id} onChange={(event) => setForm({ ...form, location_id: Number(event.target.value) })}>{locations.map((location) => <option key={location.id} value={location.id}>{location.short_code} · {location.name}</option>)}</select></div>
              <div className="field"><label>Scheme</label><select value={form.scheme} onChange={(event) => setForm({ ...form, scheme: event.target.value })}><option value="http">http</option><option value="https">https</option></select></div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head"><h3>Capacity</h3><p>Total resources exposed by this daemon.</p></div>
            <div className="form-grid three">
              <div className="field"><label>Memory (MiB)</label><input type="number" min={0} value={form.memory} onChange={(event) => setForm({ ...form, memory: Number(event.target.value) })} /></div>
              <div className="field"><label>Disk (MiB)</label><input type="number" min={0} value={form.disk} onChange={(event) => setForm({ ...form, disk: Number(event.target.value) })} /></div>
              <div className="field"><label>CPU (%)</label><input type="number" min={100} step={100} value={form.cpu} onChange={(event) => setForm({ ...form, cpu: Number(event.target.value) })} /></div>
              <div className="field"><label>Memory overallocate (%)</label><input type="number" min={0} value={form.memory_overallocate} onChange={(event) => setForm({ ...form, memory_overallocate: Number(event.target.value) })} /></div>
              <div className="field"><label>Disk overallocate (%)</label><input type="number" min={0} value={form.disk_overallocate} onChange={(event) => setForm({ ...form, disk_overallocate: Number(event.target.value) })} /></div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head"><h3>Daemon</h3><p>Node API and SFTP listeners.</p></div>
            <div className="form-grid">
              <div className="field"><label>API port</label><input type="number" value={form.daemon_listen} onChange={(event) => setForm({ ...form, daemon_listen: Number(event.target.value) })} /></div>
              <div className="field"><label>SFTP port</label><input type="number" value={form.daemon_sftp} onChange={(event) => setForm({ ...form, daemon_sftp: Number(event.target.value) })} /></div>
              <label className="check-row"><input type="checkbox" checked={form.public} onChange={(event) => setForm({ ...form, public: event.target.checked })} /><span className="checkbox-ui"><Icon name="check" /></span><span>Public node</span></label>
              <label className="check-row"><input type="checkbox" checked={form.behind_proxy} onChange={(event) => setForm({ ...form, behind_proxy: event.target.checked })} /><span className="checkbox-ui"><Icon name="check" /></span><span>Behind reverse proxy</span></label>
            </div>
          </div>

          <div className="form-actions">
            <Link className="btn btn-ghost" to="/admin/nodes">Cancel</Link>
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "plus"} className={busy ? "spin" : ""} /> Register node</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function NodeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const nodeId = Number(id);
  const [node, setNode] = useState<any>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState({ ip: "0.0.0.0", start: 25565, end: 25575, notes: "" });
  const [rangeBusy, setRangeBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.adminNode(nodeId);
      setNode(response.data);
      setEditForm({
        name: response.data.name,
        fqdn: response.data.fqdn,
        location_id: response.data.location_id,
        scheme: response.data.scheme,
        memory: response.data.memory,
        memory_overallocate: response.data.memory_overallocate,
        disk: response.data.disk,
        disk_overallocate: response.data.disk_overallocate,
        cpu: response.data.cpu,
        daemon_listen: response.data.daemon_listen,
        daemon_sftp: response.data.daemon_sftp,
        public: !!response.data.public,
        behind_proxy: !!response.data.behind_proxy,
      });
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load node");
    }
  }, [nodeId]);

  useEffect(() => {
    load();
    api.adminLocations().then((response) => setLocations(response.data));
  }, [load]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!node || !editForm) return <LoadingPage label="Loading node" />;

  const live = node.live;
  const memoryPercent = Math.min(100, (node.memory_allocated / Math.max(node.memory, 1)) * 100);
  const diskPercent = Math.min(100, (node.disk_allocated / Math.max(node.disk, 1)) * 100);

  async function saveNode(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.adminUpdateNode(nodeId, editForm);
      notify("Node configuration saved");
      setEditOpen(false);
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to update node", "error");
    } finally {
      setSaving(false);
    }
  }

  async function assignRange(event: FormEvent) {
    event.preventDefault();
    setRangeBusy(true);
    try {
      const result = await api.adminCreateAllocations(nodeId, range);
      notify(`${result.created} allocation${result.created === 1 ? "" : "s"} created`);
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to assign range", "error");
    } finally {
      setRangeBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={<><Link to="/admin/nodes">Node fleet</Link> <span className="dot-separator" /> {node.location}</> as any}
        title={<span className="title-with-status">{node.name} <span className={`pill pill-${daemonTone(node.daemon)}`}>{node.daemon}</span></span>}
        description={`${node.fqdn} · Runtime ${node.wings} · ${node.runtime} engine`}
        actions={
          <>
            <Link className="btn btn-ghost" to="/admin/nodes"><Icon name="arrow-left" /> Back</Link>
            <button className="btn" onClick={() => setEditOpen(true)}><Icon name="pen" /> Edit node</button>
            <button type="button" className={`btn ${node.maintenance ? "btn-warning" : "btn-ghost"}`} onClick={async () => { await api.adminUpdateNode(nodeId, { maintenance: !node.maintenance }); notify(node.maintenance ? "Maintenance disabled" : "Maintenance enabled"); await load(); }}>
              <Icon name="screwdriver-wrench" /> {node.maintenance ? "Disable maintenance" : "Maintenance"}
            </button>
            {nodeId !== 1 && (
              <ConfirmButton className="btn btn-danger-ghost" icon="trash-can" title={`Delete ${node.name}?`} description="The node must not contain servers. All unassigned allocations and the daemon token will be removed." confirmLabel="Delete node" onConfirm={async () => { await api.adminDeleteNode(nodeId); notify("Node deleted"); nav("/admin/nodes"); }}>Delete</ConfirmButton>
            )}
          </>
        }
      />

      {node.maintenance && <div className="banner banner-warning"><Icon name="screwdriver-wrench" /><div><strong>Maintenance mode is active</strong><span>New servers cannot be provisioned on this node.</span></div></div>}

      <section className="kpi-grid kpi-grid-compact">
        <Kpi label="Connected" value={live ? "Live" : "Offline"} sub={live?.hostname || node.fqdn} icon="tower-broadcast" tone={live ? "success" : "neutral"} />
        <Kpi label="CPU" value={live ? `${live.cpu}%` : "—"} sub={live ? plural(live.cores, "core") : "No telemetry"} icon="microchip" tone="accent" />
        <Kpi label="Memory" value={live ? fmtBytes(live.memory.used) : "—"} sub={live ? `${live.memory.percent}% of ${fmtBytes(live.memory.total)}` : "No telemetry"} icon="memory" tone="violet" />
        <Kpi label="Disk" value={live ? fmtBytes(live.disk.used) : "—"} sub={live ? `${live.disk.percent}% of ${fmtBytes(live.disk.total)}` : "No telemetry"} icon="hard-drive" tone="info" />
      </section>

      <div className="node-detail-grid">
        <div className="node-detail-main">
          <section className="card">
            <div className="card-head"><div><h2>Capacity allocation</h2><p>Committed resources versus node limits.</p></div></div>
            <div className="card-body capacity-grid">
              <div>
                <div className="capacity-head"><span><Icon name="memory" /> Memory</span><strong>{node.memory_allocated} / {node.memory} MiB</strong></div>
                <div className="track mem"><i style={{ width: `${memoryPercent}%` }} /></div>
                <span className="capacity-note">{Math.max(0, node.memory - node.memory_allocated)} MiB remaining · {node.memory_overallocate}% overallocation allowed</span>
              </div>
              <div>
                <div className="capacity-head"><span><Icon name="hard-drive" /> Disk</span><strong>{node.disk_allocated} / {node.disk} MiB</strong></div>
                <div className="track disk"><i style={{ width: `${diskPercent}%` }} /></div>
                <span className="capacity-note">{Math.max(0, node.disk - node.disk_allocated)} MiB remaining · {node.disk_overallocate}% overallocation allowed</span>
              </div>
              <div className="capacity-summary">
                <div><span>Workloads</span><strong>{node.running} <small>/ {node.servers} running</small></strong></div>
                <div><span>Allocations</span><strong>{node.allocations?.free ?? 0} <small>free / {node.allocations?.total ?? 0}</small></strong></div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Allocations</h2><p>Port ranges available to workloads on this node.</p></div><span className="pill pill-neutral">{node.allocations?.free ?? 0} free</span></div>
            <form className="range-form" onSubmit={assignRange}>
              <div className="field"><label>IP address</label><input value={range.ip} onChange={(event) => setRange({ ...range, ip: event.target.value })} /></div>
              <div className="field"><label>Start port</label><input type="number" min={1} max={65535} value={range.start} onChange={(event) => setRange({ ...range, start: Number(event.target.value) })} /></div>
              <div className="field"><label>End port</label><input type="number" min={1} max={65535} value={range.end} onChange={(event) => setRange({ ...range, end: Number(event.target.value) })} /></div>
              <div className="field"><label>Notes</label><input value={range.notes} onChange={(event) => setRange({ ...range, notes: event.target.value })} placeholder="Optional label" /></div>
              <button className="btn btn-primary" disabled={rangeBusy}><Icon name={rangeBusy ? "circle-notch" : "plus"} className={rangeBusy ? "spin" : ""} /> Assign range</button>
            </form>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Address</th><th>Assignment</th><th>Notes</th><th /></tr></thead>
                <tbody>
                  {(node.allocation_list || []).slice(0, 60).map((allocation: any) => (
                    <tr key={allocation.id}>
                      <td><code className="address-inline">{allocation.ip}:{allocation.port}</code></td>
                      <td>{allocation.server_id ? <Link className="entity-name" to={`/server/${allocation.server_id}`}>{allocation.server_id.slice(0, 8)}</Link> : <span className="pill pill-neutral">Free</span>}</td>
                      <td className="muted">{allocation.notes || "—"}</td>
                      <td>{!allocation.server_id && <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${allocation.ip}:${allocation.port}?`} description="The unassigned allocation will be removed from the pool." confirmLabel="Delete allocation" onConfirm={async () => { await api.adminDeleteAllocation(allocation.id); notify("Allocation deleted"); await load(); }}><span className="sr-only">Delete</span></ConfirmButton>}</td>
                    </tr>
                  ))}
                  {!(node.allocation_list || []).length && <tr><td colSpan={4}><EmptyState icon="plug" title="No allocations" description="Assign a port range to begin provisioning workloads." /></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div><h2>Workloads</h2><p>Servers currently registered on this node.</p></div><span className="pill pill-neutral">{node.server_list?.length || 0}</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Server</th><th>Owner</th><th>Port</th><th>Memory</th><th>Status</th></tr></thead>
                <tbody>
                  {(node.server_list || []).map((server: any) => (
                    <tr key={server.id}>
                      <td><Link className="entity-name" to={`/server/${server.id}`}>{server.name}</Link></td>
                      <td>{server.owner_name}</td>
                      <td><code className="address-inline">{server.allocation_port}</code></td>
                      <td className="mono">{server.memory} MiB</td>
                      <td><StatusPill status={server.status} /></td>
                    </tr>
                  ))}
                  {!(node.server_list || []).length && <tr><td colSpan={5}><EmptyState icon="server" title="No workloads" description="Provision a server on this node to see it here." /></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="node-detail-side">
          <div className="card">
            <div className="card-head"><div><h2>Daemon configuration</h2><p>Paste into the daemon configuration.</p></div><CopyButton value={node.wings_config || ""} label="Copy YAML" className="btn btn-ghost btn-sm" /></div>
            <pre className="config-box">{node.wings_config}</pre>
            <div className="card-body daemon-token">
              <span>Daemon token</span>
              <div><code>{String(node.token || "").slice(0, 18)}…</code><CopyButton value={node.token || ""} label="Copy token" /></div>
              <ConfirmButton className="btn btn-ghost btn-sm" icon="arrows-rotate" title="Regenerate daemon token?" description="The node's current token will stop working immediately. Update the daemon configuration before restarting it." confirmLabel="Regenerate token" tone="warning" onConfirm={async () => { await api.adminRegenerateToken(nodeId); notify("Daemon token regenerated"); await load(); }}>Regenerate token</ConfirmButton>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Daemon details</h2><p>Registration endpoints.</p></div></div>
            <div className="card-body identity-list">
              <div><span>API endpoint</span><code>{node.scheme}://{node.fqdn}:{node.daemon_listen}</code></div>
              <div><span>SFTP</span><code>{node.fqdn}:{node.daemon_sftp}</code></div>
              <div><span>UUID</span><code>{node.uuid}</code></div>
              <div><span>Public</span><span>{node.public ? "Yes" : "No"}</span></div>
              <div><span>Behind proxy</span><span>{node.behind_proxy ? "Yes" : "No"}</span></div>
              <div><span>Created</span><span>{fmtDate(node.created_at)}</span></div>
            </div>
          </div>
        </aside>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit node configuration"
        description="Changes apply to the panel record. Update the daemon separately when endpoints change."
        size="wide"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveNode} disabled={saving}><Icon name={saving ? "circle-notch" : "floppy-disk"} className={saving ? "spin" : ""} /> Save configuration</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field"><label>Name</label><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></div>
          <div className="field"><label>FQDN</label><input value={editForm.fqdn} onChange={(event) => setEditForm({ ...editForm, fqdn: event.target.value })} /></div>
          <div className="field"><label>Location</label><select value={editForm.location_id} onChange={(event) => setEditForm({ ...editForm, location_id: Number(event.target.value) })}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
          <div className="field"><label>Scheme</label><select value={editForm.scheme} onChange={(event) => setEditForm({ ...editForm, scheme: event.target.value })}><option value="http">http</option><option value="https">https</option></select></div>
          <div className="field"><label>Memory (MiB)</label><input type="number" value={editForm.memory} onChange={(event) => setEditForm({ ...editForm, memory: Number(event.target.value) })} /></div>
          <div className="field"><label>Disk (MiB)</label><input type="number" value={editForm.disk} onChange={(event) => setEditForm({ ...editForm, disk: Number(event.target.value) })} /></div>
          <div className="field"><label>CPU (%)</label><input type="number" value={editForm.cpu} onChange={(event) => setEditForm({ ...editForm, cpu: Number(event.target.value) })} /></div>
          <div className="field"><label>API port</label><input type="number" value={editForm.daemon_listen} onChange={(event) => setEditForm({ ...editForm, daemon_listen: Number(event.target.value) })} /></div>
          <div className="field"><label>SFTP port</label><input type="number" value={editForm.daemon_sftp} onChange={(event) => setEditForm({ ...editForm, daemon_sftp: Number(event.target.value) })} /></div>
          <div className="field"><label>Memory overallocate (%)</label><input type="number" value={editForm.memory_overallocate} onChange={(event) => setEditForm({ ...editForm, memory_overallocate: Number(event.target.value) })} /></div>
          <div className="field"><label>Disk overallocate (%)</label><input type="number" value={editForm.disk_overallocate} onChange={(event) => setEditForm({ ...editForm, disk_overallocate: Number(event.target.value) })} /></div>
          <div className="field field-checks">
            <label>Visibility</label>
            <label className="check-row"><input type="checkbox" checked={editForm.public} onChange={(event) => setEditForm({ ...editForm, public: event.target.checked })} /><span className="checkbox-ui"><Icon name="check" /></span><span>Public node</span></label>
            <label className="check-row"><input type="checkbox" checked={editForm.behind_proxy} onChange={(event) => setEditForm({ ...editForm, behind_proxy: event.target.checked })} /><span className="checkbox-ui"><Icon name="check" /></span><span>Behind reverse proxy</span></label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function Nests() {
  const [nests, setNests] = useState<any[] | null>(null);
  const [eggs, setEggs] = useState<EggCatalogEntry[]>([]);
  const [catalog, setCatalog] = useState({ nests: 0, eggs: 0, version: "" });
  const [catalogHealth, setCatalogHealth] = useState<{ repaired?: boolean; missing?: number[]; known_egg_ids?: number[] } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [installFilter, setInstallFilter] = useState<"all" | "installed" | "missing">("all");
  const [selectedEggs, setSelectedEggs] = useState<number[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [nestOpen, setNestOpen] = useState(false);
  const [eggOpen, setEggOpen] = useState(false);
  const [nestForm, setNestForm] = useState({ name: "", description: "" });
  const [eggForm, setEggForm] = useState({
    nest_id: 0,
    name: "",
    description: "",
    docker_image: "python:3.11-slim",
    startup: "python3 main.py",
    runtime: "process",
  });
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<number[]>([]);
  const [bulkOwner, setBulkOwner] = useState(0);
  const [bulkNode, setBulkNode] = useState(0);
  const [bulkPrefix, setBulkPrefix] = useState("");
  const [bulkMemory, setBulkMemory] = useState(256);
  const [bulkDisk, setBulkDisk] = useState(1024);
  const [bulkStart, setBulkStart] = useState(false);
  const [bulkEula, setBulkEula] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkInstallResult[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await api.adminNests();
      setNests(response.nests);
      setEggs(response.eggs);
      setCatalog(response.catalog || { nests: response.nests.length, eggs: response.eggs.length, version: "" });
      setCatalogHealth(response.catalog_health || null);
      setEggForm((current) => ({
        ...current,
        nest_id: current.nest_id || response.nests[0]?.id || 0,
      }));
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load nests");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.adminUsers(), api.adminNodes()]).then(([userResult, nodeResult]) => {
      if (!alive) return;
      if (userResult.status === "fulfilled") setUsers(userResult.value.data);
      if (nodeResult.status === "fulfilled") setNodes(nodeResult.value.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setSelectedEggs((current) => current.filter((id) => eggs.some((egg) => egg.id === id)));
  }, [eggs]);

  useEffect(() => {
    if (!bulkOpen) return;
    setBulkOwner((current) => current || users.find((user) => user.role === "admin")?.id || users[0]?.id || 0);
    setBulkNode((current) => current || nodes.find((node) => node.daemon === "connected")?.id || nodes[0]?.id || 0);
  }, [bulkOpen, users, nodes]);

  const needle = query.trim().toLowerCase();
  const installedCount = eggs.filter(eggInstalled).length;
  const missingEggs = eggs.filter((egg) => !eggInstalled(egg));
  const coverage = eggs.length ? Math.round((installedCount / eggs.length) * 100) : 0;

  function matchesInstallFilter(egg: EggCatalogEntry): boolean {
    if (installFilter === "installed") return eggInstalled(egg);
    if (installFilter === "missing") return !eggInstalled(egg);
    return true;
  }

  function matchesSearch(egg: EggCatalogEntry, nest: any): boolean {
    if (!needle) return true;
    return (
      nest.name.toLowerCase().includes(needle) ||
      (nest.description || "").toLowerCase().includes(needle) ||
      `${egg.name} ${egg.description} ${egg.startup} ${egg.docker_image}`.toLowerCase().includes(needle)
    );
  }

  const visibleNests = (nests || []).filter((nest) => {
    const nestEggs = eggs.filter((egg) => egg.nest_id === nest.id);
    const matching = nestEggs.filter((egg) => matchesInstallFilter(egg) && matchesSearch(egg, nest));
    if (matching.length) return true;
    if (installFilter !== "all") return false;
    if (!needle) return true;
    return nest.name.toLowerCase().includes(needle) || (nest.description || "").toLowerCase().includes(needle);
  });

  const bulkEggs = useMemo(
    () => bulkIds.map((id) => eggs.find((egg) => egg.id === id)).filter(Boolean) as EggCatalogEntry[],
    [bulkIds, eggs]
  );
  const bulkNodeData = nodes.find((node) => node.id === bulkNode);
  const bulkMemLimit = bulkNodeData
    ? Number(bulkNodeData.memory || 0) * (1 + Number(bulkNodeData.memory_overallocate || 0) / 100)
    : 0;
  const bulkDiskLimit = bulkNodeData
    ? Number(bulkNodeData.disk || 0) * (1 + Number(bulkNodeData.disk_overallocate || 0) / 100)
    : 0;
  const bulkMemFree = Math.max(0, bulkMemLimit - Number(bulkNodeData?.memory_allocated || 0));
  const bulkDiskFree = Math.max(0, bulkDiskLimit - Number(bulkNodeData?.disk_allocated || 0));
  const bulkPlan = bulkEggs.reduce(
    (total, egg) => {
      const defaults = eggDefaults(egg);
      const memory = Number(egg.id) === 27 || Number(egg.id) === 28 ? defaults.memory : bulkMemory;
      const disk = Number(egg.id) === 27 || Number(egg.id) === 28 ? defaults.disk : bulkDisk;
      return { memory: total.memory + memory, disk: total.disk + disk };
    },
    { memory: 0, disk: 0 }
  );
  const bulkIncludesMinecraft = bulkEggs.some((egg) => egg.id === 27 || egg.id === 28);
  const bulkOverCapacity =
    !!bulkNodeData && (bulkPlan.memory > bulkMemFree || bulkPlan.disk > bulkDiskFree);
  const bulkStarted = bulkResults.some((result) => result.status !== "pending");
  const bulkFinished =
    bulkResults.length > 0 &&
    bulkResults.every((result) => result.status === "created" || result.status === "failed");
  const bulkCreated = bulkResults.filter((result) => result.status === "created").length;
  const bulkFailed = bulkResults.filter((result) => result.status === "failed").length;

  async function syncCatalog() {
    setSyncing(true);
    try {
      const result = await api.adminSyncNests();
      notify(`Catalogue synced: ${plural(result.nests, "nest")} and ${plural(result.eggs, "egg")}`);
      await load();
    } catch (err: any) {
      notify(err.message || "Catalogue sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function createNest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.adminCreateNest(nestForm);
      notify("Nest created");
      setNestOpen(false);
      setNestForm({ name: "", description: "" });
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to create nest", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createEgg(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.adminCreateEgg(eggForm);
      notify("Egg created");
      setEggOpen(false);
      setEggForm((current) => ({ ...current, name: "", description: "" }));
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to create egg", "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleEgg(id: number) {
    setSelectedEggs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function openBulk(ids: number[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return;
    const selected = unique
      .map((id) => eggs.find((egg) => egg.id === id))
      .filter(Boolean) as EggCatalogEntry[];
    setBulkIds(unique);
    setBulkResults(
      selected.map((egg) => ({
        eggId: egg.id,
        name: egg.name,
        status: "pending",
        message: "Waiting",
      }))
    );
    setBulkOwner((current) => current || users.find((user) => user.role === "admin")?.id || users[0]?.id || 0);
    setBulkNode((current) => current || nodes.find((node) => node.daemon === "connected")?.id || nodes[0]?.id || 0);
    setBulkEula(false);
    setBulkOpen(true);
  }

  function closeBulk() {
    if (bulkBusy) return;
    setBulkOpen(false);
  }

  async function startBulk() {
    if (!bulkEggs.length || !bulkOwner || !bulkNode) {
      notify("Choose an owner and node before installing", "error");
      return;
    }
    if (bulkIncludesMinecraft && !bulkEula) {
      notify("Accept the Minecraft EULA before installing Minecraft eggs", "error");
      return;
    }
    setBulkBusy(true);
    let created = 0;
    let failed = 0;
    const createdIds: number[] = [];
    for (const egg of bulkEggs) {
      const defaults = eggDefaults(egg);
      const minecraft = egg.id === 27 || egg.id === 28;
      const memory = minecraft ? defaults.memory : bulkMemory;
      const disk = minecraft ? defaults.disk : bulkDisk;
      const environment = Object.fromEntries(
        eggVars(egg).map((variable: any) => [variable.env, variable.default || ""])
      );
      setBulkResults((current) =>
        current.map((result) =>
          result.eggId === egg.id
            ? { ...result, status: "running", message: "Provisioning server" }
            : result
        )
      );
      const payload: any = {
        name: `${bulkPrefix.trim() ? `${bulkPrefix.trim()} · ` : ""}${egg.name}`,
        description: `Provisioned from the ${egg.name} egg by the catalogue installer.`,
        egg_id: egg.id,
        owner_id: bulkOwner,
        node_id: bulkNode,
        memory,
        cpu: 100,
        disk,
        environment,
        start_on_completion: bulkStart,
      };
      if (minecraft) {
        payload.minecraft = {
          software: egg.id === 28 ? "bedrock" : "paper",
          version: "",
          loader_version: "",
          accept_eula: bulkEula,
          properties: { motd: environment.MOTD || environment.SERVER_NAME || egg.name },
        };
        payload.accept_eula = bulkEula;
      }
      try {
        const response: any = await api.adminCreateServer(payload);
        created += 1;
        createdIds.push(egg.id);
        setBulkResults((current) =>
          current.map((result) =>
            result.eggId === egg.id
              ? {
                  ...result,
                  status: "created",
                  message: response?.minecraft_job
                    ? "Server created, Minecraft installation queued"
                    : "Server provisioned",
                  serverId: response?.data?.id,
                }
              : result
          )
        );
      } catch (err: any) {
        failed += 1;
        setBulkResults((current) =>
          current.map((result) =>
            result.eggId === egg.id
              ? {
                  ...result,
                  status: "failed",
                  message: err?.message || "Provisioning failed",
                }
              : result
          )
        );
      }
    }
    setBulkBusy(false);
    setSelectedEggs((current) => current.filter((id) => !createdIds.includes(id)));
    await load();
    notify(
      failed
        ? `${created} installed, ${failed} could not be provisioned`
        : `${created} server${created === 1 ? "" : "s"} installed from the catalogue`,
      failed ? "info" : "success"
    );
  }

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!nests) return <LoadingPage label="Loading nests" />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Nests & eggs"
        description={`${installedCount} of ${plural(eggs.length, "egg")} installed · ${plural(nests.length, "nest")} · catalogue ${catalog.version || "2.1.0"}`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>
            <button
              className="btn btn-primary"
              onClick={() => openBulk(missingEggs.map((egg) => egg.id))}
              disabled={!missingEggs.length}
              title="Deploy one server from every egg that does not have a deployment yet"
            >
              <Icon name="cloud-arrow-down" /> Install all missing
            </button>
            <button className="btn" onClick={() => setNestOpen(true)}><Icon name="folder-plus" /> New nest</button>
            <button className="btn" onClick={() => setEggOpen(true)}><Icon name="plus" /> New egg</button>
            <button className="btn btn-ghost" disabled={syncing} onClick={syncCatalog}>
              <Icon name={syncing ? "circle-notch" : "download"} className={syncing ? "spin" : ""} /> Sync catalogue
            </button>
          </>
        }
      />
      {catalogHealth?.repaired && (
        <div className="banner banner-warning">
          <Icon name="circle-info" />
          <div>
            <strong>Catalogue repaired</strong>
            <span>
              Missing built-in eggs were restored automatically. Minecraft Java and Bedrock are
              available again, and new servers can be created normally.
            </span>
          </div>
        </div>
      )}
      {catalogHealth && !catalogHealth.repaired && (catalogHealth.missing?.length || 0) > 0 && (
        <div className="banner banner-error">
          <Icon name="circle-exclamation" />
          <div>
            <strong>Built-in eggs are missing</strong>
            <span>
              Missing IDs: {catalogHealth.missing?.join(", ")}. Run Sync catalogue or redeploy the
              current backend, then reload this page.
            </span>
          </div>
        </div>
      )}
      <section className="catalogue-overview">
        <div className="catalogue-overview-copy">
          <span className="eyebrow">Deployment coverage</span>
          <div className="catalogue-overview-count">
            <strong>{installedCount}</strong>
            <span>/ {plural(eggs.length, "egg")} installed</span>
          </div>
          <p>
            {missingEggs.length
              ? `${missingEggs.length} egg${missingEggs.length === 1 ? "" : "s"} still need a first deployment.`
              : "Every egg in the catalogue has at least one deployment."}
          </p>
        </div>
        <div className="catalogue-overview-meter">
          <div className="catalogue-meter-head">
            <span>Coverage</span>
            <strong>{coverage}%</strong>
          </div>
          <div className="catalogue-meter" role="img" aria-label={`${coverage}% of eggs installed`}>
            <i style={{ width: `${coverage}%` }} />
          </div>
          <div className="catalogue-legend">
            <span><i className="catalogue-dot installed" /> {installedCount} installed</span>
            <span><i className="catalogue-dot missing" /> {missingEggs.length} not installed</span>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="magnifying-glass" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nests, eggs, startup commands" />
        </div>
        <div className="segmented egg-filter">
          {([
            { id: "all", label: "All", count: eggs.length },
            { id: "installed", label: "Installed", count: installedCount },
            { id: "missing", label: "Not installed", count: missingEggs.length },
          ] as const).map((item) => (
            <button
              key={item.id}
              type="button"
              className={installFilter === item.id ? "active" : ""}
              onClick={() => setInstallFilter(item.id)}
            >
              {item.label} <em>{item.count}</em>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setSelectedEggs(missingEggs.map((egg) => egg.id))}
          disabled={!missingEggs.length}
        >
          <Icon name="check-double" /> Select missing
        </button>
        <span className="pill pill-neutral">{plural(visibleNests.length, "nest")} shown</span>
      </div>

      {selectedEggs.length > 0 && (
        <div className="selection-tray">
          <span className="selection-tray-icon"><Icon name="layer-group" /></span>
          <div className="selection-tray-copy">
            <strong>{selectedEggs.length} egg{selectedEggs.length === 1 ? "" : "s"} selected</strong>
            <span>Each selection becomes a separate server. Existing deployments are not touched.</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedEggs([])}>
            Clear
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openBulk(selectedEggs)}>
            <Icon name="cloud-arrow-down" /> Install selected
          </button>
        </div>
      )}
      <div className="nest-list">
        {visibleNests.length === 0 && (
          <EmptyState
            icon="layer-group"
            title={installFilter === "missing" ? "Every egg is installed" : "No matching nests"}
            description={
              installFilter === "missing"
                ? "All catalogue eggs already have at least one deployment."
                : "Try another search or clear the installation filter."
            }
          />
        )}
        {visibleNests.map((nest) => {
          const nestEggs = eggs.filter(
            (egg) => egg.nest_id === nest.id && matchesInstallFilter(egg) && matchesSearch(egg, nest)
          );
          if (!nestEggs.length) return null;
          const nestInstalled = nestEggs.filter(eggInstalled).length;
          return (
            <section className="card nest-card" key={nest.id}>
              <div className="card-head">
                <div className="nest-title">
                  <span className="node-icon"><Icon name={eggIcon(nest.name)} brand={eggBrand(nest.name)} /></span>
                  <div><h2>{nest.name}</h2><p>{nest.description}</p></div>
                </div>
                <div className="nest-head-meta">
                  <span className="nest-count">
                    <strong>{nestInstalled}</strong>
                    <span>of {nestEggs.length} installed</span>
                  </span>
                  <span className="pill pill-neutral">{nestEggs.length} egg{nestEggs.length === 1 ? "" : "s"}{nest.id >= 1000 ? " · custom" : ""}</span>
                </div>
              </div>
              <div className="egg-grid">
                {nestEggs.map((egg, index) => {
                  const installed = eggInstalled(egg);
                  const deployments = Number(egg.deployments || 0);
                  const selected = selectedEggs.includes(egg.id);
                  return (
                    <article
                      className={`egg-tile ${installed ? "is-installed" : "is-missing"} ${selected ? "is-selected" : ""}`}
                      key={egg.id}
                      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
                      onClick={() => toggleEgg(egg.id)}
                    >
                      <div className="egg-tile-head">
                        <label className="egg-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleEgg(egg.id)}
                            aria-label={`Select ${egg.name}`}
                          />
                          <span className="checkbox-ui"><Icon name="check" /></span>
                        </label>
                        <div className="egg-tile-title">
                          <strong className="egg-name">{egg.name}</strong>
                          <span className="egg-tile-kicker">#{egg.id} · {egg.runtime} runtime</span>
                        </div>
                        <span className={`egg-status ${installed ? "installed" : "missing"}`}>
                          <i />
                          {installed ? "Installed" : "Not installed"}
                        </span>
                      </div>
                      <p>{egg.description}</p>
                      <div className="egg-tile-meta">
                        <span><Icon name="cube" /> {egg.docker_image}</span>
                        <span><Icon name="terminal" /> {egg.startup}</span>
                      </div>
                      <div className="egg-tile-foot">
                        <span>
                          {deployments
                            ? `${deployments} deployment${deployments === 1 ? "" : "s"}`
                            : "No deployments"} · {eggVars(egg).length} var{eggVars(egg).length === 1 ? "" : "s"}
                        </span>
                        <div className="egg-tile-actions">
                          <Link
                            className="btn btn-ghost btn-sm"
                            to={`/admin/servers/new?egg=${egg.id}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Icon name="sliders" /> Configure
                          </Link>
                          <button
                            type="button"
                            className="btn btn-sm egg-install-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              openBulk([egg.id]);
                            }}
                          >
                            <Icon name={installed ? "plus" : "cloud-arrow-down"} />
                            {installed ? "Another" : "Install"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <Modal open={nestOpen} onClose={() => setNestOpen(false)} title="Create nest" description="Custom nests use IDs above 1000 so catalog updates never overwrite them." footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setNestOpen(false)}>Cancel</button>
          <button type="submit" form="create-nest" className="btn btn-primary" disabled={busy}>{busy ? "Saving" : "Create nest"}</button>
        </>
      }>
        <form id="create-nest" className="form-grid" onSubmit={createNest}>
          <div className="field full">
            <label>Name</label>
            <input value={nestForm.name} onChange={(event) => setNestForm({ ...nestForm, name: event.target.value })} required minLength={2} placeholder="Modpacks" />
          </div>
          <div className="field full">
            <label>Description</label>
            <input value={nestForm.description} onChange={(event) => setNestForm({ ...nestForm, description: event.target.value })} placeholder="What this nest contains" />
          </div>
        </form>
      </Modal>

      <Modal open={eggOpen} onClose={() => setEggOpen(false)} title="Create egg" description="A default Python health listener is installed if you do not supply files." footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setEggOpen(false)}>Cancel</button>
          <button type="submit" form="create-egg" className="btn btn-primary" disabled={busy}>{busy ? "Saving" : "Create egg"}</button>
        </>
      }>
        <form id="create-egg" className="form-grid" onSubmit={createEgg}>
          <div className="field">
            <label>Nest</label>
            <select value={eggForm.nest_id} onChange={(event) => setEggForm({ ...eggForm, nest_id: Number(event.target.value) })}>
              {nests.map((nest) => <option key={nest.id} value={nest.id}>{nest.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Runtime</label>
            <select value={eggForm.runtime} onChange={(event) => setEggForm({ ...eggForm, runtime: event.target.value })}>
              <option value="process">process</option>
              <option value="docker">docker</option>
            </select>
          </div>
          <div className="field full">
            <label>Name</label>
            <input value={eggForm.name} onChange={(event) => setEggForm({ ...eggForm, name: event.target.value })} required minLength={2} placeholder="Custom HTTP" />
          </div>
          <div className="field full">
            <label>Description</label>
            <input value={eggForm.description} onChange={(event) => setEggForm({ ...eggForm, description: event.target.value })} placeholder="What this egg launches" />
          </div>
          <div className="field">
            <label>Image</label>
            <input className="mono" value={eggForm.docker_image} onChange={(event) => setEggForm({ ...eggForm, docker_image: event.target.value })} />
          </div>
          <div className="field">
            <label>Startup</label>
            <input className="mono" value={eggForm.startup} onChange={(event) => setEggForm({ ...eggForm, startup: event.target.value })} />
          </div>
        </form>
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={closeBulk}
        title="Install from the catalogue"
        description="Each selected egg becomes one server. Existing deployments are not modified."
        size="wide"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeBulk} disabled={bulkBusy}>
              {bulkFinished ? "Close" : "Cancel"}
            </button>
            {!bulkFinished && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={startBulk}
                disabled={
                  bulkBusy ||
                  !bulkEggs.length ||
                  !bulkOwner ||
                  !bulkNode ||
                  (bulkIncludesMinecraft && !bulkEula)
                }
              >
                <Icon name={bulkBusy ? "circle-notch" : "cloud-arrow-down"} className={bulkBusy ? "spin" : ""} />
                {bulkBusy ? "Installing" : `Install ${bulkEggs.length} egg${bulkEggs.length === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        }
      >
        <div className="bulk-install">
          <section className="bulk-plan">
            <div className="bulk-plan-head">
              <span className="eyebrow">Selected eggs</span>
              <span className="pill pill-neutral">{bulkEggs.length} selected</span>
            </div>
            <div className="bulk-chip-row">
              {bulkEggs.map((egg) => (
                <span className={`bulk-chip ${eggInstalled(egg) ? "installed" : "missing"}`} key={egg.id}>
                  <i />
                  {egg.name}
                </span>
              ))}
            </div>
            <p>
              Installed means at least one server already exists for that egg. Installing another
              adds a new server without replacing the existing one.
            </p>
          </section>

          <div className="form-grid">
            <div className="field">
              <label>Owner</label>
              <select value={bulkOwner} onChange={(event) => setBulkOwner(Number(event.target.value))}>
                <option value={0}>Select an account</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.username} · {user.email}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Node</label>
              <select value={bulkNode} onChange={(event) => setBulkNode(Number(event.target.value))}>
                <option value={0}>Select a node</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} · {node.daemon === "connected" ? "online" : node.daemon || "unknown"}
                  </option>
                ))}
              </select>
            </div>
            <div className="field full">
              <label>Name prefix <span className="field-hint">optional</span></label>
              <input
                value={bulkPrefix}
                onChange={(event) => setBulkPrefix(event.target.value)}
                placeholder="Catalogue"
                maxLength={40}
              />
              <span className="field-hint">
                Example: {bulkPrefix.trim() ? `${bulkPrefix.trim()} · ` : ""}{bulkEggs[0]?.name || "Python Generic"}
              </span>
            </div>
            <div className="field">
              <label>Memory per application</label>
              <input
                type="number"
                min={32}
                step={32}
                value={bulkMemory}
                onChange={(event) => setBulkMemory(Math.max(32, Number(event.target.value) || 0))}
              />
              <span className="field-hint">Minecraft eggs keep their own minimum.</span>
            </div>
            <div className="field">
              <label>Disk per application</label>
              <input
                type="number"
                min={128}
                step={128}
                value={bulkDisk}
                onChange={(event) => setBulkDisk(Math.max(128, Number(event.target.value) || 0))}
              />
              <span className="field-hint">MiB per non-Minecraft server.</span>
            </div>
          </div>

          <div className={`bulk-capacity ${bulkOverCapacity ? "is-over" : ""}`}>
            <div className="bulk-capacity-head">
              <span className="eyebrow">Node capacity</span>
              <span>{bulkNodeData ? plural(bulkEggs.length, "planned server") : "Choose a node"}</span>
            </div>
            {bulkNodeData ? (
              <>
                <div className="bulk-capacity-row">
                  <span>Memory</span>
                  <strong>{fmtMiB(bulkPlan.memory)} <em>of {fmtMiB(bulkMemFree)} free</em></strong>
                  <div className="bulk-capacity-track">
                    <i
                      className="memory"
                      style={{ width: `${Math.min(100, (bulkPlan.memory / Math.max(bulkMemFree, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="bulk-capacity-row">
                  <span>Disk</span>
                  <strong>{fmtMiB(bulkPlan.disk)} <em>of {fmtMiB(bulkDiskFree)} free</em></strong>
                  <div className="bulk-capacity-track">
                    <i
                      className="disk"
                      style={{ width: `${Math.min(100, (bulkPlan.disk / Math.max(bulkDiskFree, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
                {bulkOverCapacity && (
                  <p className="bulk-capacity-warning">
                    This plan exceeds the node's current free capacity. Lower the per-application
                    resources, choose another node, or install fewer eggs. Capacity failures are
                    reported per server.
                  </p>
                )}
              </>
            ) : (
              <p className="bulk-capacity-warning">Select a node to calculate the capacity plan.</p>
            )}
          </div>

          <div className="bulk-options">
            <label className="check-row">
              <input type="checkbox" checked={bulkStart} onChange={(event) => setBulkStart(event.target.checked)} />
              <span className="checkbox-ui"><Icon name="check" /></span>
              <span>Start each server after provisioning</span>
            </label>
            {bulkIncludesMinecraft && (
              <label className="check-row">
                <input type="checkbox" checked={bulkEula} onChange={(event) => setBulkEula(event.target.checked)} />
                <span className="checkbox-ui"><Icon name="check" /></span>
                <span>
                  I accept the{" "}
                  <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
                    Minecraft EULA
                  </a>{" "}
                  for the Minecraft servers in this batch
                </span>
              </label>
            )}
          </div>

          {(bulkStarted || bulkBusy) && (
            <div className="bulk-progress">
              <div className="bulk-progress-head">
                <span className="eyebrow">Provisioning</span>
                <span>
                  {bulkResults.filter((result) => result.status !== "pending" && result.status !== "running").length}
                  {" / "}
                  {bulkResults.length}
                </span>
              </div>
              <div className="bulk-progress-track">
                <i
                  style={{
                    width: `${(bulkResults.filter((result) => result.status === "created" || result.status === "failed").length / Math.max(bulkResults.length, 1)) * 100}%`,
                  }}
                />
              </div>
              <div className="bulk-results">
                {bulkResults.map((result) => (
                  <div className={`bulk-result is-${result.status}`} key={result.eggId}>
                    <span className="bulk-result-icon">
                      <Icon
                        name={
                          result.status === "created"
                            ? "circle-check"
                            : result.status === "failed"
                              ? "circle-exclamation"
                              : result.status === "running"
                                ? "circle-notch"
                                : "clock"
                        }
                        className={result.status === "running" ? "spin" : ""}
                      />
                    </span>
                    <strong>{result.name}</strong>
                    <span>{result.message}</span>
                    {result.serverId && <Link to={`/server/${result.serverId}`}>Open server</Link>}
                  </div>
                ))}
              </div>
              {bulkFinished && (
                <p className={`bulk-outcome ${bulkFailed ? "has-failures" : "is-clean"}`}>
                  {bulkFailed
                    ? `${bulkCreated} installed, ${bulkFailed} could not be provisioned. The results above include the reason for each failure.`
                    : `${bulkCreated} server${bulkCreated === 1 ? "" : "s"} installed successfully.`}
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export function Users() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");

  const load = useCallback(async () => {
    try {
      setRows((await api.adminUsers()).data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load users");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = query.trim().toLowerCase();
    return rows.filter((user) => {
      if (role !== "all" && user.role !== role) return false;
      if (!needle) return true;
      return [user.username, user.email, user.first_name, user.last_name].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [rows, query, role]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!rows) return <LoadingPage label="Loading users" />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Panel users"
        description={`${plural(rows.length, "account")} · ${plural(rows.filter((user) => user.role === "admin").length, "administrator")}`}
        actions={<Link className="btn btn-primary" to="/admin/users/new"><Icon name="user-plus" /> Create user</Link>}
      />
      <div className="toolbar">
        <div className="search-field"><Icon name="magnifying-glass" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users by name or email" /></div>
        <div className="segmented">
          {["all", "admin", "user"].map((item) => <button type="button" key={item} className={role === item ? "active" : ""} onClick={() => setRole(item)}>{item === "all" ? "All roles" : item === "admin" ? "Admin" : "Member"}</button>)}
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Workloads</th><th>Last sign-in</th><th>Created</th><th /></tr></thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="entity-cell">
                      <span className="avatar avatar-sm">{(user.first_name?.[0] || user.username.slice(0, 1)).toUpperCase()}</span>
                      <div>
                        <Link className="entity-name" to={`/admin/users/${user.id}`}>{user.username}</Link>
                        <span className="entity-meta">{user.email}{user.first_name || user.last_name ? ` · ${[user.first_name, user.last_name].filter(Boolean).join(" ")}` : ""}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className={`pill ${user.role === "admin" ? "pill-ok" : "pill-neutral"}`}><Icon name={user.role === "admin" ? "shield-halved" : "user"} /> {user.role === "admin" ? "Administrator" : "Member"}</span></td>
                  <td><span className="limit-inline"><Icon name="server" /> {user.servers ?? 0}</span></td>
                  <td className="muted">{timeAgo(user.last_login)}</td>
                  <td className="muted">{fmtDate(user.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="icon-btn" to={`/admin/users/${user.id}`} title="Edit user"><Icon name="pen" /></Link>
                      <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${user.username}?`} description="Accounts that still own workloads cannot be deleted. Transfer or delete their servers first." confirmLabel="Delete user" onConfirm={async () => { await api.adminDeleteUser(user.id); notify("User deleted"); await load(); }}>
                        <span className="sr-only">Delete</span>
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6}><EmptyState icon="users" title="No users match this view" description="Adjust your search or role filter." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function NewUser() {
  const nav = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "user", first_name: "", last_name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.adminCreateUser(form);
      notify("User account created");
      nav("/admin/users");
    } catch (err: any) {
      setError(err.message || "Unable to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Access control" title="Create user" description="Issue a panel account and assign the appropriate role." actions={<Link className="btn btn-ghost" to="/admin/users"><Icon name="arrow-left" /> Back</Link>} />
      <form className="card form-page" onSubmit={submit}>
        <div className="card-body">
          {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
          <div className="form-grid">
            <div className="field"><label>First name</label><input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></div>
            <div className="field"><label>Last name</label><input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></div>
            <div className="field"><label>Username</label><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} minLength={3} required /></div>
            <div className="field"><label>Email address</label><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>
            <div className="field"><label>Initial password</label><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required /><span className="field-help">At least 8 characters. Share it through a secure channel.</span></div>
          </div>
          <div className="role-choice">
            {[
              { id: "user", icon: "user", title: "Member", text: "Can manage assigned workloads and their own account." },
              { id: "admin", icon: "shield-halved", title: "Administrator", text: "Full access to nodes, users, settings and every workload." },
            ].map((role) => (
              <label className={`role-option ${form.role === role.id ? "selected" : ""}`} key={role.id}>
                <input type="radio" name="role" checked={form.role === role.id} onChange={() => setForm({ ...form, role: role.id })} />
                <span className="role-option-icon"><Icon name={role.icon} /></span>
                <div><strong>{role.title}</strong><span>{role.text}</span></div>
                <span className="role-check"><Icon name="check" /></span>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <Link className="btn btn-ghost" to="/admin/users">Cancel</Link>
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "user-plus"} className={busy ? "spin" : ""} /> Create account</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function EditUser() {
  const { id } = useParams();
  const userId = Number(id);
  const nav = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [servers, setServers] = useState<any[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await api.adminUser(userId);
    setUser(response.data);
    setForm({
      username: response.data.username,
      email: response.data.email,
      role: response.data.role,
      first_name: response.data.first_name || "",
      last_name: response.data.last_name || "",
    });
    setServers(response.data.servers || []);
  }, [userId]);

  useEffect(() => { load().catch((err) => notify(err.message, "error")); }, [load]);

  if (!form || !user) return <LoadingPage label="Loading user" />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      if (password) body.password = password;
      await api.adminUpdateUser(userId, body);
      setPassword("");
      notify("User updated");
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to update user", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Access control" title={user.username} description={`Account #${user.id} · joined ${fmtDate(user.created_at)}`} actions={<Link className="btn btn-ghost" to="/admin/users"><Icon name="arrow-left" /> Back to users</Link>} />
      <div className="user-detail-grid">
        <form className="card" onSubmit={submit}>
          <div className="card-head"><div><h2>Account details</h2><p>Identity, contact address and role.</p></div></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="field"><label>Username</label><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} minLength={3} required /></div>
              <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>
              <div className="field"><label>First name</label><input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></div>
              <div className="field"><label>Last name</label><input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></div>
              <div className="field"><label>Role</label><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="user">Member</option><option value="admin">Administrator</option></select></div>
              <div className="field"><label>Reset password</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep current" minLength={8} /></div>
            </div>
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save changes</button>
          </div>
        </form>
        <aside className="user-detail-side">
          <div className="card">
            <div className="card-head"><div><h2>Account summary</h2><p>Current access context.</p></div></div>
            <div className="card-body identity-list">
              <div><span>Role</span><span>{user.role}</span></div>
              <div><span>Workloads</span><span>{servers.length}</span></div>
              <div><span>Last sign-in</span><span>{timeAgo(user.last_login)}</span></div>
              <div><span>Created</span><span>{fmtDate(user.created_at)}</span></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Owned workloads</h2><p>Servers assigned to this account.</p></div></div>
            <div className="server-mini-list">
              {servers.map((server) => (
                <Link className="server-mini" key={server.id} to={`/server/${server.id}`}>
                  <span className={`server-egg icon-only ${server.status === "running" ? "online" : ""}`}><Icon name="server" /></span>
                  <div><strong>{server.name}</strong><span>Port {server.allocation_port} · {server.status}</span></div>
                  <Icon name="arrow-right" />
                </Link>
              ))}
              {!servers.length && <EmptyState icon="server" title="No workloads" description="This user does not own any servers yet." />}
            </div>
          </div>
          <div className="card danger-card">
            <div className="card-body">
              <div className="danger-action">
                <div><strong>Delete account</strong><span>Only possible when no workloads remain assigned.</span></div>
                <ConfirmButton className="btn btn-danger-ghost" icon="trash-can" title={`Delete ${user.username}?`} description="The account and all associated access will be removed. Transfer or delete owned servers first." confirmLabel="Delete account" onConfirm={async () => { await api.adminDeleteUser(userId); notify("User deleted"); nav("/admin/users"); }}>Delete</ConfirmButton>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function Locations() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [form, setForm] = useState({ short_code: "", name: "", description: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.adminLocations()).data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load locations");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!rows && error) return <ErrorPanel message={error} retry={load} />;
  if (!rows) return <LoadingPage label="Loading locations" />;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.adminCreateLocation(form);
      setForm({ short_code: "", name: "", description: "" });
      notify("Location created");
      await load();
    } catch (err: any) {
      setError(err.message || "Unable to create location");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Administration" title="Locations" description={`${plural(rows.length, "location")} grouping ${plural(rows.reduce((sum, row) => sum + (row.nodes || 0), 0), "node")}.`} />
      <div className="location-layout">
        <form className="card form-card" onSubmit={create}>
          <div className="card-head"><div><h2>Add location</h2><p>Logical region for grouping nodes.</p></div></div>
          <div className="card-body">
            {error && <div className="err">{error}</div>}
            <div className="field"><label>Short code</label><input value={form.short_code} onChange={(event) => setForm({ ...form, short_code: event.target.value })} placeholder="eu-central" required /></div>
            <div className="field"><label>Name</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="EU Central" required /></div>
            <div className="field"><label>Description</label><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Optional notes about this region" /></div>
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "plus"} className={busy ? "spin" : ""} /> Create location</button>
          </div>
        </form>
        <div className="location-grid">
          {rows.map((location) => (
            <article className="card location-card" key={location.id}>
              <div className="card-head">
                <div className="location-title"><span className="node-icon"><Icon name="location-dot" /></span><div><h2>{location.name}</h2><code>{location.short_code}</code></div></div>
                <ConfirmButton className="icon-btn danger-hover" icon="trash-can" title={`Delete ${location.name}?`} description="Locations containing nodes cannot be deleted. Move or delete its nodes first." confirmLabel="Delete location" onConfirm={async () => { await api.adminDeleteLocation(location.id); notify("Location deleted"); await load(); }}>
                  <span className="sr-only">Delete</span>
                </ConfirmButton>
              </div>
              <div className="card-body">
                <p>{location.description || "No description provided."}</p>
                <div className="location-stats">
                  <span><Icon name="server" /> <strong>{location.nodes}</strong> node{location.nodes === 1 ? "" : "s"}</span>
                  <span><Icon name="calendar" /> {fmtDate(location.created_at)}</span>
                </div>
              </div>
            </article>
          ))}
          {!rows.length && <div className="card"><EmptyState icon="location-dot" title="No locations" description="Create a location to group your nodes." /></div>}
        </div>
      </div>
    </div>
  );
}

export function ActivityLog() {
  const [items, setItems] = useState<Activity[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.adminActivity(50, offset, filter);
      setItems(response.data);
      setTotal(response.total);
      setLoaded(true);
    } catch (err: any) {
      notify(err.message || "Unable to load audit log", "error");
    } finally {
      setLoading(false);
    }
  }, [offset, filter]);

  useEffect(() => { load(); }, [load]);

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setFilter(search.trim());
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description={loaded
          ? `${plural(total, "recorded event")} across authentication, workloads, files and infrastructure.`
          : "Authentication, workload, file and infrastructure events for this panel."}
        actions={<button className="btn btn-ghost" onClick={load} disabled={loading}><Icon name={loading ? "circle-notch" : "arrows-rotate"} className={loading ? "spin" : ""} /> {loading ? "Loading" : "Refresh"}</button>}
      />
      <div className="toolbar">
        <form className="search-field" onSubmit={applyFilter}>
          <Icon name="magnifying-glass" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by event prefix, e.g. server:power" />
          {search && <button type="button" className="input-action" onClick={() => { setSearch(""); setFilter(""); setOffset(0); }}><Icon name="xmark" /></button>}
        </form>
        <div className="filter-chips">
          {["", "server:", "backup:", "file:", "auth:", "network:"].map((value) => (
            <button type="button" key={value || "all"} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setSearch(value); setOffset(0); }}>
              {value ? value.replace(":", "") : "All events"}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        {loading ? (
          <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading audit log</div>
        ) : (
          <div className="table-wrap">
            <table className="table audit-table">
              <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Workload</th><th>Source</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const info = activityInfo(item.event);
                  return (
                    <tr key={item.id}>
                      <td className="audit-time"><span>{timeAgo(item.created_at)}</span><small>{fmtDate(item.created_at)}</small></td>
                      <td><div className="audit-event"><span className={`activity-icon tone-${info.tone}`}><Icon name={info.icon} /></span><div><strong>{info.label}</strong><code>{item.event}</code></div></div></td>
                      <td>{item.username || <span className="muted">System</span>}</td>
                      <td>{item.server_name ? <Link className="entity-name" to={`/server/${item.server_id}`}>{item.server_name}</Link> : <span className="muted">—</span>}</td>
                      <td><code className="muted">{item.ip}</code></td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan={5}><EmptyState icon="clock-rotate-left" title="No audit events" description="Adjust the filter or perform an action in the panel." /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>Showing {items.length ? offset + 1 : 0}–{Math.min(offset + items.length, total)} of {total}</span>
          <div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}><Icon name="chevron-left" /> Previous</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Next <Icon name="chevron-right" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DatabaseHosts() {
  const [rows, setRows] = useState<AdminDatabaseHost[]>([]);
  const [client, setClient] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    engine: "mariadb",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "",
    linked_ip: "",
    max_databases: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.adminDatabaseHosts();
      setRows(response.data);
      setClient(response.meta.client);
    } catch (err: any) {
      notify(err.message || "Unable to load database hosts", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({
      name: "",
      engine: "mariadb",
      host: "127.0.0.1",
      port: 3306,
      username: "root",
      password: "",
      linked_ip: "",
      max_databases: 0,
    });
    setEditingId(null);
    setTestResult(null);
  }

  function startEdit(row: AdminDatabaseHost) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      engine: row.engine,
      host: row.host,
      port: row.port,
      username: row.username,
      password: "",
      linked_ip: row.linked_ip || "",
      max_databases: row.max_databases || 0,
    });
    setTestResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setTestResult(null);
    try {
      const body: any = {
        name: form.name.trim(),
        engine: form.engine,
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        linked_ip: form.linked_ip.trim(),
        max_databases: Number(form.max_databases),
        ...(form.password ? { password: form.password } : {}),
      };
      if (editingId) {
        await api.adminUpdateDatabaseHost(editingId, body);
        notify("Database host updated");
      } else {
        await api.adminCreateDatabaseHost(body);
        notify("Database host created");
      }
      resetForm();
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to save database host", "error");
    } finally {
      setBusy("");
    }
  }

  async function testDraft() {
    setBusy("test");
    setTestResult(null);
    try {
      const response = await api.adminTestDatabaseHostDraft({
        name: form.name.trim() || "draft",
        engine: form.engine,
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        password: form.password,
        linked_ip: form.linked_ip.trim(),
        max_databases: Number(form.max_databases),
      });
      setTestResult({
        ok: true,
        message: `Connected to ${response.version || "server"} in ${response.latency_ms}ms`,
      });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || "Connection failed" });
    } finally {
      setBusy("");
    }
  }

  async function testExisting(row: AdminDatabaseHost) {
    setBusy(`test:${row.id}`);
    try {
      const response = await api.adminTestDatabaseHost(row.id);
      notify(`Connected to ${response.version || row.name} in ${response.latency_ms}ms`);
    } catch (err: any) {
      notify(err.message || "Connection failed", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Database hosts"
        description={`${rows.length} MySQL or MariaDB host${rows.length === 1 ? "" : "s"} available for managed database provisioning.`}
        actions={<button className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>}
      />
      {!client && (
        <div className="banner banner-warning">
          <Icon name="circle-exclamation" />
          <div>
            <strong>The MySQL client is not installed on the panel host</strong>
            <span>Install <code>mariadb-client</code> or <code>mysql-client</code> on Debian or Ubuntu to provision real databases. Local SQLite databases remain available.</span>
          </div>
        </div>
      )}
      <div className="two-pane database-host-layout">
        <form className="card form-card" onSubmit={save}>
          <div className="card-head">
            <div>
              <h2>{editingId ? "Edit database host" : "Add database host"}</h2>
              <p>Provisioning uses the panel host's native MySQL client over TCP.</p>
            </div>
            {editingId && <span className="pill pill-warn"><Icon name="pen" /> Editing</span>}
          </div>
          <div className="card-body">
            <div className="field"><label>Display name</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Primary MariaDB" required /></div>
            <div className="field-row">
              <div className="field">
                <label>Engine</label>
                <select value={form.engine} onChange={(event) => setForm({ ...form, engine: event.target.value, port: event.target.value === "mysql" ? 3306 : form.port })}>
                  <option value="mariadb">MariaDB</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>
              <div className="field">
                <label>Port</label>
                <input type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} />
              </div>
            </div>
            <div className="field"><label>Hostname or IP</label><input className="mono" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="db.internal" required /></div>
            <div className="field"><label>Administrator username</label><input className="mono" autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></div>
            <div className="field">
              <label>Administrator password</label>
              <input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? "Leave blank to keep the stored password" : "Required"} required={!editingId} />
              <span className="field-help">Stored in the panel database and passed to the client through the process environment only.</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Linked IP</label>
                <input className="mono" value={form.linked_ip} onChange={(event) => setForm({ ...form, linked_ip: event.target.value })} placeholder="Optional client address" />
                <span className="field-help">MySQL user host. Use <code>%</code> when empty.</span>
              </div>
              <div className="field">
                <label>Database limit</label>
                <input type="number" min={0} value={form.max_databases} onChange={(event) => setForm({ ...form, max_databases: Number(event.target.value) })} />
                <span className="field-help">0 means unlimited.</span>
              </div>
            </div>
            {testResult && (
              <div className={`notice ${testResult.ok ? "notice-ok" : "notice-warn"}`}>
                <Icon name={testResult.ok ? "circle-check" : "circle-exclamation"} />
                <span>{testResult.message}</span>
              </div>
            )}
            <div className="btn-row">
              {editingId && <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancel edit</button>}
              <button type="button" className="btn btn-ghost" onClick={testDraft} disabled={busy === "test" || !form.host.trim() || !form.username.trim() || (!editingId && !form.password)}>
                <Icon name={busy === "test" ? "circle-notch" : "plug"} className={busy === "test" ? "spin" : ""} /> Test connection
              </button>
              <button className="btn btn-primary" disabled={busy === "save"}>
                <Icon name={busy === "save" ? "circle-notch" : editingId ? "check" : "plus"} className={busy === "save" ? "spin" : ""} />
                {editingId ? "Save host" : "Create host"}
              </button>
            </div>
          </div>
        </form>

        <div className="card">
          <div className="card-head"><div><h2>Provisioning hosts</h2><p>Databases created by servers can target any host below.</p></div><span className="pill pill-neutral">{rows.length}</span></div>
          {loading ? (
            <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading database hosts</div>
          ) : (
            <div className="database-host-list">
              {rows.map((row) => (
                <article className="database-host-card" key={row.id}>
                  <div className="database-host-head">
                    <span className="node-icon"><Icon name="database" /></span>
                    <div>
                      <strong>{row.name}</strong>
                      <span className="mono">{row.host}:{row.port}</span>
                    </div>
                    <span className="pill pill-neutral">{row.engine === "mysql" ? "MySQL" : "MariaDB"}</span>
                  </div>
                  <div className="database-host-meta">
                    <span><Icon name="user" /> {row.username}</span>
                    <span><Icon name="server" /> {row.databases} database{row.databases === 1 ? "" : "s"}{row.max_databases ? ` of ${row.max_databases}` : ""}</span>
                    <span><Icon name="network-wired" /> {row.linked_ip || "%"}</span>
                  </div>
                  <div className="database-host-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => testExisting(row)} disabled={busy === `test:${row.id}` || !client}>
                      <Icon name={busy === `test:${row.id}` ? "circle-notch" : "plug"} className={busy === `test:${row.id}` ? "spin" : ""} /> Test
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(row)}><Icon name="pen" /> Edit</button>
                    <ConfirmButton
                      className="btn btn-danger-ghost btn-sm"
                      icon="trash-can"
                      title={`Delete ${row.name}?`}
                      description={row.databases ? `This host still manages ${plural(row.databases, "database")}. Remove those databases before deleting the host.` : "The host configuration will be removed. Managed databases on the remote server are not dropped."}
                      confirmLabel="Delete host"
                      onConfirm={async () => {
                        await api.adminDeleteDatabaseHost(row.id);
                        notify("Database host deleted");
                        if (editingId === row.id) resetForm();
                        await load();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </article>
              ))}
              {!rows.length && <EmptyState icon="database" title="No database hosts" description="Add a MySQL or MariaDB host to provision managed databases for servers." />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function healthTone(status: string): string {
  if (["ok", "active", "enabled", "running"].includes(status)) return "ok";
  if (["warn", "inactive", "unknown", "unavailable"].includes(status)) return "warn";
  return "danger";
}

export function SystemHealth() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminSystem());
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load system health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  if (error && !data) return <ErrorPanel message={error} retry={load} />;
  if (!data) return <LoadingPage label="Reading host telemetry" />;

  const securityOk = data.security.checks.filter((check: any) => check.status === "ok").length;
  const securityWarn = data.security.checks.length - securityOk;

  return (
    <div className="page system-page">
      <PageHeader
        eyebrow="Administration"
        title="System health"
        description={`${data.host.pretty_name} | ${data.host.architecture} | up ${fmtUptime(data.host.uptime)}`}
        actions={
          <>
            <label className="auto-refresh">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              Auto refresh
            </label>
            <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
              <Icon name={loading ? "circle-notch" : "arrows-rotate"} className={loading ? "spin" : ""} /> Refresh
            </button>
          </>
        }
      />
      {error && <div className="banner banner-error"><Icon name="circle-exclamation" /><span>{error}</span></div>}
      {data.host.system !== "Linux" && (
        <div className="banner banner-warning">
          <Icon name="circle-info" />
          <div>
            <strong>Host health is tuned for Debian and Ubuntu Linux</strong>
            <span>
              This panel is running on {data.host.system}. Linux-only checks such as systemd,
              AppArmor and SSH policy are shown as unavailable rather than failing.
            </span>
          </div>
        </div>
      )}
      {data.failed_units.length > 0 && (
        <div className="banner banner-warning">
          <Icon name="triangle-exclamation" />
          <div>
            <strong>{data.failed_units.length} failed system unit{data.failed_units.length === 1 ? "" : "s"}</strong>
            <span>{data.failed_units.map((unit: any) => unit.unit).join(", ")}</span>
          </div>
        </div>
      )}

      <section className="system-kpis">
        <article className="card system-kpi">
          <span className="system-kpi-icon tone-cpu"><Icon name="microchip" /></span>
          <div><span>CPU</span><strong>{data.cpu.percent.toFixed(1)}%</strong><small>{plural(data.cpu.cores, "core")} at {data.cpu.frequency_mhz || 0} MHz</small></div>
        </article>
        <article className="card system-kpi">
          <span className="system-kpi-icon tone-mem"><Icon name="memory" /></span>
          <div><span>Memory</span><strong>{data.memory.percent.toFixed(1)}%</strong><small>{fmtBytes(data.memory.used)} of {fmtBytes(data.memory.total)}</small></div>
        </article>
        <article className="card system-kpi">
          <span className="system-kpi-icon tone-disk"><Icon name="hard-drive" /></span>
          <div><span>Swap</span><strong>{data.swap.percent.toFixed(1)}%</strong><small>{fmtBytes(data.swap.used)} of {fmtBytes(data.swap.total)}</small></div>
        </article>
        <article className="card system-kpi">
          <span className="system-kpi-icon tone-uptime"><Icon name="gauge-high" /></span>
          <div><span>Load average</span><strong>{data.cpu.load.map((value: number) => value.toFixed(2)).join(" / ")}</strong><small>1, 5 and 15 minute averages</small></div>
        </article>
      </section>

      <div className="system-grid">
        <section className="card">
          <div className="card-head"><div><h2>Processor</h2><p>Per-core utilisation sampled on request.</p></div><span className="pill pill-neutral">{data.cpu.cores} logical / {data.cpu.physical} physical</span></div>
          <div className="card-body">
            <div className="core-grid">
              {(data.cpu.per_core || []).map((value: number, index: number) => (
                <div className="core-meter" key={index}>
                  <span>Core {index}</span>
                  <div className="meter-track"><span className="meter-fill" style={{ width: `${Math.min(100, value)}%` }} /></div>
                  <strong>{value.toFixed(0)}%</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Storage</h2><p>Mounted block devices and capacity.</p></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mount</th><th>Device</th><th>Type</th><th>Usage</th></tr></thead>
              <tbody>
                {(data.disks || []).map((disk: any) => (
                  <tr key={disk.mount}>
                    <td><strong>{disk.mount}</strong><small className="muted block">{fmtBytes(disk.used)} of {fmtBytes(disk.total)}</small></td>
                    <td className="mono muted">{disk.device}</td>
                    <td><span className="pill pill-neutral">{disk.fstype || "unknown"}</span></td>
                    <td>
                      <div className="disk-usage">
                        <div className="meter-track"><span className={`meter-fill ${disk.percent >= 90 ? "danger" : disk.percent >= 75 ? "warning" : ""}`} style={{ width: `${Math.min(100, disk.percent)}%` }} /></div>
                        <span>{disk.percent.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!data.disks.length && <tr><td colSpan={4}><EmptyState icon="hard-drive" title="No disks detected" description="The panel could not read mounted filesystems." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Security posture</h2><p>Debian and Ubuntu host hardening checks.</p></div><span className={`pill ${securityWarn ? "pill-warn" : "pill-ok"}`}>{securityOk} ok / {securityWarn} attention</span></div>
          <div className="card-body">
            <div className="health-list">
              {data.security.checks.map((check: any) => (
                <div className="health-item" key={check.id}>
                  <span className={`health-dot ${healthTone(check.status)}`}><Icon name={check.status === "ok" ? "check" : "circle-exclamation"} /></span>
                  <div><strong>{check.label}</strong><span>{check.detail}</span></div>
                </div>
              ))}
            </div>
            <div className="identity-list">
              <div><span>SSH password authentication</span><code>{data.security.ssh.password_authentication}</code></div>
              <div><span>SSH root login</span><code>{data.security.ssh.permit_root_login}</code></div>
              <div><span>SSH public key authentication</span><code>{data.security.ssh.pubkey_authentication}</code></div>
              <div><span>Firewall</span><code>{data.security.firewall.manager} / {data.security.firewall.status}</code></div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Services</h2><p>systemd unit state for common panel dependencies.</p></div></div>
          <div className="card-body">
            <div className="service-grid">
              {(data.services || []).filter((service: any) => service.installed !== false).map((service: any) => (
                <div className="service-item" key={service.name}>
                  <span className={`health-dot ${healthTone(service.active)}`} />
                  <div><strong>{service.name}</strong><span>{service.active} / {service.enabled}</span></div>
                </div>
              ))}
            </div>
            {(data.services || []).filter((service: any) => service.installed !== false).length === 0 && (
              <EmptyState
                icon="server"
                title="No systemd services detected"
                description="Service state is available when the panel runs on a systemd-based Linux host."
              />
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Panel storage</h2><p>Database and workload data footprint.</p></div></div>
          <div className="card-body">
            <div className="identity-list">
              <div><span>Data directory</span><code className="ellipsis">{data.panel.data.data_dir}</code></div>
              <div><span>Panel database</span><span>{fmtBytes(data.panel.data.database_bytes)}</span></div>
              <div><span>Server volumes</span><span>{fmtBytes(data.panel.data.servers_bytes)}</span></div>
              <div><span>Backup archives</span><span>{fmtBytes(data.panel.data.backups_bytes)}</span></div>
              <div><span>Servers</span><span>{data.panel.data.counts.servers}</span></div>
              <div><span>Users</span><span>{data.panel.data.counts.users}</span></div>
              <div><span>Databases</span><span>{data.panel.data.counts.databases}</span></div>
            </div>
            <div className="identity-list">
              <div><span>Panel version</span><code>{data.panel.version}</code></div>
              <div><span>Runtime</span><code>{data.panel.wings}</code></div>
              <div><span>Python</span><code>{data.host.python}</code></div>
              <div><span>Kernel</span><code>{data.host.release}</code></div>
              <div><span>Docker</span><code>{data.docker.available ? `${data.docker.server_version || "installed"} / ${plural(data.docker.containers || 0, "container")}` : "not installed"}</code></div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Processes by memory</h2><p>Top resident consumers on the panel host.</p></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>PID</th><th>Process</th><th>User</th><th>Memory</th></tr></thead>
              <tbody>
                {data.processes.by_memory.map((proc: any) => (
                  <tr key={`mem-${proc.pid}`}>
                    <td className="mono">{proc.pid}</td>
                    <td><strong>{proc.name}</strong><small className="muted block ellipsis">{proc.command}</small></td>
                    <td className="muted">{proc.username}</td>
                    <td className="mono">{fmtBytes(proc.memory_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Processes by CPU</h2><p>Top processors on the panel host.</p></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>PID</th><th>Process</th><th>User</th><th>CPU</th></tr></thead>
              <tbody>
                {data.processes.by_cpu.map((proc: any) => (
                  <tr key={`cpu-${proc.pid}`}>
                    <td className="mono">{proc.pid}</td>
                    <td><strong>{proc.name}</strong><small className="muted block ellipsis">{proc.command}</small></td>
                    <td className="muted">{proc.username}</td>
                    <td className="mono">{proc.cpu_percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <p className="system-footnote">
        Snapshot generated {fmtDate(data.generated_at)}. Host telemetry is read directly from the panel service account.
      </p>
    </div>
  );
}

export function PanelSettings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [form, setForm] = useState({ company: "", support_email: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.adminSettings(), api.adminOverview()])
      .then(([settingsResponse, overviewResponse]) => {
        setSettings(settingsResponse.data);
        setOverview(overviewResponse.data);
        setForm({
          company: settingsResponse.data.company || "",
          support_email: settingsResponse.data.support_email || "",
        });
      })
      .catch((err) => notify(err.message, "error"));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.adminSaveSettings(form);
      setSettings(response.data);
      notify("Panel settings saved");
    } catch (err: any) {
      notify(err.message || "Unable to save settings", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !overview) return <LoadingPage label="Loading panel settings" />;

  return (
    <div className="page">
      <PageHeader eyebrow="Administration" title="Panel settings" description="Branding and deployment information for this control plane." />
      <div className="settings-layout">
        <form className="card" onSubmit={save}>
          <div className="card-head"><div><h2>Branding</h2><p>Text shown on the sign-in screen and account footer.</p></div><span className="card-head-icon"><Icon name="pen-ruler" /></span></div>
          <div className="card-body">
            <div className="field"><label>Organisation name</label><input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="VITESTERTL" /><span className="field-help">Displayed as the operator name on the authentication screen.</span></div>
            <div className="field"><label>Support email</label><input type="email" value={form.support_email} onChange={(event) => setForm({ ...form, support_email: event.target.value })} placeholder="support@example.com" /><span className="field-help">Optional contact address shown to signed-out users.</span></div>
            <button className="btn btn-primary" disabled={busy}><Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save branding</button>
          </div>
        </form>
        <div className="settings-side">
          <div className="card">
            <div className="card-head"><div><h2>Deployment</h2><p>Read-only system information.</p></div></div>
            <div className="card-body identity-list">
              <div><span>Panel version</span><code>{overview.version}</code></div>
              <div><span>Runtime version</span><code>{overview.wings}</code></div>
              <div><span>Hostname</span><span>{overview.hostname}</span></div>
              <div><span>Runtime</span><span>{overview.docker ? "Docker engine" : "Process runtime"}</span></div>
              <div><span>Logical cores</span><span>{overview.cores}</span></div>
              <div><span>Database</span><span>SQLite</span></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Operational footprint</h2><p>Current panel scale.</p></div></div>
            <div className="card-body identity-list">
              <div><span>Servers</span><span>{overview.servers}</span></div>
              <div><span>Nodes</span><span>{overview.nodes}</span></div>
              <div><span>Users</span><span>{overview.users}</span></div>
              <div><span>Archives</span><span>{overview.backups}</span></div>
              <div><span>Allocations</span><span>{overview.allocations.assigned} assigned</span></div>
            </div>
          </div>
          <div className="wizard-note">
            <Icon name="shield-halved" />
            <p>Registration is closed. Administrators create accounts from the Users section of the panel.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
