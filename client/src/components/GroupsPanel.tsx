import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { api } from "../lib/api";
import type { AccessGroup, Host } from "../types";

export default function GroupsPanel() {
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  const load = async () => {
    const [g, h] = await Promise.all([api.groups(), api.hosts()]);
    setGroups(g);
    setHosts(h);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    try {
      await api.createGroup(name.trim(), [...selected]);
      setName("");
      setSelected(new Set());
      setMsg("Groupe créé");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur");
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
      {msg && <p className="mb-3 text-sm text-bastion-glow">{msg}</p>}

      <ul className="mb-6 divide-y divide-bastion-800">
        {groups.map((group) => (
          <li key={group.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-white">
              {group.name}{" "}
              <span className="text-slate-500">({group.hostIds.length} machine(s))</span>
            </span>
            <button
              type="button"
              className="text-red-400"
              onClick={() => void remove(group)}
            >
              ✕
            </button>
          </li>
        ))}
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
            <label key={host.id} className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
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
    </div>
  );
}
