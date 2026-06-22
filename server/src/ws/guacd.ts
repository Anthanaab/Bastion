import net from "net";
import { WebSocket } from "ws";
import { getHost, createSession, endSession } from "../db";
import { wsAuthFromUrl } from "../auth";

function encodeInstruction(opcode: string, args: string[]): string {
  const parts = [
    `${opcode.length}.${opcode}`,
    ...args.map((a) => `${a.length}.${a}`),
  ];
  return `${parts.join(",")};`;
}

function buildSelectInstruction(
  protocol: "rdp" | "vnc",
  host: NonNullable<ReturnType<typeof getHost>>
): string {
  const params: string[] = [protocol];

  const add = (key: string, value: string) => {
    params.push(key, value);
  };

  add("hostname", host.hostname);
  add("port", String(host.port));
  if (host.username) add("username", host.username);
  if (host.password) add("password", host.password);

  if (protocol === "rdp") {
    add("security", "any");
    add("ignore-cert", "true");
    add("enable-wallpaper", "false");
    add("enable-font-smoothing", "true");
    add("resize-method", "display-update");
    add("width", "1920");
    add("height", "1080");
    add("dpi", "96");
  } else {
    add("color-depth", "24");
    add("cursor", "remote");
    add("width", "1920");
    add("height", "1080");
  }

  return encodeInstruction("select", params);
}

export function handleGuacdConnection(
  ws: WebSocket,
  url: string,
  guacdHost: string,
  guacdPort: number
): void {
  const user = wsAuthFromUrl(url);
  if (!user) {
    ws.close(4001, "Non authentifié");
    return;
  }

  const params = new URL(url, "http://localhost").searchParams;
  const hostId = params.get("hostId");
  if (!hostId) {
    ws.close(4002, "hostId requis");
    return;
  }

  const host = getHost(hostId);
  if (!host || (host.protocol !== "rdp" && host.protocol !== "vnc")) {
    ws.close(4003, "Hôte ou protocole invalide");
    return;
  }

  const sessionId = createSession(hostId, host.protocol);
  const guacdSocket = net.createConnection(guacdPort, guacdHost);
  let phase: "handshake" | "bridge" = "handshake";
  let buffer = "";

  guacdSocket.on("connect", () => {
    guacdSocket.write("GUACD 1.5.0\n");
  });

  guacdSocket.on("data", (data: Buffer) => {
    if (phase === "handshake") {
      buffer += data.toString("utf8");
      if (buffer.includes("4.args,")) {
        const select = buildSelectInstruction(
          host.protocol as "rdp" | "vnc",
          host
        );
        guacdSocket.write(select);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buffer);
        }
        buffer = "";
        phase = "bridge";
      }
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on("message", (data) => {
    if (phase === "bridge" && guacdSocket.writable) {
      guacdSocket.write(data as Buffer);
    }
  });

  guacdSocket.on("error", (err) => {
    console.error("[Guacd]", err.message);
    ws.close(4005, "guacd indisponible");
  });

  const cleanup = () => {
    endSession(sessionId);
    guacdSocket.destroy();
  };

  ws.on("close", cleanup);
  guacdSocket.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
}
