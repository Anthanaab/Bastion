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
  secretsUnreadable?: boolean;
}

export interface Stats {
  totalHosts: number;
  activeSessions: number;
  byProtocol: Record<string, number>;
}

export interface SessionRecord {
  id: string;
  hostId: string;
  hostName: string;
  protocol: Protocol;
  username: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
}

export interface LiveSessionRecord {
  sessionId: string;
  userId: string;
  username: string;
  hostId: string;
  hostName: string;
  protocol: Protocol;
  startedAt: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  username: string;
  action: string;
  summary: string;
  hostId?: string;
  hostName?: string;
}

export interface HostExportBundle {
  bastionExport: 1;
  exportedAt: string;
  hosts: Omit<Host, "createdAt" | "updatedAt">[];
}

export type UserRole = "admin" | "operator";

export interface User {
  username: string;
  role: UserRole;
  pinnedHostIds?: string[];
  totpEnabled?: boolean;
  mustChangePassword?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  role: UserRole;
  allowedHostIds: string[] | null;
  groupIds: string[];
  pinnedHostIds: string[];
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AccessGroup {
  id: string;
  name: string;
  hostIds: string[];
  createdAt: string;
}

export interface StatusNotification {
  id: string;
  hostId: string;
  hostName: string;
  online: boolean;
  at: number;
}
