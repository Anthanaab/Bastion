import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      await login(username, password);
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
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(245,158,11,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-bastion-accent to-bastion-accent-dim shadow-glow">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-8 w-8 text-bastion-950"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 3L4 9v12h16V9l-8-6z" />
              <path d="M9 21v-6h6v6" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Bastion
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Votre passerelle d&apos;accès distant personnelle
          </p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

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

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full py-3"
            >
              {submitting ? "Connexion…" : "Accéder au bastion"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          SSH · RDP · VNC — auto-hébergé
        </p>
      </div>
    </div>
  );
}
