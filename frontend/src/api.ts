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
  two_factor_enabled?: boolean;
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
  environment?: Record<string, string>;
  startup?: string;
  image: string;
  created_at: string;
  allocation_port: number;
  allocation_ip: string;
  tags?: string[];
  permissions?: string[];
  is_owner?: boolean;
  mc_software?: string;
  mc_version?: string;
  mc_loader_version?: string;
  mc_status?: string;
  mc_message?: string;
  mc_installed_at?: string | null;
  mc_eula?: number;
  terminal_sudo?: number;
};

export type MinecraftSoftware = {
  id: string;
  name: string;
  edition: "java" | "bedrock";
  kind: "server" | "proxy" | "bedrock";
  description: string;
  accent: string;
  icon: string;
  content: "plugin" | "mod" | null;
  content_dir: string;
  loaders: string[];
  proxy: boolean;
  requires_eula: boolean;
  egg_id: number;
  source: string;
};

export type MinecraftVersion = {
  id: string;
  type: string;
  released?: string | null;
  channel?: string;
  download_url?: string;
};

export type MinecraftLoader = {
  id: string;
  label: string;
  stable: boolean;
  channel?: string;
  time?: string;
};

export type MinecraftCatalog = {
  software: MinecraftSoftware;
  versions: MinecraftVersion[];
  loaders: MinecraftLoader[];
  defaults: { version: string; loader_version: string };
  notes: string[];
  fetched_at: string;
};

export type MinecraftJob = {
  id: string;
  server_id: string;
  status: string;
  progress: number;
  message: string;
  software?: string;
  software_name?: string;
  version?: string;
  loader_version?: string;
  logs: string[];
  created_at?: string;
  updated_at?: string;
  result?: Record<string, any>;
};

export type MinecraftInstallSelection = {
  software: string;
  version: string;
  loader_version: string;
  accept_eula: boolean;
  properties: Record<string, string>;
};

export type MinecraftInfo = {
  available: boolean;
  software: MinecraftSoftware | null;
  version?: string;
  loader_version?: string;
  status?: string;
  message?: string;
  installed_at?: string | null;
  eula?: boolean;
  capabilities: {
    enabled: boolean;
    kind: "plugin" | "mod" | null;
    directory: string;
    loaders: string[];
    project_type?: string;
    edition?: string;
  };
  properties: Record<string, string>;
  job: MinecraftJob | null;
  manifest?: Record<string, any>;
};

export type MinecraftUpdateInfo = {
  current: {
    software: string;
    version: string;
    loader_version: string;
  };
  latest: {
    software: string;
    software_name: string;
    edition: "java" | "bedrock";
    version: string;
    loader_version: string;
    released?: string | null;
    type: string;
    notes: string[];
    fetched_at: string;
  };
  update_available: boolean;
  version_update: boolean;
  loader_update: boolean;
  floating_channel: boolean;
};

export type MinecraftContentUpdate = {
  filename: string;
  base_name: string;
  title: string;
  project_id: string;
  project_slug: string;
  icon_url: string;
  current_version_id: string;
  current_version: string;
  latest: MinecraftContentVersion;
  enabled: boolean;
};

export type CatalogHealth = {
  expected: number;
  installed: number;
  missing: number[];
  repaired?: boolean;
  known_egg_ids?: number[];
};

export type LoginResult =
  | { token: string; user: User }
  | { two_factor_required: true; challenge: string; expires_in: number };

export type TwoFactorStatus = {
  enabled: boolean;
  recovery_codes_remaining: number;
  issuer: string;
  digits: number;
  period: number;
};

export type PermissionGroup = {
  group: string;
  permissions: Array<{ id: string; label: string }>;
};

export type DatabaseHostOption = {
  id: number;
  name: string;
  engine: string;
  host: string;
  port: number;
};

export type ServerDatabase = {
  id: number;
  server_id: string;
  name: string;
  username: string;
  password: string;
  host: string;
  port: number;
  host_id: number | null;
  engine: string;
  host_name?: string | null;
  host_engine?: string | null;
  created_at: string;
};

export type AdminDatabaseHost = DatabaseHostOption & {
  username: string;
  linked_ip: string;
  max_databases: number;
  created_at: string;
  databases: number;
  password_set: boolean;
};

