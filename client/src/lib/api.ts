import type {
  AccessGroup,
  AuditRecord,
  Host,
  HostExportBundle,
  LiveSessionRecord,
  SessionRecord,
  Stats,
  User,
  UserAccount,
  UserRole,
} from "../types";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...fetchOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Délai dépassé — connexion lente ou serveur injoignable");
    }
    throw new Error("Serveur injoignable — vérifiez la connexion réseau");
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Erreur réseau");
  }

  return res.json() as Promise<T>;
}

export type LoginResult =
  | { requiresTotp: true; challenge: string }
  | { token: string; user: User };

const TOKEN_KEY = "bastion_token";

export const api = {
  login: (username: string, password: string, totp?: string) =>
    request<LoginResult>("/login", {
      method: "POST",
      body: JSON.stringify({ username, password, totp }),
    }),

  loginTotp: (challenge: string, code: string) =>
    request<{ token: string; user: User }>("/login/totp", {
      method: "POST",
      body: JSON.stringify({ challenge, code }),
    }),

  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  me: () => request<{ user: User }>("/me", { timeoutMs: 10_000 }),

  hosts: () => request<Host[]>("/hosts", { timeoutMs: 12_000 }),

  stats: () => request<Stats>("/stats", { timeoutMs: 12_000 }),

  updatePins: (pinnedHostIds: string[]) =>
    request<{ pinnedHostIds: string[] }>("/me/pins", {
      method: "PUT",
      body: JSON.stringify({ pinnedHostIds }),
    }),

  totpSetup: () =>
    request<{ secret: string; uri: string }>("/me/totp/setup", { method: "POST" }),

  totpConfirm: (code: string) =>
    request<{ ok: boolean }>("/me/totp/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  totpDisable: (currentPassword: string) =>
    request<{ ok: boolean }>("/me/totp", {
      method: "DELETE",
      body: JSON.stringify({ currentPassword }),
    }),

  users: () => request<UserAccount[]>("/users"),

  createUser: (
    username: string,
    password: string,
    role: UserRole,
    allowedHostIds?: string[] | null,
    groupIds?: string[]
  ) =>
    request<UserAccount>("/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role, allowedHostIds, groupIds }),
    }),

  updateUser: (
    id: string,
    data: {
      role?: UserRole;
      password?: string;
      allowedHostIds?: string[] | null;
      groupIds?: string[];
    }
  ) =>
    request<UserAccount>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  revokeUserSessions: (id: string) =>
    request<{ ok: boolean; revoked: number }>(`/users/${id}/revoke-sessions`, {
      method: "POST",
    }),

  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),

  groups: () => request<AccessGroup[]>("/groups"),

  createGroup: (name: string, hostIds: string[]) =>
    request<AccessGroup>("/groups", {
      method: "POST",
      body: JSON.stringify({ name, hostIds }),
    }),

  updateGroup: (id: string, data: { name?: string; hostIds?: string[] }) =>
    request<AccessGroup>(`/groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteGroup: (id: string) =>
    request<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" }),

  hostsStatus: () =>
    request<Record<string, boolean>>("/hosts/status", { timeoutMs: 12_000 }),

  host: (id: string) =>
    request<Host & { password?: string; privateKey?: string }>(`/hosts/${id}`),

  createHost: (data: Partial<Host>) =>
    request<Host>("/hosts", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateHost: (id: string, data: Partial<Host>) =>
    request<Host>(`/hosts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteHost: (id: string) =>
    request<{ ok: boolean }>(`/hosts/${id}`, { method: "DELETE" }),

  sessionPing: (hostId: string) =>
    request<{ ok: boolean; version: string; wsPath: string }>("/sessions/ping", {
      method: "POST",
      body: JSON.stringify({ hostId }),
      timeoutMs: 12_000,
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  wakeHost: (hostId: string, wait = false) =>
    request<{ ok: boolean; sentTo: string[]; hint?: string; online?: boolean }>(
      `/hosts/${hostId}/wake`,
      {
        method: "POST",
        body: JSON.stringify({ wait }),
        timeoutMs: wait ? 130_000 : 20_000,
      }
    ),

  sessions: (limit = 50) =>
    request<SessionRecord[]>(`/sessions?limit=${limit}`),

  liveSessions: () => request<LiveSessionRecord[]>("/sessions/live"),

  terminateSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/terminate`, { method: "POST" }),

  audit: (limit = 100) =>
    request<AuditRecord[]>(`/audit?limit=${limit}`),

  exportHosts: () => request<HostExportBundle>("/hosts/export"),

  importHosts: (mode: "merge" | "replace", hosts: HostExportBundle["hosts"]) =>
    request<{ ok: boolean; created: number; updated: number }>("/hosts/import", {
      method: "POST",
      body: JSON.stringify({ mode, hosts }),
    }),
};

export function wsBaseUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export function wsConnectData(params: Record<string, string>): string {
  // Le token n'est plus mis en query string (il finirait dans les logs de
  // reverse-proxy / l'historique navigateur). L'auth WebSocket repose sur le
  // cookie httpOnly `bastion_token` déjà posé au login (voir server/src/auth.ts).
  const qs = new URLSearchParams(params);
  return qs.toString();
}

export function wsUrl(path: string, params: Record<string, string>): string {
  const qs = wsConnectData(params);
  return `${wsBaseUrl(path)}?${qs}`;
}

export const WAKE_POLL_INTERVAL_MS = 2000;
export const WAKE_MAX_WAIT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Attend qu'une machine réponde au probe TCP (après WoL), avec retours visuels */
export async function pollHostOnline(
  hostId: string,
  options?: {
    onProgress?: (elapsedSec: number) => void;
    signal?: AbortSignal;
  }
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < WAKE_MAX_WAIT_MS) {
    if (options?.signal?.aborted) return false;
    await sleep(WAKE_POLL_INTERVAL_MS);
    const elapsed = Math.round((Date.now() - started) / 1000);
    options?.onProgress?.(elapsed);
    try {
      const statuses = await request<Record<string, boolean>>("/hosts/status", {
        timeoutMs: 10_000,
      });
      if (statuses[hostId]) return true;
    } catch {
      // Réseau ou bastion lent pendant le boot — on continue d'attendre
    }
  }
  return false;
}
