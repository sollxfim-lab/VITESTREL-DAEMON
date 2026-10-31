import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  fmtDate,
  timeAgo,
  type AdminAiProvider,
  type AiPreset,
  type AiUsage,
} from "../api";
import { Icon } from "../icons";
import {
  ConfirmButton,
  EmptyState,
  PageHeader,
  notify,
} from "../ui";

const AI_KIND_LABELS: Record<string, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic",
  google: "Google Gemini",
  azure: "Azure OpenAI",
  ollama: "Ollama",
};

const AI_KIND_ICONS: Record<string, string> = {
  openai: "bolt",
  anthropic: "brain",
  google: "gem",
  azure: "cloud",
  ollama: "server",
};

const EMPTY_AI_FORM = {
  name: "",
  kind: "openai",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  api_key: "",
  headers: "{}",
  max_tokens: 2048,
  temperature: 0.4,
  enabled: true,
  is_default: false,
};

function parseHeadersSafe(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default function AiProviders() {
  const [rows, setRows] = useState<AdminAiProvider[]>([]);
  const [presets, setPresets] = useState<AiPreset[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_AI_FORM });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [rowTests, setRowTests] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [modelShelf, setModelShelf] = useState<{
    id: number;
    name: string;
    models: string[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [providers, analytics] = await Promise.all([
        api.adminAiProviders(),
        api.adminAiUsage(30),
      ]);
      setRows(providers.data);
      setPresets(providers.meta.presets);
      setUsage(analytics);
    } catch (err: any) {
      notify(err.message || "Unable to load AI providers", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setForm({ ...EMPTY_AI_FORM });
    setEditingId(null);
    setTestResult(null);
    setDraftModels([]);
  }

  function applyPreset(preset: AiPreset) {
    setForm((current) => ({
      ...current,
      name: current.name.trim() ? current.name : preset.name,
      kind: preset.kind,
      base_url: preset.base_url,
      model: preset.model,
    }));
    setEditingId(null);
    setTestResult(null);
    setDraftModels([]);
  }

  function startEdit(row: AdminAiProvider) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      kind: row.kind,
      base_url: row.base_url,
      model: row.model,
      api_key: "",
      headers: JSON.stringify(row.headers || {}, null, 2),
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      enabled: row.enabled,
      is_default: row.is_default,
    });
    setTestResult(null);
    setDraftModels([]);
    setModelShelf(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function parseHeaders(raw: string): Record<string, string> {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "{}") return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Custom headers must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Custom headers must be a JSON object");
    }
    return parsed as Record<string, string>;
  }

  function requestBody() {
    const headers = parseHeaders(form.headers);
    return {
      id: editingId ?? undefined,
      name: form.name.trim(),
      kind: form.kind,
      base_url: form.base_url.trim(),
      api_key: form.api_key,
      model: form.model.trim(),
      headers,
      max_tokens: Number(form.max_tokens),
      temperature: Number(form.temperature),
      enabled: form.enabled,
      is_default: form.is_default,
    };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setTestResult(null);
    try {
      const body = requestBody();
      if (editingId) {
        await api.adminUpdateAiProvider(editingId, body);
        notify("AI provider updated");
      } else {
        await api.adminCreateAiProvider(body);
        notify("AI provider connected");
      }
      resetForm();
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to save the AI provider", "error");
    } finally {
      setBusy("");
    }
  }

  async function testDraft() {
    setBusy("test");
    setTestResult(null);
    try {
      const response = await api.adminTestAiProviderDraft(requestBody());
      setTestResult({
        ok: true,
        message: `${response.message} in ${response.latency_ms}ms`,
      });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || "Connection test failed" });
    } finally {
      setBusy("");
    }
  }

  async function discoverDraft() {
    setBusy("models");
    try {
      const response = await api.adminAiProviderModelsDraft(requestBody());
      setDraftModels(response.data);
      if (!response.data.length) {
        notify("This provider does not expose a model catalogue", "info");
      }
    } catch (err: any) {
      notify(err.message || "Unable to list models", "error");
    } finally {
      setBusy("");
    }
  }

  async function testExisting(row: AdminAiProvider) {
    setBusy(`test:${row.id}`);
    setRowTests((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    try {
      const response = await api.adminTestAiProvider(row.id);
      setRowTests((current) => ({
        ...current,
        [row.id]: {
          ok: true,
          message: `${response.message} in ${response.latency_ms}ms`,
        },
      }));
    } catch (err: any) {
      setRowTests((current) => ({
        ...current,
        [row.id]: { ok: false, message: err.message || "Connection test failed" },
      }));
    } finally {
      setBusy("");
    }
  }

  async function discoverExisting(row: AdminAiProvider) {
    if (modelShelf?.id === row.id) {
      setModelShelf(null);
      return;
    }
    setBusy(`models:${row.id}`);
    try {
      const response = await api.adminAiProviderModels(row.id);
      if (!response.data.length) {
        notify(
          row.kind === "azure"
            ? "Azure deployments do not expose a model catalogue. Enter the deployment name manually."
            : "This provider does not expose a model catalogue",
          "info"
        );
        return;
      }
      setModelShelf({ id: row.id, name: row.name, models: response.data });
    } catch (err: any) {
      notify(err.message || "Unable to list models", "error");
    } finally {
      setBusy("");
    }
  }

  async function makeDefault(row: AdminAiProvider) {
    setBusy(`default:${row.id}`);
    try {
      await api.adminDefaultAiProvider(row.id);
      notify(`${row.name} is now the default provider`);
      await load();
    } catch (err: any) {
      notify(err.message || "Unable to set the default provider", "error");
    } finally {
      setBusy("");
    }
  }

  const totals = usage?.totals;
  const successRate =
    totals && totals.requests
      ? Math.round((totals.succeeded / totals.requests) * 100)
      : null;
  const activeCount = rows.filter((row) => row.enabled).length;

  return (
    <div className="page ai-providers-page">
      <PageHeader
        eyebrow="Administration"
        title="AI providers"
        description="Connect the model backend behind the server terminal copilot. One provider is used as the default; operators can switch per conversation."
        actions={
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            <Icon name={loading ? "circle-notch" : "arrows-rotate"} className={loading ? "spin" : ""} />
            Refresh
          </button>
        }
      />

      <section className="ai-metrics">
        <article className="card ai-metric">
          <span className="ai-metric-icon tone-requests"><Icon name="comment-dots" /></span>
          <div>
            <span>Requests</span>
            <strong>{(totals?.requests ?? 0).toLocaleString()}</strong>
            <small>last 30 days</small>
          </div>
        </article>
        <article className="card ai-metric">
          <span className="ai-metric-icon tone-tokens"><Icon name="microchip" /></span>
          <div>
            <span>Tokens</span>
            <strong>{(totals?.tokens ?? 0).toLocaleString()}</strong>
            <small>prompt and completion</small>
          </div>
        </article>
        <article className="card ai-metric">
          <span className="ai-metric-icon tone-success"><Icon name="circle-check" /></span>
          <div>
            <span>Success rate</span>
            <strong>{successRate == null ? "—" : `${successRate}%`}</strong>
            <small>{totals?.failed ? `${totals.failed} failed` : "no failed requests"}</small>
          </div>
        </article>
        <article className="card ai-metric">
          <span className="ai-metric-icon tone-latency"><Icon name="stopwatch" /></span>
          <div>
            <span>Average latency</span>
            <strong>{totals?.avg_latency_ms ? `${(totals.avg_latency_ms / 1000).toFixed(2)}s` : "—"}</strong>
            <small>
              {activeCount} of {rows.length} provider{rows.length === 1 ? "" : "s"} enabled
            </small>
          </div>
        </article>
      </section>

      <div className="two-pane ai-provider-layout">
        <form className="card form-card ai-provider-form" onSubmit={save}>
          <div className="card-head">
            <div>
              <h2>{editingId ? "Edit provider" : "Connect a provider"}</h2>
              <p>Native wire formats for OpenAI-compatible gateways, Anthropic, Gemini, Azure and Ollama.</p>
            </div>
            {editingId && <span className="pill pill-warning"><Icon name="pen" /> Editing</span>}
          </div>
          <div className="card-body">
            <div className="ai-preset-block">
              <span className="ai-field-label">Quick start</span>
              <div className="ai-preset-grid">
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`ai-preset ${
                      form.base_url === preset.base_url && form.kind === preset.kind ? "active" : ""
                    }`}
                    onClick={() => applyPreset(preset)}
                    title={preset.note}
                  >
                    <Icon name={AI_KIND_ICONS[preset.kind] || "bolt"} />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Display name</label>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Production Claude"
                  required
                />
              </div>
              <div className="field">
                <label>API family</label>
                <select
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value })}
                >
                  {Object.entries(AI_KIND_LABELS).map(([kind, label]) => (
                    <option value={kind} key={kind}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Base URL</label>
              <input
                className="mono"
                value={form.base_url}
                onChange={(event) => setForm({ ...form, base_url: event.target.value })}
                placeholder="https://api.openai.com/v1"
                required
              />
              <span className="field-help">
                Include the API version root. Chat, model and test requests are derived from it.
              </span>
            </div>

            <div className="field">
              <label>API key</label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.api_key}
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                placeholder={
                  editingId
                    ? "Leave blank to keep the stored key"
                    : form.kind === "ollama"
                      ? "Not required for Ollama"
                      : "Paste the provider key"
                }
              />
              <span className="field-help">
                Stored in the panel database and never returned to the browser. Only <code>key_set</code> is exposed.
              </span>
            </div>

            <div className="field">
              <label>Model</label>
              <div className="ai-model-input">
                <input
                  className="mono"
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                  placeholder="gpt-4.1-mini"
                  required
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={discoverDraft}
                  disabled={busy === "models" || !form.base_url.trim()}
                >
                  <Icon
                    name={busy === "models" ? "circle-notch" : "magnifying-glass"}
                    className={busy === "models" ? "spin" : ""}
                  />
                  Discover
                </button>
              </div>
              <span className="field-help">
                Use the exact model identifier the provider expects. Azure uses the deployment name.
              </span>
            </div>

            {draftModels.length > 0 && (
              <div className="ai-model-shelf">
                <div className="ai-model-shelf-head">
                  <span>
                    {draftModels.length} model{draftModels.length === 1 ? "" : "s"} discovered
                  </span>
                  <button type="button" onClick={() => setDraftModels([])}>
                    Hide
                  </button>
                </div>
                <div className="ai-model-shelf-list">
                  {draftModels.slice(0, 140).map((name) => (
                    <button
                      type="button"
                      key={name}
                      className={form.model === name ? "active" : ""}
                      onClick={() => setForm((current) => ({ ...current, model: name }))}
                      title={name}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label>Max output tokens</label>
                <input
                  type="number"
                  min={64}
                  max={32000}
                  step={64}
                  value={form.max_tokens}
                  onChange={(event) =>
                    setForm({ ...form, max_tokens: Number(event.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Temperature</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(event) =>
                    setForm({ ...form, temperature: Number(event.target.value) })
                  }
                />
                <span className="field-help">Lower is steadier for command work.</span>
              </div>
            </div>

            <details className="ai-advanced">
              <summary>
                <Icon name="code" /> Custom headers
                <span>{Object.keys(parseHeadersSafe(form.headers)).length || "none"}</span>
              </summary>
              <div className="field">
                <textarea
                  className="mono"
                  rows={3}
                  value={form.headers}
                  onChange={(event) => setForm({ ...form, headers: event.target.value })}
                  spellCheck={false}
                  placeholder='{"X-Title": "Meridian"}'
                />
                <span className="field-help">
                  JSON object merged into every request. Use for gateways that need routing or
                  attribution headers. Authorization headers are not overridden.
                </span>
              </div>
            </details>

            <div className="ai-form-checks">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                />
                <span className="checkbox-ui"><Icon name="check" /></span>
                Enabled for operators
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      is_default: event.target.checked,
                      enabled: event.target.checked ? true : form.enabled,
                    })
                  }
                />
                <span className="checkbox-ui"><Icon name="check" /></span>
                Default provider
              </label>
            </div>

            {testResult && (
              <div className={`notice ${testResult.ok ? "notice-ok" : "notice-warn"}`}>
                <Icon name={testResult.ok ? "circle-check" : "circle-exclamation"} />
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={testDraft}
                disabled={busy === "test" || !form.base_url.trim() || !form.model.trim()}
              >
                <Icon
                  name={busy === "test" ? "circle-notch" : "plug"}
                  className={busy === "test" ? "spin" : ""}
                />
                Test connection
              </button>
              <button className="btn btn-primary" disabled={busy === "save"}>
                <Icon
                  name={busy === "save" ? "circle-notch" : editingId ? "check" : "plus"}
                  className={busy === "save" ? "spin" : ""}
                />
                {editingId ? "Save provider" : "Connect provider"}
              </button>
            </div>
          </div>
        </form>

        <div className="ai-provider-column">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Connected providers</h2>
                <p>Available to owners and administrators in the terminal copilot.</p>
              </div>
              <span className="pill pill-neutral">{rows.length}</span>
            </div>
            {loading ? (
              <div className="table-loading">
                <Icon name="circle-notch" className="spin" /> Loading providers
              </div>
            ) : (
              <div className="ai-provider-list">
                {rows.map((row) => (
                  <article
                    className={`ai-provider-card ${row.is_default ? "is-default" : ""} ${
                      row.enabled ? "" : "is-disabled"
                    }`}
                    key={row.id}
                  >
                    <div className="ai-provider-head">
                      <span className={`ai-provider-icon kind-${row.kind}`}>
                        <Icon name={AI_KIND_ICONS[row.kind] || "bolt"} />
                      </span>
                      <div className="ai-provider-identity">
                        <strong>{row.name}</strong>
                        <span className="mono">{AI_KIND_LABELS[row.kind] || row.kind}</span>
                      </div>
                      <div className="ai-provider-badges">
                        {row.is_default && (
                          <span className="pill pill-ok">
                            <Icon name="star" /> Default
                          </span>
                        )}
                        <span className={`pill ${row.enabled ? "pill-neutral" : "pill-warning"}`}>
                          {row.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>

                    <div className="ai-provider-meta">
                      <span title={row.model}>
                        <Icon name="microchip" /> {row.model || "No model"}
                      </span>
                      <span title={row.base_url} className="ai-provider-url">
                        <Icon name="link" /> {row.base_url}
                      </span>
                      <span>
                        <Icon name="key" /> {row.key_set ? "Key stored" : "No key"}
                      </span>
                      <span>
                        <Icon name="comment-dots" /> {row.requests} request
                        {row.requests === 1 ? "" : "s"}
                      </span>
                      <span>
                        <Icon name="clock" /> {row.last_used ? timeAgo(row.last_used) : "Never used"}
                      </span>
                    </div>

                    {rowTests[row.id] && (
                      <div className={`notice ${rowTests[row.id].ok ? "notice-ok" : "notice-warn"}`}>
                        <Icon name={rowTests[row.id].ok ? "circle-check" : "circle-exclamation"} />
                        <span>{rowTests[row.id].message}</span>
                      </div>
                    )}

                    {modelShelf?.id === row.id && (
                      <div className="ai-model-shelf">
                        <div className="ai-model-shelf-head">
                          <span>
                            {modelShelf.models.length} model
                            {modelShelf.models.length === 1 ? "" : "s"} from {modelShelf.name}
                          </span>
                          <button type="button" onClick={() => setModelShelf(null)}>
                            Hide
                          </button>
                        </div>
                        <div className="ai-model-shelf-list">
                          {modelShelf.models.slice(0, 140).map((name) => (
                            <button
                              type="button"
                              key={name}
                              className={row.model === name ? "active" : ""}
                              onClick={() => {
                                startEdit(row);
                                setForm((current) => ({ ...current, model: name }));
                                setModelShelf(null);
                              }}
                              title={`Edit ${row.name} with ${name}`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ai-provider-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => testExisting(row)}
                        disabled={busy === `test:${row.id}`}
                      >
                        <Icon
                          name={busy === `test:${row.id}` ? "circle-notch" : "plug"}
                          className={busy === `test:${row.id}` ? "spin" : ""}
                        />
                        Test
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => discoverExisting(row)}
                        disabled={busy === `models:${row.id}` || row.kind === "azure"}
                      >
                        <Icon
                          name={busy === `models:${row.id}` ? "circle-notch" : "list"}
                          className={busy === `models:${row.id}` ? "spin" : ""}
                        />
                        Models
                      </button>
                      {!row.is_default && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => makeDefault(row)}
                          disabled={busy === `default:${row.id}`}
                        >
                          <Icon
                            name={busy === `default:${row.id}` ? "circle-notch" : "star"}
                            className={busy === `default:${row.id}` ? "spin" : ""}
                          />
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEdit(row)}
                      >
                        <Icon name="pen" /> Edit
                      </button>
                      <ConfirmButton
                        className="btn btn-danger-ghost btn-sm"
                        icon="trash-can"
                        title={`Delete ${row.name}?`}
                        description={
                          row.requests
                            ? `The provider will be removed. ${row.requests} usage ${
                                row.requests === 1 ? "record keeps its" : "records keep their"
                              } token counts but lose the provider link. Conversations remain readable.`
                            : "The provider and its stored key will be removed. Conversations remain readable."
                        }
                        confirmLabel="Delete provider"
                        onConfirm={async () => {
                          await api.adminDeleteAiProvider(row.id);
                          notify("AI provider deleted");
                          if (editingId === row.id) resetForm();
                          setModelShelf(null);
                          await load();
                        }}
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  </article>
                ))}
                {!rows.length && (
                  <EmptyState
                    icon="brain"
                    title="No AI provider connected"
                    description="Choose a preset on the left. OpenAI-compatible gateways, Anthropic, Gemini, Azure OpenAI and local Ollama models are supported."
                  />
                )}
              </div>
            )}
          </div>

          <div className="card ai-recent-card">
            <div className="card-head">
              <div>
                <h2>Recent copilot calls</h2>
                <p>Latency and token usage recorded by the panel.</p>
              </div>
              <span className="pill pill-neutral">{usage?.window_days ?? 30}d</span>
            </div>
            {usage?.recent.length ? (
              <div className="table-wrap">
                <table className="table ai-recent-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Tokens</th>
                      <th>Latency</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.recent.slice(0, 12).map((item) => (
                      <tr key={item.id}>
                        <td className="mono muted">{fmtDate(item.created_at)}</td>
                        <td>{item.provider_name || "Removed provider"}</td>
                        <td className="mono">{item.model || "—"}</td>
                        <td className="mono">{item.total_tokens.toLocaleString()}</td>
                        <td className="mono">{(item.latency_ms / 1000).toFixed(2)}s</td>
                        <td>
                          <span className={`pill ${item.ok ? "pill-ok" : "pill-danger"}`}>
                            {item.ok ? "ok" : "failed"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="card-body">
                <p className="ai-recent-empty">
                  No copilot calls in this window. Open a server terminal and ask the copilot to
                  review an error or draft a command.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="ai-security-card">
        <Icon name="shield-halved" />
        <div>
          <strong>Provider credentials stay server-side</strong>
          <span>
            API keys are stored in the panel database, redacted from every API response and sent
            only to the configured endpoint. Copilot replies are suggestions; commands are inserted
            at the terminal prompt for review and never executed automatically.
          </span>
        </div>
      </div>
    </div>
  );
}
