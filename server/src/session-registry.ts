import type { WebSocket } from "ws";
import type { Protocol } from "./db";

export interface LiveSession {
  sessionId: string;
  userId: string;
  username: string;
  hostId: string;
  hostName: string;
  protocol: Protocol;
  startedAt: string;
  ws: WebSocket;
}

const live = new Map<string, LiveSession>();

export function registerLiveSession(entry: LiveSession): void {
  live.set(entry.sessionId, entry);
}

export function unregisterLiveSession(sessionId: string): void {
  live.delete(sessionId);
}

export function getLiveSession(sessionId: string): LiveSession | undefined {
  return live.get(sessionId);
}

export function listLiveSessions(): Omit<LiveSession, "ws">[] {
  return [...live.values()].map(({ ws: _ws, ...rest }) => rest);
}

export function terminateLiveSession(sessionId: string): boolean {
  const entry = live.get(sessionId);
  if (!entry) return false;
  try {
    entry.ws.close(4000, "Session terminée par l'administrateur");
  } catch {
    /* ignore */
  }
  live.delete(sessionId);
  return true;
}

export function terminateUserLiveSessions(userId: string): number {
  let count = 0;
  for (const [id, entry] of live) {
    if (entry.userId === userId) {
      terminateLiveSession(id);
      count += 1;
    }
  }
  return count;
}
