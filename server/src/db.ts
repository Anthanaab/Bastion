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
import { maybeBackup } from "./backup";
import { decryptTotpSecret } from "./totp";

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

export interface AccessGroup {
  id: string;
  name: string;
  hostIds: string[];
  createdAt: string;
}

export interface AuthSessionRow {
  id: string;
  userId: string;
  jti: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  /** null/undefined = toutes les machines (legacy). [] = aucune directe. */
  allowedHostIds?: string[] | null;
  groupIds?: string[];
  pinnedHostIds?: string[];
  totpSecret?: string | null;
  totpEnabled?: boolean;
  createdAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  allowedHostIds: string[] | null;
  groupIds: string[];
  pinnedHostIds: string[];
  totpEnabled: boolean;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  hostId: string;
  protocol: Protocol;
  username: string | null;
  bastionUserId?: string | null;
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
  groups?: AccessGroup[];
  authSessions?: AuthSessionRow[];
}

const MAX_SESSION_ROWS = 2000;

let storePath = "";
let store: Store = { users: [], hosts: [], sessions: [], auditLog: [] };
const liveSessionIds = new Set<string>();

/** Ne doit jamais throw : un secret illisible (ex. rotation de JWT_SECRET
 * sans BASTION_ENCRYPTION_KEY séparé) ne doit pas planter toute la liste. */
