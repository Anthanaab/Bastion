import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navLinks = [
  { to: "/activity", label: "Activité" },
  { to: "/settings", label: "Paramètres" },
] as const;

export default function Layout({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="page-shell">
      <div className="pointer-events-none fixed inset-0 hidden overflow-hidden sm:block">
        <div className="absolute -left-40 top-0 h-96 w-96 rounded-full bg-bastion-accent/5 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-bastion-800/80 bg-bastion-950 sm:bg-bastion-950/80 sm:backdrop-blur-md">
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
              <h1 className="text-lg font-bold tracking-tight text-white transition group-hover:text-bastion-glow">
                Bastion
              </h1>
              {title && <p className="text-xs text-slate-500">{title}</p>}
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`btn-secondary hidden min-h-[44px] text-xs sm:inline-flex ${
                  location.pathname === to
                    ? "border-bastion-accent/50 text-white"
                    : ""
                }`}
              >
                {label}
              </Link>
            ))}
            <span className="hidden text-sm text-slate-400 sm:block">
              {user?.username}
              {user?.role === "operator" && (
                <span className="ml-1.5 rounded bg-bastion-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                  opérateur
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="btn-secondary hidden min-h-[44px] text-xs sm:inline-flex"
            >
              Déconnexion
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="btn-icon min-h-[44px] min-w-[44px] sm:hidden"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5"
                stroke="currentColor"
                strokeWidth="2"
              >
                {menuOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="relative z-30 border-t border-bastion-800 bg-bastion-950 px-4 py-3 sm:hidden">
            <div className="mb-3 text-sm text-slate-400">
              {user?.username}
              {user?.role === "operator" && (
                <span className="ml-1.5 rounded bg-bastion-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                  opérateur
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {navLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    location.pathname === to
                      ? "bg-bastion-accent text-bastion-950"
                      : "text-slate-300 hover:bg-bastion-800"
                  }`}
                >
                  {label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => logout()}
                className="min-h-[44px] rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-300 transition hover:bg-bastion-800"
              >
                Déconnexion
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="page-main">{children}</main>
    </div>
  );
}
