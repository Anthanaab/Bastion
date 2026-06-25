import type { IncomingMessage } from "http";
import { Client } from "ssh2";
import { WebSocket } from "ws";
import { getHost, createSession, endSession } from "../db";
import { wsAuthFromRequest } from "../auth";

export function handleSshConnection(ws: WebSocket, request: IncomingMessage): void {
  const url = request.url ?? "";
  const user = wsAuthFromRequest(url, request.headers.cookie);
  if (!user) {
    console.error("[SSH] Auth WebSocket échouée");
    ws.close(4001, "Non authentifié");
    return;
  }

  const params = new URL(url, "http://localhost").searchParams;
  const hostId = params.get("hostId");
  const cols = parseInt(params.get("cols") ?? "120", 10);
  const rows = parseInt(params.get("rows") ?? "30", 10);

  if (!hostId) {
    ws.close(4002, "hostId requis");
    return;
  }

  const host = getHost(hostId);
  if (!host || host.protocol !== "ssh") {
    ws.close(4003, "Hôte SSH introuvable");
    return;
  }

  const sessionId = createSession(hostId, "ssh");
  const conn = new Client();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stream: any = null;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    endSession(sessionId);
    try {
      conn.end();
    } catch {
      /* ignore */
    }
  };

  conn.on("ready", () => {
    conn.shell({ cols, rows, term: "xterm-256color" }, (err, shellStream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        cleanup();
        ws.close();
        return;
      }

      stream = shellStream as typeof stream;

      shellStream.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      shellStream.stderr.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      shellStream.on("close", () => {
        ws.close();
      });

      ws.send(JSON.stringify({ type: "connected", host: host.name }));
    });
  });

  conn.on("error", (err) => {
    ws.send(JSON.stringify({ type: "error", message: err.message }));
    ws.close();
    cleanup();
  });

  ws.on("message", (data) => {
    const raw = data.toString();

    if (raw.startsWith("{")) {
      try {
        const msg = JSON.parse(raw) as {
          type: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === "resize" && stream && msg.cols && msg.rows) {
          stream.setWindow(msg.rows, msg.cols, 0, 0);
        }
        return;
      } catch {
        /* fall through to write */
      }
    }

    if (stream) {
      stream.write(raw);
    }
  });

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  const connectConfig: Parameters<Client["connect"]>[0] = {
    host: host.hostname,
    port: host.port,
    username: host.username,
    readyTimeout: 15000,
  };

  if (host.privateKey) {
    connectConfig.privateKey = host.privateKey;
    if (host.password) connectConfig.passphrase = host.password;
  } else if (host.password) {
    connectConfig.password = host.password;
  }

  conn.connect(connectConfig);
}
