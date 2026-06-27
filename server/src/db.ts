import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  decryptNullable,
  encryptNullable,
  isEncrypted,
} from "./crypto";
import { bindAuditStore } from "./audit";
import type { AuditEntry } from "./audit";

export type Protocol = "ssh" | "rdp" | "vnc";

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  protocol: Protocol;
  username: string;
  password: string | null;
  privateKey: string | null;
  macAddress: string | null;
  wolBroadcast: string | null;
  keyboardLayout: string | null;
  color: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "admin" | "operator";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  hostId: string;
  protocol: Protocol;
  username: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface SessionView {
  id: string;
  hostId: string;
  hostName: string;
  protocol: Protocol;
  username: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
}

export interface HostExportBundle {
  bastionExport: 1;
  exportedAt: string;
  hosts: Omit<Host, "createdAt" | "updatedAt">[];
}

interface StoredHost extends Omit<Host, "password" | "privateKey"> {
  password: string | null;
  privateKey: string | null;
}

interface Store {
  users: User[];
  hosts: StoredHost[];
  sessions: SessionRow[];
  auditLog?: AuditEntry[];
}

const MAX_SESSION_ROWS = 2000;

let storePath = "";
let store: Store = { users: [], hosts: [], sessions: [], auditLog: [] };
const liveSessionIds = new Set<string>();

function decryptHost(host: StoredHost): Host {
  return {
    ...host,
    macAddress: host.macAddress ?? null,
    wolBroadcast: host.wolBroadcast ?? null,
    keyboardLayout: host.keyboardLayout ?? null,
    password: decryptNullable(host.password),
    privateKey: decryptNullable(host.privateKey),
  };
}

function encryptHostSecrets(
  data: Partial<Pick<Host, "password" | "privateKey">>
): Partial<Pick<StoredHost, "password" | "privateKey">> {
  const out: Partial<Pick<StoredHost, "password" | "privateKey">> = {};
  if (data.password !== undefined) {
    out.password = encryptNullable(data.password);
  }
  if (data.privateKey !== undefined) {
    out.privateKey = encryptNullable(data.privateKey);
  }
  return out;
}

function migratePlaintextSecrets(): void {
  let changed = false;
  for (const host of store.hosts) {
    if (host.password && !isEncrypted(host.password)) {
      host.password = encryptNullable(host.password);
      changed = true;
    }
    if (host.privateKey && !isEncrypted(host.privateKey)) {
      host.privateKey = encryptNullable(host.privateKey);
      changed = true;
    }
  }
  if (changed) {
    persist();
    console.log("[Bastion] Identifiants hôtes chiffrés (migration)");
  }
}

function persist(): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

function load(): void {
  if (fs.existsSync(storePath)) {
    store = JSON.parse(fs.readFileSync(storePath, "utf8")) as Store;
  }
  if (!store.auditLog) store.auditLog = [];
  for (const session of store.sessions) {
    if (session.username === undefined) session.username = null;
  }
  for (const user of store.users) {
    if (!user.role) user.role = "admin";
  }
}

function trimSessions(): void {
  if (store.sessions.length <= MAX_SESSION_ROWS) return;
  store.sessions = [...store.sessions]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_SESSION_ROWS);
}

export function initDatabase(dbPath: string): void {
  storePath = dbPath.endsWith(".json")
    ? dbPath
    : path.join(dbPath.replace(/\.db$/, "") + ".json");
  load();
  bindAuditStore(store.auditLog!, persist);
  closeOrphanedSessions();
  migratePlaintextSecrets();
}

/** Sessions left open after a crash/restart are not actually active. */
export function closeOrphanedSessions(): void {
  let changed = false;
  for (const session of store.sessions) {
    if (!session.endedAt) {
      session.endedAt = new Date().toISOString();
      changed = true;
    }
  }
  liveSessionIds.clear();
  if (changed) {
    persist();
    console.log("[Bastion] Sessions orphelines fermées au démarrage");
  }
}

