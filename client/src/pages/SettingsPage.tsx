import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { UserAccount, UserRole } from "../types";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("operator");
  const [userMsg, setUserMsg] = useState("");

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      setUsers(await api.users());
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
      await api.createUser(newUsername.trim(), newUserPassword, newUserRole);
      setNewUsername("");
      setNewUserPassword("");
      setNewUserRole("operator");
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
              <strong>Opérateur</strong> : connexions et WoL uniquement.
            </p>

            {userMsg && (
              <p className="mb-4 text-sm text-bastion-glow">{userMsg}</p>
            )}

            {usersLoading ? (
              <p className="text-sm text-slate-500">Chargement…</p>
            ) : (
              <ul className="mb-6 divide-y divide-bastion-800">
                {users.map((user) => (
                  <li
                    key={user.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium text-white">{user.username}</p>
                      <p className="text-xs text-slate-500">
                        {user.role === "admin" ? "Administrateur" : "Opérateur"}
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
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3 border-t border-bastion-800 pt-6">
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