export type ScheduleTask = {
  id?: number;
  action: string;
  payload: string;
  time_offset: number;
  continue_on_failure: number | boolean;
  sequence?: number;
};

export type Schedule = {
  id: number;
  server_id: string;
  name: string;
  cron: string;
  action: string;
  payload: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  tasks: ScheduleTask[];
  task_count: number;
};

export type TerminalInfo = {
  user: string;
  server: string;
  cwd: string;
  root: string;
  sudo: boolean;
  can_toggle_sudo: boolean;
  sudo_available: boolean;
  shell: string;
  platform: string;
  timeout_seconds: number;
};

export type AiProviderOption = {
  id: number;
  name: string;
  kind: string;
  model: string;
  is_default: boolean;
  enabled?: boolean;
};

export type AiProviderMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  provider_id: number | null;
  model: string;
  created_at: string;
  streaming?: boolean;
  pending?: boolean;
};

export type AiHistory = {
  data: AiProviderMessage[];
  meta: {
    providers: AiProviderOption[];
    default_provider_id: number;
    configured: boolean;
    limits: { history: number; context_chars: number; message_chars: number };
    server: { name: string; identifier: string };
  };
};

export type AdminAiProvider = {
  id: number;
  name: string;
  kind: string;
  base_url: string;
  model: string;
  headers: Record<string, string>;
  max_tokens: number;
  temperature: number;
  enabled: boolean;
  is_default: boolean;
  key_set: boolean;
  requests: number;
  last_used: string | null;
  created_at: string;
  updated_at: string;
};

export type AiPreset = {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  model: string;
  note: string;
};

export type AiUsage = {
  totals: {
    requests: number;
    tokens: number;
    succeeded: number;
    failed: number;
    avg_latency_ms: number;
  };
  providers: Array<{
    id: number;
    name: string;
    kind: string;
    model: string;
    is_default: boolean;
    requests: number;
    tokens: number;
    failures: number;
    last_used: string | null;
  }>;
  recent: Array<{
    id: number;
    provider_id: number | null;
    provider_name: string | null;
    server_id: string;
    model: string;
    total_tokens: number;
    latency_ms: number;
    ok: boolean;
    error: string;
    created_at: string;
  }>;
  window_days: number;
};

export type EggCatalogEntry = {
  id: number;
  nest_id: number;
  name: string;
  description: string;
  runtime: string;
  docker_image: string;
  startup: string;
  variables: Array<{ env: string; name: string; default?: string; rules?: string }>;
  custom?: boolean;
  deployments?: number;
  installed?: boolean;
};

export type MinecraftContent = {
  filename: string;
  base_name: string;
  enabled: boolean;
  size: number;
  modified_at?: string | null;
  directory: string;
  project_type: "plugin" | "mod";
  title: string;
  project_id: string;
  project_slug: string;
  version_id: string;
  version_number: string;
  icon_url: string;
  source: string;
  installed_at?: string | null;
  tracked: boolean;
};

export type MinecraftContentProject = {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string;
  downloads: number;
  follows: number;
  categories: string[];
  loaders: string[];
  game_versions: string[];
  project_type: "plugin" | "mod";
  client_side: string;
  server_side: string;
  url: string;
  updated?: string | null;
};

export type MinecraftContentSearch = {
  data: MinecraftContentProject[];
  total: number;
  featured: boolean;
  project_type: "plugin" | "mod";
  loaders: string[];
  source: string;
};

export type MinecraftContentVersion = {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published?: string | null;
  files: Array<{ filename: string; primary: boolean; size: number }>;
};

