import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import InlineAlert from "../components/InlineAlert";
import Layout from "../components/Layout";
import { ProtocolBadge } from "../components/ProtocolBadge";
import Spinner from "../components/Spinner";
import { api } from "../lib/api";
import type { InfrastructureSummary, Protocol } from "../types";

const REFRESH_INTERVAL_MS = 30_000;

function formatUptime(totalSec: number): string {
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "en cours";
  if (sec < 60) return `${sec} s`;
  if (sec < 3_600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3_600)} h ${Math.round((sec % 3_600) / 60)} min`;
}

function StatusDot({ ok, label }: { ok: boolean | null; label?: string }) {
  const color =
    ok === null ? "bg-slate-500" : ok ? "bg-emerald-400" : "bg-red-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color} ${ok ? "shadow-[0_0_6px] shadow-emerald-400/60" : ""}`} />
      {label && <span className="text-xs text-slate-400">{label}</span>}
    </span>
  );
}

function ServiceCard({
  name,
  detail,
  ok,
}: {
  name: string;
  detail: string;
  ok: boolean | null;
}) {
  return (
    <div className="glass-card flex items-center justify-between p-4">
      <div>
        <p className="text-sm font-semibold text-white">{name}</p>
        <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
      </div>
      <StatusDot ok={ok} />
    </div>
  );
}

