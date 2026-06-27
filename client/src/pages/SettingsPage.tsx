import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { Host, UserAccount, UserRole } from "../types";

function accessSummary(allowed: string[] | null, totalHosts: number): string {
  if (allowed === null) return "Toutes les machines";
  if (allowed.length === 0) return "Aucune machine";
  return `${allowed.length} / ${totalHosts} machine(s)`;
}

function OperatorHostAccess({
  user,
  hosts,
  onSaved,
}: {
  user: UserAccount;
  hosts: Host[];
  onSaved: () => void;
}) {
  const [allAccess, setAllAccess] = useState(user.allowedHostIds === null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(user.allowedHostIds ?? [])
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setAllAccess(user.allowedHostIds === null);
    setSelected(new Set(user.allowedHostIds ?? []));
  }, [user.allowedHostIds, user.id]);

  const toggleHost = (hostId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.updateUser(user.id, {
        allowedHostIds: allAccess ? null : [...selected],
      });
      setMsg("Accès enregistré");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (hosts.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        Aucune machine configurée — ajoutez des hôtes au tableau de bord.
      </p>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-bastion-800 bg-bastion-950/50 p-3">
      <p className="mb-2 text-xs text-slate-500">
        Machines accessibles : {accessSummary(user.allowedHostIds, hosts.length)}
      </p>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="rounded border-bastion-600"
          checked={allAccess}
          onChange={(e) => setAllAccess(e.target.checked)}
        />
        Accès à toutes les machines
      </label>
      {!allAccess && (
        <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
          {hosts.map((host) => (
            <label
              key={host.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-400 hover:bg-bastion-800/50"
            >
              <input
                type="checkbox"
                className="rounded border-bastion-600"
                checked={selected.has(host.id)}
                onChange={() => toggleHost(host.id)}
              />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: host.color }}
              />
              {host.name}
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="btn-secondary text-xs"
      >
        {saving ? "Enregistrement…" : "Enregistrer l'accès"}
      </button>
      {msg && <p className="mt-2 text-xs text-bastion-glow">{msg}</p>}
    </div>
  );
}

function CreateUserHostAccess({
  hosts,
  allAccess,
  onAllAccessChange,
  selected,
  onToggle,
}: {
  hosts: Host[];
  allAccess: boolean;
  onAllAccessChange: (value: boolean) => void;
  selected: Set<string>;
  onToggle: (hostId: string) => void;
}) {
  if (hosts.length === 0) return null;

  return (
    <div className="rounded-lg border border-bastion-800 bg-bastion-950/50 p-3">
      <p className="mb-2 text-xs font-medium text-slate-400">Machines autorisées</p>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="rounded border-bastion-600"
          checked={allAccess}
          onChange={(e) => onAllAccessChange(e.target.checked)}
        />
        Toutes les machines
      </label>
      {!allAccess && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {hosts.map((host) => (
            <label
              key={host.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-400"
            >
              <input
                type="checkbox"
                className="rounded border-bastion-600"
                checked={selected.has(host.id)}
                onChange={() => onToggle(host.id)}
              />
              {host.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("operator");
  const [newUserAllAccess, setNewUserAllAccess] = useState(false);
  const [newUserHosts, setNewUserHosts] = useState<Set<string>>(new Set());
  const [userMsg, setUserMsg] = useState("");

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      const [userList, hostList] = await Promise.all([api.users(), api.hosts()]);
      setUsers(userList);
      setHosts(hostList);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [isAdmin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères");
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess("Mot de passe mis à jour");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMsg("");
    try {
      const allowedHostIds =
        newUserRole === "admin"
          ? null
          : newUserAllAccess
            ? null
            : [...newUserHosts];
      await api.createUser(
        newUsername.trim(),
        newUserPassword,
        newUserRole,
        allowedHostIds
      );
      setNewUsername("");
      setNewUserPassword("");
      setNewUserRole("operator");
      setNewUserAllAccess(false);
      setNewUserHosts(new Set());
      setUserMsg("Utilisateur créé");
      await loadUsers();
    } catch (err) {
      setUserMsg(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleRoleChange = async (id: string, role: UserRole) => {
    setUserMsg("");
    try {
      await api.updateUser(id, { role });
      setUserMsg("Rôle mis à jour");
      await loadUsers();
    } catch (err) {
      setUserMsg(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleDeleteUser = async (user: UserAccount) => {
    if (!confirm(`Supprimer l'utilisateur « ${user.username} » ?`)) return;
    setUserMsg("");
    try {
      await api.deleteUser(user.id);
      setUserMsg("Utilisateur supprimé");
      await loadUsers();
    } catch (err) {
      setUserMsg(err instanceof Error ? err.message : "Erreur");
    }
  };

  const toggleNewUserHost = (hostId: string) => {
    setNewUserHosts((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  };

  return (
    <Layout title="Paramètres">
      <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
        <div className="glass-card p-6">
          <h2 className="mb-1 text-lg font-semibold text-white">
            Changer le mot de passe
          </h2>
          <p className="mb-6 text-sm text-slate-400">
            Mettez à jour le mot de passe de votre compte Bastion.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Mot de passe actuel
              </label>
              <input
                type="password"
                className="input-field"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Confirmer le nouveau mot de passe
              </label>
              <input
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? "Enregistrement…" : "Mettre à jour"}
            </button>
          </form>
        </div>

        {isAdmin && (
          <div className="glass-card p-6">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Utilisateurs
            </h2>
            <p className="mb-6 text-sm text-slate-400">
              <strong>Admin</strong> : gestion complète.{" "}
              <strong>Opérateur</strong> : connexions et WoL sur les machines
              autorisées uniquement.
            </p>

            {userMsg && (
              <p className="mb-4 text-sm text-bastion-glow">{userMsg}</p>
            )}

            {usersLoading ? (
              <p className="text-sm text-slate-500">Chargement…</p>
            ) : (
              <ul className="mb-6 divide-y divide-bastion-800">
                {users.map((user) => (
                  <li key={user.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{user.username}</p>
                        <p className="text-xs text-slate-500">
                          {user.role === "admin"
                            ? "Administrateur"
                            : accessSummary(user.allowedHostIds, hosts.length)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="input-field py-1.5 text-sm"
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(user.id, e.target.value as UserRole)
                          }
                        >
                          <option value="admin">Admin</option>
                          <option value="operator">Opérateur</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          className="btn-secondary px-3 text-red-400"
                          title="Supprimer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {user.role === "operator" && (
                      <OperatorHostAccess
                        user={user}
                        hosts={hosts}
                        onSaved={() => void loadUsers()}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={handleCreateUser}
              className="space-y-3 border-t border-bastion-800 pt-6"
            >
              <h3 className="text-sm font-medium text-slate-300">
                Nouvel utilisateur
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="input-field"
                  placeholder="Nom d'utilisateur"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                  minLength={2}
                />
                <input
                  type="password"
                  className="input-field"
                  placeholder="Mot de passe (8+ caractères)"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <select
                className="input-field"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              >
                <option value="operator">Opérateur</option>
                <option value="admin">Administrateur</option>
              </select>
              {newUserRole === "operator" && (
                <CreateUserHostAccess
                  hosts={hosts}
                  allAccess={newUserAllAccess}
                  onAllAccessChange={setNewUserAllAccess}
                  selected={newUserHosts}
                  onToggle={toggleNewUserHost}
                />
              )}
              <button type="submit" className="btn-primary">
                Créer l'utilisateur
              </button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
