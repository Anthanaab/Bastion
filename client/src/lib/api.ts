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

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

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
};

export function wsUrl(path: string, params: Record<string, string>): string {
  const token = getToken();
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const qs = new URLSearchParams({ ...params, token: token ?? "" });
  return `${proto}//${host}${path}?${qs}`;
}
