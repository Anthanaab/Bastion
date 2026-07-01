import { useState } from "react";
import InlineAlert from "./InlineAlert";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export default function ForceChangePassword() {
  const { refreshMe, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bastion-950 px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-amber-500/8 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">Bastion</h1>
          <p className="mt-2 text-sm text-amber-400">
            Mot de passe par défaut détecté — changement requis
          </p>
        </div>

        <div className="glass-card p-8">
          <p className="mb-5 text-sm text-slate-400">
            Ce compte administrateur utilise encore le mot de passe par défaut.
            Choisissez-en un nouveau avant de continuer.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <InlineAlert variant="error">{error}</InlineAlert>}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Mot de passe actuel
              </label>
              <input
                className="input-field"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Nouveau mot de passe
              </label>
              <input
                className="input-field"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Confirmer le nouveau mot de passe
              </label>
              <input
                className="input-field"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? "Enregistrement…" : "Changer le mot de passe"}
            </button>

            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => void logout()}
            >
              Se déconnecter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
