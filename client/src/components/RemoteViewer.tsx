import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { api, wsBaseUrl, wsConnectData } from "../lib/api";
import type { SessionControl } from "../lib/session";

interface RemoteViewerProps {
  hostId: string;
  protocol: "rdp" | "vnc";
  onSessionControl?: (control: SessionControl | null) => void;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
}

const MAX_RECONNECT_ATTEMPTS = 12;

function reconnectDelay(attempt: number): number {
  return Math.min(2000 * Math.pow(1.4, attempt), 15000);
}

function viewportSize(container: HTMLElement): { width: number; height: number } {
  const width = Math.min(3840, Math.max(800, container.clientWidth || 1920));
  const height = Math.min(2160, Math.max(600, container.clientHeight || 1080));
  return { width, height };
}

const CTRL_KEYSYM = 0xffe3;
const ALT_KEYSYM = 0xffe9;
const DEL_KEYSYM = 0xffff;

function sendCtrlAltDel(client: Guacamole.Client): void {
  const keys = [CTRL_KEYSYM, ALT_KEYSYM, DEL_KEYSYM];
  for (const keysym of keys) client.sendKeyEvent(1, keysym);
  for (const keysym of [...keys].reverse()) client.sendKeyEvent(0, keysym);
}

function sendTextToRemote(client: Guacamole.Client, text: string): void {
  if (!text) return;
  const stream = client.createClipboardStream("text/plain");
  const writer = new Guacamole.StringWriter(stream);
  writer.sendText(text);
  writer.sendEnd();
}

async function pasteClipboard(client: Guacamole.Client): Promise<void> {
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard API indisponible");
  }
  const text = await navigator.clipboard.readText();
  if (!text) throw new Error("Presse-papiers vide");
  sendTextToRemote(client, text);
}

function copyToLocalClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {
      copyToLocalClipboardFallback(text);
    });
    return;
  }
  copyToLocalClipboardFallback(text);
}

