import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { User, api, fmtDate, timeAgo } from "../api";
import { Icon } from "../icons";
import { ConfirmButton, CopyButton, PageHeader, notify } from "../ui";

function passwordStrength(value: string): { score: number; label: string; tone: string } {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  if (!value) return { score: 0, label: "No password", tone: "empty" };
  if (score <= 2) return { score: 33, label: "Weak", tone: "weak" };
  if (score === 3) return { score: 55, label: "Fair", tone: "fair" };
  if (score === 4) return { score: 80, label: "Strong", tone: "strong" };
  return { score: 100, label: "Excellent", tone: "excellent" };
}

export default function Account() {
  const { user, refreshUser } = useOutletContext<{ user: User; refreshUser: () => Promise<User> }>();
  const [profile, setProfile] = useState({
    username: user.username,
    email: user.email,
    first_name: user.first_name || "",
    last_name: user.last_name || "",
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const strength = useMemo(() => passwordStrength(passwordForm.next), [passwordForm.next]);
  const initials = (user.first_name?.[0] || user.username.slice(0, 1)).toUpperCase();
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
  const [keys, setKeys] = useState<any[]>([]);
  const [keyName, setKeyName] = useState("Panel API");
  const [keyBusy, setKeyBusy] = useState(false);
  const [freshToken, setFreshToken] = useState("");

  const loadKeys = useCallback(async () => {
    try {
      setKeys((await api.apiKeys()).data);
    } catch (err: any) {
      notify(err.message || "Unable to load API keys", "error");
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setKeyBusy(true);
    try {
      const response = await api.createApiKey(keyName.trim() || "Panel API");
      setFreshToken(response.data.token);
      setKeyName("Panel API");
      notify("API key created");
      await loadKeys();
    } catch (err: any) {
      notify(err.message || "Unable to create API key", "error");
    } finally {
      setKeyBusy(false);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileBusy(true);
    try {
      await api.updateAccount(profile);
      await refreshUser();
      notify("Profile updated");
    } catch (err: any) {
      notify(err.message || "Unable to update profile", "error");
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordForm.next !== passwordForm.confirm) {
      notify("New passwords do not match", "error");
      return;
    }
    if (passwordForm.next.length < 8) {
      notify("Use at least 8 characters for the new password", "error");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.password(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      notify("Password updated");
    } catch (err: any) {
      notify(err.message || "Unable to update password", "error");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Account"
        title="Personal settings"
        description="Manage the identity attached to your panel session, rotate your password, and issue API keys."
      />

      <div className="account-hero">
        <span className="avatar avatar-xl">{initials}</span>
        <div className="account-hero-copy">
          <h2>{displayName}</h2>
          <span>{user.email}</span>
          <div className="account-badges">
            <span className="pill pill-ok"><Icon name="shield-halved" /> {user.role === "admin" ? "Administrator" : "Member"}</span>
            <span className="pill pill-neutral"><Icon name="clock" /> Last sign-in {timeAgo(user.last_login)}</span>
            <span className="pill pill-neutral"><Icon name="calendar" /> Joined {fmtDate(user.created_at)}</span>
          </div>
        </div>
        <div className="account-ident">
          <span>Panel user</span>
          <strong>#{String(user.id).padStart(4, "0")}</strong>
        </div>
      </div>

      <div className="account-layout">
        <form className="card" onSubmit={saveProfile}>
          <div className="card-head">
            <div>
              <h2>Profile information</h2>
              <p>Display name and contact address used across the panel.</p>
            </div>
            <span className="card-head-icon"><Icon name="id-card" /></span>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <div className="field">
                <label>First name</label>
                <input value={profile.first_name} onChange={(event) => setProfile({ ...profile, first_name: event.target.value })} placeholder="First name" />
              </div>
              <div className="field">
                <label>Last name</label>
                <input value={profile.last_name} onChange={(event) => setProfile({ ...profile, last_name: event.target.value })} placeholder="Last name" />
              </div>
              <div className="field">
                <label>Username</label>
                <input value={profile.username} onChange={(event) => setProfile({ ...profile, username: event.target.value })} required minLength={3} />
              </div>
              <div className="field">
                <label>Email address</label>
                <input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} required />
              </div>
            </div>
            <button className="btn btn-primary" disabled={profileBusy}>
              <Icon name={profileBusy ? "circle-notch" : "floppy-disk"} className={profileBusy ? "spin" : ""} /> Save profile
            </button>
          </div>
        </form>

        <form className="card" onSubmit={savePassword}>
          <div className="card-head">
            <div>
              <h2>Password</h2>
              <p>Use at least 8 characters. Existing sessions remain valid until expiry.</p>
            </div>
            <span className="card-head-icon"><Icon name="key" /></span>
          </div>
          <div className="card-body">
            <div className="field">
              <label>Current password</label>
              <input type="password" autoComplete="current-password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} required />
            </div>
            <div className="field">
              <label>New password</label>
              <input type="password" autoComplete="new-password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} required />
              {passwordForm.next && (
                <div className="strength">
                  <div className="strength-track"><i className={`tone-${strength.tone}`} style={{ width: `${strength.score}%` }} /></div>
                  <span>{strength.label}</span>
                </div>
              )}
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type="password" autoComplete="new-password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} required />
            </div>
            <button className="btn btn-primary" disabled={passwordBusy}>
              <Icon name={passwordBusy ? "circle-notch" : "shield-halved"} className={passwordBusy ? "spin" : ""} /> Update password
            </button>
          </div>
        </form>

        <aside className="account-side">
          <div className="card">
            <div className="card-head"><div><h2>Session</h2><p>Current authentication context.</p></div></div>
            <div className="card-body identity-list">
              <div><span>Signed in as</span><span>{user.username}</span></div>
              <div><span>Role</span><span>{user.role}</span></div>
              <div><span>Token lifetime</span><span>7 days</span></div>
              <div><span>Account ID</span><code>{user.id}</code></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Security notes</h2><p>Keep your workspace protected.</p></div></div>
            <div className="card-body security-notes">
              <div><Icon name="lock" /><span>Passwords are hashed with PBKDF2-SHA256 and never returned by the API.</span></div>
              <div><Icon name="clock" /><span>Sign-in sessions expire automatically after seven days.</span></div>
              <div><Icon name="clock-rotate-left" /><span>Account changes are recorded in the audit trail.</span></div>
            </div>
          </div>
          <div className="card account-ref">
            <div className="card-body">
              <span>Account reference</span>
              <code>{user.email}</code>
              <CopyButton value={user.email} label="Copy email" className="btn btn-ghost btn-sm" />
            </div>
          </div>
        </aside>
      </div>

      <section className="card account-keys">
        <div className="card-head">
          <div>
            <h2>API keys</h2>
            <p>Bearer tokens for automation. The secret is shown once at creation. Prefix <code>vt_</code>.</p>
          </div>
          <span className="card-head-icon"><Icon name="key" /></span>
        </div>
        <div className="card-body">
          <form className="api-key-form" onSubmit={createKey}>
            <div className="field">
              <label>Key name</label>
              <input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="CI deploy" maxLength={80} />
            </div>
            <button className="btn btn-primary" disabled={keyBusy}>
              <Icon name={keyBusy ? "circle-notch" : "plus"} className={keyBusy ? "spin" : ""} /> Create key
            </button>
          </form>
          {freshToken && (
            <div className="api-key-once">
              <div>
                <strong>Copy this token now</strong>
                <span>It will not be shown again.</span>
              </div>
              <CopyButton value={freshToken} label="Copy token" className="btn btn-ghost btn-sm" />
              <code>{freshToken}</code>
            </div>
          )}
          {keys.length === 0 ? (
            <p className="muted">No API keys yet. Created keys authenticate as your account against /api.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td><code>{key.prefix}</code></td>
                      <td>{key.last_used ? timeAgo(key.last_used) : "Never"}</td>
                      <td>{fmtDate(key.created_at)}</td>
                      <td>
                        <ConfirmButton
                          className="btn btn-ghost btn-sm"
                          icon="trash"
                          title={`Revoke ${key.name}?`}
                          description="Scripts using this token will fail immediately."
                          confirmLabel="Revoke key"
                          tone="danger"
                          onConfirm={async () => {
                            await api.deleteApiKey(key.id);
                            if (freshToken.startsWith(String(key.prefix || "").replace("...", ""))) setFreshToken("");
                            notify("API key revoked");
                            await loadKeys();
                          }}
                        >
                          Revoke
                        </ConfirmButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
