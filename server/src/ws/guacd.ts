import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { getHost, createSession, endSession, getSession, canUserAccessHost } from "../db";
import { registerLiveSession, unregisterLiveSession } from "../session-registry";
import { wsAuthFromRequest } from "../auth";
import { GuacdClient, type ConnectionSettings } from "./guacd-client";
import { toInstruction, splitClientMessage } from "./guacamole-parser";
import { attachWsKeepAlive } from "./ws-keepalive";
import { logAudit } from "../audit";

const MAX_CLIENT_BUFFER = 256 * 1024;

const DEFAULT_RDP_SECURITY = "nla|tls|rdp|any";

function rdpDisableGfx(): boolean {
  const raw = process.env.BASTION_RDP_DISABLE_GFX ?? "true";
  return raw !== "false" && raw !== "0";
}

type RdpQualityProfile = "performance" | "balanced" | "quality";

function parseQualityProfile(raw: string | null): RdpQualityProfile {
  if (raw === "performance" || raw === "quality") return raw;
  return "balanced";
}

function applyRdpQualityProfile(
  settings: ConnectionSettings,
  profile: RdpQualityProfile
): void {
  if (profile === "performance") {
    settings["color-depth"] = "16";
    settings["disable-gfx"] = "true";
    settings["enable-wallpaper"] = "false";
    settings["enable-font-smoothing"] = "false";
    settings["enable-desktop-composition"] = "false";
    settings.image = ["image/jpeg"];
    return;
  }

  if (profile === "quality") {
    settings["color-depth"] = "32";
    settings["disable-gfx"] = "false";
    settings["enable-wallpaper"] = "true";
    settings["enable-font-smoothing"] = "true";
    settings["enable-desktop-composition"] = "true";
    settings.image = ["image/png", "image/jpeg"];
    return;
  }

  settings["color-depth"] = "24";
  settings["disable-gfx"] = rdpDisableGfx() ? "true" : "false";
  settings["enable-wallpaper"] = "false";
  settings["enable-font-smoothing"] = "true";
  settings["enable-desktop-composition"] = "false";
  settings.image = ["image/png", "image/jpeg"];
}

