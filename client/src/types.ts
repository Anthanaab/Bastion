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

export interface InfraServiceCounts {
  total: number;
  online: number;
}

export interface InfraHostItem {
  id: string;
  name: string;
  hostname: string;
  port: number;
  protocol: Protocol;
  online: boolean;
  wolCapable: boolean;
  tags: string;
  color: string;
}

export interface InfrastructureSummary {
  generatedAt: string;
  hosts: {
    total: number;
    online: number;
    offline: number;
    wolCapable: number;
    byProtocol: Record<string, InfraServiceCounts>;
    byTag: Record<string, InfraServiceCounts>;
    items: InfraHostItem[];
  };
  services: {
    guacd: boolean;
    database: boolean;
    wolRelay: { configured: boolean; ok: boolean; url: string | null };
  };
  sessions: {
    active: number;
    live: LiveSessionRecord[] | null;
    recent: SessionRecord[];
  };
  system: {
    version: string;
    uptimeSec: number;
    nodeVersion: string;
    platform: string;
    memoryMb: number;
    users: number;
    backups: { count: number; lastBackupAt: string | null };
  } | null;
}

export interface StatusNotification {
  id: string;
  hostId: string;
  hostName: string;
  online: boolean;
  at: number;
}
