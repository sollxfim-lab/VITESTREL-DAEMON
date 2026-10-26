import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  api,
  fmtBytes,
  fmtDate,
  timeAgo,
} from "../api";
import { Icon } from "../icons";
import { ResourceLimits } from "../resources";
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
  return "cube";
}

function eggBrand(nest: string): boolean {
  return /python|node|java|docker/i.test(nest || "");
}

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
      detail: `${data.cores} logical cores`,
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
        <Kpi label="Panel users" value={data.users} sub={`${data.eggs} eggs available`} icon="users" tone="neutral" />
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
        description={`${rows.length} workloads · ${running} running · ${suspended} suspended`}
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
  const [step, setStep] = useState(1);
  const [eggs, setEggs] = useState<any[]>([]);
  const [nests, setNests] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    egg_id: 2,
    owner_id: 0,
    node_id: 0,
    allocation_id: 0,
    memory: 512,
    cpu: 100,
    disk: 2048,
    start_on_completion: false,
    environment: {} as Record<string, string>,
  });

  useEffect(() => {
    api.adminNests().then((response) => {
      setEggs(response.eggs);
      setNests(response.nests);
      if (response.eggs[0]) {
        const egg = response.eggs.find((item: any) => item.id === 2) || response.eggs[0];
        setForm((current) => ({
          ...current,
          egg_id: egg.id,
          environment: Object.fromEntries(eggVars(egg).map((variable) => [variable.env, variable.default || ""])),
        }));
      }
    });
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
  }, []);

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

  function pickEgg(id: number) {
    const egg = eggs.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      egg_id: id,
      environment: Object.fromEntries(eggVars(egg).map((variable) => [variable.env, variable.default || ""])),
    }));
  }

  const canContinue =
    (step === 1 && form.name.trim().length >= 2 && form.owner_id > 0) ||
    (step === 2 && !!form.egg_id) ||
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
      const response = await api.adminCreateServer(payload);
      notify("Server provisioned");
      nav(`/server/${response.data.id}`);
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
                {variables.length > 0 && (
                  <div className="variable-grid">
                    {variables.map((variable) => (
                      <div className="field" key={variable.env}>
                        <label>{variable.name} <span className="field-env">{variable.env}</span></label>
                        <input value={form.environment[variable.env] || ""} onChange={(event) => setForm({ ...form, environment: { ...form.environment, [variable.env]: event.target.value } })} />
                      </div>
                    ))}
                  </div>
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
                  ? `#${job.result.node_id} · ${job.result.allocations} allocations · ${job.result.runtime} runtime`
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
        description={`${rows.length} registered nodes · ${connected} connected · ${freePorts} free allocations`}
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
        <Kpi label="CPU" value={live ? `${live.cpu}%` : "—"} sub={live ? `${live.cores} cores` : "No telemetry"} icon="microchip" tone="accent" />
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
  const [eggs, setEggs] = useState<any[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.adminNests();
      setNests(response.nests);
      setEggs(response.eggs);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load nests");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorPanel message={error} retry={load} />;
  if (!nests) return <LoadingPage label="Loading nests" />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Nests & eggs"
        description={`${nests.length} nests · ${eggs.length} eggs defining runtimes, files and startup variables.`}
        actions={<button className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>}
      />
      <div className="nest-list">
        {nests.map((nest) => {
          const nestEggs = eggs.filter((egg) => egg.nest_id === nest.id);
          return (
            <section className="card" key={nest.id}>
              <div className="card-head">
                <div className="nest-title">
                  <span className="node-icon"><Icon name={eggIcon(nest.name)} brand={eggBrand(nest.name)} /></span>
                  <div><h2>{nest.name}</h2><p>{nest.description}</p></div>
                </div>
                <span className="pill pill-neutral">{nestEggs.length} egg{nestEggs.length === 1 ? "" : "s"}</span>
              </div>
              <div className="egg-grid">
                {nestEggs.map((egg) => (
                  <article className="egg-tile" key={egg.id}>
                    <div className="egg-tile-head">
                      <strong>{egg.name}</strong>
                      <span className={`pill pill-neutral`}>{egg.runtime}</span>
                    </div>
                    <p>{egg.description}</p>
                    <div className="egg-tile-meta">
                      <span><Icon name="cube" /> {egg.docker_image}</span>
                      <span><Icon name="terminal" /> {egg.startup}</span>
                    </div>
                    <div className="egg-tile-foot">
                      <span>{eggVars(egg).length} variable{eggVars(egg).length === 1 ? "" : "s"}</span>
                      <code>egg #{egg.id}</code>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
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
        description={`${rows.length} accounts · ${rows.filter((user) => user.role === "admin").length} administrators`}
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
      <PageHeader eyebrow="Administration" title="Locations" description={`${rows.length} location${rows.length === 1 ? "" : "s"} grouping ${rows.reduce((sum, row) => sum + (row.nodes || 0), 0)} nodes.`} />
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.adminActivity(50, offset, filter);
      setItems(response.data);
      setTotal(response.total);
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
        description={`${total} recorded events across authentication, workloads, files and infrastructure.`}
        actions={<button className="btn btn-ghost" onClick={load}><Icon name="arrows-rotate" /> Refresh</button>}
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
