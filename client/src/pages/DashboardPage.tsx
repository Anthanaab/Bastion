import { useEffect, useMemo, useRef, useState } from "react";
import HostCard from "../components/HostCard";
import HostForm from "../components/HostForm";
import InlineAlert from "../components/InlineAlert";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import StatusToast from "../components/StatusToast";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { Host, Stats, StatusNotification } from "../types";

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
        className="absolute inset-0 bg-black/60 max-sm:bg-black/70 sm:backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="glass-card relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Fermer"
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
  const { isAdmin, pinnedHostIds, togglePin } = useAuth();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [hostStatus, setHostStatus] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<StatusNotification[]>([]);
  const prevStatusRef = useRef<Record<string, boolean>>({});

  const refreshHostStatus = () => {
    api
      .hostsStatus()
      .then((next) => {
        const hostNames = new Map(hosts.map((h) => [h.id, h.name]));
        const prev = prevStatusRef.current;
        const newNotifs: StatusNotification[] = [];
        for (const [id, online] of Object.entries(next)) {
          if (id in prev && prev[id] !== online) {
            newNotifs.push({
              id: `${id}-${Date.now()}`,
              hostId: id,
              hostName: hostNames.get(id) ?? id,
              online,
              at: Date.now(),
            });
          }
        }
        if (newNotifs.length) {
          setNotifications((n) => [...newNotifs, ...n].slice(0, 5));
        }
        prevStatusRef.current = next;
        setHostStatus(next);
      })
      .catch(() => setHostStatus({}));
  };

  const load = async () => {
    const [h, s] = await Promise.all([api.hosts(), api.stats()]);
    setHosts(h);
    setStats(s);
    refreshHostStatus();
  };

  useEffect(() => {
    setLoadError("");
    load()
      .catch((err) => {
        setLoadError(
          err instanceof Error ? err.message : "Impossible de charger les machines"
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || hosts.length === 0) return;

    const interval = window.setInterval(refreshHostStatus, 10_000);
    return () => window.clearInterval(interval);
  }, [loading, hosts.length]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const host of hosts) {
      for (const tag of host.tags.split(",").map((t) => t.trim()).filter(Boolean)) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [hosts]);

  const filtered = hosts
    .filter((h) => {
      const matchSearch =
        !search ||
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.hostname.toLowerCase().includes(search.toLowerCase()) ||
        h.tags.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === "all" || h.protocol === filter;
      const hostTags = h.tags.split(",").map((t) => t.trim());
      const matchTag = !tagFilter || hostTags.includes(tagFilter);
      return matchSearch && matchFilter && matchTag;
    })
    .sort((a, b) => {
      const ap = pinnedHostIds.includes(a.id) ? 0 : 1;
      const bp = pinnedHostIds.includes(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
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

  const handleExport = async () => {
    const bundle = await api.exportHosts();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bastion-hosts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text) as {
      hosts?: unknown;
      mode?: string;
    };
    const hosts = Array.isArray(data) ? data : data.hosts;
    if (!Array.isArray(hosts) || hosts.length === 0) {
      throw new Error("Fichier invalide : tableau hosts attendu");
    }

    const replace = confirm(
      "Remplacer toutes les machines existantes ?\n\nOK = tout remplacer\nAnnuler = fusionner (mise à jour par nom + IP)"
    );

    const result = await api.importHosts(replace ? "replace" : "merge", hosts);
    setImportFeedback({
      text: `Import OK — ${result.created} créé(s), ${result.updated} mis à jour`,
      variant: "success",
    });
    setTimeout(() => setImportFeedback(null), 5000);
    await load();
  };

  return (
    <Layout title="Tableau de bord">
      <StatusToast
        items={notifications}
        onDismiss={(id) =>
          setNotifications((n) => n.filter((item) => item.id !== id))
        }
      />
      {loading ? (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-5">
              <div className="skeleton mb-3 h-3 w-20" />
              <div className="skeleton h-8 w-16" />
            </div>
          ))}
        </div>
      ) : (
        stats && (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
            <StatCard label="Machines" value={stats.totalHosts} accent="#f59e0b" />
            <StatCard
              label="Sessions actives"
              value={stats.activeSessions}
              accent="#10b981"
            />
            <StatCard label="SSH" value={stats.byProtocol.ssh ?? 0} accent="#34d399" />
            <StatCard
              label="RDP / VNC"
              value={(stats.byProtocol.rdp ?? 0) + (stats.byProtocol.vnc ?? 0)}
              accent="#60a5fa"
            />
          </div>
        )
      )}

      {loadError && (
        <InlineAlert variant="error" className="mb-6">
          {loadError}
        </InlineAlert>
      )}

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap gap-3">
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
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={refreshHostStatus}
              className="btn-secondary px-3"
              aria-label="Actualiser le statut réseau"
            >
              ↻
            </button>
            {isAdmin && (
              <>
                <button onClick={() => void handleExport()} className="btn-secondary">
                  Exporter
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="btn-secondary"
                >
                  Importer
                </button>
                <button onClick={() => setModalOpen(true)} className="btn-primary">
                  + Ajouter une machine
                </button>
              </>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                handleImportFile(file).catch((err) => {
                  setImportFeedback({
                    text: err instanceof Error ? err.message : "Import échoué",
                    variant: "error",
                  });
                });
              }}
            />
          </div>
        </div>

        {importFeedback && (
          <InlineAlert variant={importFeedback.variant}>
            {importFeedback.text}
          </InlineAlert>
        )}

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Tags :</span>
            <button
              onClick={() => setTagFilter(null)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                tagFilter === null
                  ? "bg-bastion-accent text-bastion-950"
                  : "bg-bastion-800 text-slate-400 hover:text-white"
              }`}
            >
              Tous
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  tagFilter === tag
                    ? "bg-bastion-accent text-bastion-950"
                    : "bg-bastion-800 text-slate-400 hover:text-white"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
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
              pinned={pinnedHostIds.includes(host.id)}
              onTogglePin={() => void togglePin(host.id)}
              onEdit={openEdit}
              onDelete={handleDelete}
              canManage={isAdmin}
              onTagClick={(tag) =>
                setTagFilter((current) => (current === tag ? null : tag))
              }
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
