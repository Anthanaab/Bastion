import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { wsUrl } from "../lib/api";

/** WebSocket tunnel compatible with guacamole-common-js (comme guacamole-lite). */
class BastionTunnel extends Guacamole.Tunnel {
  private socket: WebSocket | null = null;
  private receiveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {
    super();
  }

  connect(_data?: string): void {
    this.setState(Guacamole.Tunnel.State.CONNECTING);
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      /* OPEN est défini à la réception du premier message (ready). */
    };

    this.socket.onmessage = (event) => {
      if (this.receiveTimeout) {
        clearTimeout(this.receiveTimeout);
        this.receiveTimeout = null;
      }

      const message = event.data as string;
      let startIndex = 0;
      let elementEnd = -1;
      const elements: string[] = [];

      do {
        const lengthEnd = message.indexOf(".", startIndex);
        if (lengthEnd === -1) break;

        const length = parseInt(message.substring(elementEnd + 1, lengthEnd), 10);
        startIndex = lengthEnd + 1;
        elementEnd = startIndex + length;

        if (elementEnd > message.length) break;

        const element = message.substring(startIndex, elementEnd);
        const terminator = message.substring(elementEnd, elementEnd + 1);
        elements.push(element);

        if (terminator === ";") {
          const opcode = elements.shift() ?? "";

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

          elements.length = 0;
        }

        startIndex = elementEnd + 1;
      } while (startIndex < message.length);
    };

    this.socket.onclose = () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };

    this.socket.onerror = () => {
      if (this.onerror) {
        this.onerror(
          new Guacamole.Status(Guacamole.Status.Code.SERVER_ERROR, "WebSocket error")
        );
      }
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };
  }

  sendMessage(...elements: string[]): void {
    if (!this.isConnected() || elements.length === 0) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const instruction = elements
      .map((el) => {
        const str = String(el);
        return `${str.length}.${str}`;
      })
      .join(",")
      .concat(";");

    this.socket.send(instruction);

    this.receiveTimeout = setTimeout(() => {
      if (this.onerror) {
        this.onerror(
          new Guacamole.Status(Guacamole.Status.Code.UPSTREAM_TIMEOUT)
        );
      }
    }, 15000);
  }

  disconnect(): void {
    if (this.receiveTimeout) clearTimeout(this.receiveTimeout);
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
  const [status, setStatus] = useState("Connexion en cours…");
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
    keyboard.onkeydown = (keysym: number) => {
      client.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym: number) => {
      client.sendKeyEvent(0, keysym);
    };

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

    client.onstatechange = (state: number) => {
      if (state === Guacamole.Client.State.CONNECTED) {
        setStatus("Connecté");
        scale();
      } else if (state === Guacamole.Client.State.CONNECTING) {
        setStatus("Connexion en cours…");
      } else if (state === Guacamole.Client.State.DISCONNECTED) {
        setStatus("Déconnecté");
      }
    };

    client.onerror = (err: Guacamole.Status) => {
      setError(err.message || "Erreur de connexion distante");
    };

    client.connect("");

    const resizeObserver = new ResizeObserver(() => {
      scale();
      if (display.getWidth() && display.getHeight()) {
        client.sendSize(
          containerRef.current?.clientWidth ?? 1920,
          containerRef.current?.clientHeight ?? 1080
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
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
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-bastion-900/80 px-2 py-1 text-xs text-slate-400 backdrop-blur">
        {error || status}
      </div>
    </div>
  );
}
