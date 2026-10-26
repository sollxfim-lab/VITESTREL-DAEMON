export type User = {
  id: number;
  username: string;
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
  created_at?: string;
  last_login?: string | null;
  root_admin?: boolean;
  servers?: number;
};

export type Stats = {
  state: string;
  cpu_absolute: number;
  memory_bytes: number;
  memory_limit_bytes: number;
  disk_bytes: number;
  disk_limit_bytes: number;
  network: { rx_bytes: number; tx_bytes: number };
  uptime: number;
  pid: number | null;
  mode: string;
};

export type Server = {
  id: string;
  uuid: string;
  identifier: string;
  name: string;
  description: string;
  egg_id: number;
  egg_name: string;
  nest_name: string;
  owner_id: number;
  owner_name: string;
  node_id: number;
  status: string;
  suspended: boolean;
  suspended_reason?: string;
  allocation: { ip: string; port: number; alias: string };
  limits: { memory: number; cpu: number; disk: number; swap: number; io: number };
  resources: Stats;
  environment: Record<string, string>;
  startup: string;
  image: string;
  created_at: string;
  allocation_port: number;
  allocation_ip: string;
};

export type Activity = {
  id: number;
  user_id: number | null;
  server_id: string | null;
  event: string;
  ip: string;
  metadata: Record<string, any>;
  created_at: string;
  username?: string | null;
  server_name?: string | null;
};

export type Meta = {
  name: string;
  version: string;
  company?: string;
  support_email?: string;
  registration?: boolean;
  theme?: string;
};

