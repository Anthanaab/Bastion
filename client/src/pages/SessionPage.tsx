import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import SshTerminal from "../components/SshTerminal";
import RemoteViewer from "../components/RemoteViewer";
import { ProtocolBadge } from "../components/ProtocolBadge";
import { api } from "../lib/api";
import type { Host } from "../types";

export default function SessionPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const [host, setHost] = useState<Host | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hostId) return;
    api
      .host(hostId)
      .then(setHost)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hostId]);

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
          <Link
            to="/"
            className="btn-secondary py-2 text-xs"
          >
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
        <div className="hidden text-xs text-slate-500 sm:block">
          Session {host.protocol.toUpperCase()}
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3">
        {host.protocol === "ssh" ? (
          <SshTerminal hostId={host.id} />
        ) : (
          <RemoteViewer hostId={host.id} protocol={host.protocol} />
        )}
      </div>
    </div>
  );
}
