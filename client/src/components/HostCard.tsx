import { Link } from "react-router-dom";
import type { Host } from "../types";
import { ProtocolBadge, protocolIcon } from "./ProtocolBadge";

interface HostCardProps {
  host: Host;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
}

export default function HostCard({ host, onEdit, onDelete }: HostCardProps) {
  const tags = host.tags
    ? host.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

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
              <h3 className="font-semibold text-white">{host.name}</h3>
              <p className="font-mono text-xs text-slate-500">
                {host.hostname}:{host.port}
              </p>
            </div>
          </div>
          <ProtocolBadge protocol={host.protocol} />
        </div>

        {host.username && (
          <p className="mb-3 text-sm text-slate-400">
            <span className="text-slate-500">Utilisateur :</span>{" "}
            {host.username}
          </p>
        )}

        {tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-bastion-800 px-2 py-0.5 text-xs text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Link
            to={`/session/${host.id}`}
            className="btn-primary flex-1 text-center"
          >
            Connexion
          </Link>
          <button
            onClick={() => onEdit(host)}
            className="btn-secondary px-3"
            title="Modifier"
          >
            ✎
          </button>
          <button
            onClick={() => onDelete(host)}
            className="btn-secondary px-3 text-red-400 hover:border-red-500/40"
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
