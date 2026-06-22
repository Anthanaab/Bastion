import { useEffect, useRef } from "react";
import Guacamole from "guacamole-common-js";
import { wsUrl } from "../lib/api";

/** Tunnel où le serveur effectue déjà le handshake guacd + select. */
class BastionTunnel extends Guacamole.Tunnel {
  private socket: WebSocket | null = null;
  private receiveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {
    super();
  }

  connect(_data?: string): void {
    this.setState(Guacamole.Tunnel.State.CONNECTING);
    this.socket = new WebSocket(this.url);
    this.socket.binaryType = "arraybuffer";

    this.socket.onopen = () => {
      this.setState(Guacamole.Tunnel.State.OPEN);
    };

    this.socket.onmessage = (event) => {
      if (this.receiveTimeout) {
        clearTimeout(this.receiveTimeout);
        this.receiveTimeout = null;
      }
      const data =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      if (this.oninstruction) {
        this.oninstruction(data);
      }
    };

    this.socket.onclose = () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };

    this.socket.onerror = () => {
      this.setState(Guacamole.Tunnel.State.CLOSED);
    };
  }

  sendMessage(elements: string[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const instruction = elements
      .map((el) => `${el.length}.${el}`)
      .join(",")
      .concat(";");

    this.socket.send(instruction);

    this.receiveTimeout = setTimeout(() => {
      if (this.onerror) {
        this.onerror(new Guacamole.Status(Guacamole.Status.Code.UPSTREAM_TIMEOUT));
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

  useEffect(() => {
    if (!containerRef.current) return;

    const tunnel = new BastionTunnel(wsUrl("/ws/guacd", { hostId }));
    const client = new Guacamole.Client(tunnel);
    const display = client.getDisplay();
    const element = display.getElement();

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(element);

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
      if (state === Guacamole.Client.State.CONNECTED) scale();
    };

    client.connect();

    const resizeObserver = new ResizeObserver(scale);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      client.disconnect();
    };
  }, [hostId]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center"
      />
    </div>
  );
}
