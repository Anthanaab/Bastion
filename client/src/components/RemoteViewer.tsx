import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { api, wsBaseUrl, wsConnectData } from "../lib/api";
import {
  resolveRdpResolution,
  rdpSettingsSignature,
  type RdpDisplaySettings,
} from "../lib/rdpSettings";
import type { ConnectionStatus, SessionControl } from "../lib/session";

interface RemoteViewerProps {
  hostId: string;
  protocol: "rdp" | "vnc";
  rdpSettings?: RdpDisplaySettings;
  onSessionControl?: (control: SessionControl | null) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  reconnectRef?: React.MutableRefObject<(() => void) | null>;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
}

const MAX_RECONNECT_ATTEMPTS = 12;

function reconnectDelay(attempt: number): number {
  return Math.min(2000 * Math.pow(1.4, attempt), 15000);
}

function viewportSize(container: HTMLElement): { width: number; height: number } {
  const width = Math.min(3840, Math.max(320, container.clientWidth || 1280));
  const height = Math.min(2160, Math.max(240, container.clientHeight || 720));
  return { width, height };
}

function isCoarsePointer(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    "ontouchstart" in window
  );
}

const MOUSE_EVENTS = ["mousedown", "mousemove", "mouseup"] as const;

function attachPointerInput(
  client: Guacamole.Client,
  element: HTMLElement
): { detach: () => void } {
  const handler = (event: Guacamole.Mouse.Event) => {
    element.focus({ preventScroll: true });
    client.getDisplay().showCursor(true);
    client.sendMouseState(event.state, true);
  };

  const input: Guacamole.Mouse.EventTarget = isCoarsePointer()
    ? new Guacamole.Mouse.Touchscreen(element)
    : new Guacamole.Mouse(element);

  input.onEach([...MOUSE_EVENTS], handler);

  return {
    detach: () => {
      input.offEach([...MOUSE_EVENTS], handler);
    },
  };
}

function resolveSessionResolution(
  protocol: "rdp" | "vnc",
  container: HTMLElement,
  rdpSettings?: RdpDisplaySettings
): { width: number; height: number } {
  if (protocol === "rdp" && rdpSettings) {
    return resolveRdpResolution(rdpSettings, container);
  }
  return viewportSize(container);
}

function shouldSendDynamicResize(
  protocol: "rdp" | "vnc",
  rdpSettings?: RdpDisplaySettings
): boolean {
  if (protocol === "vnc") return true;
  return !rdpSettings || rdpSettings.resolutionMode === "auto";
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
  rdpSettings,
  onSessionControl,
  onStatusChange,
  reconnectRef,
  viewportRef,
}: RemoteViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connexion au serveur…");
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [manualReconnect, setManualReconnect] = useState(false);
  const [touchUi, setTouchUi] = useState(false);
  const manualReconnectRef = useRef<(() => void) | null>(null);
  const onSessionControlRef = useRef(onSessionControl);
  const onStatusChangeRef = useRef(onStatusChange);
  onSessionControlRef.current = onSessionControl;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    setTouchUi(isCoarsePointer());
  }, []);

  useEffect(() => {
    onStatusChangeRef.current?.({
      message: status,
      error: error || undefined,
      reconnecting,
      manualReconnect,
    });
  }, [status, error, reconnecting, manualReconnect]);

  useEffect(() => {
    if (!reconnectRef) return;
    reconnectRef.current = () => manualReconnectRef.current?.();
    return () => {
      reconnectRef.current = null;
    };
  }, [reconnectRef]);

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

      const { width, height } = resolveSessionResolution(
        protocol,
        containerRef.current,
        rdpSettings
      );
      const tunnel = new Guacamole.WebSocketTunnel(wsBaseUrl("/ws/guacd"));
      tunnel.receiveTimeout = 300_000;
      tunnel.unstableThreshold = 60_000;

      const connectParams: Record<string, string> = {
        hostId,
        width: String(width),
        height: String(height),
      };
      if (protocol === "rdp" && rdpSettings) {
        connectParams.quality = rdpSettings.qualityProfile;
      }
      const connectData = wsConnectData(connectParams);

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
      element.style.touchAction = "none";
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
        if (!dw || !dh) return;

        const widthRatio = container.clientWidth / dw;
        const heightRatio = container.clientHeight / dh;
        const landscape = container.clientWidth >= container.clientHeight;
        const factor =
          isCoarsePointer() && landscape
            ? widthRatio
            : Math.min(widthRatio, heightRatio);

        display.scale(factor);
      };

      let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
      const pushDisplaySize = () => {
        if (!clientConnected) return;
        if (!shouldSendDynamicResize(protocol, rdpSettings)) return;
        const container = containerRef.current;
        if (!container) return;
        const { width, height } = resolveSessionResolution(
          protocol,
          container,
          rdpSettings
        );
        client.sendSize(width, height);
      };

      const handleViewportChange = () => {
        scale();
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
          resizeDebounce = null;
          pushDisplaySize();
          scale();
        }, 300);
      };

      const pointerInput = attachPointerInput(client, element);

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
          handleViewportChange();
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
        handleViewportChange();
      });
      resizeObserver.observe(containerRef.current);

      const onOrientationChange = () => {
        window.setTimeout(handleViewportChange, 150);
      };
      window.addEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.addEventListener("resize", handleViewportChange);

      sessionCleanup = () => {
        if (clientConnected) clearControl();
        element.removeEventListener("paste", onPaste);
        window.clearTimeout(handshakeTimeout);
        window.clearTimeout(timeout);
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeObserver.disconnect();
        window.removeEventListener("orientationchange", onOrientationChange);
        window.visualViewport?.removeEventListener("resize", handleViewportChange);
        pointerInput.detach();
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

    const startTimer = window.setTimeout(() => {
      void openSession();
    }, 0);

    return () => {
      window.clearTimeout(startTimer);
      cancelled = true;
      intentional = true;
      manualReconnectRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanupSession();
      onSessionControlRef.current?.(null);
    };
  }, [hostId, protocol, rdpSettings ? rdpSettingsSignature(rdpSettings) : ""]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden overscroll-none"
      />
      <div
        className={`pointer-events-none absolute left-3 top-3 hidden max-w-md rounded-md px-2 py-1 text-xs sm:block ${
          error
            ? "bg-red-950/90 text-red-300"
            : reconnecting
              ? "bg-amber-950/90 text-amber-200"
              : "bg-bastion-900/80 text-slate-400"
        }`}
      >
        {error || status}
      </div>
      {touchUi && !error && !manualReconnect && (
        <p className="pointer-events-none absolute bottom-2 left-0 right-0 px-3 text-center text-[10px] text-slate-500 sm:hidden">
          Touchez pour cliquer · glisser pour déplacer · appui long = clic droit
        </p>
      )}
      {manualReconnect && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 sm:pointer-events-auto">
          <button
            type="button"
            className="btn-primary pointer-events-auto min-h-[44px]"
            onClick={() => manualReconnectRef.current?.()}
          >
            Reconnecter
          </button>
        </div>
      )}
    </div>
  );
}
