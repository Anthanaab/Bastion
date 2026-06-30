import { useState } from "react";
import { Link } from "react-router-dom";
import type { Host } from "../types";
import { api } from "../lib/api";
import InlineAlert from "./InlineAlert";
import { ProtocolBadge, protocolIcon } from "./ProtocolBadge";

interface HostCardProps {
  host: Host;
  online?: boolean | null;
  pinned?: boolean;
  onTogglePin?: () => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
  canManage?: boolean;
  onTagClick?: (tag: string) => void;
}

export default function HostCard({
  host,
  online = null,
  pinned = false,
  onTogglePin,
  onEdit,
  onDelete,
  canManage = true,
  onTagClick,
}: HostCardProps) {
  const [waking, setWaking] = useState(false);
  const [wakeFeedback, setWakeFeedback] = useState<{
    text: string;
    variant: "success" | "error" | "info";
  } | null>(null);
  const [readyToConnect, setReadyToConnect] = useState(false);

  const tags = host.tags
    ? host.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const handleWake = async () => {
    setWaking(true);
    setWakeFeedback(null);
    setReadyToConnect(false);
    try {
      const result = await api.wakeHost(host.id, true);
      if (result.online) {
        setWakeFeedback({
          text: "Machine en ligne — vous pouvez vous connecter",
          variant: "success",
        });
        setReadyToConnect(true);
      } else {
        setWakeFeedback({
          text: result.hint
            ? `Paquet envoyé. ${result.hint}`
            : "Démarrage en cours — la machine n'est pas encore en ligne",
          variant: "info",
        });
      }
      setTimeout(() => setWakeFeedback(null), 12000);
    } catch (err) {
      setWakeFeedback({
        text: err instanceof Error ? err.message : "Échec WoL",
        variant: "error",
      });
    } finally {
      setWaking(false);
    }
  };

  return (
    <article
      className="glass-card group animate-slide-up overflow-hidden transition hover:border-bastion-accent/30 hover:shadow-glow"
      style={{ borderLeftWidth: 3, borderLeftColor: host.color }}
    >
      <div className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-lg text-lg"
              style={{ backgroundColor: `${host.color}20`, color: host.color }}
            >
              {protocolIcon(host.protocol)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{host.name}</h3>
                {online !== null && (
                  <span
                    className={`h-2 w-2 rounded-full ${
                      online ? "bg-emerald-400" : "bg-red-500"
                    }`}
                    title={online ? "En ligne" : "Hors ligne"}
                    aria-label={online ? "En ligne" : "Hors ligne"}
                  />
                )}
                {onTogglePin && (
                  <button
                    type="button"
                    onClick={onTogglePin}
                    className={`text-sm ${pinned ? "text-bastion-accent" : "text-slate-600 hover:text-slate-400"}`}
                    aria-label={pinned ? "Retirer des favoris" : "Épingler"}
                  >
                    {pinned ? "★" : "☆"}
                  </button>
                )}
              </div>
              <p className="font-mono text-xs text-slate-500">
                {host.hostname}:{host.port}
              </p>
            </div>
          </div>
          <ProtocolBadge protocol={host.protocol} />
        </div>

        {host.username && (
          <p className="mb-3 text-sm text-slate-400">
            <span className="text-slate-500">Utilisateur :</span> {host.username}
          </p>
        )}

        {host.macAddress && (
          <p className="mb-3 font-mono text-xs text-slate-500">
            MAC : {host.macAddress}
          </p>
        )}

        {tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTagClick?.(tag)}
                className={`rounded-md bg-bastion-800 px-2 py-0.5 text-xs text-slate-400 ${
                  onTagClick ? "hover:bg-bastion-700 hover:text-white" : ""
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {wakeFeedback && (
          <InlineAlert variant={wakeFeedback.variant} className="mb-3 py-2 text-xs">
            {wakeFeedback.text}
          </InlineAlert>
        )}

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/session/${host.id}`}
            className={`btn-primary flex-1 text-center ${readyToConnect ? "animate-pulse" : ""}`}
          >
            Connexion
          </Link>
          {host.macAddress && (
            <button
              onClick={() => void handleWake()}
              disabled={waking}
              className="btn-secondary px-3"
              title="Réveiller et attendre la mise en ligne"
            >
              {waking ? "…" : "⚡ Réveiller"}
            </button>
          )}
          {canManage && (
            <>
              <button
                onClick={() => onEdit(host)}
                className="btn-secondary px-3"
                aria-label="Modifier"
              >
                ✎
              </button>
              <button
                onClick={() => onDelete(host)}
                className="btn-secondary px-3 text-red-400 hover:border-red-500/40"
                aria-label="Supprimer"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
