import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, clearToken, getToken, setToken } from "../lib/api";
import type { User, UserRole } from "../types";

interface AuthContextValue {
  user: User | null;
  isAdmin: boolean;
  pinnedHostIds: string[];
  loading: boolean;
  login: (
    username: string,
    password: string,
    totp?: string
  ) => Promise<{ requiresTotp: true; challenge: string } | void>;
  loginTotp: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  reloadAuth: () => Promise<void>;
  abortAuth: () => void;
  togglePin: (hostId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [pinnedHostIds, setPinnedHostIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const applyUser = (u: User) => {
    setUser(u);
    setPinnedHostIds(u.pinnedHostIds ?? []);
  };

  const refreshMe = async () => {
    const r = await api.me();
    applyUser(r.user);
  };

  const reloadAuth = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setPinnedHostIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api.me();
      applyUser(r.user);
    } catch {
      clearToken();
      setUser(null);
      setPinnedHostIds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const abortAuth = useCallback(() => {
    clearToken();
    setUser(null);
    setPinnedHostIds([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reloadAuth();
  }, [reloadAuth]);

  const login = async (username: string, password: string, totp?: string) => {
    const res = await api.login(username, password, totp);
    if ("requiresTotp" in res && res.requiresTotp) {
      return { requiresTotp: true as const, challenge: res.challenge };
    }
    setToken(res.token);
    applyUser(res.user);
  };

  const loginTotp = async (challenge: string, code: string) => {
    const res = await api.loginTotp(challenge, code);
    setToken(res.token);
    applyUser(res.user);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    clearToken();
    setUser(null);
    setPinnedHostIds([]);
  };

  const togglePin = async (hostId: string) => {
    const next = pinnedHostIds.includes(hostId)
      ? pinnedHostIds.filter((id) => id !== hostId)
      : [...pinnedHostIds, hostId];
    const res = await api.updatePins(next);
    setPinnedHostIds(res.pinnedHostIds);
    if (user) applyUser({ ...user, pinnedHostIds: res.pinnedHostIds });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin: user?.role === "admin",
        pinnedHostIds,
        loading,
        login,
        loginTotp,
        logout,
        refreshMe,
        reloadAuth,
        abortAuth,
        togglePin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export type { UserRole };
