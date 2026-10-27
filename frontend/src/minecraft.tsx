import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MinecraftCatalog,
  MinecraftContent,
  MinecraftContentProject,
  MinecraftContentUpdate,
  MinecraftContentVersion,
  MinecraftInfo,
  MinecraftInstallSelection,
  MinecraftJob,
  MinecraftSoftware,
  MinecraftStatus,
  MinecraftUpdateInfo,
  Server as ServerRecord,
  api,
  fmtBytes,
  fmtDate,
} from "./api";
import { Icon } from "./icons";
import { ConfirmButton, EmptyState, Modal, notify } from "./ui";
import minecraftHero from "./assets/minecraft-hero.svg";

export type MinecraftSetupValue = MinecraftInstallSelection & {
  software_name: string;
  edition: "java" | "bedrock";
  requires_eula: boolean;
};

const MC_RUNNING = new Set(["queued", "running"]);

function chooseLoader(data: MinecraftCatalog, current: string): string {
  if (!data.loaders.length) return "";
  if (current && data.loaders.some((item) => item.id === current)) return current;
  return data.defaults.loader_version || data.loaders[0]?.id || "";
}

function loaderLabel(software: MinecraftSoftware | null): string {
  if (!software) return "Loader / build";
  if (software.id === "fabric") return "Fabric loader";
  if (software.id === "quilt") return "Quilt loader";
  if (software.id === "forge") return "Forge version";
  if (software.id === "neoforge") return "NeoForge version";
  if (software.id === "purpur") return "Purpur build";
  if (["paper", "folia", "velocity", "waterfall"].includes(software.id)) return "Build";
  return "Loader / build";
}

export function minecraftSetupReady(value: MinecraftSetupValue | null): boolean {
  if (!value || !value.software || !value.version) return false;
  if (value.requires_eula && !value.accept_eula) return false;
  return true;
}

type PropertyField = {
  key: string;
  label: string;
  kind: "text" | "number" | "select" | "toggle";
  options?: string[];
  placeholder?: string;
  fallback?: string;
  help?: string;
};

function propertyFields(software: MinecraftSoftware | null): PropertyField[] {
  if (!software || software.proxy) return [];
  const bedrock = software.edition === "bedrock";
  return [
    {
      key: bedrock ? "server-name" : "motd",
      label: bedrock ? "Server name" : "MOTD",
      kind: "text",
      placeholder: bedrock ? "VITESTERTL Bedrock" : `${software.name} on VITESTERTL`,
    },
    {
      key: "max-players",
      label: "Max players",
      kind: "number",
      fallback: "20",
    },
    {
      key: "gamemode",
      label: "Game mode",
      kind: "select",
      fallback: "survival",
      options: bedrock
        ? ["survival", "creative", "adventure"]
        : ["survival", "creative", "adventure", "spectator"],
    },
    {
      key: "difficulty",
      label: "Difficulty",
      kind: "select",
      fallback: "easy",
      options: ["peaceful", "easy", "normal", "hard"],
    },
    {
      key: "online-mode",
      label: "Online mode",
      kind: "toggle",
      fallback: "true",
      help: "Verify player identities with Mojang services.",
    },
    {
      key: "view-distance",
      label: "View distance",
      kind: "number",
      fallback: "10",
    },
    ...(bedrock
      ? [
          {
            key: "allow-cheats",
            label: "Allow cheats",
            kind: "toggle" as const,
            fallback: "false",
          },
        ]
      : [
          {
            key: "pvp",
            label: "Player versus player",
            kind: "toggle" as const,
            fallback: "true",
          },
          {
            key: "white-list",
            label: "Whitelist",
            kind: "toggle" as const,
            fallback: "false",
            help: "Only listed players may join after the server starts.",
          },
          {
            key: "simulation-distance",
            label: "Simulation distance",
            kind: "number" as const,
            fallback: "10",
          },
        ]),
  ];
}

function propertyValue(
  properties: Record<string, string>,
  field: PropertyField
): string {
  return properties[field.key] ?? field.fallback ?? "";
}

