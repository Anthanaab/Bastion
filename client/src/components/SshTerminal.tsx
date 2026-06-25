import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { wsUrl } from "../lib/api";
import type { SessionControl } from "../pages/SessionPage";

interface SshTerminalProps {
  hostId: string;
  onSessionControl?: (control: SessionControl | null) => void;
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

    let connected = false;
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

    const cols = term.cols;
    const rows = term.rows;
    const ws = new WebSocket(
      wsUrl("/ws/ssh", { hostId, cols: String(cols), rows: String(rows) })
    );

    ws.binaryType = "arraybuffer";

    const publishControl = () => {
      onSessionControlRef.current?.({
        connected,
        disconnect: () => ws.close(),
      });
    };

    const clearControl = () => {
      onSessionControlRef.current?.(null);
    };

    ws.onopen = () => {
      term.writeln("\x1b[38;5;214m[Bastion]\x1b[0m Connexion SSH en cours…");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as { type: string; message?: string };
          if (msg.type === "error") {
            term.writeln(`\r\n\x1b[31mErreur : ${msg.message}\x1b[0m`);
          } else if (msg.type === "connected") {
            connected = true;
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
      connected = false;
      clearControl();
      term.writeln("\r\n\x1b[33mSession terminée.\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
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

    return () => {
      clearControl();
      resizeObserver.disconnect();
      ws.close();
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
