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

export interface User {
  username: string;
}
