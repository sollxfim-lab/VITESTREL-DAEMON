import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { User } from "../api";
import { setToken } from "../api";
import { BrandMark, Icon } from "../icons";

type SystemInfo = {
  runtime?: string;
  docker?: boolean;
  hostname?: string;
  version?: string;
  wings?: string;
} | null;

const NAV = {
  workspace: [
    { to: "/", label: "Overview", icon: "gauge-high", end: true },
    { to: "/account", label: "Account", icon: "user-gear" },
  ],
  admin: [
    { to: "/admin", label: "Administration", icon: "chart-pie", end: true },
    { to: "/admin/servers", label: "Servers", icon: "server" },
    { to: "/admin/nodes", label: "Nodes", icon: "network-wired" },
    { to: "/admin/locations", label: "Locations", icon: "location-dot" },
    { to: "/admin/nests", label: "Nests & eggs", icon: "layer-group" },
    { to: "/admin/users", label: "Users", icon: "users" },
    { to: "/admin/activity", label: "Audit log", icon: "clock-rotate-left" },
    { to: "/admin/settings", label: "Settings", icon: "sliders" },
  ],
};

function pageLabel(pathname: string): string {
  const map: Record<string, string> = {
    "/": "Overview",
    "/account": "Account",
    "/admin": "Administration",
    "/admin/servers": "Servers",
    "/admin/servers/new": "Provision server",
    "/admin/nodes": "Nodes",
    "/admin/nodes/new": "Register node",
    "/admin/locations": "Locations",
    "/admin/nests": "Nests & eggs",
    "/admin/users": "Users",
    "/admin/users/new": "Create user",
    "/admin/activity": "Audit log",
    "/admin/settings": "Settings",
  };
  if (map[pathname]) return map[pathname];
  if (pathname.startsWith("/server/")) return "Server console";
  if (pathname.startsWith("/admin/nodes/")) return "Node detail";
  if (pathname.startsWith("/admin/users/")) return "User detail";
  return "Workspace";
}

export default function Shell({
  user,
  system,
  onUserChange,
  refreshUser,
}: {
  user: User;
  system: SystemInfo;
  onUserChange: (user: User) => void;
  refreshUser: () => Promise<User>;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const admin = user.role === "admin";

  useEffect(() => {
    setMenuOpen(false);
    setUserMenu(false);
  }, [loc.pathname]);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenu(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function logout() {
    setToken(null);
    nav("/login", { replace: true });
  }

  const runtime = system?.docker ? "Docker engine" : "Process runtime";
  const initials = (user.first_name?.[0] || user.username.slice(0, 1)).toUpperCase();
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;

  function renderNav(items: typeof NAV.workspace) {
    return items.map((item) => (
      <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)}>
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </NavLink>
    ));
  }

  return (
    <div className="shell">
      <div
        className={`sidebar-scrim ${menuOpen ? "visible" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <Link to="/" className="side-brand" aria-label="VITESTERTL overview">
          <BrandMark />
          <span className="word">
            VITESTERTL
            <small>Control plane</small>
          </span>
          <span className="brand-version">v{system?.version || "1.7"}</span>
        </Link>

        <nav className="nav" aria-label="Primary navigation">
          <div className="nav-label">Workspace</div>
          {renderNav(NAV.workspace)}
          {admin && (
            <>
              <div className="nav-label">Administration</div>
              {renderNav(NAV.admin)}
            </>
          )}
        </nav>

        <div className="side-cta">
          <span className="side-cta-icon">
            <Icon name="circle-nodes" />
          </span>
          <div>
            <strong>{system?.hostname || "Local node"}</strong>
            <span>{runtime}</span>
          </div>
          <span className={`live-dot ${system?.docker ? "ok" : "neutral"}`} />
        </div>

        <div className="side-foot">
          <div className="side-foot-row">
            <span>Panel</span>
            <strong>{system?.version || "1.7.0"}</strong>
          </div>
          <div className="side-foot-row">
            <span>Runtime</span>
            <strong>{system?.wings || "1.7.0"}</strong>
          </div>
          <div className="side-foot-note">
            <Icon name={system?.docker ? "cube" : "microchip"} />
            {system?.docker ? "OCI workloads enabled" : "Native process isolation"}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn mobile-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="bars" />
            </button>
            <div className="crumbs">
              <Link to="/" className="crumb-root">
                <Icon name="house" /> VITESTERTL
              </Link>
              <span className="sep">/</span>
              <strong>{pageLabel(loc.pathname)}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="runtime-pill" title={`${runtime} on ${system?.hostname || "this node"}`}>
              <span className={`status-dot ${system?.docker ? "running" : "warning"}`} />
              {runtime}
            </span>
            {admin && (
              <Link to="/admin/servers/new" className="btn btn-primary btn-sm">
                <Icon name="plus" /> New server
              </Link>
            )}
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-trigger"
                onClick={() => setUserMenu((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenu}
              >
                <span className="avatar">{initials}</span>
                <span className="user-meta">
                  <strong>{displayName}</strong>
                  <small>{admin ? "Administrator" : "Member"}</small>
                </span>
                <Icon name="chevron-down" className="user-chevron" />
              </button>
              {userMenu && (
                <div className="user-pop" role="menu">
                  <div className="user-pop-head">
                    <span className="avatar avatar-lg">{initials}</span>
                    <div>
                      <strong>{displayName}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>
                  <Link to="/account" role="menuitem">
                    <Icon name="user-gear" /> Account settings
                  </Link>
                  {admin && (
                    <Link to="/admin/settings" role="menuitem">
                      <Icon name="sliders" /> Panel settings
                    </Link>
                  )}
                  <button type="button" role="menuitem" onClick={logout}>
                    <Icon name="arrow-right-from-bracket" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet
            context={{
              user,
              refreshUser: async () => {
                const next = await refreshUser();
                onUserChange(next);
                return next;
              },
            }}
          />
        </main>
      </div>
    </div>
  );
}
