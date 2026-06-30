import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import InlineAlert from "../components/InlineAlert";
import Layout from "../components/Layout";
import RdpSettingsPanel from "../components/RdpSettingsPanel";
import RemoteViewer from "../components/RemoteViewer";
import Spinner from "../components/Spinner";
import SshTerminal from "../components/SshTerminal";
import { ProtocolBadge } from "../components/ProtocolBadge";
import { api } from "../lib/api";
import {
  loadRdpDisplaySettings,
  RDP_QUALITY_PROFILES,
  saveRdpDisplaySettings,
  type RdpDisplaySettings,
} from "../lib/rdpSettings";
import type { ConnectionStatus, SessionControl } from "../lib/session";
import type { Host } from "../types";

export default function SessionPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const [host, setHost] = useState<Host | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionControl | null>(null);
  const [clipboardMsg, setClipboardMsg] = useState("");
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [clipboardText, setClipboardText] = useState("");
  const [rdpSettingsOpen, setRdpSettingsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [rdpSettings, setRdpSettings] = useState<RdpDisplaySettings>(() =>
    loadRdpDisplaySettings(hostId ?? "")
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const sessionRootRef = useRef<HTMLDivElement>(null);
  const remoteReconnectRef = useRef<(() => void) | null>(null);
  const fullscreenRef = useRef<(() => void) | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>({
    message: "Initialisation…",
  });

  const handleSessionControl = useCallback((control: SessionControl | null) => {
    setSession(control);
  }, []);

  useEffect(() => {
    setSession(null);
    setMobileActionsOpen(false);
    setConnStatus({ message: "Initialisation…" });
    setImmersive(false);
    if (hostId) {
      setRdpSettings(loadRdpDisplaySettings(hostId));
    }
  }, [hostId]);

  useEffect(() => {
    setMobileActionsOpen(false);
  }, [session?.connected]);

  useEffect(() => {
    document.body.classList.toggle("overflow-hidden", immersive);
    return () => document.body.classList.remove("overflow-hidden");
  }, [immersive]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setImmersive(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const enterRdpFullscreen = async () => {
    setImmersive(true);
    const root = sessionRootRef.current;
    if (!root?.requestFullscreen) return;
    try {
      await root.requestFullscreen();
    } catch {
      // iOS Safari : mode immersif CSS uniquement
    }
  };

  const exitRdpFullscreen = async () => {
    setImmersive(false);
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  const toggleRdpFullscreen = () => {
    if (immersive) void exitRdpFullscreen();
    else void enterRdpFullscreen();
  };

  fullscreenRef.current = toggleRdpFullscreen;

  useEffect(() => {
    if (!hostId) return;
    api
      .host(hostId)
      .then(setHost)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hostId]);

  const handlePasteClipboard = async () => {
    if (!session?.rdp) return;
    setClipboardMsg("");
    try {
      await session.rdp.pasteClipboard();
      setClipboardMsg("Presse-papiers envoyé");
      setTimeout(() => setClipboardMsg(""), 2500);
    } catch {
      setClipboardText("");
      setClipboardOpen(true);
    }
  };

  const handleApplyRdpSettings = (settings: RdpDisplaySettings) => {
    if (!hostId) return;
    saveRdpDisplaySettings(hostId, settings);
    setRdpSettings(settings);
  };

  const rdpSettingsSummary =
    rdpSettings &&
    `${rdpSettings.resolutionMode === "auto" ? "Auto" : `${rdpSettings.width}×${rdpSettings.height}`} · ${
      RDP_QUALITY_PROFILES[rdpSettings.qualityProfile].label
    }`;

  const handleSendClipboardText = () => {
    if (!session?.rdp || !clipboardText.trim()) return;
    session.rdp.pasteText(clipboardText);
    setClipboardOpen(false);
    setClipboardMsg("Texte envoyé au bureau distant");
    setTimeout(() => setClipboardMsg(""), 2500);
  };

  const statusLabel =
    session?.connected
      ? "Connecté"
      : connStatus.error || connStatus.message || session?.status || `Session ${host?.protocol.toUpperCase() ?? ""}`;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </Layout>
    );
  }

  if (error || !host) {
    return (
      <Layout>
        <div className="glass-card p-8 text-center">
          <InlineAlert variant="error">{error || "Hôte introuvable"}</InlineAlert>
          <Link to="/" className="btn-primary mt-4 inline-flex">
            Retour
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <div
      ref={sessionRootRef}
      className={
        immersive
          ? "session-shell-immersive flex flex-col"
          : "session-shell flex flex-col bg-bastion-950"
      }
    >
      {!immersive && (
      <header className="session-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link to="/" className="btn-secondary shrink-0 min-h-[44px] py-2 text-xs">
              ← Retour
            </Link>
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: host.color }}
              />
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-white">
                  {host.name}
                </h1>
                <p className="truncate font-mono text-xs text-slate-500">
                  {host.hostname}:{host.port}
                </p>
              </div>
              <ProtocolBadge protocol={host.protocol} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {host.protocol === "rdp" && (
              <button
                type="button"
                onClick={() => setRdpSettingsOpen(true)}
                className="btn-secondary min-h-[44px] py-2 text-xs"
                title={rdpSettingsSummary ?? "Réglages RDP"}
              >
                Réglages
              </button>
            )}
            {session?.connected && session.rdp && host.protocol === "rdp" && (
              <button
                type="button"
                onClick={toggleRdpFullscreen}
                className="btn-primary min-h-[44px] px-3 py-2 text-xs"
                aria-label="Plein écran"
              >
                ⛶ Plein écran
              </button>
            )}
            {session?.connected && session.rdp && (
              <>
                <button
                  type="button"
                  onClick={() => session.rdp!.sendCtrlAltDel()}
                  className="btn-secondary hidden min-h-[44px] py-2 text-xs sm:inline-flex"
                >
                  Ctrl+Alt+Suppr
                </button>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="btn-secondary hidden min-h-[44px] py-2 text-xs sm:inline-flex"
                >
                  Coller
                </button>
                <button
                  type="button"
                  onClick={() => setMobileActionsOpen((open) => !open)}
                  className="btn-secondary min-h-[44px] py-2 text-xs sm:hidden"
                  aria-expanded={mobileActionsOpen}
                >
                  Plus
                </button>
              </>
            )}

            {connStatus.manualReconnect && (
              <button
                type="button"
                onClick={() => remoteReconnectRef.current?.()}
                className="btn-primary min-h-[44px] py-2 text-xs sm:hidden"
              >
                Reconnecter
              </button>
            )}

            {session?.connected ? (
              <>
                <span className="hidden items-center gap-2 text-xs font-medium text-emerald-400 sm:flex">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Connecté
                </span>
                <button
                  type="button"
                  onClick={() => session.disconnect()}
                  className="btn-danger min-h-[44px]"
                >
                  Déconnecter
                </button>
              </>
            ) : (
              !connStatus.manualReconnect && (
                <span
                  className={`max-w-[10rem] truncate text-xs sm:max-w-none ${
                    connStatus.error ? "text-red-300" : "text-slate-500"
                  }`}
                >
                  {statusLabel}
                </span>
              )
            )}
            {!session?.connected && session?.reconnect && (
              <button
                type="button"
                onClick={() => session.reconnect?.()}
                className="btn-secondary min-h-[44px] py-2 text-xs"
              >
                Reconnecter
              </button>
            )}
          </div>
        </div>

        {!session?.connected && (
          <p
            className={`mt-2 text-xs sm:hidden ${
              connStatus.error ? "text-red-300" : "text-slate-400"
            }`}
          >
            {statusLabel}
          </p>
        )}

        {mobileActionsOpen && session?.connected && session.rdp && (
          <div className="mt-3 flex flex-col gap-2 border-t border-bastion-800 pt-3 sm:hidden">
            <button
              type="button"
              onClick={() => {
                session.rdp!.focusKeyboard();
                setMobileActionsOpen(false);
              }}
              className="btn-secondary w-full py-2 text-xs"
            >
              ⌨️ Clavier
            </button>
            <button
              type="button"
              onClick={() => {
                session.rdp!.sendCtrlAltDel();
                setMobileActionsOpen(false);
              }}
              className="btn-secondary w-full py-2 text-xs"
            >
              Ctrl+Alt+Suppr
            </button>
            <button
              type="button"
              onClick={() => {
                void handlePasteClipboard();
                setMobileActionsOpen(false);
              }}
              className="btn-secondary w-full py-2 text-xs"
            >
              Coller
            </button>
          </div>
        )}
      </header>
      )}

      {immersive && session?.connected && (
        <div className="session-exit-immersive flex gap-2">
          {session.rdp && (
            <button
              type="button"
              onClick={() => session.rdp!.focusKeyboard()}
              aria-label="Clavier"
              className="btn-secondary relative z-[101] min-h-[44px] px-4 text-xs"
            >
              ⌨️
            </button>
          )}
          <button
            type="button"
            onClick={toggleRdpFullscreen}
            className="btn-primary relative z-[101] min-h-[44px] px-4 text-xs"
          >
            Réduire
          </button>
        </div>
      )}

      {clipboardMsg && (
        <InlineAlert variant="success" className="shrink-0 rounded-none border-x-0 py-2 text-center text-xs">
          {clipboardMsg}
        </InlineAlert>
      )}

      <div
        ref={viewportRef}
        className={immersive ? "session-viewport-immersive" : "session-viewport"}
      >
        {host.protocol === "ssh" ? (
          <SshTerminal hostId={host.id} onSessionControl={handleSessionControl} />
        ) : (
          <RemoteViewer
            hostId={host.id}
            protocol={host.protocol}
            rdpSettings={host.protocol === "rdp" ? rdpSettings : undefined}
            onSessionControl={handleSessionControl}
            onStatusChange={setConnStatus}
            reconnectRef={remoteReconnectRef}
            fullscreenRef={fullscreenRef}
            immersive={immersive}
            viewportRef={viewportRef}
          />
        )}
      </div>

      {host.protocol === "rdp" && (
        <RdpSettingsPanel
          open={rdpSettingsOpen}
          settings={rdpSettings}
          onClose={() => setRdpSettingsOpen(false)}
          onApply={handleApplyRdpSettings}
        />
      )}

      {clipboardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 max-sm:bg-black/70 sm:backdrop-blur-sm"
            onClick={() => setClipboardOpen(false)}
          />
          <div className="glass-card relative z-10 w-full max-w-md p-5">
            <h3 className="mb-2 text-sm font-semibold text-white">
              Coller du texte
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Le navigateur bloque l&apos;accès direct au presse-papiers.
              Collez ici (Ctrl+V) ou saisissez le texte à envoyer au PC distant.
              Vous pouvez aussi cliquer dans la session RDP puis Ctrl+V.
            </p>
            <textarea
              className="input-field mb-4 min-h-[120px] font-mono text-sm"
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              autoFocus
              placeholder="Collez votre texte ici…"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setClipboardOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSendClipboardText}
                disabled={!clipboardText.trim()}
              >
                Envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
