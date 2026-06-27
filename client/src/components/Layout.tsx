import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-bastion-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-bastion-accent/5 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-bastion-800/80 bg-bastion-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-bastion-accent to-bastion-accent-dim shadow-glow">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5 text-bastion-950"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 3L4 9v12h16V9l-8-6z" />
                <path d="M9 21v-6h6v6" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white group-hover:text-bastion-glow transition">
                Bastion
              </h1>
              {title && (
                <p className="text-xs text-slate-500">{title}</p>
              )}
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              to="/activity"
              className="btn-secondary hidden text-xs sm:inline-flex"
            >
              Activité
            </Link>
            <Link
              to="/settings"
              className="btn-secondary hidden text-xs sm:inline-flex"
            >
              Paramètres
            </Link>
            <span className="hidden text-sm text-slate-400 sm:block">
              {user?.username}
              {user?.role === "operator" && (
                <span className="ml-1.5 rounded bg-bastion-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                  opérateur
                </span>
              )}
            </span>
            <button onClick={() => logout()} className="btn-secondary text-xs">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
