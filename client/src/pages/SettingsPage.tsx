import { useEffect, useState } from "react";
import GroupsPanel from "../components/GroupsPanel";
import InlineAlert from "../components/InlineAlert";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import TotpQrCode from "../components/TotpQrCode";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { AccessGroup, Host, UserAccount, UserRole } from "../types";

function accessSummary(user: UserAccount, totalHosts: number): string {
  if (user.role === "admin") return "Administrateur";
  if (user.allowedHostIds === null && user.groupIds.length === 0) {
    return "Toutes les machines";
  }
  const parts: string[] = [];
  if (user.groupIds.length > 0) {
    parts.push(`${user.groupIds.length} groupe(s)`);
  }
  if (user.allowedHostIds === null) {
    parts.push("toutes les machines");
  } else if (user.allowedHostIds.length === 0 && user.groupIds.length === 0) {
    return "Aucune machine";
  } else if (user.allowedHostIds.length > 0) {
    parts.push(`${user.allowedHostIds.length} / ${totalHosts} machine(s)`);
  }
  return parts.join(" · ");
}

function OperatorHostAccess({
  user,
  hosts,
  groups,
  onSaved,
}: {
  user: UserAccount;
  hosts: Host[];
  groups: AccessGroup[];
  onSaved: () => void;
}) {
  const [allAccess, setAllAccess] = useState(user.allowedHostIds === null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(user.allowedHostIds ?? [])
  );
  const [groupIds, setGroupIds] = useState<Set<string>>(
    () => new Set(user.groupIds ?? [])
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);

  useEffect(() => {
    setAllAccess(user.allowedHostIds === null);
    setSelected(new Set(user.allowedHostIds ?? []));
    setGroupIds(new Set(user.groupIds ?? []));
  }, [user.allowedHostIds, user.groupIds, user.id]);

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
    setFeedback(null);
    try {
      await api.updateUser(user.id, {
        allowedHostIds: allAccess ? null : [...selected],
        groupIds: [...groupIds],
      });
      setFeedback({ text: "Accès enregistré", variant: "success" });
      onSaved();
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
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
        Machines accessibles : {accessSummary(user, hosts.length)}
      </p>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="checkbox-accent"
          checked={allAccess}
          onChange={(e) => setAllAccess(e.target.checked)}
        />
        Accès à toutes les machines
      </label>
      {!allAccess && groups.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs text-slate-500">Groupes</p>
          <div className="space-y-1">
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                className="checkbox-accent"
                checked={groupIds.has(g.id)}
                  onChange={() =>
                    setGroupIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    })
                  }
                />
                {g.name} ({g.hostIds.length})
              </label>
            ))}
          </div>
        </div>
      )}
      {!allAccess && (
        <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
          {hosts.map((host) => (
            <label
              key={host.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-400 hover:bg-bastion-800/50"
            >
              <input
                type="checkbox"
                className="checkbox-accent"
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
      {feedback && (
        <InlineAlert variant={feedback.variant} className="mt-2 py-2 text-xs">
          {feedback.text}
        </InlineAlert>
      )}
    </div>
  );
}

function CreateUserHostAccess({
  hosts,
  groups,
  allAccess,
  onAllAccessChange,
  selected,
  groupIds,
  onToggle,
  onToggleGroup,
}: {
  hosts: Host[];
  groups: AccessGroup[];
  allAccess: boolean;
  onAllAccessChange: (value: boolean) => void;
  selected: Set<string>;
  groupIds: Set<string>;
  onToggle: (hostId: string) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  if (hosts.length === 0) return null;

  return (
    <div className="rounded-lg border border-bastion-800 bg-bastion-950/50 p-3">
      <p className="mb-2 text-xs font-medium text-slate-400">Machines autorisées</p>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="checkbox-accent"
          checked={allAccess}
          onChange={(e) => onAllAccessChange(e.target.checked)}
        />
        Toutes les machines
      </label>
      {!allAccess && groups.length > 0 && (
        <div className="mb-2 space-y-1">
          <p className="text-xs text-slate-500">Groupes</p>
          {groups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-400"
            >
              <input
                type="checkbox"
                className="checkbox-accent"
                checked={groupIds.has(g.id)}
                onChange={() => onToggleGroup(g.id)}
              />
              {g.name} ({g.hostIds.length})
            </label>
          ))}
        </div>
      )}
      {!allAccess && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {hosts.map((host) => (
            <label
              key={host.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-400"
            >
              <input
                type="checkbox"
                className="checkbox-accent"
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

function TotpSettings() {
  const { user, refreshMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);

  if (!user) return null;

  const startSetup = async () => {
    setFeedback(null);
    try {
      setSetup(await api.totpSetup());
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const confirm = async () => {
    setFeedback(null);
    try {
      await api.totpConfirm(code);
      setSetup(null);
      setCode("");
      setFeedback({ text: "2FA activée", variant: "success" });
      await refreshMe();
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const disable = async () => {
    setFeedback(null);
    try {
      await api.totpDisable(password);
      setPassword("");
      setFeedback({ text: "2FA désactivée", variant: "success" });
      await refreshMe();
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  return (
    <div className="glass-card p-6">
      <h2 className="mb-1 text-lg font-semibold text-white">
        Authentification à deux facteurs (2FA)
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        Protégez votre compte avec une application Authenticator.
      </p>
      {feedback && (
        <InlineAlert variant={feedback.variant} className="mb-3">
          {feedback.text}
        </InlineAlert>
      )}
      {user.totpEnabled ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-400">2FA activée sur ce compte.</p>
          <input
            type="password"
            className="input-field"
            placeholder="Mot de passe actuel pour désactiver"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" onClick={() => void disable()} className="btn-secondary">
            Désactiver la 2FA
          </button>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <TotpQrCode uri={setup.uri} />
          <p className="text-center text-xs text-slate-500">
            Scannez avec Google Authenticator, Authy, etc.
          </p>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer text-slate-400">
              Saisie manuelle
            </summary>
            <p className="mt-2 break-all font-mono">{setup.secret}</p>
          </details>
          <input
            className="input-field font-mono"
            placeholder="Code à 6 chiffres"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button type="button" onClick={() => void confirm()} className="btn-primary">
            Confirmer
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => void startSetup()} className="btn-primary">
          Configurer la 2FA
        </button>
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
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("operator");
  const [newUserAllAccess, setNewUserAllAccess] = useState(false);
  const [newUserHosts, setNewUserHosts] = useState<Set<string>>(new Set());
  const [newUserGroups, setNewUserGroups] = useState<Set<string>>(new Set());
  const [userFeedback, setUserFeedback] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      const [userList, hostList, groupList] = await Promise.all([
        api.users(),
        api.hosts(),
        api.groups(),
      ]);
      setUsers(userList);
      setHosts(hostList);
      setGroups(groupList);
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
    setUserFeedback(null);
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
        allowedHostIds,
        newUserRole === "operator" ? [...newUserGroups] : undefined
      );
      setNewUsername("");
      setNewUserPassword("");
      setNewUserRole("operator");
      setNewUserAllAccess(false);
      setNewUserHosts(new Set());
      setNewUserGroups(new Set());
      setUserFeedback({ text: "Utilisateur créé", variant: "success" });
      await loadUsers();
    } catch (err) {
      setUserFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const handleRoleChange = async (id: string, role: UserRole) => {
    setUserFeedback(null);
    try {
      await api.updateUser(id, { role });
      setUserFeedback({ text: "Rôle mis à jour", variant: "success" });
      await loadUsers();
    } catch (err) {
      setUserFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const handleRevokeSessions = async (user: UserAccount) => {
    if (
      !confirm(
        `Révoquer toutes les sessions de « ${user.username} » ?\nL'utilisateur devra se reconnecter.`
      )
    ) {
      return;
    }
    setUserFeedback(null);
    try {
      const res = await api.revokeUserSessions(user.id);
      setUserFeedback({
        text: `Sessions révoquées pour ${user.username} (${res.revoked} connexion(s))`,
        variant: "success",
      });
    } catch (err) {
      setUserFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
    }
  };

  const handleDeleteUser = async (user: UserAccount) => {
    if (!confirm(`Supprimer l'utilisateur « ${user.username} » ?`)) return;
    setUserFeedback(null);
    try {
      await api.deleteUser(user.id);
      setUserFeedback({ text: "Utilisateur supprimé", variant: "success" });
      await loadUsers();
    } catch (err) {
      setUserFeedback({
        text: err instanceof Error ? err.message : "Erreur",
        variant: "error",
      });
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

  const toggleNewUserGroup = (groupId: string) => {
    setNewUserGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
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
            <InlineAlert variant="error" className="mb-4">
              {error}
            </InlineAlert>
          )}
          {success && (
            <InlineAlert variant="success" className="mb-4">
              {success}
            </InlineAlert>
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
          <>
          <GroupsPanel />
          <div className="glass-card p-6">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Utilisateurs
            </h2>
            <p className="mb-6 text-sm text-slate-400">
              <strong>Admin</strong> : gestion complète.{" "}
              <strong>Opérateur</strong> : connexions et WoL sur les machines
              autorisées uniquement.
            </p>

            {userFeedback && (
              <InlineAlert variant={userFeedback.variant} className="mb-4">
                {userFeedback.text}
              </InlineAlert>
            )}

            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <ul className="mb-6 divide-y divide-bastion-800">
                {users.map((user) => (
                  <li key={user.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{user.username}</p>
                        <p className="text-xs text-slate-500">
                          {accessSummary(user, hosts.length)}
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
                          onClick={() => void handleRevokeSessions(user)}
                          className="btn-secondary px-2 text-xs"
                          aria-label={`Révoquer les sessions de ${user.username}`}
                        >
                          ⏻
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          className="btn-secondary px-3 text-red-400"
                          aria-label={`Supprimer ${user.username}`}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {user.role === "operator" && (
                      <OperatorHostAccess
                        user={user}
                        hosts={hosts}
                        groups={groups}
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
                  groups={groups}
                  allAccess={newUserAllAccess}
                  onAllAccessChange={setNewUserAllAccess}
                  selected={newUserHosts}
                  groupIds={newUserGroups}
                  onToggle={toggleNewUserHost}
                  onToggleGroup={toggleNewUserGroup}
                />
              )}
              <button type="submit" className="btn-primary">
                Créer l'utilisateur
              </button>
            </form>
          </div>
          </>
        )}

        <TotpSettings />
      </div>
    </Layout>
  );
}
