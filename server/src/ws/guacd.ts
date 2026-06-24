import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { getHost, createSession, endSession } from "../db";
import { wsAuthFromRequest } from "../auth";
import { GuacdClient, type ConnectionSettings } from "./guacd-client";
import { toInstruction } from "./guacamole-parser";

function buildSettings(
  protocol: "rdp" | "vnc",
  host: NonNullable<ReturnType<typeof getHost>>
): ConnectionSettings {
  let username = host.username ?? "";
  let domain = "";

  if (protocol === "rdp" && username.includes("\\")) {
    const parts = username.split("\\");
    domain = parts[0] ?? "";
    username = parts.slice(1).join("\\");
  }

  const settings: ConnectionSettings = {
    hostname: host.hostname,
    port: String(host.port),
    username,
    password: host.password ?? "",
    width: "1280",
    height: "720",
    dpi: "96",
    audio: ["audio/L16"],
    video: null,
    image: ["image/png", "image/jpeg"],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  if (domain) settings.domain = domain;

  if (protocol === "rdp") {
    const security = process.env.BASTION_RDP_SECURITY ?? "nla";
    settings.security = security;
    settings["ignore-cert"] = "true";
    settings["cert-tofu"] = "true";
    settings["enable-wallpaper"] = "false";
    settings["enable-font-smoothing"] = "true";
    settings["resize-method"] = "display-update";
  } else {
    settings["color-depth"] = "24";
    settings.cursor = "remote";
  }

  return settings;
}

export function handleGuacdConnection(
  ws: WebSocket,
  request: IncomingMessage,
  guacdHost: string,
  guacdPort: number
): void {
  const url = request.url ?? "";
  console.log("[Guacd] Nouvelle connexion WebSocket");

  const user = wsAuthFromRequest(url, request.headers.cookie);
  if (!user) {
    console.error("[Guacd] Auth WebSocket échouée (token/cookie manquant ou expiré)");
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
  const settings = buildSettings(host.protocol, host);

  console.log(
    `[Guacd] Session ${host.protocol} → ${host.hostname}:${host.port} (${host.name})`
  );

  let guacdClient: GuacdClient | null = null;
  let opened = false;

  const handshakeTimeout = setTimeout(() => {
    if (!opened) {
      console.error("[Guacd] Timeout handshake");
      ws.send(toInstruction(["error", "Timeout connexion guacd", "504"]));
      ws.close(4006, "Timeout handshake");
      guacdClient?.close(new Error("Timeout handshake"));
    }
  }, 20000);

  const sendToClient = (data: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  try {
    guacdClient = new GuacdClient(
      { host: guacdHost, port: guacdPort },
      host.protocol,
      settings
    );
  } catch (err) {
    clearTimeout(handshakeTimeout);
    console.error("[Guacd] Init error:", err);
    ws.close(4005, "guacd indisponible");
    return;
  }

  guacdClient.on("open", () => {
    opened = true;
    clearTimeout(handshakeTimeout);
    console.log(`[Guacd] Prêt — ${host.name}`);
  });

  guacdClient.on("data", (data: string) => {
    sendToClient(data);
  });

  guacdClient.on("error", (err: Error) => {
    console.error("[Guacd] Erreur:", err.message);
    sendToClient(toInstruction(["error", err.message, "769"]));
  });

  guacdClient.on("close", () => {
    clearTimeout(handshakeTimeout);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on("message", (data) => {
    const message =
      typeof data === "string" ? data : (data as Buffer).toString("utf8");
    guacdClient?.send(message, true);
  });

  const cleanup = () => {
    clearTimeout(handshakeTimeout);
    endSession(sessionId);
    guacdClient?.close();
  };

  ws.on("close", cleanup);
}
