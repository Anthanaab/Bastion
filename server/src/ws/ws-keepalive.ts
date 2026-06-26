import type { WebSocket } from "ws";

const WS_PING_INTERVAL_MS = 30_000;

export function attachWsKeepAlive(ws: WebSocket, label: string): () => void {
  let alive = true;

  ws.on("pong", () => {
    alive = true;
  });

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;

    if (!alive) {
      console.warn(`[WS] ${label} — pas de pong, fermeture`);
      ws.terminate();
      return;
    }

    alive = false;
    ws.ping();
  }, WS_PING_INTERVAL_MS);

  return () => clearInterval(interval);
}
