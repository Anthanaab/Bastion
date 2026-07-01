import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ForceChangePassword from "./components/ForceChangePassword";
import Spinner from "./components/Spinner";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";

// Chargées à la demande : la page Session embarque guacamole-common-js et
// xterm.js — les découper évite de les télécharger avant la première connexion.
const SessionPage = lazy(() => import("./pages/SessionPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const InfrastructurePage = lazy(() => import("./pages/InfrastructurePage"));

function PageLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bastion-950">
      <Spinner />
    </div>
  );
}

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
  if (user.mustChangePassword) return <ForceChangePassword />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
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
          path="/infrastructure"
          element={
            <ProtectedRoute>
              <InfrastructurePage />
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
    </Suspense>
  );
}
