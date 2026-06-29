import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { AuditRecord, LiveSessionRecord, Protocol, SessionRecord } from "../types";
import { ProtocolBadge } from "../components/ProtocolBadge";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "En cours";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    login: "Connexion",
    "host.create": "Hôte créé",
    "host.update": "Hôte modifié",
    "host.delete": "Hôte supprimé",
    "host.import": "Import",
    "host.export": "Export",
    "session.start": "Session ouverte",
    "session.end": "Session fermée",
    wol: "Wake-on-LAN",
    "password.change": "Mot de passe",
    "user.create": "Utilisateur créé",
    "user.update": "Utilisateur modifié",
    "user.delete": "Utilisateur supprimé",
    "group.create": "Groupe créé",
    "group.update": "Groupe modifié",
    "group.delete": "Groupe supprimé",
    "totp.enable": "2FA activée",
    "totp.disable": "2FA désactivée",
    "session.terminate": "Session coupée",
    "auth.revoke": "Sessions révoquées",
  };
  return labels[action] ?? action;
}

export default function ActivityPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<"sessions" | "live" | "audit">("sessions");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [live, setLive] = useState<LiveSessionRecord[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [s, a] = await Promise.all([api.sessions(80), api.audit(120)]);
    setSessions(s);
    setAudit(a);
    if (isAdmin) {
      setLive(await api.liveSessions());
    }
  };

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout title="Activité & journal">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-bastion-600 bg-bastion-900 p-1">
          {(
            [
              ["sessions", "Historique"],
              ...(isAdmin ? ([["live", "Sessions actives"]] as const) : []),
              ["audit", "Journal d'audit"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                tab === key
                  ? "bg-bastion-accent text-bastion-950"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => load()} className="btn-secondary text-sm">
          ↻ Actualiser
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-bastion-accent border-t-transparent" />
        </div>
      ) : tab === "live" && isAdmin ? (
        <div className="glass-card overflow-hidden">
          {live.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              Aucune session distante active.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-bastion-700 bg-bastion-900/50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Machine</th>
                  <th className="px-4 py-3">Utilisateur</th>
                  <th className="px-4 py-3">Protocole</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {live.map((row) => (
                  <tr key={row.sessionId} className="border-b border-bastion-800/80">
                    <td className="px-4 py-3 text-white">{row.hostName}</td>
                    <td className="px-4 py-3 text-slate-400">{row.username}</td>
                    <td className="px-4 py-3">
                      <ProtocolBadge protocol={row.protocol} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-secondary text-xs text-red-400"
                        onClick={() =>
                          api.terminateSession(row.sessionId).then(() => load())
                        }
                      >
                        Couper
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === "sessions" ? (
        <div className="glass-card overflow-hidden">
          {sessions.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              Aucune session enregistrée pour l'instant.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-bastion-700 bg-bastion-900/50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Machine</th>
                    <th className="px-4 py-3">Protocole</th>
                    <th className="px-4 py-3">Utilisateur</th>
                    <th className="px-4 py-3">Début</th>
                    <th className="px-4 py-3">Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-bastion-800/80 hover:bg-bastion-900/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/session/${row.hostId}`}
                          className="font-medium text-white hover:text-bastion-glow"
                        >
                          {row.hostName}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <ProtocolBadge protocol={row.protocol as Protocol} />
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {row.username ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {formatWhen(row.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {formatDuration(row.durationSec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          {audit.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              Journal vide.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-bastion-700 bg-bastion-900/50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Détail</th>
                    <th className="px-4 py-3">Par</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-bastion-800/80 hover:bg-bastion-900/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {formatWhen(row.at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-bastion-800 px-2 py-0.5 text-xs text-slate-300">
                          {actionLabel(row.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{row.summary}</td>
                      <td className="px-4 py-3 text-slate-500">{row.username}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
