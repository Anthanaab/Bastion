const TOKEN_KEY = "bastion_token";

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
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new Error("Serveur injoignable — vérifiez la connexion réseau");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Erreur réseau");
  }

  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: { username: string } }>("/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>("/logout", { method: "POST" }),

  me: () => request<{ user: { username: string } }>("/me"),

  stats: () => request<import("./types").Stats>("/stats"),

  hosts: () => request<import("./types").Host[]>("/hosts"),

  hostsStatus: () =>
    request<Record<string, boolean>>("/hosts/status"),

  host: (id: string) =>
    request<import("./types").Host & { password: string; privateKey: string }>(
      `/hosts/${id}`
    ),

  createHost: (data: Partial<import("./types").Host>) =>
    request<import("./types").Host>("/hosts", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateHost: (id: string, data: Partial<import("./types").Host>) =>
    request<import("./types").Host>(`/hosts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteHost: (id: string) =>
    request<{ ok: boolean }>(`/hosts/${id}`, { method: "DELETE" }),

  sessionPing: (hostId: string) =>
    request<{ ok: boolean; version: string; wsPath: string }>("/sessions/ping", {
      method: "POST",
      body: JSON.stringify({ hostId }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  wakeHost: (hostId: string) =>
    request<{ ok: boolean; sentTo: string[]; hint?: string }>(
      `/hosts/${hostId}/wake`,
      { method: "POST" }
    ),
};

export function wsBaseUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export function wsConnectData(params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  const token = getToken();
  if (token) qs.set("token", token);
  return qs.toString();
}

export function wsUrl(path: string, params: Record<string, string>): string {
  const qs = wsConnectData(params);
  return `${wsBaseUrl(path)}?${qs}`;
}
