import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { wsUrl } from "../lib/api";
import type { SessionControl } from "../lib/session";

interface SshTerminalProps {
  hostId: string;
  onSessionControl?: (control: SessionControl | null) => void;
}

const MAX_RECONNECT_ATTEMPTS = 12;

function reconnectDelay(attempt: number): number {
  return Math.min(2000 * Math.pow(1.4, attempt), 15000);
}

export default function SshTerminal({
  hostId,
  onSessionControl,
}: SshTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onSessionControlRef = useRef(onSessionControl);
  onSessionControlRef.current = onSessionControl;

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let intentional = false;
    let connected = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 14,
      theme: {
        background: "#0a0e17",
        foreground: "#e2e8f0",
        cursor: "#f59e0b",
        selectionBackground: "#f59e0b33",
        black: "#1e293b",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#f1f5f9",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    let reconnectFn: (() => void) | null = null;

    const publishControl = () => {
      onSessionControlRef.current?.({
        connected,
        disconnect: () => {
          intentional = true;
          ws?.close();
        },
        reconnect: reconnectFn ?? undefined,
        status: connected ? "Connecté" : undefined,
      });
    };

    const clearControl = () => {
      onSessionControlRef.current?.(null);
    };

    const closeWs = () => {
      if (!ws) return;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    };

    const scheduleReconnect = (reason: string) => {
      if (cancelled || intentional) return;
      connected = false;
      clearControl();
      closeWs();

      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        term.writeln(
          `\r\n\x1b[31m${reason} — reconnexion automatique abandonnée.\x1b[0m`
        );
        term.writeln("\x1b[33mRechargez la page pour réessayer.\x1b[0m");
        return;
      }

      const delay = reconnectDelay(attempt);
      attempt += 1;
      term.writeln(
        `\r\n\x1b[33m${reason} — reconnexion dans ${Math.ceil(delay / 1000)}s (${attempt}/${MAX_RECONNECT_ATTEMPTS})…\x1b[0m`
      );

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openConnection();
      }, delay);
    };

    const manualReconnect = () => {
      attempt = 0;
      intentional = false;
      closeWs();
      openConnection();
    };
    reconnectFn = manualReconnect;

    const openConnection = () => {
      if (cancelled || intentional) return;

      const cols = term.cols;
      const rows = term.rows;
      ws = new WebSocket(
        wsUrl("/ws/ssh", { hostId, cols: String(cols), rows: String(rows) })
      );
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        term.writeln("\x1b[38;5;214m[Bastion]\x1b[0m Connexion SSH en cours…");
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as { type: string; message?: string };
            if (msg.type === "error") {
              term.writeln(`\r\n\x1b[31mErreur : ${msg.message}\x1b[0m`);
              scheduleReconnect(msg.message || "Erreur SSH");
            } else if (msg.type === "connected") {
              connected = true;
              attempt = 0;
              publishControl();
              term.writeln("\x1b[32mConnecté.\x1b[0m\r\n");
            }
          } catch {
            term.write(event.data);
          }
        } else {
          term.write(new Uint8Array(event.data as ArrayBuffer));
        }
      };

      ws.onclose = () => {
        if (intentional || cancelled) {
          connected = false;
          clearControl();
          term.writeln("\r\n\x1b[33mSession terminée.\x1b[0m");
          return;
        }
        scheduleReconnect("Connexion SSH interrompue");
      };

      ws.onerror = () => {
        if (!intentional && !cancelled) {
          scheduleReconnect("Erreur réseau SSH");
        }
      };
    };

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          })
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    openConnection();

    return () => {
      cancelled = true;
      intentional = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearControl();
      closeWs();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [hostId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden rounded-lg border border-bastion-700 bg-bastion-950 p-2"
    />
  );
}