export type MinecraftStatus = {
  online: boolean;
  latency_ms: number;
  error?: string;
  motd?: string;
  version?: string;
  protocol?: number;
  players?: {
    online: number;
    max: number;
    sample: Array<{ name: string; id: string }>;
  };
  icon?: string;
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

/** Consume the copilot SSE stream. Events: meta, delta, done, error. */
export async function streamAiChat(
  serverId: string,
  body: {
    message: string;
    provider_id?: number | null;
    context?: string;
    cwd?: string;
    sudo?: boolean;
  },
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "text/event-stream" });
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`/api/servers/${serverId}/ai/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    setToken(null);
    window.location.replace("/login");
    throw new Error("Session expired");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      detail = payload.detail || payload.error || detail;
    } catch {
      /* no json body */
    }
    throw new Error(typeof detail === "string" ? detail : "The copilot request failed");
  }
  if (!res.body) throw new Error("Streaming is not available in this browser");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) {
        const raw = dataLines.join("\n");
        let payload: any = raw;
        try {
          payload = JSON.parse(raw);
        } catch {
          /* keep the raw string for unknown events */
        }
        onEvent(event, payload);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export const api = {
  login: (username: string, password: string) =>
    req<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  loginTwoFactor: (challenge: string, code: string) =>
    req<{ token: string; user: User }>("/api/auth/2fa", {
      method: "POST",
      body: JSON.stringify({ challenge, code }),
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
  fileCompress: (id: string, root: string, files: string[], name: string) =>
    req<{ status: string; name: string; bytes: number }>(`/api/servers/${id}/files/compress`, {
      method: "POST",
      body: JSON.stringify({ root, files, name }),
    }),
  fileExtract: (id: string, root: string, file: string, destination = "") =>
    req<{ status: string; entries: number }>(`/api/servers/${id}/files/extract`, {
      method: "POST",
      body: JSON.stringify({ root, file, destination }),
    }),
  fileChmod: (id: string, root: string, files: string[], mode: string) =>
    req<{ status: string; changed: number }>(`/api/servers/${id}/files/chmod`, {
      method: "POST",
      body: JSON.stringify({ root, files, mode }),
    }),
  fileCopy: (id: string, root: string, from: string, to: string) =>
    req(`/api/servers/${id}/files/copy`, {
      method: "POST",
      body: JSON.stringify({ root, from, to }),
    }),
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
  databases: (id: string) =>
    req<{
      data: ServerDatabase[];
      meta: { hosts: DatabaseHostOption[]; limit: number; client: boolean };
    }>(`/api/servers/${id}/databases`),
  createDatabase: (id: string, name: string, hostId?: number | null, engine?: string) =>
    req<{ data: ServerDatabase }>(`/api/servers/${id}/databases`, {
      method: "POST",
      body: JSON.stringify({
        name,
        ...(hostId ? { host_id: hostId } : {}),
        ...(engine ? { engine } : {}),
      }),
    }),
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
  schedules: (id: string) => req<{ data: Schedule[] }>(`/api/servers/${id}/schedules`),
  createSchedule: (id: string, body: any) =>
    req<{ data: Schedule }>(`/api/servers/${id}/schedules`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSchedule: (id: string, sid: number, body: any) =>
    req<{ data: Schedule }>(`/api/servers/${id}/schedules/${sid}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  setSchedule: (id: string, sid: number, enabled: boolean) =>
    req<{ data: Schedule }>(`/api/servers/${id}/schedules/${sid}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  runSchedule: (id: string, sid: number) =>
    req<{ status: string; tasks: Array<Record<string, any>> }>(
      `/api/servers/${id}/schedules/${sid}/run`,
      { method: "POST" }
    ),
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
  users: (id: string) =>
    req<{ data: any[]; meta: { permission_groups: PermissionGroup[] } }>(
      `/api/servers/${id}/users`
    ),
  createUser: (id: string, body: any) =>
    req(`/api/servers/${id}/users`, { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, uid: number, body: any) =>
    req(`/api/servers/${id}/users/${uid}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUser: (id: string, uid: number) => req(`/api/servers/${id}/users/${uid}`, { method: "DELETE" }),
  serverActivity: (id: string) => req<{ data: Activity[] }>(`/api/servers/${id}/activity`),
  updateAccount: (body: any) => req<{ user: User }>("/api/account", { method: "PUT", body: JSON.stringify(body) }),
  twoFactor: () => req<TwoFactorStatus>("/api/account/2fa"),
  twoFactorSetup: (password: string) =>
    req<{
      secret: string;
      otpauth_uri: string;
      issuer: string;
      account: string;
      digits: number;
      period: number;
    }>("/api/account/2fa/setup", { method: "POST", body: JSON.stringify({ password }) }),
  twoFactorEnable: (code: string) =>
    req<{ status: string; recovery_codes: string[] }>("/api/account/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  twoFactorDisable: (password: string, code: string) =>
    req<{ status: string }>("/api/account/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password, code }),
    }),
  apiKeys: () => req<{ data: any[] }>("/api/account/api-keys"),
  createApiKey: (name: string) =>
    req<{ data: any }>("/api/account/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
  deleteApiKey: (id: number) => req(`/api/account/api-keys/${id}`, { method: "DELETE" }),
  saveTags: (id: string, tags: string[]) =>
    req<{ data: { tags: string[] } }>(`/api/servers/${id}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
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
  adminNests: () =>
    req<{
      nests: any[];
      eggs: EggCatalogEntry[];
      catalog?: { nests: number; eggs: number; version: string };
      catalog_health?: CatalogHealth;
    }>("/api/admin/nests"),
  adminSyncNests: () => req<{ status: string; nests: number; eggs: number }>("/api/admin/nests/sync", { method: "POST" }),
  adminCreateNest: (body: any) =>
    req<{ data: any }>("/api/admin/nests", { method: "POST", body: JSON.stringify(body) }),
  adminCreateEgg: (body: any) =>
    req<{ data: any }>("/api/admin/eggs", { method: "POST", body: JSON.stringify(body) }),
  adminEgg: (id: number) => req<{ data: any }>(`/api/admin/eggs/${id}`),
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
  adminSystem: () => req<any>("/api/admin/system"),
  adminDatabaseHosts: () =>
    req<{ data: AdminDatabaseHost[]; meta: { client: boolean } }>("/api/admin/database-hosts"),
  adminCreateDatabaseHost: (body: any) =>
    req<{ data: { id: number; name: string } }>("/api/admin/database-hosts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateDatabaseHost: (id: number, body: any) =>
    req<{ status: string }>(`/api/admin/database-hosts/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminDeleteDatabaseHost: (id: number) =>
    req(`/api/admin/database-hosts/${id}`, { method: "DELETE" }),
  adminTestDatabaseHost: (id: number) =>
    req<{ status: string; version: string; latency_ms: number }>(
      `/api/admin/database-hosts/${id}/test`,
      { method: "POST" }
    ),
  adminTestDatabaseHostDraft: (body: any) =>
    req<{ status: string; version: string; latency_ms: number }>(
      "/api/admin/database-hosts/test-connection",
      { method: "POST", body: JSON.stringify(body) }
    ),
  password: (current: string, new_password: string) =>
    req("/api/auth/password", { method: "POST", body: JSON.stringify({ current, new_password }) }),
  aiHistory: (id: string) => req<AiHistory>(`/api/servers/${id}/ai`),
  clearAiHistory: (id: string) =>
    req<{ status: string; deleted: number }>(`/api/servers/${id}/ai`, { method: "DELETE" }),
  adminAiProviders: () =>
    req<{ data: AdminAiProvider[]; meta: { presets: AiPreset[]; kinds: string[]; default_provider_id: number } }>(
      "/api/admin/ai/providers"
    ),
  adminCreateAiProvider: (body: any) =>
    req<{ data: AdminAiProvider }>("/api/admin/ai/providers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateAiProvider: (id: number, body: any) =>
    req<{ data: AdminAiProvider }>(`/api/admin/ai/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminDeleteAiProvider: (id: number) =>
    req(`/api/admin/ai/providers/${id}`, { method: "DELETE" }),
  adminDefaultAiProvider: (id: number) =>
    req<{ data: AdminAiProvider }>(`/api/admin/ai/providers/${id}/default`, { method: "POST" }),
  adminTestAiProvider: (id: number) =>
    req<{ status: string; message: string; models: number; latency_ms: number }>(
      `/api/admin/ai/providers/${id}/test`,
      { method: "POST" }
    ),
  adminTestAiProviderDraft: (body: any) =>
    req<{ status: string; message: string; models: number; latency_ms: number }>(
      "/api/admin/ai/providers/test",
      { method: "POST", body: JSON.stringify(body) }
    ),
  adminAiProviderModels: (id: number) =>
    req<{ data: string[]; meta: { kind: string } }>(`/api/admin/ai/providers/${id}/models`),
  adminAiProviderModelsDraft: (body: any) =>
    req<{ data: string[]; meta: { kind: string } }>("/api/admin/ai/providers/models", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminAiUsage: (days = 30) => req<AiUsage>(`/api/admin/ai/usage?days=${days}`),
  terminalInfo: (id: string) =>
    req<{ data: TerminalInfo }>(`/api/servers/${id}/terminal`),
  setTerminalSudo: (id: string, enabled: boolean) =>
    req<{ data: TerminalInfo }>(`/api/servers/${id}/terminal/sudo`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  minecraftCatalog: () => req<{ data: MinecraftSoftware[] }>("/api/minecraft/catalog"),
  minecraftVersions: (software: string, version = "", includeSnapshots = false) => {
    const q = new URLSearchParams();
    if (version) q.set("version", version);
    if (includeSnapshots) q.set("include_snapshots", "true");
    const suffix = q.toString();
    return req<{ data: MinecraftCatalog }>(
      `/api/minecraft/catalog/${encodeURIComponent(software)}/versions${suffix ? `?${suffix}` : ""}`
    );
  },
  minecraftInfo: (id: string) => req<{ data: MinecraftInfo }>(`/api/servers/${id}/minecraft`),
  minecraftStatus: (id: string) =>
    req<{ data: MinecraftStatus }>(`/api/servers/${id}/minecraft/status`),
  minecraftInstall: (id: string, body: MinecraftInstallSelection) =>
    req<{ data: MinecraftJob }>(`/api/servers/${id}/minecraft/install`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  minecraftJob: (id: string, jobId: string) =>
    req<{ data: MinecraftJob }>(`/api/servers/${id}/minecraft/jobs/${encodeURIComponent(jobId)}`),
  minecraftUpdate: (id: string) =>
    req<{ data: MinecraftUpdateInfo }>(`/api/servers/${id}/minecraft/update`),
  minecraftUpgrade: (
    id: string,
    body: { version?: string; loader_version?: string | null; accept_eula?: boolean; backup?: boolean }
  ) =>
    req<{ data: MinecraftJob; backup: any | null }>(`/api/servers/${id}/minecraft/upgrade`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  minecraftProperties: (id: string, properties: Record<string, string>) =>
    req<{ data: Record<string, string> }>(`/api/servers/${id}/minecraft/properties`, {
      method: "PUT",
      body: JSON.stringify({ properties }),
    }),
  plugins: (id: string) =>
    req<{
      data: MinecraftContent[];
      capabilities: MinecraftInfo["capabilities"];
      counts: { total: number; enabled: number };
    }>(`/api/servers/${id}/plugins`),
  pluginSearch: (id: string, query = "", featured = false, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (query) params.set("query", query);
    if (featured) params.set("featured", "true");
    return req<MinecraftContentSearch>(`/api/servers/${id}/plugins/search?${params.toString()}`);
  },
  pluginVersions: (id: string, projectId: string, limit = 16) =>
    req<{
      data: MinecraftContentVersion[];
      project_type: "plugin" | "mod";
      loaders: string[];
    }>(
      `/api/servers/${id}/plugins/versions/${encodeURIComponent(projectId)}?limit=${limit}`
    ),
  pluginUpdates: (id: string) =>
    req<{
      data: MinecraftContentUpdate[];
      checked: number;
      errors: Array<{ filename: string; title: string; project_id: string; error: string }>;
      project_type?: "plugin" | "mod";
    }>(`/api/servers/${id}/plugins/updates`),
  pluginUpdate: (id: string, filename: string, versionId = "") =>
    req<{ data: MinecraftContent; updated: boolean; restart_required?: boolean; message?: string }>(
      `/api/servers/${id}/plugins/${encodeURIComponent(filename)}/update`,
      { method: "POST", body: JSON.stringify({ version_id: versionId || null }) }
    ),
  pluginInstall: (id: string, projectId: string, versionId = "") =>
    req<{ data: MinecraftContent }>(`/api/servers/${id}/plugins`, {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, version_id: versionId || null }),
    }),
  pluginUpload: async (id: string, file: File) => {
    const fd = new FormData();
    fd.append("upload", file);
    return req<{ data: MinecraftContent }>(`/api/servers/${id}/plugins/upload`, {
      method: "POST",
      body: fd,
    });
  },
  pluginToggle: (id: string, filename: string) =>
    req<{ data: { filename: string; enabled: boolean } }>(
      `/api/servers/${id}/plugins/${encodeURIComponent(filename)}/toggle`,
      { method: "POST" }
    ),
  pluginDelete: (id: string, filename: string) =>
    req<{ status: string }>(`/api/servers/${id}/plugins/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    }),
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