function safeDecrypt(
  value: string | null,
  hostName: string,
  field: string
): string | null {
  try {
    return decryptNullable(value);
  } catch (err) {
    console.error(
      `[Bastion] Échec de déchiffrement (${field}) pour l'hôte "${hostName}" — ` +
        `clé de chiffrement changée ? Reconfigurez les identifiants de cet hôte.`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function decryptHost(host: StoredHost): Host {
  return {
    ...host,
    macAddress: host.macAddress ?? null,
    wolBroadcast: host.wolBroadcast ?? null,
    keyboardLayout: host.keyboardLayout ?? null,
    password: safeDecrypt(host.password, host.name, "password"),
    privateKey: safeDecrypt(host.privateKey, host.name, "privateKey"),
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
  maybeBackup();
}

function toUserPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    allowedHostIds:
      user.role === "admin" ? null : (user.allowedHostIds ?? null),
    groupIds: user.role === "admin" ? [] : (user.groupIds ?? []),
    pinnedHostIds: user.pinnedHostIds ?? [],
    totpEnabled: !!user.totpEnabled,
    createdAt: user.createdAt,
  };
}

function load(): void {
  if (fs.existsSync(storePath)) {
    store = JSON.parse(fs.readFileSync(storePath, "utf8")) as Store;
  }
  if (!store.auditLog) store.auditLog = [];
  if (!store.groups) store.groups = [];
  if (!store.authSessions) store.authSessions = [];
  for (const session of store.sessions) {
    if (session.username === undefined) session.username = null;
    if (session.bastionUserId === undefined) session.bastionUserId = null;
  }
  for (const user of store.users) {
    if (!user.role) user.role = "admin";
    if (!user.groupIds) user.groupIds = [];
    if (!user.pinnedHostIds) user.pinnedHostIds = [];
  }
  pruneExpiredAuthSessions();
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
    .map((u) => toUserPublic(u))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function resolveEffectiveHostIds(user: User): Set<string> | null {
  if (user.role === "admin") return null;

  const hasGroups = (user.groupIds?.length ?? 0) > 0;
  const direct = user.allowedHostIds;

  if (!hasGroups && (direct === null || direct === undefined)) {
    return null;
  }

  const ids = new Set<string>();
  if (hasGroups) {
    for (const gid of user.groupIds!) {
      const group = store.groups?.find((g) => g.id === gid);
      if (group) {
        for (const hid of group.hostIds) ids.add(hid);
      }
    }
  }
  if (direct?.length) {
    for (const hid of direct) ids.add(hid);
  }
  return ids;
}

export function filterValidHostIds(ids: string[]): string[] {
  const known = new Set(store.hosts.map((h) => h.id));
  return ids.filter((id) => known.has(id));
}

export function canUserAccessHost(userId: string, hostId: string): boolean {
  const user = getUserById(userId);
  if (!user) return false;
  if (user.role === "admin") return true;
  const effective = resolveEffectiveHostIds(user);
  if (effective === null) return true;
  return effective.has(hostId);
}

export function listHostsForUser(userId: string): Host[] {
  const user = getUserById(userId);
  if (!user) return [];
  const hosts = listHosts();
  if (user.role === "admin") return hosts;
  const effective = resolveEffectiveHostIds(user);
  if (effective === null) return hosts;
  return hosts.filter((h) => effective.has(h.id));
}

export function createUser(
  username: string,
  password: string,
  role: UserRole,
  allowedHostIds?: string[] | null,
  groupIds?: string[]
): UserPublic {
  const user: User = {
    id: uuid(),
    username,
    passwordHash: bcrypt.hashSync(password, 12),
    role,
    allowedHostIds: role === "admin" ? null : (allowedHostIds ?? []),
    groupIds: role === "admin" ? [] : filterValidGroupIds(groupIds ?? []),
    pinnedHostIds: [],
    totpEnabled: false,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  persist();
  return toUserPublic(user);
}

export function updateUser(
  id: string,
  data: {
    role?: UserRole;
    password?: string;
    allowedHostIds?: string[] | null;
    groupIds?: string[];
  }
): UserPublic | undefined {
  const user = store.users.find((u) => u.id === id);
  if (!user) return undefined;
  if (data.role) {
    user.role = data.role;
    if (data.role === "admin") {
      user.allowedHostIds = null;
      user.groupIds = [];
    } else if (user.allowedHostIds === null || user.allowedHostIds === undefined) {
      user.allowedHostIds = [];
    }
  }
  if (data.password) user.passwordHash = bcrypt.hashSync(data.password, 12);
  if (data.allowedHostIds !== undefined && user.role === "operator") {
    user.allowedHostIds = data.allowedHostIds;
  }
  if (data.groupIds !== undefined && user.role === "operator") {
    user.groupIds = filterValidGroupIds(data.groupIds);
  }
  persist();
  return toUserPublic(user);
}

export function updateUserPins(userId: string, pinnedHostIds: string[]): UserPublic | undefined {
  const user = getUserById(userId);
  if (!user) return undefined;
  const allowed = new Set(listHostsForUser(userId).map((h) => h.id));
  user.pinnedHostIds = filterValidHostIds(pinnedHostIds).filter((id) =>
    allowed.has(id)
  );
  persist();
  return toUserPublic(user);
}

export function listGroups(): AccessGroup[] {
  return [...(store.groups ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export function getGroup(id: string): AccessGroup | undefined {
  return store.groups?.find((g) => g.id === id);
}

export function filterValidGroupIds(ids: string[]): string[] {
  const known = new Set((store.groups ?? []).map((g) => g.id));
  return ids.filter((id) => known.has(id));
}

export function createGroup(name: string, hostIds: string[]): AccessGroup {
  const group: AccessGroup = {
    id: uuid(),
    name: name.trim(),
    hostIds: filterValidHostIds(hostIds),
    createdAt: new Date().toISOString(),
  };
  if (!store.groups) store.groups = [];
  store.groups.push(group);
  persist();
  return group;
}

export function updateGroup(
  id: string,
  data: { name?: string; hostIds?: string[] }
): AccessGroup | undefined {
  const group = store.groups?.find((g) => g.id === id);
  if (!group) return undefined;
  if (data.name !== undefined) group.name = data.name.trim();
  if (data.hostIds !== undefined) group.hostIds = filterValidHostIds(data.hostIds);
  persist();
  return group;
}

export function deleteGroup(id: string): boolean {
  if (!store.groups) return false;
  const before = store.groups.length;
  store.groups = store.groups.filter((g) => g.id !== id);
  for (const user of store.users) {
    if (user.groupIds?.length) {
      user.groupIds = user.groupIds.filter((gid) => gid !== id);
    }
  }
  if (store.groups.length < before) {
    persist();
    return true;
  }
  return false;
}

export function createAuthSession(
  userId: string,
  jti: string,
  expiresAt: string
): AuthSessionRow {
  const row: AuthSessionRow = {
    id: uuid(),
    userId,
    jti,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  if (!store.authSessions) store.authSessions = [];
  store.authSessions.push(row);
  pruneExpiredAuthSessions();
  persist();
  return row;
}

export function isAuthSessionValid(jti: string, userId?: string): boolean {
  pruneExpiredAuthSessions();
  const row = store.authSessions?.find((s) => s.jti === jti);
  if (!row || row.revoked) return false;
  if (userId !== undefined && row.userId !== userId) return false;
  return true;
}

export function revokeAuthSession(jti: string): void {
  const row = store.authSessions?.find((s) => s.jti === jti);
  if (row) {
    row.revoked = true;
    persist();
  }
}

export function revokeAllAuthSessionsForUser(userId: string, exceptJti?: string): number {
  let count = 0;
  for (const row of store.authSessions ?? []) {
    if (row.userId === userId && row.jti !== exceptJti && !row.revoked) {
      row.revoked = true;
      count += 1;
    }
  }
  if (count) persist();
  return count;
}

export function listAuthSessionsForUser(userId: string): AuthSessionRow[] {
  pruneExpiredAuthSessions();
  return (store.authSessions ?? []).filter(
    (s) => s.userId === userId && !s.revoked
  );
}

function pruneExpiredAuthSessions(): void {
  if (!store.authSessions?.length) return;
  const now = Date.now();
  const before = store.authSessions.length;
  store.authSessions = store.authSessions.filter((s) => {
    if (s.revoked) return false;
    return new Date(s.expiresAt).getTime() > now;
  });
  if (store.authSessions.length < before) persist();
}

export function setUserTotpPending(userId: string, encryptedSecret: string): boolean {
  const user = getUserById(userId);
  if (!user) return false;
  user.totpSecret = encryptedSecret;
  user.totpEnabled = false;
  persist();
  return true;
}

export function enableUserTotp(userId: string): boolean {
  const user = getUserById(userId);
  if (!user?.totpSecret) return false;
  user.totpEnabled = true;
  persist();
  return true;
}

export function disableUserTotp(userId: string): boolean {
  const user = getUserById(userId);
  if (!user) return false;
  user.totpSecret = null;
  user.totpEnabled = false;
  persist();
  return true;
}

export function getUserTotpSecret(userId: string): string | null {
  const user = getUserById(userId);
  if (!user?.totpSecret) return null;
  try {
    return decryptTotpSecret(user.totpSecret);
  } catch (err) {
    console.error(
      `[Bastion] Échec de déchiffrement du secret TOTP pour "${user.username}" — ` +
        `clé de chiffrement changée ? Cet utilisateur doit reconfigurer son 2FA.`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function deleteUser(id: string): boolean {
  if (store.users.length <= 1) return false;
  const before = store.users.length;
  store.users = store.users.filter((u) => u.id !== id);
  if (store.authSessions) {
    store.authSessions = store.authSessions.filter((s) => s.userId !== id);
  }
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
  for (const user of store.users) {
    if (user.allowedHostIds?.length) {
      user.allowedHostIds = user.allowedHostIds.filter((hid) => hid !== id);
    }
    if (user.pinnedHostIds?.length) {
      user.pinnedHostIds = user.pinnedHostIds.filter((hid) => hid !== id);
    }
  }
  if (store.groups) {
    for (const group of store.groups) {
      group.hostIds = group.hostIds.filter((hid) => hid !== id);
    }
  }
  if (store.hosts.length < before) {
    persist();
    return true;
  }
  return false;
}

export function createSession(
  hostId: string,
  protocol: Protocol,
  username: string | null = null,
  bastionUserId: string | null = null
): string {
  const id = uuid();
  store.sessions.push({
    id,
    hostId,
    protocol,
    username,
    bastionUserId,
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

export function listSessions(limit = 50, userId?: string): SessionView[] {
  const hostNames = new Map(store.hosts.map((h) => [h.id, h.name]));
  const allowedHostIds =
    userId === undefined
      ? null
      : new Set(listHostsForUser(userId).map((h) => h.id));

  return [...store.sessions]
    .filter((session) => !allowedHostIds || allowedHostIds.has(session.hostId))
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

export function getStats(userId?: string) {
  const hosts =
    userId === undefined ? store.hosts : listHostsForUser(userId);
  const byProtocol: Record<string, number> = {};
  for (const h of hosts) {
    byProtocol[h.protocol] = (byProtocol[h.protocol] ?? 0) + 1;
  }
  const allowedIds = new Set(hosts.map((h) => h.id));
  let activeSessions = 0;
  for (const session of store.sessions) {
    if (!session.endedAt && allowedIds.has(session.hostId)) activeSessions += 1;
  }
  return {
    totalHosts: hosts.length,
    activeSessions: userId === undefined ? liveSessionIds.size : activeSessions,
    byProtocol,
  };
}
