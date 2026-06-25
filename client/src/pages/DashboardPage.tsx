import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import HostCard from "../components/HostCard";
import HostForm from "../components/HostForm";
import { api } from "../lib/api";
import type { Host, Stats } from "../types";

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="glass-card relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-bastion-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="glass-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className="mt-1 text-3xl font-bold tabular-nums"
        style={{ color: accent ?? "#f8fafc" }}
      >
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [hostStatus, setHostStatus] = useState<Record<string, boolean>>({});

  const load = async () => {
    const [h, s] = await Promise.all([api.hosts(), api.stats()]);
    setHosts(h);
    setStats(s);
    api.hostsStatus().then(setHostStatus).catch(() => setHostStatus({}));
  };

  useEffect(() => {
    load()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = hosts.filter((h) => {
    const matchSearch =
      !search ||
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.hostname.toLowerCase().includes(search.toLowerCase()) ||
      h.tags.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || h.protocol === filter;
    return matchSearch && matchFilter;
  });

  const handleCreate = async (data: Partial<Host>) => {
    await api.createHost(data);
    setModalOpen(false);
    await load();
  };

  const handleUpdate = async (data: Partial<Host>) => {
    if (!editingHost) return;
    await api.updateHost(editingHost.id, data);
    setEditingHost(null);
    await load();
  };

  const handleDelete = async (host: Host) => {
    if (!confirm(`Supprimer « ${host.name} » ?`)) return;
    await api.deleteHost(host.id);
    await load();
  };

  const openEdit = async (host: Host) => {
    const full = await api.host(host.id);
    setEditingHost({ ...host, ...full });
  };

  return (
    <Layout title="Tableau de bord">
      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
          <StatCard label="Machines" value={stats.totalHosts} accent="#f59e0b" />
          <StatCard
            label="Sessions actives"
            value={stats.activeSessions}
            accent="#10b981"
          />
          <StatCard label="SSH" value={stats.byProtocol.ssh ?? 0} accent="#34d399" />
          <StatCard label="RDP / VNC" value={(stats.byProtocol.rdp ?? 0) + (stats.byProtocol.vnc ?? 0)} accent="#60a5fa" />
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-3">
          <input
            className="input-field max-w-xs"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex rounded-lg border border-bastion-600 bg-bastion-900 p-1">
            {["all", "ssh", "rdp", "vnc"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase transition ${
                  filter === f
                    ? "bg-bastion-accent text-bastion-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {f === "all" ? "Tous" : f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() =>
              api.hostsStatus().then(setHostStatus).catch(() => {})
            }
            className="btn-secondary"
            title="Actualiser le statut réseau"
          >
            ↻
          </button>
          <button onClick={() => setModalOpen(true)} className="btn-primary">
            + Ajouter une machine
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-bastion-accent border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 text-4xl opacity-40">🏰</div>
          <h3 className="text-lg font-semibold text-white">
            {hosts.length === 0
              ? "Aucune machine configurée"
              : "Aucun résultat"}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-slate-400">
            {hosts.length === 0
              ? "Ajoutez votre premier serveur pour commencer à vous connecter depuis le navigateur."
              : "Essayez un autre filtre ou terme de recherche."}
          </p>
          {hosts.length === 0 && (
            <button
              onClick={() => setModalOpen(true)}
              className="btn-primary mt-6"
            >
              Ajouter une machine
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((host) => (
            <HostCard
              key={host.id}
              host={host}
              online={host.id in hostStatus ? hostStatus[host.id] : null}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="Nouvelle machine"
        onClose={() => setModalOpen(false)}
      >
        <HostForm
          onSubmit={handleCreate}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      <Modal
        open={!!editingHost}
        title={`Modifier — ${editingHost?.name ?? ""}`}
        onClose={() => setEditingHost(null)}
      >
        {editingHost && (
          <HostForm
            initial={editingHost}
            onSubmit={handleUpdate}
            onCancel={() => setEditingHost(null)}
          />
        )}
      </Modal>
    </Layout>
  );
}
