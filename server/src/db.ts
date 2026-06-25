import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  decryptNullable,
  encryptNullable,
  isEncrypted,
} from "./crypto";

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
  color: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  hostId: string;
  protocol: Protocol;
  startedAt: string;
  endedAt: string | null;
}

interface StoredHost extends Omit<Host, "password" | "privateKey"> {
  password: string | null;
  privateKey: string | null;
}

interface Store {
  users: User[];
  hosts: StoredHost[];
  sessions: SessionRow[];
}

let storePath = "";
let store: Store = { users: [], hosts: [], sessions: [] };

function decryptHost(host: StoredHost): Host {
  return {
    ...host,
    macAddress: host.macAddress ?? null,
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
}

export function initDatabase(dbPath: string): void {
  storePath = dbPath.endsWith(".json")
    ? dbPath
    : path.join(dbPath.replace(/\.db$/, "") + ".json");
  load();
  migratePlaintextSecrets();
}

export function ensureAdminUser(username: string, password: string): void {
  const existing = store.users.find((u) => u.username === username);
  if (existing) return;

  store.users.push({
    id: uuid(),
    username,
    passwordHash: bcrypt.hashSync(password, 12),
    createdAt: new Date().toISOString(),
  });
  persist();
  console.log(`[Bastion] Compte admin créé : ${username}`);
}

export function findUserByUsername(username: string): User | undefined {
  return store.users.find((u) => u.username === username);
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

export function createSession(hostId: string, protocol: Protocol): string {
  const id = uuid();
  store.sessions.push({
    id,
    hostId,
    protocol,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
  persist();
  return id;
}

export function endSession(id: string): void {
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
    activeSessions: store.sessions.filter((s) => !s.endedAt).length,
    byProtocol,
  };
}
