import net from "net";
import { WebSocket } from "ws";
import { getHost, createSession, endSession } from "../db";
import { wsAuthFromUrl } from "../auth";
import { GuacamoleParser, toInstruction } from "./guacamole-parser";

const STATE_OPENING = 0;
const STATE_OPEN = 1;
const STATE_CLOSED = 2;

interface ConnectionSettings {
  [key: string]: string | string[] | null | undefined;
}

function buildSettings(
  protocol: "rdp" | "vnc",
  host: NonNullable<ReturnType<typeof getHost>>
): ConnectionSettings {
  const base: ConnectionSettings = {
    hostname: host.hostname,
    port: String(host.port),
    width: "1920",
    height: "1080",
    dpi: "96",
    audio: ["audio/L16"],
    video: null,
    image: ["image/png", "image/jpeg"],
    timezone: "Europe/Paris",
  };

  if (host.username) base.username = host.username;
  if (host.password) base.password = host.password;

  if (protocol === "rdp") {
    base.security = "any";
    base["ignore-cert"] = "true";
    base["enable-wallpaper"] = "false";
    base["enable-font-smoothing"] = "true";
    base["resize-method"] = "display-update";
  } else {
    base["color-depth"] = "24";
    base.cursor = "remote";
  }

  return base;
}

function sendInstruction(
  socket: net.Socket,
  instruction: (string | number | string[] | null | undefined)[]
): void {
  socket.write(toInstruction(instruction));
}

function sendHandshakeReply(
  socket: net.Socket,
  serverArgs: string[],
  settings: ConnectionSettings
): void {
  let protocolVersion = "1_0_0";
  const connectArgs: string[] = [];

  for (const argName of serverArgs) {
    if (argName.startsWith("VERSION_")) {
      const version = argName.substring(8);
      protocolVersion = version === "1_0_0" || version === "1_1_0" ? version : "1_1_0";
      connectArgs.push(`VERSION_${protocolVersion}`);
    } else {
      const value = settings[argName];
      if (Array.isArray(value)) connectArgs.push(value.join(","));
      else connectArgs.push(value ?? "");
    }
  }

  sendInstruction(socket, ["size", settings.width, settings.height, settings.dpi]);

  const audio = settings.audio;
  sendInstruction(
    socket,
    Array.isArray(audio) ? ["audio", ...audio] : ["audio"]
  );

  const video = settings.video;
  if (Array.isArray(video) && video.length) {
    sendInstruction(socket, ["video", ...video]);
  } else {
    sendInstruction(socket, ["video"]);
  }

  const image = settings.image;
  sendInstruction(
    socket,
    Array.isArray(image) ? ["image", ...image] : ["image"]
  );

  if (protocolVersion === "1_1_0") {
    const tz = settings.timezone;
    sendInstruction(
      socket,
      tz ? ["timezone", tz] : ["timezone"]
    );
  }

  sendInstruction(socket, ["connect", ...connectArgs]);
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

  const protocol = host.protocol;
  const settings = buildSettings(protocol, host);
  const sessionId = createSession(hostId, protocol);

  let state = STATE_OPENING;
  let sendBuffer = "";
  const parser = new GuacamoleParser();

  const guacdSocket = net.createConnection(guacdPort, guacdHost);

  const sendToClient = (data: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  const sendToGuacd = (data: string, afterOpened = false) => {
    if (state === STATE_CLOSED) return;
    if (afterOpened && state === STATE_OPENING) {
      sendBuffer += data;
      return;
    }
    if (guacdSocket.writable) guacdSocket.write(data);
  };

  guacdSocket.on("connect", () => {
    sendInstruction(guacdSocket, ["select", protocol]);
  });

  parser.oninstruction = (opcode, instrParams) => {
    if (opcode === "args") {
      sendHandshakeReply(guacdSocket, instrParams, settings);
      return;
    }

    if (opcode === "ready") {
      const connectionId = instrParams[0];
      state = STATE_OPEN;
      sendToClient(toInstruction(["", connectionId]));
      if (sendBuffer) {
        sendToGuacd(sendBuffer);
        sendBuffer = "";
      }
      return;
    }

    if (opcode === "error") {
      console.error("[Guacd] error:", instrParams.join(", "));
    }

    sendToClient(toInstruction([opcode, ...instrParams]));
  };

  guacdSocket.on("data", (chunk) => {
    parser.receive(chunk.toString("utf8"));
  });

  ws.on("message", (data) => {
    const message =
      typeof data === "string" ? data : (data as Buffer).toString("utf8");
    sendToGuacd(message, true);
  });

  guacdSocket.on("error", (err) => {
    console.error("[Guacd]", err.message);
    sendToClient(toInstruction(["error", err.message, "769"]));
    ws.close(4005, "guacd indisponible");
  });

  const cleanup = () => {
    state = STATE_CLOSED;
    endSession(sessionId);
    guacdSocket.destroy();
  };

  ws.on("close", cleanup);
  guacdSocket.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
}
