import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Host } from "../types";
import { api, pollHostOnline } from "../lib/api";
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
  onHostOnline?: () => void;
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
  onHostOnline,
}: HostCardProps) {
  const navigate = useNavigate();
  const [waking, setWaking] = useState(false);
  const [wakeFeedback, setWakeFeedback] = useState<{
    text: string;
    variant: "success" | "error" | "info";
  } | null>(null);
  const [readyToConnect, setReadyToConnect] = useState(false);
  const wakeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => wakeAbortRef.current?.abort();
  }, []);

  const tags = host.tags
    ? host.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const openSession = () => {
    navigate(`/session/${host.id}`);
  };

  const handleWake = async (event: React.MouseEvent) => {
    event.stopPropagation();
    wakeAbortRef.current?.abort();
    const abort = new AbortController();
    wakeAbortRef.current = abort;

    setWaking(true);
    setWakeFeedback(null);
    setReadyToConnect(false);
    setWakeFeedback({
      text: "Envoi du réveil Wake-on-LAN…",
      variant: "info",
    });

    try {
      const result = await api.wakeHost(host.id, false);
      if (abort.signal.aborted) return;

      setWakeFeedback({
        text: "Démarrage en cours — attente de la disponibilité…",
        variant: "info",
      });

      const becameOnline = await pollHostOnline(host.id, {
        signal: abort.signal,
        onProgress: (elapsedSec) => {
          if (abort.signal.aborted) return;
          setWakeFeedback({
            text: `Démarrage en cours… (${elapsedSec}s)`,
            variant: "info",
          });
        },
      });

      if (abort.signal.aborted) return;

      if (becameOnline) {
        setWakeFeedback({
          text: "Machine en ligne — vous pouvez vous connecter",
          variant: "success",
        });
        setReadyToConnect(true);
        onHostOnline?.();
      } else {
        setWakeFeedback({
          text: result.hint
            ? `Paquet envoyé. ${result.hint} La machine met plus de 2 minutes à répondre.`
            : "La machine ne répond pas encore — le démarrage peut prendre encore un moment. Réessayez ou connectez-vous dans quelques instants.",
          variant: "info",
        });
      }
      window.setTimeout(() => setWakeFeedback(null), 15_000);
    } catch (err) {
      if (!abort.signal.aborted) {
        setWakeFeedback({
          text: err instanceof Error ? err.message : "Échec WoL",
          variant: "error",
        });
      }
    } finally {
      if (wakeAbortRef.current === abort) {
        setWaking(false);
        wakeAbortRef.current = null;
      }
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={openSession}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSession();
        }
      }}
      className="glass-card group animate-slide-up cursor-pointer overflow-hidden transition hover:border-bastion-accent/30 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bastion-accent/50"
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
                    onClick={(event) => {
                      event.stopPropagation();
                      onTogglePin();
                    }}
                    className={`min-h-[44px] min-w-[44px] text-sm ${pinned ? "text-bastion-accent" : "text-slate-600 hover:text-slate-400"}`}
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

        {host.secretsUnreadable && (
          <p
            className="mb-3 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-400"
            title="Le mot de passe ou la clé privée n'a pas pu être déchiffré (clé de chiffrement changée) — reconfigurez cet hôte."
          >
            ⚠ Identifiants à ressaisir
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
                onClick={(event) => {
                  event.stopPropagation();
                  onTagClick?.(tag);
                }}
                className={`min-h-[32px] rounded-md bg-bastion-800 px-2 py-0.5 text-xs text-slate-400 ${
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
          <span
            className={`btn-primary pointer-events-none min-h-[44px] flex-1 text-center ${readyToConnect ? "animate-pulse" : ""}`}
          >
            Connexion
          </span>
          {host.macAddress && (
            <button
              type="button"
              onClick={(event) => void handleWake(event)}
              disabled={waking}
              className="btn-secondary relative z-10 min-h-[44px] px-3"
              title="Réveiller et attendre la mise en ligne"
            >
              {waking ? "Démarrage…" : "⚡ Réveiller"}
            </button>
          )}
          {canManage && (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(host);
                }}
                className="btn-secondary relative z-10 min-h-[44px] px-3"
                aria-label="Modifier"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(host);
                }}
                className="btn-secondary relative z-10 min-h-[44px] px-3 text-red-400 hover:border-red-500/40"
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
