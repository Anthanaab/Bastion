import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Spinner from "./components/Spinner";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SessionPage from "./pages/SessionPage";
import SettingsPage from "./pages/SettingsPage";
import ActivityPage from "./pages/ActivityPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, reloadAuth, abortAuth } = useAuth();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bastion-950 px-6 text-center">
        <Spinner />
        <p className="max-w-sm text-sm text-slate-400">
          {slow
            ? "Le serveur met du temps à répondre — souvent lié au VPN ou au réseau mobile."
            : "Chargement…"}
        </p>
        {slow && (
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="btn-primary min-h-[44px]"
              onClick={() => void reloadAuth()}
            >
              Réessayer
            </button>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              onClick={abortAuth}
            >
              Retour connexion
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/activity"
        element={
          <ProtectedRoute>
            <ActivityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/session/:hostId"
        element={
          <ProtectedRoute>
            <SessionPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
