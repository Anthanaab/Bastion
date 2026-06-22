import { useState } from "react";
import type { Host, Protocol } from "../types";
import { defaultPort } from "./ProtocolBadge";

const COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
];

interface HostFormProps {
  initial?: Partial<Host>;
  onSubmit: (data: Partial<Host>) => Promise<void>;
  onCancel: () => void;
}

export default function HostForm({ initial, onSubmit, onCancel }: HostFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const [protocol, setProtocol] = useState<Protocol>(initial?.protocol ?? "ssh");
  const [port, setPort] = useState(initial?.port ?? defaultPort("ssh"));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [tags, setTags] = useState(initial?.tags ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleProtocolChange = (p: Protocol) => {
    setProtocol(p);
    if (!initial?.port) setPort(defaultPort(p));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit({
        name,
        hostname,
        protocol,
        port,
        username,
        password: password || undefined,
        privateKey: privateKey || undefined,
        color,
        tags,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Nom
          </label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Serveur prod"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Protocole
          </label>
          <div className="flex gap-2">
            {(["ssh", "rdp", "vnc"] as Protocol[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleProtocolChange(p)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold uppercase transition ${
                  protocol === p
                    ? "border-bastion-accent bg-bastion-accent/10 text-bastion-glow"
                    : "border-bastion-600 bg-bastion-900 text-slate-400 hover:border-bastion-500"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Adresse
          </label>
          <input
            className="input-field"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="192.168.1.10 ou server.local"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Port
          </label>
          <input
            className="input-field"
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10))}
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Utilisateur
        </label>
        <input
          className="input-field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root, Administrator…"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Mot de passe
          </label>
          <input
            className="input-field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial ? "Laisser vide pour conserver" : ""}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Tags (séparés par virgule)
          </label>
          <input
            className="input-field"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="prod, linux, web"
          />
        </div>
      </div>

      {protocol === "ssh" && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Clé privée SSH (optionnel)
          </label>
          <textarea
            className="input-field min-h-[100px] font-mono text-xs"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </div>
      )}

      <div>
        <label className="mb-2 block text-xs font-medium text-slate-400">
          Couleur
        </label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full transition ring-offset-2 ring-offset-bastion-900 ${
                color === c ? "ring-2 ring-white scale-110" : "hover:scale-105"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Annuler
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Enregistrement…" : initial?.id ? "Mettre à jour" : "Ajouter"}
        </button>
      </div>
    </form>
  );
}