function parseViewportSize(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function rdpSecurityModes(): string[] {
  const raw = process.env.BASTION_RDP_SECURITY ?? DEFAULT_RDP_SECURITY;
  return raw
    .split(/[|,]/)
    .map((mode) => mode.trim())
    .filter(Boolean);
}

function rdpKeyboardLayout(host: NonNullable<ReturnType<typeof getHost>>): string {
  return (
    host.keyboardLayout?.trim() ||
    process.env.BASTION_RDP_KEYBOARD_LAYOUT?.trim() ||
    "fr-fr-azerty"
  );
}

function rdpResizeMethod(): string {
  const raw = process.env.BASTION_RDP_RESIZE_METHOD?.trim().toLowerCase();
  if (raw === "reconnect" || raw === "display-update" || raw === "none") {
    return raw;
  }
  return "display-update";
}

function rdpIgnoreCert(): boolean {
  const raw = process.env.BASTION_RDP_IGNORE_CERT ?? "true";
  return raw !== "false" && raw !== "0";
}

function isRdpSecurityError(data: string): boolean {
  return /wrong security type|security negotiation failed/i.test(data);
}

function buildSettings(
  protocol: "rdp" | "vnc",
  host: NonNullable<ReturnType<typeof getHost>>,
  securityMode?: string,
  viewport?: { width: number; height: number },
  qualityProfile: RdpQualityProfile = "balanced"
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
    width: String(viewport?.width ?? 1920),
    height: String(viewport?.height ?? 1080),
    dpi: "96",
    audio: ["audio/L16"],
    video: null,
    image: ["image/png", "image/jpeg"],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  if (domain) settings.domain = domain;

  if (protocol === "rdp") {
    settings.security = securityMode ?? rdpSecurityModes()[0] ?? "nla";
    if (rdpIgnoreCert()) {
      settings["ignore-cert"] = "true";
    }
    const resizeMethod = rdpResizeMethod();
    if (resizeMethod !== "none") {
      settings["resize-method"] = resizeMethod;
    }
    applyRdpQualityProfile(settings, qualityProfile);
    settings["server-layout"] = rdpKeyboardLayout(host);
    settings["server-alive-interval"] = "30";
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

  const viewport = {
    width: parseViewportSize(params.get("width"), 1920, 320, 3840),
    height: parseViewportSize(params.get("height"), 1080, 240, 2160),
  };
  const qualityProfile = parseQualityProfile(params.get("quality"));

  const host = getHost(hostId);
  if (!host || (host.protocol !== "rdp" && host.protocol !== "vnc")) {
    ws.close(4003, "Hôte ou protocole invalide");
    return;
  }

  if (!canUserAccessHost(user.userId, host.id)) {
    ws.close(4004, "Accès non autorisé");
    return;
  }

  const protocol = host.protocol;

  const sessionId = createSession(hostId, protocol, user.username, user.userId);
  registerLiveSession({
    sessionId,
    userId: user.userId,
    username: user.username,
    hostId: host.id,
    hostName: host.name,
    protocol,
    startedAt: new Date().toISOString(),
    ws,
  });
  const clearWsKeepAlive = attachWsKeepAlive(ws, `guacd/${host.name}`);
  logAudit(user.username, "session.start", `${protocol.toUpperCase()} → ${host.name}`, {
    hostId: host.id,
    hostName: host.name,
    meta: { protocol },
  });

  console.log(
    `[Guacd] Session ${protocol} → ${host.hostname}:${host.port} (${host.name}) ${viewport.width}x${viewport.height}` +
      (protocol === "rdp" ? ` quality=${qualityProfile}` : "")
  );

  let guacdClient: GuacdClient | null = null;
  let opened = false;
  let attemptIndex = 0;
  let retrying = false;
  let cleaned = false;
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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: false });
    }
  };

  const startClient = (securityMode?: string) => {
    if (guacdClient) {
      guacdClient.removeAllListeners();
      guacdClient.close();
      guacdClient = null;
    }

    const settings = buildSettings(
      protocol,
      host,
      securityMode,
      viewport,
      qualityProfile
    );

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
      if (/authentication failure|invalid credentials/i.test(data)) {
        console.error("[Guacd] Échec authentification RDP — vérifiez identifiants hôte");
      }

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

  let clientToGuacdBuffer = "";

  ws.on("message", (data) => {
    const message =
      typeof data === "string" ? data : (data as Buffer).toString("utf8");
    clientToGuacdBuffer += message;

    if (clientToGuacdBuffer.length > MAX_CLIENT_BUFFER) {
      console.warn(
        `[Guacd] Buffer client tronqué (${clientToGuacdBuffer.length} octets)`
      );
      clientToGuacdBuffer = clientToGuacdBuffer.slice(-MAX_CLIENT_BUFFER);
    }

    const { tunnelOnly, forGuacd, remainder } =
      splitClientMessage(clientToGuacdBuffer);
    clientToGuacdBuffer = remainder;
    if (tunnelOnly && ws.readyState === WebSocket.OPEN) {
      ws.send(tunnelOnly, { binary: false });
    }
    if (forGuacd) {
      guacdClient?.send(forGuacd, true);
    }
  });

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearWsKeepAlive();
    clearTimeout(handshakeTimeout);
    const session = getSession(sessionId);
    if (session && !session.endedAt) {
      logAudit(user.username, "session.end", `${protocol.toUpperCase()} fermé — ${host.name}`, {
        hostId: host.id,
        hostName: host.name,
      });
    }
    endSession(sessionId);
    unregisterLiveSession(sessionId);
    guacdClient?.close();
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