export function ensureAdminUser(username: string, password: string): void {
  const existing = store.users.find((u) => u.username === username);
  if (existing) return;

  store.users.push({
    id: uuid(),
    username,
    passwordHash: bcrypt.hashSync(password, 12),
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  persist();
  console.log(`[Bastion] Compte admin créé : ${username}`);
}

export function findUserByUsername(username: string): User | undefined {
  return store.users.find((u) => u.username === username);
}

export function getUserById(id: string): User | undefined {
  return store.users.find((u) => u.id === id);
}

export function listUsers(): UserPublic[] {
  return store.users
    .map(({ passwordHash: _p, ...user }) => user)
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function createUser(
  username: string,
  password: string,
  role: UserRole
): UserPublic {
  const user: User = {
    id: uuid(),
    username,
    passwordHash: bcrypt.hashSync(password, 12),
    role,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  persist();
  const { passwordHash: _p, ...pub } = user;
  return pub;
}

export function updateUser(
  id: string,
  data: { role?: UserRole; password?: string }
): UserPublic | undefined {
  const user = store.users.find((u) => u.id === id);
  if (!user) return undefined;
  if (data.role) user.role = data.role;
  if (data.password) user.passwordHash = bcrypt.hashSync(data.password, 12);
  persist();
  const { passwordHash: _p, ...pub } = user;
  return pub;
}

export function deleteUser(id: string): boolean {
  if (store.users.length <= 1) return false;
  const before = store.users.length;
  store.users = store.users.filter((u) => u.id !== id);
  if (store.users.length < before) {
    persist();
    return true;
  }
  return false;
}

export function updateUserPassword(
  userId: string,
  newPassword: string
): boolean {
  const user = store.users.find((u) => u.id === userId);
  if (!user) return false;
  user.passwordHash = bcrypt.hashSync(newPassword, 12);
  persist();
  return true;
}

export function listHosts(): Host[] {
  return [...store.hosts]
    .map(decryptHost)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getHost(id: string): Host | undefined {
  const host = store.hosts.find((h) => h.id === id);
  return host ? decryptHost(host) : undefined;
}

export function createHost(host: Omit<Host, "createdAt" | "updatedAt">): Host {
  const now = new Date().toISOString();
  const { password, privateKey, ...rest } = host;
  const stored: StoredHost = {
    ...rest,
    password: encryptNullable(password),
    privateKey: encryptNullable(privateKey),
    createdAt: now,
    updatedAt: now,
  };
  store.hosts.push(stored);
  persist();
  return decryptHost(stored);
}

export function updateHost(
  id: string,
  data: Partial<Omit<Host, "id" | "createdAt" | "updatedAt">>
): Host | undefined {
  const idx = store.hosts.findIndex((h) => h.id === id);
  if (idx === -1) return undefined;

  const { password, privateKey, ...rest } = data;
  const encrypted = encryptHostSecrets({ password, privateKey });

  store.hosts[idx] = {
    ...store.hosts[idx],
    ...rest,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return decryptHost(store.hosts[idx]);
}

export function deleteHost(id: string): boolean {
  const before = store.hosts.length;
  store.hosts = store.hosts.filter((h) => h.id !== id);
  store.sessions = store.sessions.filter((s) => s.hostId !== id);
  if (store.hosts.length < before) {
    persist();
    return true;
  }
  return false;
}

export function createSession(
  hostId: string,
  protocol: Protocol,
  username: string | null = null
): string {
  const id = uuid();
  store.sessions.push({
    id,
    hostId,
    protocol,
    username,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
  liveSessionIds.add(id);
  trimSessions();
  persist();
  return id;
}

export function getSession(id: string): SessionRow | undefined {
  return store.sessions.find((s) => s.id === id);
}

export function listSessions(limit = 50): SessionView[] {
  const hostNames = new Map(store.hosts.map((h) => [h.id, h.name]));

  return [...store.sessions]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map((session) => {
      const ended = session.endedAt
        ? new Date(session.endedAt).getTime()
        : null;
      const started = new Date(session.startedAt).getTime();
      return {
        id: session.id,
        hostId: session.hostId,
        hostName: hostNames.get(session.hostId) ?? "?",
        protocol: session.protocol,
        username: session.username,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSec:
          ended !== null ? Math.max(0, Math.round((ended - started) / 1000)) : null,
      };
    });
}

export function exportHostsBundle(): HostExportBundle {
  return {
    bastionExport: 1,
    exportedAt: new Date().toISOString(),
    hosts: listHosts().map(
      ({ createdAt: _c, updatedAt: _u, ...host }) => host
    ),
  };
}

export type ImportHostInput = Omit<Host, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export function importHosts(
  hosts: ImportHostInput[],
  mode: "merge" | "replace"
): { created: number; updated: number } {
  let created = 0;
  let updated = 0;

  if (mode === "replace") {
    store.hosts = [];
    store.sessions = [];
    liveSessionIds.clear();
  }

  for (const row of hosts) {
    const byId = row.id
      ? store.hosts.find((h) => h.id === row.id)
      : undefined;
    const byKey = store.hosts.find(
      (h) => h.name === row.name && h.hostname === row.hostname
    );
    const existing = byId ?? byKey;

    if (existing && mode === "merge") {
      updateHost(existing.id, {
        name: row.name,
        hostname: row.hostname,
        port: row.port,
        protocol: row.protocol,
        username: row.username,
        password: row.password,
        privateKey: row.privateKey,
        macAddress: row.macAddress,
        wolBroadcast: row.wolBroadcast,
        keyboardLayout: row.keyboardLayout,
        color: row.color,
        tags: row.tags,
      });
      updated += 1;
    } else {
      const { id: _drop, ...rest } = row;
      createHost({
        id: uuid(),
        ...rest,
      });
      created += 1;
    }
  }

  return { created, updated };
}

export function endSession(id: string): void {
  liveSessionIds.delete(id);
  const session = store.sessions.find((s) => s.id === id);
  if (session && !session.endedAt) {
    session.endedAt = new Date().toISOString();
    persist();
  }
}

export function getStats() {
  const byProtocol: Record<string, number> = {};
  for (const h of store.hosts) {
    byProtocol[h.protocol] = (byProtocol[h.protocol] ?? 0) + 1;
  }
  return {
    totalHosts: store.hosts.length,
    activeSessions: liveSessionIds.size,
    byProtocol,
  };
}