export function MinecraftPropertyFields({
  software,
  properties,
  onChange,
}: {
  software: MinecraftSoftware | null;
  properties: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const fields = propertyFields(software);
  if (!fields.length) return null;
  function update(key: string, value: string) {
    onChange({ ...properties, [key]: value });
  }
  return (
    <div className="form-grid mc-property-grid">
      {fields.map((field) => {
        if (field.kind === "toggle") {
          const checked = propertyValue(properties, field) === "true";
          return (
            <div className="field mc-toggle-field" key={field.key}>
              <label>{field.label}</label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => update(field.key, event.target.checked ? "true" : "false")}
                />
                <span className="checkbox-ui"><Icon name="check" /></span>
                <span>{checked ? "Enabled" : "Disabled"}</span>
              </label>
              {field.help && <span className="field-help">{field.help}</span>}
            </div>
          );
        }
        if (field.kind === "select") {
          return (
            <div className="field" key={field.key}>
              <label>{field.label}</label>
              <select value={propertyValue(properties, field)} onChange={(event) => update(field.key, event.target.value)}>
                {(field.options || []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {field.help && <span className="field-help">{field.help}</span>}
            </div>
          );
        }
        return (
          <div className="field" key={field.key}>
            <label>{field.label}</label>
            <input
              type={field.kind === "number" ? "number" : "text"}
              min={field.kind === "number" ? 0 : undefined}
              value={properties[field.key] ?? ""}
              placeholder={field.placeholder || field.fallback}
              onChange={(event) => update(field.key, event.target.value)}
            />
            {field.help && <span className="field-help">{field.help}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function MinecraftSetup({
  edition,
  initial,
  onChange,
}: {
  edition: "java" | "bedrock";
  initial?: MinecraftSetupValue | null;
  onChange: (value: MinecraftSetupValue) => void;
}) {
  const [catalog, setCatalog] = useState<MinecraftSoftware[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [softwareId, setSoftwareId] = useState(initial?.software || "");
  const [version, setVersion] = useState(initial?.version || "");
  const [loaderVersion, setLoaderVersion] = useState(initial?.loader_version || "");
  const [acceptEula, setAcceptEula] = useState(initial?.accept_eula || false);
  const [properties, setProperties] = useState<Record<string, string>>(
    initial?.properties || {}
  );
  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [info, setInfo] = useState<MinecraftCatalog | null>(null);
  const [versionError, setVersionError] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    api
      .minecraftCatalog()
      .then(({ data }) => {
        if (active) {
          setCatalog(data);
          setCatalogError("");
        }
      })
      .catch((err: any) => {
        if (active) setCatalogError(err?.message || "Unable to load Minecraft software");
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  const softwareList = useMemo(
    () => catalog.filter((item) => item.edition === edition),
    [catalog, edition]
  );
  const software = softwareList.find((item) => item.id === softwareId) || null;

  useEffect(() => {
    if (!softwareList.length) return;
    if (!softwareList.some((item) => item.id === softwareId)) {
      const preferred =
        softwareList.find((item) => item.id === initial?.software) || softwareList[0];
      setSoftwareId(preferred.id);
      setVersion("");
      setLoaderVersion("");
      setInfo(null);
    }
  }, [softwareList, softwareId, initial?.software]);

  useEffect(() => {
    if (!softwareId) return;
    let active = true;
    setVersionLoading(true);
    setVersionError("");
    api
      .minecraftVersions(softwareId, version, includeSnapshots)
      .then(({ data }) => {
        if (!active) return;
        setInfo(data);
        const selectedVersion =
          version && data.versions.some((item) => item.id === version)
            ? version
            : data.defaults.version || data.versions[0]?.id || "";
        if (selectedVersion !== version) setVersion(selectedVersion);
        const selectedLoader = chooseLoader(data, loaderVersion);
        if (selectedLoader !== loaderVersion) setLoaderVersion(selectedLoader);
      })
      .catch((err: any) => {
        if (active) {
          setInfo(null);
          setVersionError(err?.message || "Unable to load Minecraft versions");
        }
      })
      .finally(() => {
        if (active) setVersionLoading(false);
      });
    return () => {
      active = false;
    };
    // Version is intentionally included so loader metadata follows the selected game version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softwareId, version, includeSnapshots, refreshToken]);

  useEffect(() => {
    if (!software) return;
    const cleanProperties = Object.fromEntries(
      Object.entries(properties).filter(([, value]) => String(value).trim() !== "")
    );
    onChangeRef.current({
      software: software.id,
      version,
      loader_version: loaderVersion,
      accept_eula: software.requires_eula ? acceptEula : true,
      properties: cleanProperties,
      software_name: software.name,
      edition: software.edition,
      requires_eula: software.requires_eula,
    });
  }, [software, version, loaderVersion, acceptEula, properties]);

  function pickSoftware(item: MinecraftSoftware) {
    if (item.id === softwareId) return;
    setSoftwareId(item.id);
    setVersion("");
    setLoaderVersion("");
    setInfo(null);
    setVersionError("");
    setAcceptEula(false);
  }

  if (catalogLoading) {
    return (
      <div className="mc-setup-loading">
        <Icon name="circle-notch" className="spin" />
        <span>Loading Minecraft software catalogue</span>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="err">
        <Icon name="circle-exclamation" />
        <span>{catalogError}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setRefreshToken((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="mc-setup">
      <div className="mc-setup-intro">
        <div>
          <span className="eyebrow">Minecraft installer</span>
          <h3>Choose server software</h3>
          <p>
            Official installers fetch the selected version directly and preserve worlds,
            plugins and mods across reinstalls.
          </p>
        </div>
        <span className="mc-edition-chip">
          <Icon name={edition === "bedrock" ? "cubes-stacked" : "mug-hot"} />
          {edition === "bedrock" ? "Bedrock edition" : "Java edition"}
        </span>
      </div>

      <div className="mc-software-grid" role="radiogroup" aria-label="Minecraft server software">
        {softwareList.map((item) => {
          const active = item.id === softwareId;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`mc-software-card ${active ? "active" : ""}`}
              style={{ "--mc-accent": item.accent } as CSSProperties}
              onClick={() => pickSoftware(item)}
            >
              <span className="mc-software-icon"><Icon name={item.icon} /></span>
              <span className="mc-software-copy">
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </span>
              <span className="mc-software-source">{item.source}</span>
              {active && <span className="mc-software-check"><Icon name="check" /></span>}
            </button>
          );
        })}
      </div>

      {versionError && (
        <div className="err">
          <Icon name="circle-exclamation" />
          <span>{versionError}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setRefreshToken((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {info && (
        <>
          <div className="mc-select-row">
            <div className="field">
              <label>Minecraft version</label>
              <select value={version} onChange={(event) => setVersion(event.target.value)} disabled={versionLoading}>
                {info.versions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                    {item.type && item.type !== "release" ? ` (${item.type})` : ""}
                    {item.channel === "preview" ? " preview" : ""}
                  </option>
                ))}
              </select>
            </div>
            {info.loaders.length > 0 && (
              <div className="field">
                <label>{loaderLabel(software)}</label>
                <select value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
                  {info.loaders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {!item.stable ? " (unstable)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {edition === "java" && (
              <div className="field mc-snapshot-field">
                <label>Release channel</label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={includeSnapshots}
                    onChange={(event) => setIncludeSnapshots(event.target.checked)}
                  />
                  <span className="checkbox-ui"><Icon name="check" /></span>
                  <span>Include snapshots and pre-releases</span>
                </label>
              </div>
            )}
          </div>

          {versionLoading && (
            <div className="mc-inline-loading">
              <Icon name="circle-notch" className="spin" /> Loading builds
            </div>
          )}

          {info.notes.length > 0 && (
            <div className="mc-notes">
              {info.notes.map((note) => (
                <p key={note}><Icon name="circle-info" /> {note}</p>
              ))}
            </div>
          )}

          {propertyFields(software).length > 0 && (
            <div className="mc-property-panel">
              <div className="mc-property-head">
                <div>
                  <strong>Initial server defaults</strong>
                  <span>Applied to server.properties during installation. The allocation port is managed automatically.</span>
                </div>
                <span className="pill pill-neutral">{version || "latest"}</span>
              </div>
              <MinecraftPropertyFields
                software={software}
                properties={properties}
                onChange={setProperties}
              />
            </div>
          )}

          {software?.requires_eula && (
            <label className="mc-eula">
              <input
                type="checkbox"
                checked={acceptEula}
                onChange={(event) => setAcceptEula(event.target.checked)}
              />
              <span className="checkbox-ui"><Icon name="check" /></span>
              <span>
                I accept the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft End User License Agreement</a> and
                confirm that I am authorised to operate this server.
              </span>
            </label>
          )}

          {software && !software.requires_eula && (
            <p className="mc-no-eula">
              <Icon name="circle-check" /> {software.name} does not require a separate EULA acceptance.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function InstallProgress({ job }: { job: MinecraftJob }) {
  const logs = (job.logs || []).slice(-16).join("\n");
  return (
    <div className={`mc-job ${job.status}`}>
      <div className="mc-job-head">
        <div>
          <span className="eyebrow">Provisioning job</span>
          <strong>{job.message || job.status}</strong>
        </div>
        <span className={`pill ${job.status === "failed" ? "pill-danger" : job.status === "completed" ? "pill-ok" : "pill-warning"}`}>
          {job.status}
        </span>
      </div>
      <div className="mc-progress" aria-label={`Installation ${job.progress}% complete`}>
        <i style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} />
      </div>
      <div className="mc-job-meta">
        <span>{job.software_name || job.software || "Minecraft"} {job.version || ""}</span>
        <span>{Math.round(job.progress || 0)}%</span>
      </div>
      {logs && <pre className="mc-job-log">{logs}</pre>}
    </div>
  );
}

function MinecraftInstallDialog({
  open,
  onClose,
  id,
  info,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  info: MinecraftInfo;
  onStarted: (job: MinecraftJob) => void;
}) {
  const [selection, setSelection] = useState<MinecraftSetupValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const edition = info.software?.edition || "java";
  const initial = useMemo<MinecraftSetupValue | null>(() => {
    if (!info.software) return null;
    return {
      software: info.software.id,
      version: info.version || "",
      loader_version: info.loader_version || "",
      accept_eula: !!info.eula,
      properties: info.properties || {},
      software_name: info.software.name,
      edition: info.software.edition,
      requires_eula: info.software.requires_eula,
    };
  }, [info]);

  useEffect(() => {
    if (open) {
      setSelection(initial);
      setError("");
      setBusy(false);
    }
  }, [open, initial]);

  async function submit() {
    if (!selection || !minecraftSetupReady(selection)) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.minecraftInstall(id, {
        software: selection.software,
        version: selection.version,
        loader_version: selection.loader_version,
        accept_eula: selection.accept_eula,
        properties: selection.properties,
      });
      notify("Minecraft installation queued", "info");
      onStarted(data);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Unable to start the installation");
    } finally {
      setBusy(false);
    }
  }

  const ready = minecraftSetupReady(selection);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Install or change Minecraft server"
      description="The server is stopped before installation. Worlds, plugins and mods are preserved."
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!ready || busy}>
            {busy ? <><Icon name="circle-notch" className="spin" /> Starting</> : <><Icon name="cloud-arrow-down" /> Install server</>}
          </button>
        </>
      }
    >
      {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
      <MinecraftSetup edition={edition} initial={initial} onChange={setSelection} />
      {!ready && selection?.requires_eula && !selection.accept_eula && (
        <p className="mc-hint"><Icon name="circle-info" /> Accept the Minecraft EULA to continue.</p>
      )}
    </Modal>
  );
}

function MinecraftStatusCard({
  status,
  busy,
  onCheck,
  running,
}: {
  status: MinecraftStatus | null;
  busy: boolean;
  onCheck: () => void;
  running: boolean;
}) {
  return (
    <div className="card mc-status-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Live query</span>
          <h2>Server list ping</h2>
          <p>Query the running server over the allocation port.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCheck} disabled={busy || !running}>
          {busy ? <Icon name="circle-notch" className="spin" /> : <Icon name="satellite-dish" />}
          Check status
        </button>
      </div>
      <div className="card-body">
        {!status ? (
          <div className="mc-status-empty">
            <span className={`mc-status-orb ${running ? "ready" : ""}`}><Icon name="signal" /></span>
            <div>
              <strong>{running ? "Ready to query" : "Server is not running"}</strong>
              <span>{running ? "Request a live response from the Minecraft server." : "Start the workload to query players and MOTD."}</span>
            </div>
          </div>
        ) : status.online ? (
          <div className="mc-status-online">
            <div className="mc-status-hero">
              {status.icon ? <img src={status.icon} alt="" /> : <span className="mc-status-orb ready"><Icon name="signal" /></span>}
              <div>
                <span className="status status-running"><span className="status-dot running" /> Online</span>
                <strong>{status.motd || "Minecraft server"}</strong>
                <span>{status.version || "Unknown version"} · {status.latency_ms} ms</span>
              </div>
            </div>
            <div className="mc-status-stats">
              <div><span>Players</span><strong>{status.players?.online || 0} / {status.players?.max || 0}</strong></div>
              <div><span>Protocol</span><strong>{status.protocol ?? "—"}</strong></div>
              <div><span>Latency</span><strong>{status.latency_ms} ms</strong></div>
            </div>
            {!!status.players?.sample?.length && (
              <div className="mc-player-list">
                {status.players.sample.map((player) => <span key={`${player.id}-${player.name}`}>{player.name}</span>)}
              </div>
            )}
          </div>
        ) : (
          <div className="mc-status-offline">
            <span className="mc-status-orb"><Icon name="plug-circle-xmark" /></span>
            <div>
              <strong>No response</strong>
              <span>{status.error || "The server did not answer the status request."}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MinecraftConfigCard({
  id,
  info,
  onSaved,
}: {
  id: string;
  info: MinecraftInfo;
  onSaved: (properties: Record<string, string>) => void;
}) {
  const [properties, setProperties] = useState<Record<string, string>>(info.properties || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setProperties(info.properties || {});
  }, [info.properties]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const clean: Record<string, string> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (String(value).trim() !== "") clean[key] = String(value);
      }
      const { data } = await api.minecraftProperties(id, clean);
      setProperties(data);
      onSaved(data);
      notify("Minecraft configuration saved");
    } catch (err: any) {
      setError(err?.message || "Unable to save server.properties");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Configuration</span>
          <h2>server.properties</h2>
          <p>Changes are written directly to the server directory and apply on restart.</p>
        </div>
        <button type="button" className="btn btn-primary btn-small" onClick={save} disabled={busy}>
          {busy ? <Icon name="circle-notch" className="spin" /> : <Icon name="floppy-disk" />}
          Save
        </button>
      </div>
      <div className="card-body">
        {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
        <MinecraftPropertyFields software={info.software} properties={properties} onChange={setProperties} />
        <p className="mc-hint">
          <Icon name="circle-info" />
          The server port, bind address and memory flags remain managed by the panel.
        </p>
      </div>
    </div>
  );
}

function MinecraftUpdateCard({
  id,
  info,
  onQueued,
}: {
  id: string;
  info: MinecraftInfo;
  onQueued: (job: MinecraftJob, backup: any | null) => void;
}) {
  const [update, setUpdate] = useState<MinecraftUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    if (!info.available || !info.version) return;
    setChecking(true);
    try {
      const { data } = await api.minecraftUpdate(id);
      setUpdate(data);
      setError("");
    } catch (err: any) {
      setError(err?.message || "");
    } finally {
      setChecking(false);
    }
  }, [id, info.available, info.version]);

  useEffect(() => {
    check();
  }, [check, info.loader_version, info.status]);

  if (error && !update) {
    return (
      <div className="mc-update-current">
        <Icon name="circle-exclamation" />
        <span>Could not check for updates: {error}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={checking}>
          <Icon name={checking ? "circle-notch" : "rotate"} className={checking ? "spin" : ""} /> Recheck
        </button>
      </div>
    );
  }
  if (!update) {
    if (checking) {
      return (
        <div className="mc-update-checking">
          <Icon name="circle-notch" className="spin" /> Checking upstream releases
        </div>
      );
    }
    return null;
  }
  if (!update.update_available) {
    return (
      <div className="mc-update-current">
        <span className="status-dot ok" />
        <span>
          {update.latest.software_name} {update.latest.version}
          {update.latest.loader_version ? ` · ${update.latest.loader_version}` : ""} is the current stable release.
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={checking}>
          <Icon name={checking ? "circle-notch" : "rotate"} className={checking ? "spin" : ""} /> Recheck
        </button>
      </div>
    );
  }

  async function upgrade() {
    if (!update) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.minecraftUpgrade(id, {
        version: update.latest.version,
        loader_version: update.latest.loader_version,
        backup: true,
      });
      onQueued(response.data, response.backup);
      notify(
        response.backup
          ? "Upgrade queued and a pre-upgrade backup was created"
          : "Upgrade queued"
      );
      await check();
    } catch (err: any) {
      setError(err?.message || "Unable to start the upgrade");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mc-update-card">
      <div className="mc-update-body">
        <div className="mc-update-copy">
          <span className="eyebrow">Maintenance</span>
          <h2>
            {update.version_update
              ? `${update.latest.software_name} ${update.latest.version} is available`
              : "A newer loader build is available"}
          </h2>
          <p>
            Installed <strong>{update.current.version || "unknown"}</strong>
            {update.current.loader_version ? ` · ${update.current.loader_version}` : ""}. Upgrading
            preserves worlds, plugins and mods, and creates a full backup first.
          </p>
          <div className="mc-hero-badges">
            <span><Icon name="tag" /> Target {update.latest.version}</span>
            {update.latest.loader_version && (
              <span><Icon name="layer-group" /> {update.latest.loader_version}</span>
            )}
            {update.latest.released && <span><Icon name="calendar" /> {fmtDate(update.latest.released)}</span>}
          </div>
          {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
        </div>
        <div className="mc-update-actions">
          <ConfirmButton
            className="btn btn-primary"
            icon="arrow-up"
            title="Back up and upgrade this server?"
            description={
              <>
                The server will be stopped, a complete archive will be created, and the target
                release will be installed. World data, plugins, mods and server.properties are
                preserved.
              </>
            }
            confirmLabel="Back up and upgrade"
            tone="primary"
            onConfirm={upgrade}
            disabled={busy}
          >
            Back up and upgrade
          </ConfirmButton>
          <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={checking}>
            <Icon name={checking ? "circle-notch" : "rotate"} className={checking ? "spin" : ""} /> Recheck
          </button>
        </div>
      </div>
    </section>
  );
}

export function MinecraftPane({
  id,
  server,
  onChanged,
}: {
  id: string;
  server: ServerRecord;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<MinecraftInfo | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState<MinecraftJob | null>(null);
  const [dialog, setDialog] = useState(false);
  const [status, setStatus] = useState<MinecraftStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.minecraftInfo(id);
      setInfo(data);
      setJob(data.job || null);
      setError("");
    } catch (err: any) {
      setError(err?.message || "Unable to load Minecraft information");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const running = (server.resources?.state || server.status) === "running" && !server.suspended;

  const checkStatus = useCallback(async () => {
    setStatusBusy(true);
    try {
      const { data } = await api.minecraftStatus(id);
      setStatus(data);
    } catch (err: any) {
      setStatus({ online: false, latency_ms: 0, error: err?.message || "Status query failed" });
    } finally {
      setStatusBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (running) checkStatus();
    else setStatus(null);
  }, [running, checkStatus]);

  useEffect(() => {
    if (!job || !MC_RUNNING.has(job.status)) return;
    const current = job;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.minecraftJob(id, current.id);
        setJob(data);
        if (!MC_RUNNING.has(data.status)) {
          window.clearInterval(timer);
          await load();
          onChanged?.();
          notify(
            data.status === "completed" ? "Minecraft server installed" : data.message || "Installation failed",
            data.status === "completed" ? "success" : "error"
          );
        }
      } catch {
        /* keep the last known job state */
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [id, job?.id, job?.status, load, onChanged]);

  if (error && !info) {
    return <div className="err"><Icon name="circle-exclamation" /> {error}</div>;
  }

  if (!info) {
    return (
      <div className="table-loading">
        <Icon name="circle-notch" className="spin" /> Loading Minecraft installation
      </div>
    );
  }

  if (!info.available) {
    return (
      <EmptyState
        icon="cube"
        title="Minecraft is not installed yet"
        description="Queue an installer job to fetch the server binary, write configuration and prepare the launch script."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setDialog(true)}>
            <Icon name="cloud-arrow-down" /> Install Minecraft
          </button>
        }
      />
    );
  }

  const software = info.software;
  const installed = info.status === "installed";

  return (
    <div className="mc-pane">
      {error && <div className="banner banner-error"><Icon name="circle-exclamation" /><span>{error}</span></div>}

      <section className="mc-hero-banner" style={{ "--mc-accent": software?.accent || "#43b8f5" } as CSSProperties}>
        <div className="mc-hero-copy">
          <span className="eyebrow">Minecraft workload</span>
          <h2>
            {software?.name || "Minecraft"}
            <span className="mc-edition-badge">{software?.edition === "bedrock" ? "Bedrock" : "Java"}</span>
          </h2>
          <p>{software?.description}</p>
          <div className="mc-hero-badges">
            <span><Icon name="tag" /> {info.version || "not installed"}</span>
            {info.loader_version && <span><Icon name="layer-group" /> {info.loader_version}</span>}
            <span><Icon name="server" /> Port {server.allocation_port}</span>
            <span><Icon name="database" /> {software?.source}</span>
          </div>
          <div className="mc-hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => setDialog(true)} disabled={MC_RUNNING.has(job?.status || "")}>
              <Icon name={installed ? "rotate" : "cloud-arrow-down"} />
              {installed ? "Reinstall or change version" : "Install server"}
            </button>
            <span className={`pill ${installed ? "pill-ok" : info.status === "failed" ? "pill-danger" : "pill-warning"}`}>
              <span className={`status-dot ${installed ? "ok" : info.status === "failed" ? "error" : "warning"}`} />
              {info.status || "not installed"}
            </span>
          </div>
        </div>
        <img src={minecraftHero} alt="" aria-hidden="true" />
      </section>

      {job && <InstallProgress job={job} />}

      {installed && (
        <MinecraftUpdateCard
          id={id}
          info={info}
          onQueued={(started) => {
            setJob(started);
            setInfo((current) => (current ? { ...current, status: "queued", job: started } : current));
            onChanged?.();
          }}
        />
      )}

      <div className="mc-pane-grid">
        <MinecraftStatusCard
          status={status}
          busy={statusBusy}
          onCheck={checkStatus}
          running={running}
        />

        <div className="card mc-details-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Installation</span>
              <h2>Provisioned runtime</h2>
              <p>Installer metadata recorded on this node.</p>
            </div>
            <span className="card-head-icon"><Icon name="cube" /></span>
          </div>
          <div className="card-body identity-list">
            <div><span>Software</span><span>{software?.name || "—"}</span></div>
            <div><span>Edition</span><span>{software?.edition || "—"}</span></div>
            <div><span>Minecraft version</span><span>{info.version || "—"}</span></div>
            <div><span>{loaderLabel(software)}</span><span>{info.loader_version || "—"}</span></div>
            <div><span>Installer source</span><span>{software?.source || "—"}</span></div>
            <div><span>Content directory</span><span>{info.capabilities.enabled ? info.capabilities.directory : "Not supported"}</span></div>
            <div><span>EULA</span><span>{software?.requires_eula ? (info.eula ? "Accepted" : "Not accepted") : "Not required"}</span></div>
            <div><span>Installed</span><span>{info.installed_at ? fmtDate(info.installed_at) : "Not yet"}</span></div>
          </div>
        </div>
      </div>

      {software && !software.proxy && (
        <MinecraftConfigCard
          id={id}
          info={info}
          onSaved={(properties) => setInfo((current) => (current ? { ...current, properties } : current))}
        />
      )}

      <MinecraftInstallDialog
        open={dialog}
        onClose={() => setDialog(false)}
        id={id}
        info={info}
        onStarted={(started) => {
          setJob(started);
          setInfo((current) => (current ? { ...current, status: "queued", job: started } : current));
          onChanged?.();
        }}
      />
    </div>
  );
}

function ContentIcon({
  url,
  title,
  type,
}: {
  url?: string;
  title: string;
  type: "plugin" | "mod";
}) {
  const [failed, setFailed] = useState(false);
  const fallback = type === "plugin" ? "puzzle-piece" : "cube";
  if (!url || failed) {
    return <span className="mc-content-icon fallback"><Icon name={fallback} /></span>;
  }
  return (
    <span className="mc-content-icon">
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      <span className="sr-only">{title}</span>
    </span>
  );
}

function ProjectDialog({
  id,
  project,
  onClose,
  onInstalled,
}: {
  id: string;
  project: MinecraftContentProject | null;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [versions, setVersions] = useState<MinecraftContentVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!project) return;
    let active = true;
    setLoading(true);
    setError("");
    setVersions([]);
    setVersionId("");
    api
      .pluginVersions(id, project.id)
      .then(({ data }) => {
        if (!active) return;
        setVersions(data);
        setVersionId(data[0]?.id || "");
      })
      .catch((err: any) => {
        if (active) setError(err?.message || "Unable to load project versions");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, project]);

  async function install() {
    if (!project || !versionId) return;
    setBusy(true);
    setError("");
    try {
      await api.pluginInstall(id, project.id, versionId);
      notify(`${project.title} installed`);
      onInstalled();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Unable to install this project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!project}
      onClose={busy ? () => undefined : onClose}
      title={project?.title || "Install content"}
      description={project ? `${project.project_type === "plugin" ? "Plugin" : "Mod"}${project.author ? ` by ${project.author}` : ""} · ${project.downloads.toLocaleString()} downloads` : undefined}
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={install} disabled={!versionId || busy || loading}>
            {busy ? <><Icon name="circle-notch" className="spin" /> Installing</> : <><Icon name="cloud-arrow-down" /> Install</>}
          </button>
        </>
      }
    >
      {project && (
        <div className="mc-project-summary">
          <ContentIcon url={project.icon_url} title={project.title} type={project.project_type} />
          <div>
            <p>{project.description}</p>
            <div className="mc-badge-row">
              {project.categories.slice(0, 6).map((category) => <span key={category} className="pill pill-neutral">{category}</span>)}
              <a href={project.url} target="_blank" rel="noreferrer" className="mc-ext-link">View on Modrinth <Icon name="arrow-up-right-from-square" /></a>
            </div>
          </div>
        </div>
      )}
      {error && <div className="err"><Icon name="circle-exclamation" /> {error}</div>}
      {loading ? (
        <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading compatible versions</div>
      ) : versions.length === 0 ? (
        <EmptyState
          icon="circle-info"
          title="No compatible version"
          description="This project does not publish a build for the installed Minecraft version and loader."
        />
      ) : (
        <div className="mc-version-list">
          {versions.map((version) => {
            const primary = version.files.find((file) => file.primary) || version.files[0];
            return (
              <label key={version.id} className={`mc-version-row ${versionId === version.id ? "active" : ""}`}>
                <input
                  type="radio"
                  name="mc-version"
                  value={version.id}
                  checked={versionId === version.id}
                  onChange={() => setVersionId(version.id)}
                />
                <span className="checkbox-ui"><Icon name="check" /></span>
                <span className="mc-version-copy">
                  <strong>{version.version_number || version.name}</strong>
                  <span>{version.name !== version.version_number ? version.name : (version.game_versions.slice(0, 4).join(", ") || "Universal")}</span>
                  <span className="mc-version-meta">
                    <em>{version.loaders.join(", ") || "any loader"}</em>
                    <em>{primary ? primary.filename : "No file"}</em>
                    <em>{primary ? fmtBytes(primary.size) : ""}</em>
                    <em>{version.date_published ? fmtDate(version.date_published) : ""}</em>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export function PluginsPane({ id }: { id: string }) {
  const [installed, setInstalled] = useState<MinecraftContent[]>([]);
  const [capabilities, setCapabilities] = useState<MinecraftInfo["capabilities"] | null>(null);
  const [counts, setCounts] = useState({ total: 0, enabled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MinecraftContentProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [featured, setFeatured] = useState(true);
  const [project, setProject] = useState<MinecraftContentProject | null>(null);
  const [busy, setBusy] = useState("");
  const [updates, setUpdates] = useState<Record<string, MinecraftContentUpdate>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.plugins(id);
      setInstalled(response.data);
      setCapabilities(response.capabilities);
      setCounts(response.counts);
      setError("");
    } catch (err: any) {
      setError(err?.message || "Unable to load installed content");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runSearch = useCallback(
    async (value: string, featuredOnly = false) => {
      setSearching(true);
      setSearchError("");
      setFeatured(featuredOnly);
      try {
        const response = await api.pluginSearch(id, value, featuredOnly, 18, 0);
        setResults(response.data);
      } catch (err: any) {
        setSearchError(err?.message || "Unable to search the Modrinth catalogue");
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [id]
  );

  useEffect(() => {
    if (capabilities?.enabled) runSearch("", true);
  }, [capabilities?.enabled, runSearch]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    runSearch(query.trim(), !query.trim());
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      await api.pluginUpload(id, file);
      notify(`${file.name} uploaded`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function toggle(item: MinecraftContent) {
    setBusy(item.filename);
    try {
      const { data } = await api.pluginToggle(id, item.filename);
      notify(`${item.title || item.base_name} ${data.enabled ? "enabled" : "disabled"}`);
      await load();
    } catch (err: any) {
      notify(err?.message || "Unable to toggle this file", "error");
    } finally {
      setBusy("");
    }
  }

  async function remove(item: MinecraftContent) {
    await api.pluginDelete(id, item.filename);
    notify(`${item.title || item.base_name} deleted`);
    await load();
  }

  async function checkUpdates() {
    setCheckingUpdates(true);
    setUpdateError("");
    try {
      const response = await api.pluginUpdates(id);
      const map = Object.fromEntries(response.data.map((item) => [item.filename, item]));
      setUpdates(map);
      const count = response.data.length;
      const label = response.project_type === "mod" ? "mod" : "plugin";
      if (count) {
        notify(`${count} ${label} update${count === 1 ? "" : "s"} available`, "info");
      } else {
        notify(`All tracked ${label}s are up to date`);
      }
      if (response.errors.length) {
        setUpdateError(
          `${response.errors.length} project${response.errors.length === 1 ? "" : "s"} could not be checked: ${response.errors
            .map((item) => item.title)
            .join(", ")}`
        );
      }
    } catch (err: any) {
      setUpdateError(err?.message || "Unable to check for updates");
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function update(item: MinecraftContent) {
    setBusy(`update:${item.filename}`);
    setUpdateError("");
    try {
      const response = await api.pluginUpdate(id, item.filename);
      notify(
        response.message
          ? `${item.title || item.base_name}: ${response.message}`
          : `${item.title || item.base_name} updated to ${response.data.version_number || "the latest build"}`,
        response.updated ? "success" : "info"
      );
      setUpdates((current) => {
        const next = { ...current };
        delete next[item.filename];
        return next;
      });
      await load();
      if (response.restart_required) {
        notify("Restart the server to load the updated file", "info");
      }
    } catch (err: any) {
      setUpdateError(err?.message || "Unable to update this file");
    } finally {
      setBusy("");
    }
  }

  const kind = capabilities?.kind || "plugin";

  return (
    <div className="plugins-pane">
      {error && <div className="banner banner-error"><Icon name="circle-exclamation" /><span>{error}</span></div>}
      {updateError && <div className="err"><Icon name="circle-exclamation" /> {updateError}</div>}

      <div className="section-head plugins-head">
        <div>
          <span className="eyebrow">Extensions</span>
          <h2>{kind === "mod" ? "Mods" : "Plugins"}</h2>
          <p className="section-meta">
            {counts.total} installed
            <span className="dot-separator" />
            {counts.enabled} enabled
            {capabilities?.directory && <><span className="dot-separator" /><code>{capabilities.directory}/</code></>}
          </p>
        </div>
        <div className="plugins-actions">
          <button type="button" className="btn btn-ghost" onClick={() => load()} disabled={loading}>
            <Icon name="rotate" /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={checkUpdates}
            disabled={checkingUpdates || !counts.total}
            title="Compare tracked Modrinth projects with the latest compatible version"
          >
            <Icon name={checkingUpdates ? "circle-notch" : "cloud-arrow-down"} className={checkingUpdates ? "spin" : ""} />
            Check updates
            {Object.keys(updates).length > 0 && <span className="mc-update-count">{Object.keys(updates).length}</span>}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => uploadRef.current?.click()}
            disabled={!capabilities?.enabled || busy === "upload"}
          >
            {busy === "upload" ? <Icon name="circle-notch" className="spin" /> : <Icon name="upload" />}
            Upload {kind}
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept=".jar,.zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
        </div>
      </div>

      {!capabilities?.enabled ? (
        <div className="card">
          <EmptyState
            icon="puzzle-piece"
            title="Content management is unavailable"
            description="This Minecraft software does not load plugins or mods. Switch to Paper, Purpur, Fabric, Forge, NeoForge or another compatible server to manage content."
          />
        </div>
      ) : (
        <>
          <div className="card mc-installed-card">
            <div className="card-head">
              <div>
                <h2>Installed {kind === "mod" ? "mods" : "plugins"}</h2>
                <p>Disable a file to keep it on disk without loading it on the next start.</p>
              </div>
              <span className="pill pill-neutral">{counts.total}</span>
            </div>
            {loading ? (
              <div className="table-loading"><Icon name="circle-notch" className="spin" /> Loading installed {kind}s</div>
            ) : installed.length === 0 ? (
              <EmptyState
                icon={kind === "mod" ? "cube" : "puzzle-piece"}
                title={`No ${kind}s installed`}
                description={`Search Modrinth below or upload a .jar file into the ${capabilities.directory}/ directory.`}
              />
            ) : (
              <div className="table-wrap">
                <table className="table mc-content-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Version</th>
                      <th>Size</th>
                      <th>State</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installed.map((item) => (
                      <tr key={item.filename} className={!item.enabled ? "disabled-row" : ""}>
                        <td>
                          <div className="entity-cell">
                            <ContentIcon url={item.icon_url} title={item.title} type={item.project_type} />
                            <div>
                              <span className="entity-name">{item.title || item.base_name}</span>
                              <span className="entity-meta">
                                {item.project_slug ? <a href={`https://modrinth.com/${item.project_type}/${item.project_slug}`} target="_blank" rel="noreferrer">{item.filename}</a> : item.filename}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="mc-table-version">{item.version_number || "local"}</span>
                          {updates[item.filename] && (
                            <span className="mc-update-pill">
                              <Icon name="arrow-up" /> {updates[item.filename].latest.version_number || "new build"}
                            </span>
                          )}
                          {item.installed_at && <span className="entity-meta">{fmtDate(item.installed_at)}</span>}
                        </td>
                        <td>{fmtBytes(item.size)}</td>
                        <td>
                          <span className={`pill ${item.enabled ? "pill-ok" : "pill-neutral"}`}>
                            <span className={`status-dot ${item.enabled ? "ok" : "neutral"}`} />
                            {item.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            {updates[item.filename] && (
                              <button
                                type="button"
                                className="icon-btn accent-hover"
                                title={`Update to ${updates[item.filename].latest.version_number || "the latest build"}`}
                                aria-label={`Update ${item.title || item.base_name}`}
                                onClick={() => update(item)}
                                disabled={busy === `update:${item.filename}`}
                              >
                                <Icon
                                  name={busy === `update:${item.filename}` ? "circle-notch" : "arrow-up"}
                                  className={busy === `update:${item.filename}` ? "spin" : ""}
                                />
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-btn"
                              title={item.enabled ? "Disable" : "Enable"}
                              aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.title || item.base_name}`}
                              onClick={() => toggle(item)}
                              disabled={busy === item.filename}
                            >
                              <Icon name={busy === item.filename ? "circle-notch" : item.enabled ? "toggle-on" : "toggle-off"} className={busy === item.filename ? "spin" : ""} />
                            </button>
                            <ConfirmButton
                              className="icon-btn danger-hover"
                              icon="trash-can"
                              title={`Delete ${item.title || item.base_name}?`}
                              description="The file is permanently removed from the server directory."
                              confirmLabel="Delete file"
                              onConfirm={() => remove(item)}
                            >
                              <span className="sr-only">Delete</span>
                            </ConfirmButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mc-catalogue-head">
            <div>
              <span className="eyebrow">Modrinth catalogue</span>
              <h2>Discover {kind === "mod" ? "mods" : "plugins"}</h2>
              <p>Builds are filtered for Minecraft {installed.length ? "and the installed software" : "and this loader"} automatically.</p>
            </div>
            <form className="mc-search" onSubmit={submitSearch}>
              <div className="search-field">
                <Icon name="magnifying-glass" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${kind}s on Modrinth`}
                  aria-label={`Search ${kind}s`}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={searching}>
                {searching ? <Icon name="circle-notch" className="spin" /> : <Icon name="magnifying-glass" />}
                Search
              </button>
            </form>
          </div>

          {searchError && <div className="err"><Icon name="circle-exclamation" /> {searchError}</div>}

          {searching ? (
            <div className="table-loading"><Icon name="circle-notch" className="spin" /> Querying Modrinth</div>
          ) : results.length === 0 ? (
            <div className="card"><EmptyState icon="magnifying-glass" title="No matching projects" description="Try a broader search term or a different Minecraft version." /></div>
          ) : (
            <div className="mc-project-grid">
              {results.map((item) => (
                <article className="mc-project-card" key={item.id}>
                  <div className="mc-project-top">
                    <ContentIcon url={item.icon_url} title={item.title} type={item.project_type} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.author ? `by ${item.author}` : "Community project"}</span>
                    </div>
                    <span className="mc-downloads"><Icon name="download" /> {item.downloads >= 1000 ? `${(item.downloads / 1000).toFixed(1)}k` : item.downloads}</span>
                  </div>
                  <p>{item.description || "No description supplied by the project author."}</p>
                  <div className="mc-project-tags">
                    {item.categories.slice(0, 3).map((category) => <span key={category}>{category}</span>)}
                    {item.game_versions.slice(-2).map((version) => <span key={version} className="mc-tag-version">{version}</span>)}
                  </div>
                  <div className="mc-project-foot">
                    <span className={`status-text ${item.server_side === "required" ? "ok" : "muted"}`}>
                      <Icon name={item.server_side === "required" ? "circle-check" : "circle-info"} />
                      {item.server_side === "required" ? "Server ready" : item.server_side === "unsupported" ? "Client only" : "Server optional"}
                    </span>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setProject(item)}>
                      Install <Icon name="arrow-right" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!featured && results.length > 0 && (
            <button type="button" className="btn btn-ghost mc-reset-search" onClick={() => { setQuery(""); runSearch("", true); }}>
              <Icon name="arrow-left" /> Back to featured
            </button>
          )}

          <ProjectDialog
            id={id}
            project={project}
            onClose={() => setProject(null)}
            onInstalled={() => load()}
          />
        </>
      )}
    </div>
  );
}
