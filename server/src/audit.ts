import { v4 as uuid } from "uuid";

export type AuditAction =
  | "login"
  | "host.create"
  | "host.update"
  | "host.delete"
  | "host.import"
  | "host.export"
  | "session.start"
  | "session.end"
  | "wol"
  | "password.change"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "group.create"
  | "group.update"
  | "group.delete"
  | "totp.enable"
  | "totp.disable"
  | "session.terminate"
  | "auth.revoke";

export interface AuditEntry {
  id: string;
  at: string;
  username: string;
  action: AuditAction;
  summary: string;
  hostId?: string;
  hostName?: string;
  meta?: Record<string, string>;
}

const MAX_AUDIT_ENTRIES = 2000;

let auditLog: AuditEntry[] = [];
let persistFn: (() => void) | null = null;

export function bindAuditStore(
  entries: AuditEntry[],
  persist: () => void
): void {
  auditLog = entries;
  persistFn = persist;
}

export function logAudit(
  username: string,
  action: AuditAction,
  summary: string,
  extra?: Pick<AuditEntry, "hostId" | "hostName" | "meta">
): void {
  auditLog.push({
    id: uuid(),
    at: new Date().toISOString(),
    username,
    action,
    summary,
    ...extra,
  });

  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }

  persistFn?.();
}

export function listAudit(limit = 100): AuditEntry[] {
  return [...auditLog].reverse().slice(0, limit);
}

export function listAuditForUser(
  username: string,
  allowedHostIds: Set<string> | null,
  limit = 100
): AuditEntry[] {
  return [...auditLog]
    .reverse()
    .filter((entry) => {
      if (allowedHostIds === null) return true;
      if (entry.username === username) return true;
      if (entry.hostId && allowedHostIds.has(entry.hostId)) return true;
      return false;
    })
    .slice(0, limit);
}
