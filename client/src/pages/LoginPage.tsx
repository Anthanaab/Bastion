import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, loading, login, loginTotp } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bastion-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-bastion-accent border-t-transparent" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (challenge) {
        await loginTotp(challenge, totp);
        return;
      }
      const result = await login(username, password, totp || undefined);
      if (result?.requiresTotp) {
        setChallenge(result.challenge);
        setTotp("");
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bastion-950 px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-bastion-accent/8 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">Bastion</h1>
          <p className="mt-2 text-sm text-slate-400">
            {challenge ? "Code d'authentification à deux facteurs" : "Connexion"}
          </p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {!challenge ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Utilisateur
                  </label>
                  <input
                    className="input-field"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Mot de passe
                  </label>
                  <input
                    className="input-field"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Code 2FA (6 chiffres)
                </label>
                <input
                  className="input-field font-mono tracking-widest"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  minLength={6}
                  maxLength={6}
                />
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
              {submitting ? "Connexion…" : challenge ? "Valider" : "Accéder au bastion"}
            </button>

            {challenge && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  setChallenge(null);
                  setTotp("");
                }}
              >
                Retour
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
