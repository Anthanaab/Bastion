import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { getHost, createSession, endSession } from "../db";
import { wsAuthFromRequest } from "../auth";
import { GuacdClient, type ConnectionSettings } from "./guacd-client";
import { toInstruction, filterInstructionsForGuacd } from "./guacamole-parser";

const DEFAULT_RDP_SECURITY = "nla|tls|rdp|any";

function rdpSecurityModes(): string[] {
  const raw = process.env.BASTION_RDP_SECURITY ?? DEFAULT_RDP_SECURITY;
  return raw
    .split(/[|,]/)
    .map((mode) => mode.trim())
    .filter(Boolean);
}

function isRdpSecurityError(data: string): boolean {
  return /wrong security type|security negotiation failed/i.test(data);
}

function buildSettings(
  protocol: "rdp" | "vnc",
  host: NonNullable<ReturnType<typeof getHost>>,
  securityMode?: string
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
    width: "1920",
    height: "1080",
    dpi: "96",
    audio: ["audio/L16"],
    video: null,
    image: ["image/png", "image/jpeg"],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  if (domain) settings.domain = domain;

  if (protocol === "rdp") {
    settings.security = securityMode ?? rdpSecurityModes()[0] ?? "nla";
    settings["ignore-cert"] = "true";
    settings["color-depth"] = "32";
    settings["enable-wallpaper"] = "false";
    settings["enable-font-smoothing"] = "true";
    settings["enable-desktop-composition"] = "false";
    settings["force-lossless"] = "true";
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

  const protocol = host.protocol;

  const sessionId = createSession(hostId, protocol);

  console.log(
    `[Guacd] Session ${protocol} → ${host.hostname}:${host.port} (${host.name})`
  );

  let guacdClient: GuacdClient | null = null;
  let opened = false;
  let attemptIndex = 0;
  let retrying = false;
  const securityModes = protocol === "rdp" ? rdpSecurityModes() : [""];
  if (protocol === "rdp") {
    console.log(`[Guacd] Modes RDP à essayer: ${securityModes.join(" → ")}`);
  }

  const handshakeTimeout = setTimeout(() => {
    if (!opened && !retrying) {
      console.error("[Guacd] Timeout handshake");
      ws.send(toInstruction(["error", "Timeout connexion guacd", "504"]));
      ws.close(4006, "Timeout handshake");
      guacdClient?.close(new Error("Timeout handshake"));
    }
  }, 30000);

  const sendToClient = (data: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  const startClient = (securityMode?: string) => {
    if (guacdClient) {
      guacdClient.removeAllListeners();
      guacdClient.close();
      guacdClient = null;
    }

    const settings = buildSettings(protocol, host, securityMode);

    if (protocol === "rdp" && securityMode) {
      console.log(`[Guacd] RDP security=${securityMode}`);
    }

    try {
      guacdClient = new GuacdClient(
        { host: guacdHost, port: guacdPort },
        protocol,
        settings
      );
    } catch (err) {
      console.error("[Guacd] Init error:", err);
      sendToClient(toInstruction(["error", "guacd indisponible", "769"]));
      return;
    }

    guacdClient.on("open", () => {
      opened = true;
      retrying = false;
      clearTimeout(handshakeTimeout);
      console.log(`[Guacd] Prêt — ${host.name}`);
    });

    guacdClient.on("data", (data: string) => {
      if (
        protocol === "rdp" &&
        isRdpSecurityError(data) &&
        attemptIndex < securityModes.length - 1
      ) {
        console.warn(`[Guacd] Erreur sécurité RDP: ${data.slice(0, 120)}`);
        attemptIndex += 1;
        retrying = true;
        opened = false;
        const nextMode = securityModes[attemptIndex];
        console.warn(
          `[Guacd] Échec sécurité RDP, nouvel essai avec security=${nextMode}`
        );
        startClient(nextMode);
        return;
      }

      sendToClient(data);
    });

    guacdClient.on("error", (err: Error) => {
      console.error("[Guacd] Erreur:", err.message);
      if (!retrying) {
        sendToClient(toInstruction(["error", err.message, "769"]));
      }
    });

    guacdClient.on("close", () => {
      if (!retrying && ws.readyState === WebSocket.OPEN) {
        clearTimeout(handshakeTimeout);
        ws.close();
      }
    });
  };

  startClient(protocol === "rdp" ? securityModes[0] : undefined);

  ws.on("message", (data) => {
    const message =
      typeof data === "string" ? data : (data as Buffer).toString("utf8");
    const filtered = filterInstructionsForGuacd(message);
    if (filtered) {
      guacdClient?.send(filtered, true);
    }
  });

  const cleanup = () => {
    clearTimeout(handshakeTimeout);
    endSession(sessionId);
    guacdClient?.close();
  };

  ws.on("close", cleanup);
}
