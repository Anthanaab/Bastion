import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { wsUrl } from "../lib/api";

function getElement(value: string): string {
  return `${value.length}.${value}`;
}

function parseInstructionMessage(
  message: string,
  onInstruction: (opcode: string, elements: string[]) => void
): void {
  let startIndex = 0;
  let elementEnd: number | undefined;
  const elements: string[] = [];

  do {
    const lengthEnd = message.indexOf(".", startIndex);
    if (lengthEnd === -1) return;

    const length = parseInt(
      message.substring((elementEnd ?? -1) + 1, lengthEnd),
      10
    );
    startIndex = lengthEnd + 1;
    elementEnd = startIndex + length;

    if (elementEnd > message.length) return;

    const element = message.substring(startIndex, elementEnd);
    const terminator = message.substring(elementEnd, elementEnd + 1);
    elements.push(element);

    if (terminator === ";") {
      const opcode = elements.shift() ?? "";
      onInstruction(opcode, [...elements]);
      elements.length = 0;
    } else if (terminator !== ",") {
      return;
    }

    startIndex = elementEnd + 1;
  } while (startIndex < message.length);
}

/** Tunnel WebSocket compatible guacamole-common-js (modèle guacamole-lite). */
class BastionTunnel extends Guacamole.Tunnel {
  private socket: WebSocket | null = null;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {
    super();
  }

  connect(_data?: string): void {
    this.setState(Guacamole.Tunnel.State.CONNECTING);
    this.socket = new WebSocket(this.url);

    this.socket.onmessage = (event) => {
      if (this.activityTimer) {
        clearTimeout(this.activityTimer);
        this.activityTimer = null;
      }

      const message =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);

      parseInstructionMessage(message, (opcode, elements) => {
        if (this.uuid === null) {
          if (
            opcode === Guacamole.Tunnel.INTERNAL_DATA_OPCODE &&
            elements.length === 1
          ) {
            this.setUUID(elements[0]);
          }
          this.setState(Guacamole.Tunnel.State.OPEN);
        }

        if (
          opcode !== Guacamole.Tunnel.INTERNAL_DATA_OPCODE &&
          this.oninstruction
        ) {
          this.oninstruction(opcode, elements);
        }
      });
    };

    this.socket.onclose = (event) => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
      if (event.code !== 1000) {
        this.onerror?.(
          new Guacamole.Status(
            Guacamole.Status.Code.SERVER_ERROR,
            `WebSocket fermé (code ${event.code})`
          )
        );
      }
    };

    this.socket.onerror = () => {
      this.onerror?.(
        new Guacamole.Status(
          Guacamole.Status.Code.SERVER_ERROR,
          "WebSocket impossible — si vous utilisez un reverse proxy, activez le support WebSocket"
        )
      );
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };
  }

  sendMessage(...elements: string[]): void {
    if (!this.isConnected() || elements.length === 0) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    let instruction = getElement(elements[0]);
    for (let i = 1; i < elements.length; i++) {
      instruction += "," + getElement(elements[i]);
    }
    instruction += ";";

    this.socket.send(instruction);

    this.activityTimer = setTimeout(() => {
      this.onerror?.(
        new Guacamole.Status(Guacamole.Status.Code.UPSTREAM_TIMEOUT)
      );
    }, this.receiveTimeout || 15000);
  }

  disconnect(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.socket?.close();
    this.socket = null;
    this.setState(Guacamole.Tunnel.State.CLOSED);
  }
}

interface RemoteViewerProps {
  hostId: string;
  protocol: "rdp" | "vnc";
}

export default function RemoteViewer({ hostId }: RemoteViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connexion au serveur…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!containerRef.current) return;

    const tunnel = new BastionTunnel(wsUrl("/ws/guacd", { hostId }));
    const client = new Guacamole.Client(tunnel);
    const display = client.getDisplay();
    const element = display.getElement();

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(element);

    const mouse = new Guacamole.Mouse(element);
    mouse.onmousedown =
      mouse.onmouseup =
      mouse.onmousemove =
        (mouseState: Guacamole.Mouse.State) => {
          client.sendMouseState(mouseState, true);
        };

    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    const scale = () => {
      const container = containerRef.current;
      if (!container) return;
      const dw = display.getWidth();
      const dh = display.getHeight();
      if (dw && dh) {
        display.scale(
          Math.min(container.clientWidth / dw, container.clientHeight / dh)
        );
      }
    };

    tunnel.onstatechange = (state: number) => {
      if (state === Guacamole.Tunnel.State.CONNECTING) {
        setStatus("Connexion au serveur…");
      } else if (state === Guacamole.Tunnel.State.OPEN) {
        setStatus("Ouverture du bureau distant…");
      }
    };

    client.onstatechange = (state: number) => {
      if (state === Guacamole.Client.State.CONNECTED) {
        setStatus("Connecté");
        setError("");
        scale();
      } else if (state === Guacamole.Client.State.WAITING) {
        setStatus("Ouverture du bureau distant…");
      } else if (state === Guacamole.Client.State.DISCONNECTED) {
        setStatus("Déconnecté");
      }
    };

    client.onerror = (err: Guacamole.Status) => {
      setError(err.message || "Erreur de connexion distante");
    };

    client.connect("");

    const timeout = window.setTimeout(() => {
      if (client.getDisplay().getWidth() === 0) {
        setError(
          "Délai dépassé — vérifiez IP/port, identifiants, et que guacd tourne"
        );
      }
    }, 30000);

    const resizeObserver = new ResizeObserver(() => {
      scale();
      const container = containerRef.current;
      if (container && display.getWidth()) {
        client.sendSize(container.clientWidth, container.clientHeight);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      window.clearTimeout(timeout);
      resizeObserver.disconnect();
      keyboard.onkeydown = keyboard.onkeyup = null;
      client.disconnect();
    };
  }, [hostId]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center"
      />
      <div
        className={`pointer-events-none absolute left-3 top-3 max-w-md rounded-md px-2 py-1 text-xs backdrop-blur ${
          error
            ? "bg-red-950/90 text-red-300"
            : "bg-bastion-900/80 text-slate-400"
        }`}
      >
        {error || status}
      </div>
    </div>
  );
}
