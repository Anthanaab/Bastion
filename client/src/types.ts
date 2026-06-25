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

export interface User {
  username: string;
}
