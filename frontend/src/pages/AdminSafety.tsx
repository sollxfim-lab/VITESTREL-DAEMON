import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Rule,
  SecuritySettings,
  SecurityStrike,
  Server,
  api,
  fmtDate,
} from "../api";
import { Icon } from "../icons";
import {
  ConfirmButton,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  Modal,
  PageHeader,
  notify,
} from "../ui";

type SafetyTab = "overview" | "strikes" | "bans" | "rules";

const SEVERITY_ICON: Record<string, string> = {
  critical: "triangle-exclamation",
  warning: "circle-exclamation",
  info: "circle-info",
};

const emptyRule: Rule = {
  id: 0,
  scope: "global",
  server_id: null,
  egg_id: null,
  nest_id: null,
  title: "",
  body: "",
  category: "Operations",
  severity: "info",
  sort_order: 0,
  enabled: true,
};

export default function AdminSafety() {
  const [tab, setTab] = useState<SafetyTab>("overview");
  const [security, setSecurity] = useState<Awaited<ReturnType<typeof api.adminSecurity>> | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [nests, setNests] = useState<any[]>([]);
  const [eggs, setEggs] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [securityResponse, rulesResponse, serversResponse, nestsResponse] = await Promise.all([
        api.adminSecurity(),
        api.adminRules(),
        api.servers(),
        api.adminNests(),
      ]);
      setSecurity(securityResponse);
      setSettings(securityResponse.settings);
      setRules(rulesResponse.data);
      setServers(serversResponse.data);
      setNests(nestsResponse.nests || []);
      setEggs(nestsResponse.eggs || []);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load the safety console");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!security && !error) return <LoadingPage label="Loading security telemetry" />;
  if (!security && error) return <ErrorPanel message={error} retry={load} />;

  async function saveSettings(next: SecuritySettings) {
    setSettings(next);
    setBusy(true);
    try {
      const response = await api.adminSaveSecurity(next);
      setSettings(response.settings);
      notify("Security policy updated");
      load();
    } catch (err: any) {
      notify(err.message || "The policy could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  const strikes: SecurityStrike[] = security?.strikes || [];
  const banned = security?.banned || [];
  const held = security?.held_servers || [];

  return (
    <div className="page admin-safety">
      <PageHeader
        eyebrow="Safety"
        title="Dangerous activity enforcement"
        description="Every command, saved file and schedule is inspected before it runs. Critical findings suspend the server; repeated attempts ban the account automatically."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={load}>
              <Icon name="rotate-right" /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setEditRule({ ...emptyRule })}>
              <Icon name="plus" /> New rule
            </button>
          </>
        }
      />

      <section className="safety-hero">
        <div className="safety-hero-copy">
          <span className="safety-emblem"><Icon name="shield-halved" /></span>
          <div>
            <span className="eyebrow">Detection engine</span>
            <h2>{settings?.detection ? "Armed and watching" : "Detection paused"}</h2>
            <p>
              Blocked attempts are recorded as strikes. A critical finding places the server on security
              hold immediately. The fourth strike bans the account unless it is an administrator.
            </p>
          </div>
        </div>
        <div className="safety-stats">
          <div><strong>{security?.totals.strikes || 0}</strong><span>Recorded strikes</span></div>
          <div><strong>{security?.totals.accounts || 0}</strong><span>Accounts involved</span></div>
          <div><strong>{banned.length}</strong><span>Banned accounts</span></div>
          <div><strong>{held.length}</strong><span>Held servers</span></div>
        </div>
      </section>

      <nav className="segmented" aria-label="Safety sections">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          <Icon name="sliders" /> Policy
        </button>
        <button type="button" className={tab === "strikes" ? "active" : ""} onClick={() => setTab("strikes")}>
          <Icon name="triangle-exclamation" /> Strikes <span className="seg-count">{strikes.length}</span>
        </button>
        <button type="button" className={tab === "bans" ? "active" : ""} onClick={() => setTab("bans")}>
          <Icon name="user-lock" /> Bans {banned.length > 0 && <span className="seg-count">{banned.length}</span>}
        </button>
        <button type="button" className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>
          <Icon name="book" /> Rules {rules.length > 0 && <span className="seg-count">{rules.length}</span>}
        </button>
      </nav>

      {tab === "overview" && settings && (
        <div className="safety-grid">
          <section className="card safety-policy">
            <div className="card-head">
              <div><span className="eyebrow">Enforcement</span><h2>Policy controls</h2></div>
              <span className={`pill ${settings.detection ? "pill-ok" : "pill-neutral"}`}>{settings.detection ? "Active" : "Paused"}</span>
            </div>
            <label className="switch-row">
              <span><strong>Dangerous-activity detection</strong><small>Scan console commands, terminal input, file saves, uploads and schedules before execution.</small></span>
              <input
                type="checkbox"
                checked={settings.detection}
                onChange={(event) => saveSettings({ ...settings, detection: event.target.checked })}
              />
            </label>
            <label className="switch-row">
              <span><strong>Automatic suspension</strong><small>A critical finding immediately stops and suspends the affected server pending review.</small></span>
              <input
                type="checkbox"
                checked={settings.auto_suspend}
                onChange={(event) => saveSettings({ ...settings, auto_suspend: event.target.checked })}
              />
            </label>
            <div className="threshold-control">
              <div>
                <strong>Ban threshold</strong>
                <small>{settings.ban_threshold} recorded strikes bans the account. More than three attempts is the recommended floor.</small>
              </div>
              <div className="threshold-range">
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={settings.ban_threshold}
                  onChange={(event) => setSettings({ ...settings, ban_threshold: Number(event.target.value) })}
                  onMouseUp={() => saveSettings(settings)}
                  onTouchEnd={() => saveSettings(settings)}
                />
                <span>{settings.ban_threshold}</span>
              </div>
            </div>
            <div className="notice">
              <Icon name="circle-info" />
              Administrator accounts are never banned automatically. Their strikes still appear in the ledger for review.
            </div>
          </section>

          <section className="card safety-held">
            <div className="card-head">
              <div><span className="eyebrow">Security holds</span><h2>Suspended servers</h2></div>
              <span className="section-meta">{held.length} held</span>
            </div>
            {held.length === 0 ? (
              <EmptyState icon="shield-check" title="No security holds" description="Critical findings will place affected servers here for owner review." />
            ) : (
              <div className="held-list">
                {held.map((server) => (
                  <article className="held-row" key={server.id}>
                    <span className="held-icon"><Icon name="ban" /></span>
                    <div>
                      <strong>{server.name}</strong>
                      <span>{server.owner_name || "Unknown owner"} · {server.suspended_reason}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        try {
                          await api.adminReleaseServer(server.id);
                          notify(`${server.name} released`);
                          load();
                        } catch (err: any) {
                          notify(err.message, "error");
                        }
                      }}
                    >
                      <Icon name="lock-open" /> Release
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "strikes" && (
        <section className="card">
          <div className="card-head">
            <div><span className="eyebrow">Ledger</span><h2>Recorded dangerous activity</h2></div>
            <span className="section-meta">Latest {Math.min(strikes.length, 150)}</span>
          </div>
          {strikes.length === 0 ? (
            <EmptyState icon="shield-check" title="No strikes recorded" description="Blocked commands and files will appear here with their source, server and matched pattern." />
          ) : (
            <div className="strike-table">
              {strikes.map((strike) => (
                <article className="strike-row" key={strike.id}>
                  <span className={`strike-severity severity-${strike.severity}`}>
                    <Icon name={SEVERITY_ICON[strike.severity] || "circle-info"} />
                  </span>
                  <div className="strike-main">
                    <div className="strike-title">
                      <strong>{strike.label}</strong>
                      <span className={`pill severity-pill severity-${strike.severity}`}>{strike.severity}</span>
                      <span className="strike-source">{strike.source}</span>
                    </div>
                    <span className="strike-meta">
                      {strike.username || `User ${strike.user_id}`}
                      {strike.server_name ? ` · ${strike.server_name}` : ""}
                      {` · ${fmtDate(strike.created_at)}`}
                    </span>
                    {strike.snippet && <code className="strike-snippet">{strike.snippet}</code>}
                  </div>
                  <div className="strike-action">
                    <span>{strike.category}</span>
                    <small>{strike.action || "blocked"}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "bans" && (
        <section className="card">
          <div className="card-head">
            <div><span className="eyebrow">Accounts</span><h2>Automatic bans</h2></div>
            <span className="section-meta">{banned.length} banned</span>
          </div>
          {banned.length === 0 ? (
            <EmptyState icon="user-check" title="No banned accounts" description="Accounts that cross the strike threshold appear here with their latest reason." />
          ) : (
            <div className="ban-list">
              {banned.map((account) => (
                <article className="ban-row" key={account.id}>
                  <span className="ban-avatar">{(account.username || "?").slice(0, 1).toUpperCase()}</span>
                  <div className="ban-main">
                    <strong>{account.username}</strong>
                    <span>{account.email} · {account.role} · banned {fmtDate(account.banned_at)}</span>
                    <p>{account.ban_reason}</p>
                  </div>
                  <div className="ban-actions">
                    <ConfirmButton
                      className="btn btn-ghost btn-sm"
                      title={`Unban ${account.username}?`}
                      description="The account can sign in again. Security-held servers are released and strikes can be kept for audit."
                      confirmLabel="Unban account"
                      tone="primary"
                      icon="lock-open"
                      onConfirm={async () => {
                        await api.adminUnbanUser(account.id, { release_servers: true, clear_strikes: false });
                        notify(`${account.username} unbanned`);
                        load();
                      }}
                    >
                      <Icon name="lock-open" /> Unban
                    </ConfirmButton>
                    <ConfirmButton
                      className="btn btn-danger-ghost btn-sm"
                      title={`Clear all strikes for ${account.username}?`}
                      description="This resets the automatic ban counter. The unban still needs to be applied."
                      confirmLabel="Clear and unban"
                      onConfirm={async () => {
                        await api.adminUnbanUser(account.id, { release_servers: true, clear_strikes: true });
                        notify(`${account.username} unbanned with a clean strike history`);
                        load();
                      }}
                    >
                      Clear strikes
                    </ConfirmButton>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="notice">
            <Icon name="circle-info" />
            Unbanning does not delete the audit trail unless you explicitly clear strikes. Suspensions that were not caused by security are left untouched.
          </div>
        </section>
      )}

      {tab === "rules" && (
        <section className="card">
          <div className="card-head">
            <div><span className="eyebrow">Acceptable use</span><h2>Global, type and server rules</h2></div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditRule({ ...emptyRule })}>
              <Icon name="plus" /> New rule
            </button>
          </div>
          {rules.length === 0 ? (
            <EmptyState icon="book" title="No rules published" description="Add a global rule first, then narrow rules to a nest, egg or individual server." />
          ) : (
            <div className="rules-admin-list">
              {rules.map((rule) => (
                <article className="rule-admin-row" key={rule.id}>
                  <span className={`rule-scope scope-${rule.scope}`}>
                    <Icon name={rule.scope === "server" ? "server" : rule.scope === "egg" ? "egg" : rule.scope === "nest" ? "layer-group" : "globe"} />
                    {rule.scope}
                  </span>
                  <div className="rule-admin-main">
                    <div className="rule-admin-title">
                      <strong>{rule.title}</strong>
                      <span className={`pill severity-pill severity-${rule.severity}`}>{rule.severity}</span>
                      {!rule.enabled && <span className="pill pill-neutral">Hidden</span>}
                    </div>
                    <p>{rule.body}</p>
                    <span className="rule-admin-meta">
                      {rule.category}
                      {rule.server_name ? ` · ${rule.server_name}` : ""}
                      {rule.egg_name ? ` · ${rule.egg_name}` : ""}
                      {rule.nest_name ? ` · ${rule.nest_name}` : ""}
                    </span>
                  </div>
                  <div className="rule-admin-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditRule(rule)}>
                      <Icon name="pen" /> Edit
                    </button>
                    <ConfirmButton
                      className="btn btn-danger-ghost btn-sm"
                      title={`Delete "${rule.title}"?`}
                      description="The rule disappears from every server it applied to."
                      confirmLabel="Delete rule"
                      onConfirm={async () => {
                        await api.adminDeleteRule(rule.id);
                        notify("Rule deleted");
                        load();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {editRule && (
        <RuleEditor
          rule={editRule}
          servers={servers}
          nests={nests}
          eggs={eggs}
          onClose={() => setEditRule(null)}
          onSaved={() => {
            setEditRule(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  servers,
  nests,
  eggs,
  onClose,
  onSaved,
}: {
  rule: Rule;
  servers: Server[];
  nests: any[];
  eggs: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    scope: rule.scope,
    server_id: rule.server_id || "",
    egg_id: rule.egg_id || 0,
    nest_id: rule.nest_id || 0,
    title: rule.title,
    body: rule.body,
    category: rule.category,
    severity: rule.severity,
    sort_order: rule.sort_order,
    enabled: rule.enabled,
  });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...form,
        server_id: form.scope === "server" ? form.server_id : null,
        egg_id: form.scope === "egg" ? Number(form.egg_id) : null,
        nest_id: form.scope === "nest" ? Number(form.nest_id) : null,
      };
      if (rule.id) await api.adminUpdateRule(rule.id, body);
      else await api.adminCreateRule(body);
      notify(rule.id ? "Rule updated" : "Rule created");
      onSaved();
    } catch (err: any) {
      notify(err.message || "The rule could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule.id ? "Edit rule" : "Create a rule"}
      description="Server rules appear in the server's Rules tab and inform the operations copilot."
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="rule-form" className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save rule
          </button>
        </>
      }
    >
      <form id="rule-form" className="form" onSubmit={submit}>
        <div className="field-row">
          <label className="field">
            <span>Scope</span>
            <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as Rule["scope"] })}>
              <option value="global">All servers</option>
              <option value="nest">Server type (nest)</option>
              <option value="egg">Template (egg)</option>
              <option value="server">One server</option>
            </select>
          </label>
          <label className="field">
            <span>Severity</span>
            <select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as Rule["severity"] })}>
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        </div>
        {form.scope === "server" && (
          <label className="field">
            <span>Server</span>
            <select value={form.server_id} onChange={(event) => setForm({ ...form, server_id: event.target.value })}>
              <option value="">Choose a server</option>
              {servers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.owner_name}</option>)}
            </select>
          </label>
        )}
        {form.scope === "nest" && (
          <label className="field">
            <span>Server type</span>
            <select value={form.nest_id} onChange={(event) => setForm({ ...form, nest_id: Number(event.target.value) })}>
              <option value={0}>Choose a type</option>
              {nests.map((nest) => <option key={nest.id} value={nest.id}>{nest.name}</option>)}
            </select>
          </label>
        )}
        {form.scope === "egg" && (
          <label className="field">
            <span>Template</span>
            <select value={form.egg_id} onChange={(event) => setForm({ ...form, egg_id: Number(event.target.value) })}>
              <option value={0}>Choose a template</option>
              {eggs.map((egg) => <option key={egg.id} value={egg.id}>{egg.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Title</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} required /></label>
        <label className="field"><span>Rule body</span><textarea rows={5} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={4000} required /></label>
        <div className="field-row">
          <label className="field"><span>Category</span><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} maxLength={60} /></label>
          <label className="field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })} /></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Published to servers</label>
      </form>
    </Modal>
  );
}
