import net from "net";
import { EventEmitter } from "events";
import { GuacamoleParser, toInstruction } from "./guacamole-parser";

export interface GuacdOptions {
  host: string;
  port: number;
}

export type ConnectionSettings = Record<
  string,
  string | string[] | number | null | undefined
>;

const STATE_OPENING = 0;
const STATE_OPEN = 1;
const STATE_CLOSED = 2;

export class GuacdClient extends EventEmitter {
  private state = STATE_OPENING;
  private sendBuffer = "";
  private guacamoleConnectionId: string | null = null;
  private readonly socket: net.Socket;
  private readonly parser = new GuacamoleParser();

  constructor(
    private readonly guacdOptions: GuacdOptions,
    private readonly connectionSelector: string,
    private readonly connectionSettings: ConnectionSettings
  ) {
    super();

    this.parser.oninstruction = (opcode, params) => {
      this.processInstruction(opcode, params);
    };

    this.socket = net.createConnection(
      guacdOptions.port,
      guacdOptions.host
    );

    this.socket.on("connect", () => {
      this.sendInstruction(["select", this.connectionSelector]);
    });

    this.socket.on("data", (chunk) => {
      this.parser.receive(chunk.toString("utf8"));
    });

    this.socket.on("error", (err: Error) => {
      this.emit("error", err);
      this.close(err);
    });

    this.socket.on("close", (hadError: boolean) => {
      this.close(
        hadError ? new Error("Connexion guacd fermée") : undefined
      );
    });
  }

  getConnectionId(): string | null {
    return this.guacamoleConnectionId;
  }

  isOpen(): boolean {
    return this.state === STATE_OPEN;
  }

  send(data: string, queueUntilOpen = false): void {
    if (this.state === STATE_CLOSED) return;

    if (queueUntilOpen && this.state === STATE_OPENING) {
      this.sendBuffer += data;
      return;
    }

    if (this.socket.writable) {
      this.socket.write(data);
    }
  }

  close(error?: Error): void {
    if (this.state === STATE_CLOSED) return;

    this.state = STATE_CLOSED;

    if (error) this.emit("error", error);

    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }

    this.emit("close", error);
  }

  private processInstruction(opcode: string, params: string[]): void {
    if (opcode === "args") {
      this.sendHandshakeReply(params);
      return;
    }

    if (opcode === "ready") {
      this.guacamoleConnectionId = params[0] ?? null;
      this.state = STATE_OPEN;
      this.emit("open", this.guacamoleConnectionId);

      if (this.sendBuffer) {
        this.send(this.sendBuffer);
        this.sendBuffer = "";
      }

      this.emit("data", toInstruction(["", this.guacamoleConnectionId ?? ""]));
      return;
    }

    this.emit("data", toInstruction([opcode, ...params]));
  }

  private sendInstruction(
    instruction: (string | number | string[] | null | undefined)[]
  ): void {
    this.send(toInstruction(instruction));
  }

  private resolveSetting(argName: string): string {
    if (argName.startsWith("VERSION_")) return "";

    const keys = [
      argName,
      argName.replace(/-/g, "_"),
      argName.replace(/_/g, "-"),
    ];

    for (const key of keys) {
      const value = this.connectionSettings[key];
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) return value.join(",");
      return String(value);
    }

    return "";
  }

  private sendHandshakeReply(serverArgs: string[]): void {
    const gfxDisabled = this.resolveSetting("disable-gfx") === "true";
    let negotiatedVersion = "1_0_0";
    for (const argName of serverArgs) {
      if (!argName.startsWith("VERSION_")) continue;
      const version = argName.substring(8);
      if (version === "1_5_0" && !gfxDisabled) negotiatedVersion = "1_5_0";
      else if (version === "1_1_0" && negotiatedVersion !== "1_5_0") {
        negotiatedVersion = "1_1_0";
      }
    }

    const connectArgs: string[] = [];

    for (const argName of serverArgs) {
      if (argName.startsWith("VERSION_")) {
        connectArgs.push(`VERSION_${negotiatedVersion}`);
      } else {
        connectArgs.push(this.resolveSetting(argName));
      }
    }

    const width = this.connectionSettings.width ?? "1920";
    const height = this.connectionSettings.height ?? "1080";
    const dpi = this.connectionSettings.dpi ?? "96";

    this.sendInstruction(["size", width, height, dpi]);

    const audio = this.connectionSettings.audio;
    this.sendInstruction(
      Array.isArray(audio) ? ["audio", ...audio] : ["audio"]
    );

    this.sendInstruction(["video"]);

    const image = this.connectionSettings.image;
    this.sendInstruction(
      Array.isArray(image) ? ["image", ...image] : ["image"]
    );

    if (negotiatedVersion === "1_1_0" || negotiatedVersion === "1_5_0") {
      const tz = this.connectionSettings.timezone;
      this.sendInstruction(tz ? ["timezone", tz] : ["timezone"]);
    }

    console.log(`[Guacd] Protocol VERSION_${negotiatedVersion}`);

    this.sendInstruction(["connect", ...connectArgs]);
  }
}