const TOKEN_KEY = "kestrel.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    if (!path.startsWith("/api/auth/login") && !window.location.pathname.startsWith("/login")) {
      window.location.replace("/login");
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail || j.error || JSON.stringify(j);
    } catch {
      /* no json body */
    }
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function download(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail || j.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || "Download failed");
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<{ user: User }>("/api/auth/me"),
  meta: () => req<Meta>("/api/meta"),
  system: () => req<any>("/api/system"),
  activity: (limit = 24) => req<{ data: Activity[] }>(`/api/activity?limit=${limit}`),
  servers: () => req<{ data: Server[] }>("/api/servers"),
  server: (id: string) => req<{ data: Server }>(`/api/servers/${id}`),
  resources: (id: string) => req<{ data: Stats }>(`/api/servers/${id}/resources`),
  power: (id: string, signal: string) =>
    req(`/api/servers/${id}/power`, { method: "POST", body: JSON.stringify({ signal }) }),
  command: (id: string, command: string) =>
    req(`/api/servers/${id}/command`, { method: "POST", body: JSON.stringify({ command }) }),
  files: (id: string, directory: string) =>
    req<{ data: any[] }>(`/api/servers/${id}/files?directory=${encodeURIComponent(directory)}`),
  fileContents: (id: string, file: string) =>
    req<{ content: string }>(`/api/servers/${id}/files/contents?file=${encodeURIComponent(file)}`),
  fileSave: (id: string, file: string, contents: string) =>
    req(`/api/servers/${id}/files/save`, { method: "POST", body: JSON.stringify({ file, contents }) }),
  fileCreate: (id: string, root: string, name: string, directory: boolean) =>
    req(`/api/servers/${id}/files/create`, {
      method: "POST",
      body: JSON.stringify({ root, name, directory }),
    }),
  fileRename: (id: string, root: string, from: string, to: string) =>
    req(`/api/servers/${id}/files/rename`, {
      method: "POST",
      body: JSON.stringify({ root, from, to }),
    }),
  fileDelete: (id: string, root: string, files: string[]) =>
    req(`/api/servers/${id}/files/delete`, { method: "POST", body: JSON.stringify({ root, files }) }),
  fileUpload: async (id: string, directory: string, file: File) => {
    const fd = new FormData();
    fd.append("upload", file);
    return req(`/api/servers/${id}/files/upload?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      body: fd,
    });
  },
  fileDownload: (id: string, file: string, filename: string) =>
    download(`/api/servers/${id}/files/download?file=${encodeURIComponent(file)}`, filename),
  startup: (id: string) => req<{ data: any }>(`/api/servers/${id}/startup`),
  saveStartup: (id: string, body: any) =>
    req(`/api/servers/${id}/startup`, { method: "PUT", body: JSON.stringify(body) }),
  saveSettings: (id: string, body: any) =>
    req(`/api/servers/${id}/settings`, { method: "PUT", body: JSON.stringify(body) }),
  reinstall: (id: string) => req(`/api/servers/${id}/reinstall`, { method: "POST" }),
  databases: (id: string) => req<{ data: any[] }>(`/api/servers/${id}/databases`),
  createDatabase: (id: string, name: string) =>
    req(`/api/servers/${id}/databases`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteDatabase: (id: string, dbId: number) =>
    req(`/api/servers/${id}/databases/${dbId}`, { method: "DELETE" }),
  backups: (id: string) => req<{ data: any[] }>(`/api/servers/${id}/backups`),
  createBackup: (id: string) => req(`/api/servers/${id}/backups`, { method: "POST" }),
  restoreBackup: (id: string, bid: string) =>
    req(`/api/servers/${id}/backups/${bid}/restore`, { method: "POST" }),
  deleteBackup: (id: string, bid: string) =>
    req(`/api/servers/${id}/backups/${bid}`, { method: "DELETE" }),
  backupDownload: (id: string, bid: string, name: string) =>
    download(`/api/servers/${id}/backups/${bid}/download`, `${name}.tar.gz`),
  schedules: (id: string) => req<{ data: any[] }>(`/api/servers/${id}/schedules`),
  createSchedule: (id: string, body: any) =>
    req(`/api/servers/${id}/schedules`, { method: "POST", body: JSON.stringify(body) }),
  setSchedule: (id: string, sid: number, enabled: boolean) =>
    req(`/api/servers/${id}/schedules/${sid}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  runSchedule: (id: string, sid: number) =>
    req(`/api/servers/${id}/schedules/${sid}/run`, { method: "POST" }),
  deleteSchedule: (id: string, sid: number) =>
    req(`/api/servers/${id}/schedules/${sid}`, { method: "DELETE" }),
  network: (id: string) =>
    req<{ data: any[]; meta: { node_id: number; node_name: string; free: number } }>(
      `/api/servers/${id}/network`
    ),
  addAllocation: (id: string, allocationId?: number) =>
    req(`/api/servers/${id}/network`, {
      method: "POST",
      body: JSON.stringify(allocationId ? { allocation_id: allocationId } : {}),
    }),
  setPrimaryAllocation: (id: string, allocationId: number) =>
    req(`/api/servers/${id}/network/${allocationId}/primary`, { method: "POST" }),
  deleteAllocation: (id: string, allocationId: number) =>
    req(`/api/servers/${id}/network/${allocationId}`, { method: "DELETE" }),
  users: (id: string) => req<{ data: any[] }>(`/api/servers/${id}/users`),
  createUser: (id: string, body: any) =>
    req(`/api/servers/${id}/users`, { method: "POST", body: JSON.stringify(body) }),
  deleteUser: (id: string, uid: number) => req(`/api/servers/${id}/users/${uid}`, { method: "DELETE" }),
  serverActivity: (id: string) => req<{ data: Activity[] }>(`/api/servers/${id}/activity`),
  updateAccount: (body: any) => req<{ user: User }>("/api/account", { method: "PUT", body: JSON.stringify(body) }),
  adminOverview: () => req<{ data: any }>("/api/admin/overview"),
  adminActivity: (limit = 50, offset = 0, event = "") => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (event) q.set("event", event);
    return req<{ data: Activity[]; total: number; limit: number; offset: number }>(
      `/api/admin/activity?${q.toString()}`
    );
  },
  adminUsers: () => req<{ data: any[] }>("/api/admin/users"),
  adminUser: (id: number) => req<{ data: any }>(`/api/admin/users/${id}`),
  adminCreateUser: (body: any) =>
    req("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  adminUpdateUser: (id: number, body: any) =>
    req(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  adminDeleteUser: (id: number) => req(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminNests: () => req<{ nests: any[]; eggs: any[] }>("/api/admin/nests"),
  adminNodes: () => req<{ data: any[] }>("/api/admin/nodes"),
  adminNodeAudit: () => req<{ data: any }>("/api/admin/node-installer/audit"),
  adminAutoInstallNode: (body: any) =>
    req<{ data: any }>("/api/admin/node-installer/install", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminAutoInstallJob: (id: string) =>
    req<{ data: any }>(`/api/admin/node-installer/jobs/${id}`),
  adminNode: (id: number) => req<{ data: any }>(`/api/admin/nodes/${id}`),
  adminCreateNode: (body: any) =>
    req("/api/admin/nodes", { method: "POST", body: JSON.stringify(body) }),
  adminUpdateNode: (id: number, body: any) =>
    req(`/api/admin/nodes/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  adminRegenerateToken: (id: number) =>
    req<{ token: string }>(`/api/admin/nodes/${id}/regenerate-token`, { method: "POST" }),
  adminDeleteNode: (id: number) => req(`/api/admin/nodes/${id}`, { method: "DELETE" }),
  adminCreateAllocations: (nodeId: number, body: any) =>
    req<{ created: number; skipped: number }>(`/api/admin/nodes/${nodeId}/allocations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminAllocations: (nodeId?: number, unassigned?: boolean) => {
    const q = new URLSearchParams();
    if (nodeId != null) q.set("node_id", String(nodeId));
    if (unassigned) q.set("unassigned", "true");
    const s = q.toString();
    return req<{ data: any[] }>(`/api/admin/allocations${s ? `?${s}` : ""}`);
  },
  adminDeleteAllocation: (id: number) => req(`/api/admin/allocations/${id}`, { method: "DELETE" }),
  adminLocations: () => req<{ data: any[] }>("/api/admin/locations"),
  adminCreateLocation: (body: any) =>
    req("/api/admin/locations", { method: "POST", body: JSON.stringify(body) }),
  adminDeleteLocation: (id: number) => req(`/api/admin/locations/${id}`, { method: "DELETE" }),
  adminCreateServer: (body: any) =>
    req("/api/admin/servers", { method: "POST", body: JSON.stringify(body) }),
  adminDeleteServer: (id: string, options?: { files?: boolean; backups?: boolean }) => {
    const q = new URLSearchParams();
    if (options?.files === false) q.set("delete_files", "false");
    if (options?.backups === false) q.set("delete_backups", "false");
    const s = q.toString();
    return req(`/api/admin/servers/${id}${s ? `?${s}` : ""}`, { method: "DELETE" });
  },
  adminSuspendServer: (id: string, suspended: boolean, reason = "") =>
    req<{ data: Server }>(`/api/admin/servers/${id}/suspend`, {
      method: "POST",
      body: JSON.stringify({ suspended, reason }),
    }),
  adminTransferServer: (id: string, ownerId: number) =>
    req(`/api/admin/servers/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ owner_id: ownerId }),
    }),
  adminSettings: () => req<{ data: Record<string, string> }>("/api/admin/settings"),
  adminSaveSettings: (body: any) =>
    req<{ data: Record<string, string> }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  password: (current: string, new_password: string) =>
    req("/api/auth/password", { method: "POST", body: JSON.stringify({ current, new_password }) }),
};

export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function pct(used: number, limit: number): number {
  if (!limit) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

export function fmtDate(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(value);
}

export function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken() || "";
  return `${proto}//${location.host}${path}?token=${encodeURIComponent(token)}`;
}
