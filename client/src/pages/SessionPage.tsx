import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import SshTerminal from "../components/SshTerminal";
import RemoteViewer from "../components/RemoteViewer";
import { ProtocolBadge } from "../components/ProtocolBadge";
import { api } from "../lib/api";
import type { SessionControl } from "../lib/session";
import type { Host } from "../types";

export default function SessionPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const [host, setHost] = useState<Host | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionControl | null>(null);
  const [clipboardMsg, setClipboardMsg] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);

  const handleSessionControl = useCallback((control: SessionControl | null) => {
    setSession(control);
  }, []);

  useEffect(() => {
    setSession(null);
  }, [hostId]);

  useEffect(() => {
    if (!hostId) return;
    api
      .host(hostId)
      .then(setHost)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hostId]);

  const handlePasteClipboard = async () => {
    if (!session?.rdp) return;
    setClipboardMsg("");
    try {
      await session.rdp.pasteClipboard();
      setClipboardMsg("Presse-papiers envoyé");
      setTimeout(() => setClipboardMsg(""), 2500);
    } catch {
      setClipboardMsg("Accès presse-papiers refusé");
      setTimeout(() => setClipboardMsg(""), 2500);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-bastion-accent border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error || !host) {
    return (
      <Layout>
        <div className="glass-card p-8 text-center">
          <p className="text-red-400">{error || "Hôte introuvable"}</p>
          <Link to="/" className="btn-primary mt-4 inline-flex">
            Retour
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bastion-950">
      <header className="flex shrink-0 items-center justify-between border-b border-bastion-800 bg-bastion-950/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Link to="/" className="btn-secondary py-2 text-xs">
            ← Retour
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: host.color }}
            />
            <div>
              <h1 className="text-sm font-semibold text-white">{host.name}</h1>
              <p className="font-mono text-xs text-slate-500">
                {host.hostname}:{host.port}
              </p>
            </div>
            <ProtocolBadge protocol={host.protocol} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session?.connected && session.rdp && (
            <>
              <button
                type="button"
                onClick={() => session.rdp!.toggleFullscreen()}
                className="btn-secondary hidden py-2 text-xs sm:inline-flex"
                title="Plein écran"
              >
                Plein écran
              </button>
              <button
                type="button"
                onClick={() => session.rdp!.sendCtrlAltDel()}
                className="btn-secondary hidden py-2 text-xs sm:inline-flex"
                title="Ctrl+Alt+Suppr"
              >
                Ctrl+Alt+Suppr
              </button>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="btn-secondary hidden py-2 text-xs sm:inline-flex"
                title="Coller le presse-papiers local vers le bureau distant"
              >
                Coller
              </button>
            </>
          )}

          {session?.connected ? (
            <>
              <span className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                Connecté
              </span>
              <button
                type="button"
                onClick={() => session.disconnect()}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
              >
                Déconnecter
              </button>
            </>
          ) : (
            <span className="text-xs text-slate-500">
              Session {host.protocol.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {clipboardMsg && (
        <div className="shrink-0 border-b border-bastion-800 bg-bastion-900/80 px-4 py-1.5 text-center text-xs text-bastion-glow">
          {clipboardMsg}
        </div>
      )}

      <div ref={viewportRef} className="min-h-0 flex-1 p-3">
        {host.protocol === "ssh" ? (
          <SshTerminal hostId={host.id} onSessionControl={handleSessionControl} />
        ) : (
          <RemoteViewer
            hostId={host.id}
            protocol={host.protocol}
            onSessionControl={handleSessionControl}
            viewportRef={viewportRef}
          />
        )}
      </div>
    </div>
  );
}
