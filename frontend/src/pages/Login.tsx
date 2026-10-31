import { FormEvent, useEffect, useState } from "react";
import { api, setToken, type Meta } from "../api";
import { AuthEmblem, BrandMark, Icon } from "../icons";
import minecraftHero from "../assets/minecraft-hero.svg";

const capabilities = [
  {
    icon: "satellite-dish",
    title: "Live telemetry",
    text: "CPU, memory, disk and console streams from every workload.",
  },
  {
    icon: "folder-tree",
    title: "Complete operations",
    text: "Files, databases, schedules, backups and allocations in one place.",
  },
  {
    icon: "shield-halved",
    title: "Controlled access",
    text: "Roles, subusers and a full audit trail for every action.",
  },
];

const REPO_URL = "https://github.com/sollxfim-lab";

export default function Login() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    document.title = "Sign in · Meridian";
    api.meta().then(setMeta).catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.login(username.trim(), password);
      if ("two_factor_required" in response) {
        setChallenge(response.challenge);
        setCode("");
        setBusy(false);
        return;
      }
      setToken(response.token);
      window.location.replace("/");
    } catch (err: any) {
      setError(err.message || "Sign in failed");
      setBusy(false);
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.loginTwoFactor(challenge, code.trim());
      setToken(response.token);
      window.location.replace("/");
    } catch (err: any) {
      setError(err.message || "Verification failed");
      setBusy(false);
    }
  }

  function resetChallenge() {
    setChallenge("");
    setCode("");
    setError("");
    setPassword("");
    setBusy(false);
  }

  return (
    <div className="auth">
      <section className="auth-visual">
        <div className="auth-grid" aria-hidden="true" />
        <div className="auth-glow" aria-hidden="true" />
        <div className="auth-visual-inner">
          <div className="auth-brand">
            <BrandMark />
            <div>
              <strong>{meta?.name || "Meridian"}</strong>
              <span>Infrastructure control plane</span>
            </div>
            <span className="auth-version">v{meta?.version || "2.1.0"}</span>
          </div>

          <div className="auth-hero">
            <span className="auth-eyebrow">
              <span className="live-dot ok" />
              Panel online
            </span>
            <h1>One console for every node, workload and allocation.</h1>
            <p>
              Operate application and game servers with live telemetry, secure file access,
              scheduled maintenance and complete audit history.
            </p>
          </div>

          <div className="auth-capabilities">
            {capabilities.map((item) => (
              <div className="auth-capability" key={item.title}>
                <span className="capability-icon">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.text}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-head">
              <div>
                <span className="preview-label">Control surface</span>
                <strong>Fleet overview</strong>
              </div>
              <span className="status status-running">
                <span className="status-dot running" />
                Operational
              </span>
            </div>
            <div className="auth-preview-body">
              <div className="auth-preview-grid">
                <div>
                  <span>Workloads</span>
                  <strong>Provisioned &amp; monitored</strong>
                </div>
                <div>
                  <span>Telemetry</span>
                  <strong>Streaming live</strong>
                </div>
                <div>
                  <span>Access</span>
                  <strong>Role based</strong>
                </div>
                <div>
                  <span>Audit</span>
                  <strong>Every event retained</strong>
                </div>
              </div>
              <img
                className="auth-preview-art"
                src={minecraftHero}
                alt=""
                aria-hidden="true"
              />
            </div>
          </div>

          <footer className="auth-visual-foot">
            <span>
              <Icon name="lock" /> Signed sessions
            </span>
            <span>
              <Icon name="server" /> Debian-first runtime
            </span>
            <span>{meta?.company || "Meridian Host"}</span>
          </footer>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-emblem">
            <AuthEmblem />
            <div className="auth-emblem-copy">
              <strong>{meta?.name || "Meridian"}</strong>
              <span>Game and application control plane</span>
            </div>
          </div>
          <div className="auth-card-head">
            <span className="eyebrow">{challenge ? "Second factor" : "Secure access"}</span>
            <h2>{challenge ? "Confirm it is you" : "Sign in to your workspace"}</h2>
            <p>
              {challenge
                ? "Enter the six-digit code from your authenticator app, or use a recovery code."
                : "Enter the credentials issued by your panel administrator."}
            </p>
          </div>

          {error && (
            <div className="auth-error" role="alert">
              <Icon name="circle-exclamation" />
              <span>{error}</span>
            </div>
          )}

          {challenge ? (
            <form onSubmit={onVerify} autoComplete="one-time-code">
              <div className="field">
                <label htmlFor="two-factor-code">Authentication code</label>
                <div className="input-wrap">
                  <Icon name="shield-halved" />
                  <input
                    id="two-factor-code"
                    name="code"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="123456 or recovery code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    required
                  />
                </div>
                <span className="field-help">
                  Codes rotate every 30 seconds. Recovery codes are single use.
                </span>
              </div>
              <button className="btn btn-primary btn-block auth-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <Icon name="circle-notch" className="spin" /> Verifying code
                  </>
                ) : (
                  <>
                    Verify and continue <Icon name="arrow-right" />
                  </>
                )}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={resetChallenge}>
                Use a different account
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit} autoComplete="on">
              <div className="field">
                <label htmlFor="username">Username or email</label>
                <div className="input-wrap">
                  <Icon name="user" />
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="password">Password</label>
                  {capsLock && <span className="field-note">Caps Lock is on</span>}
                </div>
                <div className="input-wrap">
                  <Icon name="key" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyUp={(event) => setCapsLock(event.getModifierState?.("CapsLock") || false)}
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <Icon name={showPassword ? "eye-slash" : "eye"} />
                  </button>
                </div>
              </div>

              <button className="btn btn-primary btn-block auth-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <Icon name="circle-notch" className="spin" /> Verifying credentials
                  </>
                ) : (
                  <>
                    Sign in <Icon name="arrow-right" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="auth-assurance">
            <Icon name="shield-halved" />
            <span>Sessions are signed and expire automatically. Credentials are never stored by the panel.</span>
          </div>

          <div className="auth-card-foot">
            <span>{meta?.company || "Meridian Host"}</span>
            <span className="dot-separator" />
            <span>Panel {meta?.version || "2.1.0"}</span>
            {meta?.support_email && (
              <>
                <span className="dot-separator" />
                <a href={`mailto:${meta.support_email}`}>{meta.support_email}</a>
              </>
            )}
          </div>
        </div>
        <div className="auth-credit">
          <div className="auth-signature">
            <span className="auth-platforms-label">Runs on</span>
            <div className="auth-platforms" role="group" aria-label="Supported operating systems">
              <span className="auth-platform ubuntu" title="Ubuntu">
                <Icon name="ubuntu" brand /> Ubuntu
              </span>
              <span className="auth-platform debian" title="Debian">
                <Icon name="debian" brand /> Debian
              </span>
              <span className="auth-platform linux" title="Linux">
                <Icon name="linux" brand /> Linux
              </span>
            </div>
            <a
              className="auth-source"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open the project GitHub organisation in a new tab"
            >
              <Icon name="github" brand />
              <span>GitHub</span>
              <Icon name="arrow-up-right-from-square" />
            </a>
          </div>
          <p className="auth-thanks">
            Thank you for using <strong>{meta?.name || "Meridian"}</strong>.
          </p>
        </div>
        <p className="auth-panel-note">
          <Icon name="circle-info" /> Access is restricted to authorised panel users.
        </p>
      </section>
    </div>
  );
}
