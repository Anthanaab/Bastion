import { useEffect, useState } from "react";
import InlineAlert from "./InlineAlert";
import { api } from "../lib/api";
import type { AccessGroup, Host } from "../types";
import Spinner from "./Spinner";

export default function GroupsPanel() {
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);

  const load = async () => {
    const [g, h] = await Promise.all([api.groups(), api.hosts()]);
    setGroups(g);
    setHosts(h);
  };

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await api.createGroup(name.trim(), [...selected]);
      setName("");
      setSelected(new Set());
      setFeedback({ text: "Groupe créé", variant: "success" });
      await load();
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const remove = async (group: AccessGroup) => {
    if (!confirm(`Supprimer le groupe « ${group.name} » ?`)) return;
    await api.deleteGroup(group.id);
    await load();
  };

  return (
    <div className="glass-card p-6">
      <h2 className="mb-1 text-lg font-semibold text-white">Groupes d&apos;accès</h2>
      <p className="mb-4 text-sm text-slate-400">
        Regroupez des machines et assignez les groupes aux opérateurs.
      </p>
      {feedback && (
        <InlineAlert variant={feedback.variant} className="mb-3">
          {feedback.text}
        </InlineAlert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <ul className="mb-6 divide-y divide-bastion-800">
            {groups.length === 0 ? (
              <li className="py-4 text-center text-sm text-slate-500">
                Aucun groupe — créez-en un ci-dessous.
              </li>
            ) : (
              groups.map((group) => (
                <li
                  key={group.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-white">
                    {group.name}{" "}
                    <span className="text-slate-500">
                      ({group.hostIds.length} machine(s))
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary px-2 text-xs text-red-400"
                    onClick={() => void remove(group)}
                    aria-label={`Supprimer le groupe ${group.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))
            )}
          </ul>

          <form onSubmit={create} className="space-y-3 border-t border-bastion-800 pt-4">
            <input
              className="input-field"
              placeholder="Nom du groupe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {hosts.map((host) => (
                <label
                  key={host.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-400 hover:bg-bastion-800/50"
                >
                  <input
                    type="checkbox"
                    className="checkbox-accent"
                    checked={selected.has(host.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(host.id)) next.delete(host.id);
                        else next.add(host.id);
                        return next;
                      })
                    }
                  />
                  {host.name}
                </label>
              ))}
            </div>
            <button type="submit" className="btn-primary">
              Créer le groupe
            </button>
          </form>
        </>
      )}
    </div>
  );
}