function CountBar({
  label,
  online,
  total,
  badge,
}: {
  label: string;
  online: number;
  total: number;
  badge?: React.ReactNode;
}) {
  const pct = total === 0 ? 0 : Math.round((online / total) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-slate-300">
          {badge ?? label}
        </span>
        <span className="tabular-nums text-slate-500">
          {online} / {total} en ligne
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bastion-800">
        <div
          className="h-full rounded-full bg-emerald-400/80 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function InfrastructurePage() {
  const [data, setData] = useState<InfrastructureSummary | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      setData(await api.infrastructure());
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger l'état de l'infrastructure"
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(true), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const sortedHosts = useMemo(() => {
    if (!data) return [];
    return [...data.hosts.items].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const tagEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.hosts.byTag).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }, [data]);

  if (!data && !error) {
    return (
      <Layout title="Infrastructure">
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Infrastructure">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Vue d'ensemble de votre infrastructure
          {data && (
            <span className="ml-2 text-xs text-slate-600">
              · actualisé à {formatDateTime(data.generatedAt).slice(-5)}
            </span>
          )}
        </p>
        <button
          onClick={() => void load()}
          className="btn-secondary px-3"
          disabled={refreshing}
          aria-label="Actualiser"
        >
          {refreshing ? "…" : "↻"}
        </button>
      </div>

      {error && (
        <InlineAlert variant="error" className="mb-6">
          {error}
        </InlineAlert>
      )}

      {data && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* Services */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Services
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ServiceCard
                name="Bastion"
                detail={
                  data.system
                    ? `v${data.system.version} · en ligne depuis ${formatUptime(data.system.uptimeSec)}`
                    : "Passerelle d'accès"
                }
                ok={true}
              />
              <ServiceCard
                name="Base de données"
                detail="Stockage hôtes & utilisateurs"
                ok={data.services.database}
              />
              <ServiceCard
                name="guacd"
                detail="Proxy RDP / VNC"
                ok={data.services.guacd}
              />
              <ServiceCard
                name="Relais WoL"
                detail={
                  data.services.wolRelay.ok
                    ? "Wake-on-LAN opérationnel"
                    : data.services.wolRelay.configured
                      ? "Configuré mais injoignable"
                      : "Non configuré"
                }
                ok={
                  data.services.wolRelay.ok
                    ? true
                    : data.services.wolRelay.configured
                      ? false
                      : null
                }
              />
            </div>
          </section>

          {/* Machines */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Machines
            </h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="glass-card p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">
                      En ligne
                    </p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-400">
                      {data.hosts.online}
                      <span className="text-base font-medium text-slate-500">
                        {" "}/ {data.hosts.total}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">
                      Hors ligne
                    </p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-slate-300">
                      {data.hosts.offline}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">
                      Wake-on-LAN
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {data.hosts.wolCapable} machine
                      {data.hosts.wolCapable > 1 ? "s" : ""} réveillable
                      {data.hosts.wolCapable > 1 ? "s" : ""} à distance
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass-card p-5">
                <p className="mb-4 text-xs uppercase tracking-wider text-slate-500">
                  Par protocole
                </p>
                <div className="flex flex-col gap-4">
                  {Object.entries(data.hosts.byProtocol).map(([proto, c]) => (
                    <CountBar
                      key={proto}
                      label={proto}
                      online={c.online}
                      total={c.total}
                      badge={<ProtocolBadge protocol={proto as Protocol} />}
                    />
                  ))}
                  {Object.keys(data.hosts.byProtocol).length === 0 && (
                    <p className="text-sm text-slate-500">Aucune machine</p>
                  )}
                </div>
              </div>

              <div className="glass-card p-5">
                <p className="mb-4 text-xs uppercase tracking-wider text-slate-500">
                  Par tag
                </p>
                <div className="flex flex-col gap-4">
                  {tagEntries.slice(0, 6).map(([tag, c]) => (
                    <CountBar key={tag} label={tag} online={c.online} total={c.total} />
                  ))}
                  {tagEntries.length === 0 && (
                    <p className="text-sm text-slate-500">Aucun tag défini</p>
                  )}
                  {tagEntries.length > 6 && (
                    <p className="text-xs text-slate-600">
                      + {tagEntries.length - 6} autre(s) tag(s)
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="glass-card mt-4 overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-bastion-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 font-medium">Machine</th>
                    <th className="px-5 py-3 font-medium">Protocole</th>
                    <th className="px-5 py-3 font-medium">Adresse</th>
                    <th className="px-5 py-3 font-medium">Tags</th>
                    <th className="px-5 py-3 text-right font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHosts.map((host) => (
                    <tr
                      key={host.id}
                      className="border-b border-bastion-800/50 last:border-0 hover:bg-bastion-800/30"
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`/session/${host.id}`}
                          className="font-medium text-white hover:text-bastion-glow"
                        >
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                            style={{ backgroundColor: host.color }}
                          />
                          {host.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <ProtocolBadge protocol={host.protocol} />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-400">
                        {host.hostname}:{host.port}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {host.tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <StatusDot
                          ok={host.online}
                          label={host.online ? "en ligne" : "hors ligne"}
                        />
                      </td>
                    </tr>
                  ))}
                  {sortedHosts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                        Aucune machine configurée
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Sessions */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Sessions
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="glass-card p-5">
                <p className="mb-3 text-xs uppercase tracking-wider text-slate-500">
                  Actives ({data.sessions.active})
                </p>
                {data.sessions.live && data.sessions.live.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {data.sessions.live.map((s) => (
                      <li
                        key={s.sessionId}
                        className="flex items-center justify-between rounded-lg bg-bastion-800/40 px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <ProtocolBadge protocol={s.protocol} />
                          <span className="text-white">{s.hostName}</span>
                          <span className="text-xs text-slate-500">
                            par {s.username}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">
                          depuis {formatDateTime(s.startedAt).slice(-5)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    {data.sessions.active > 0
                      ? `${data.sessions.active} session(s) en cours`
                      : "Aucune session en cours"}
                  </p>
                )}
              </div>

              <div className="glass-card p-5">
                <p className="mb-3 text-xs uppercase tracking-wider text-slate-500">
                  Dernières sessions
                </p>
                {data.sessions.recent.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {data.sessions.recent.slice(0, 6).map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <ProtocolBadge protocol={s.protocol} />
                          <span className="text-slate-300">{s.hostName}</span>
                        </span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {formatDateTime(s.startedAt)} ·{" "}
                          {formatDuration(s.durationSec)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">Aucune session enregistrée</p>
                )}
              </div>
            </div>
          </section>

          {/* Système (admin) */}
          {data.system && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Système
              </h2>
              <div className="glass-card grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Version
                  </p>
                  <p className="mt-1 text-sm text-white">
                    Bastion {data.system.version}
                  </p>
                  <p className="text-xs text-slate-500">
                    Node {data.system.nodeVersion} · {data.system.platform}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Disponibilité
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {formatUptime(data.system.uptimeSec)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Mémoire : {data.system.memoryMb} Mo
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Utilisateurs
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {data.system.users} compte{data.system.users > 1 ? "s" : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Sauvegardes
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {data.system.backups.count} conservée
                    {data.system.backups.count > 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {data.system.backups.lastBackupAt
                      ? `Dernière : ${formatDateTime(data.system.backups.lastBackupAt)}`
                      : "Aucune sauvegarde pour l'instant"}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