function copyToLocalClipboardFallback(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function RemoteViewer({
  hostId,
  protocol,
  onSessionControl,
  viewportRef,
}: RemoteViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connexion au serveur…");
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [manualReconnect, setManualReconnect] = useState(false);
  const manualReconnectRef = useRef<(() => void) | null>(null);
  const onSessionControlRef = useRef(onSessionControl);
  onSessionControlRef.current = onSessionControl;

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let intentional = false;
    let sessionCleanup: (() => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const cleanupSession = () => {
      sessionCleanup?.();
      sessionCleanup = null;
    };

    const scheduleReconnect = (reason: string) => {
      if (cancelled || intentional) return;
      cleanupSession();
      onSessionControlRef.current?.(null);

      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setReconnecting(false);
        setManualReconnect(true);
        setError(`${reason} — reconnexion automatique abandonnée`);
        return;
      }

      const delay = reconnectDelay(attempt);
      attempt += 1;
      setReconnecting(true);
      setManualReconnect(false);
      setError("");
      setStatus(
        `Reconnexion dans ${Math.ceil(delay / 1000)}s… (${attempt}/${MAX_RECONNECT_ATTEMPTS})`
      );

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void openSession();
      }, delay);
    };

    const openSession = async () => {
      if (attempt === 0) {
        try {
          const ping = await api.sessionPing(hostId);
          if (cancelled) return;
          setStatus(`Serveur OK (v${ping.version}) — connexion WebSocket…`);
        } catch (err) {
          if (cancelled) return;
          scheduleReconnect(
            err instanceof Error ? err.message : "Impossible de joindre l'API Bastion"
          );
          return;
        }
      } else {
        setStatus("Reconnexion WebSocket…");
      }

      if (cancelled || !containerRef.current) return;

      const { width, height } = viewportSize(containerRef.current);
      const tunnel = new Guacamole.WebSocketTunnel(wsBaseUrl("/ws/guacd"));
      tunnel.receiveTimeout = 300_000;
      tunnel.unstableThreshold = 60_000;

      const connectData = wsConnectData({
        hostId,
        width: String(width),
        height: String(height),
      });

      let guacdReady = false;
      let clientConnected = false;

      const client = new Guacamole.Client(tunnel);
      const display = client.getDisplay();
      const element = display.getElement();

      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(element);
      element.style.display = "block";
      element.style.width = "100%";
      element.style.height = "100%";
      element.tabIndex = 0;

      const onPaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text) {
          event.preventDefault();
          sendTextToRemote(client, text);
        }
      };
      element.addEventListener("paste", onPaste);

      const publishControl = () => {
        const control: SessionControl = {
          connected: true,
          disconnect: () => {
            intentional = true;
            client.disconnect();
          },
          reconnect: () => manualReconnectRef.current?.(),
        };

        if (protocol === "rdp") {
          control.rdp = {
            toggleFullscreen: () => {
              const target = viewportRef?.current ?? containerRef.current;
              if (!target) return;
              if (!document.fullscreenElement) {
                void target.requestFullscreen();
              } else {
                void document.exitFullscreen();
              }
            },
            sendCtrlAltDel: () => sendCtrlAltDel(client),
            pasteClipboard: () => pasteClipboard(client),
            pasteText: (text: string) => sendTextToRemote(client, text),
          };
        }

        onSessionControlRef.current?.(control);
      };

      const clearControl = () => {
        onSessionControlRef.current?.(null);
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

      client.onsync = () => {
        scale();
      };

      if (protocol === "rdp") {
        client.onclipboard = (stream, mimetype) => {
          if (!mimetype.startsWith("text/")) return;
          const reader = new Guacamole.StringReader(stream);
          let data = "";
          reader.ontext = (text: string) => {
            data += text;
          };
          reader.onend = () => {
            if (data) copyToLocalClipboard(data);
          };
        };
      }

      const mouse = new Guacamole.Mouse(element);
      mouse.onmousedown =
        mouse.onmouseup =
        mouse.onmousemove =
          (mouseState: Guacamole.Mouse.State) => {
            element.focus({ preventScroll: true });
            client.sendMouseState(mouseState, true);
          };

      const keyboard = new Guacamole.Keyboard(element);
      keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
      keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

      element.addEventListener("mousedown", () => {
        element.focus({ preventScroll: true });
      });

      tunnel.onstatechange = (state: number) => {
        if (state === Guacamole.Tunnel.State.CONNECTING) {
          setStatus(attempt > 0 ? "Reconnexion WebSocket…" : "Connexion WebSocket…");
        } else if (state === Guacamole.Tunnel.State.OPEN) {
          guacdReady = true;
          setStatus("Ouverture du bureau distant…");
        } else if (state === Guacamole.Tunnel.State.UNSTABLE) {
          setStatus("Connexion instable — reprise…");
        } else if (state === Guacamole.Tunnel.State.CLOSED && clientConnected) {
          clientConnected = false;
          clearControl();
          scheduleReconnect("Session fermée");
        }
      };

      tunnel.onerror = (tunnelStatus: Guacamole.Status) => {
        clientConnected = false;
        clearControl();
        if (tunnelStatus.code === Guacamole.Status.Code.UPSTREAM_TIMEOUT) {
          scheduleReconnect("Session expirée après inactivité");
          return;
        }
        scheduleReconnect(
          tunnelStatus.message || "Connexion WebSocket interrompue"
        );
      };

      client.onstatechange = (state: number) => {
        if (state === Guacamole.Client.State.CONNECTED) {
          clientConnected = true;
          attempt = 0;
          setReconnecting(false);
          setManualReconnect(false);
          setStatus("Connecté");
          setError("");
          publishControl();
          scale();
        } else if (state === Guacamole.Client.State.DISCONNECTED && guacdReady) {
          clientConnected = false;
          clearControl();
          scheduleReconnect("Déconnecté");
        }
      };

      client.onerror = (err: Guacamole.Status) => {
        clientConnected = false;
        clearControl();
        scheduleReconnect(err.message || "Erreur de connexion distante");
      };

      client.connect(connectData);

      const handshakeTimeout = window.setTimeout(() => {
        if (!guacdReady && !cancelled) {
          scheduleReconnect(
            "Handshake guacd expiré — vérifiez docker logs bastion et identifiants RDP"
          );
        }
      }, 15000);

      const timeout = window.setTimeout(() => {
        if (!clientConnected && client.getDisplay().getWidth() === 0 && !cancelled) {
          scheduleReconnect(
            "Délai dépassé — identifiants RDP ou pare-feu Windows à vérifier"
          );
        }
      }, 90000);

      const resizeObserver = new ResizeObserver(() => {
        scale();
      });
      resizeObserver.observe(containerRef.current);

      sessionCleanup = () => {
        if (clientConnected) clearControl();
        element.removeEventListener("paste", onPaste);
        window.clearTimeout(handshakeTimeout);
        window.clearTimeout(timeout);
        resizeObserver.disconnect();
        keyboard.onkeydown = keyboard.onkeyup = null;
        client.disconnect();
      };
    };

    manualReconnectRef.current = () => {
      attempt = 0;
      intentional = false;
      setManualReconnect(false);
      setError("");
      setReconnecting(true);
      cleanupSession();
      void openSession();
    };

    void openSession();

    return () => {
      cancelled = true;
      intentional = true;
      manualReconnectRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanupSession();
      onSessionControlRef.current?.(null);
    };
  }, [hostId, protocol]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-black">
      <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
      <div
        className={`pointer-events-none absolute left-3 top-3 max-w-md rounded-md px-2 py-1 text-xs backdrop-blur ${
          error
            ? "bg-red-950/90 text-red-300"
            : reconnecting
              ? "bg-amber-950/90 text-amber-200"
              : "bg-bastion-900/80 text-slate-400"
        }`}
      >
        {error || status}
      </div>
      {manualReconnect && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <button
            type="button"
            className="btn-primary pointer-events-auto"
            onClick={() => manualReconnectRef.current?.()}
          >
            Reconnecter
          </button>
        </div>
      )}
    </div>
  );
}
