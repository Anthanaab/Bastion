import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { api, wsBaseUrl, wsConnectData } from "../lib/api";
import type { SessionControl } from "../pages/SessionPage";

interface RemoteViewerProps {
  hostId: string;
  protocol: "rdp" | "vnc";
  onSessionControl?: (control: SessionControl | null) => void;
}

function viewportSize(container: HTMLElement): { width: number; height: number } {
  const width = Math.min(3840, Math.max(800, container.clientWidth || 1920));
  const height = Math.min(2160, Math.max(600, container.clientHeight || 1080));
  return { width, height };
}

export default function RemoteViewer({
  hostId,
  onSessionControl,
}: RemoteViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connexion au serveur…");
  const [error, setError] = useState("");
  const onSessionControlRef = useRef(onSessionControl);
  onSessionControlRef.current = onSessionControl;

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

      const { width, height } = viewportSize(containerRef.current);
      const tunnel = new Guacamole.WebSocketTunnel(wsBaseUrl("/ws/guacd"));
      tunnel.receiveTimeout = 90000;
      tunnel.unstableThreshold = 10000;

      const connectData = wsConnectData({
        hostId,
        width: String(width),
        height: String(height),
      });
      console.info(
        "[Bastion] WebSocket:",
        `${wsBaseUrl("/ws/guacd")}?${connectData}`
      );

      let guacdReady = false;
      let clientConnected = false;

      const publishControl = (client: Guacamole.Client) => {
        onSessionControlRef.current?.({
          connected: true,
          disconnect: () => client.disconnect(),
        });
      };

      const clearControl = () => {
        onSessionControlRef.current?.(null);
      };

      const client = new Guacamole.Client(tunnel);
      const display = client.getDisplay();
      const element = display.getElement();

      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(element);
      element.style.display = "block";
      element.style.width = "100%";
      element.style.height = "100%";

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

      client.onsync = () => {
        scale();
      };

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
          clientConnected = true;
          setStatus("Connecté");
          setError("");
          publishControl(client);
          scale();
        } else if (state === Guacamole.Client.State.DISCONNECTED && guacdReady) {
          clientConnected = false;
          clearControl();
          setStatus("Déconnecté");
        }
      };

      client.onerror = (err: Guacamole.Status) => {
        clientConnected = false;
        clearControl();
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
      }, 90000);

      const resizeObserver = new ResizeObserver(() => {
        scale();
      });
      resizeObserver.observe(containerRef.current);

      cleanup = () => {
        if (clientConnected) clearControl();
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
      onSessionControlRef.current?.(null);
      cleanup?.();
    };
  }, [hostId]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-black">
      <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
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
