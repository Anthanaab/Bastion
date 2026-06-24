import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { api, wsBaseUrl, wsConnectData } from "../lib/api";

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

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const start = async () => {
      try {
        const ping = await api.sessionPing(hostId);
        if (cancelled) return;
        setStatus(`Serveur OK (v${ping.version}) — connexion WebSocket…`);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de joindre l'API Bastion"
        );
        return;
      }

      if (cancelled || !containerRef.current) return;

      const tunnel = new Guacamole.WebSocketTunnel(wsBaseUrl("/ws/guacd"));
      const connectData = wsConnectData({ hostId });
      console.info(
        "[Bastion] WebSocket:",
        `${wsBaseUrl("/ws/guacd")}?${connectData}`
      );

      let guacdReady = false;
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
          setStatus("Connexion WebSocket…");
        } else if (state === Guacamole.Tunnel.State.OPEN) {
          guacdReady = true;
          setStatus("Ouverture du bureau distant…");
        }
      };

      client.onstatechange = (state: number) => {
        if (state === Guacamole.Client.State.CONNECTED) {
          setStatus("Connecté");
          setError("");
          const container = containerRef.current;
          if (container) {
            client.sendSize(container.clientWidth, container.clientHeight);
          }
          scale();
        } else if (state === Guacamole.Client.State.DISCONNECTED && guacdReady) {
          setStatus("Déconnecté");
        }
      };

      client.onerror = (err: Guacamole.Status) => {
        setError(err.message || "Erreur de connexion distante");
      };

      client.connect(connectData);

      const handshakeTimeout = window.setTimeout(() => {
        if (!guacdReady) {
          setError(
            "Handshake guacd expiré — vérifiez docker logs bastion et identifiants RDP"
          );
        }
      }, 15000);

      const timeout = window.setTimeout(() => {
        if (client.getDisplay().getWidth() === 0) {
          setError(
            "Délai dépassé — identifiants RDP ou pare-feu Windows à vérifier"
          );
        }
      }, 45000);

      const resizeObserver = new ResizeObserver(() => {
        scale();
        const container = containerRef.current;
        if (container && display.getWidth()) {
          client.sendSize(container.clientWidth, container.clientHeight);
        }
      });
      resizeObserver.observe(containerRef.current);

      cleanup = () => {
        window.clearTimeout(handshakeTimeout);
        window.clearTimeout(timeout);
        resizeObserver.disconnect();
        keyboard.onkeydown = keyboard.onkeyup = null;
        client.disconnect();
      };
    };

    start();

    return () => {
      cancelled = true;
      cleanup?.();
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
