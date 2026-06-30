import { useEffect, useState } from "react";
import {
  DEFAULT_RDP_DISPLAY_SETTINGS,
  RDP_MAX_HEIGHT,
  RDP_MAX_WIDTH,
  RDP_MIN_HEIGHT,
  RDP_MIN_WIDTH,
  RDP_QUALITY_PROFILES,
  RDP_RESOLUTION_PRESETS,
  normalizeRdpDisplaySettings,
  type RdpDisplaySettings,
  type RdpQualityProfile,
  type RdpResolutionMode,
} from "../lib/rdpSettings";

interface RdpSettingsPanelProps {
  open: boolean;
  settings: RdpDisplaySettings;
  onClose: () => void;
  onApply: (settings: RdpDisplaySettings) => void;
}

function presetValue(width: number, height: number): string {
  const match = RDP_RESOLUTION_PRESETS.find(
    (preset) => preset.width === width && preset.height === height
  );
  return match ? `${match.width}x${match.height}` : "custom";
}

export default function RdpSettingsPanel({
  open,
  settings,
  onClose,
  onApply,
}: RdpSettingsPanelProps) {
  const [draft, setDraft] = useState<RdpDisplaySettings>(settings);
  const [preset, setPreset] = useState(() => presetValue(settings.width, settings.height));

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeRdpDisplaySettings(settings);
    setDraft(normalized);
    setPreset(presetValue(normalized.width, normalized.height));
  }, [open, settings]);

  if (!open) return null;

  const updateDraft = (patch: Partial<RdpDisplaySettings>) => {
    setDraft((prev) => normalizeRdpDisplaySettings({ ...prev, ...patch }));
  };

  const handlePresetChange = (value: string) => {
    setPreset(value);
    if (value === "custom") return;
    const [widthRaw, heightRaw] = value.split("x");
    const width = parseInt(widthRaw ?? "", 10);
    const height = parseInt(heightRaw ?? "", 10);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      updateDraft({ width, height });
    }
  };

  const handleApply = () => {
    onApply(normalizeRdpDisplaySettings(draft));
    onClose();
  };

  const handleReset = () => {
    const defaults = { ...DEFAULT_RDP_DISPLAY_SETTINGS };
    setDraft(defaults);
    setPreset(presetValue(defaults.width, defaults.height));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 max-sm:bg-black/70 sm:backdrop-blur-sm"
        aria-label="Fermer les réglages RDP"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-bastion-700 bg-bastion-950 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-bastion-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Réglages RDP</h2>
            <p className="text-xs text-slate-500">
              Appliquer reconnecte la session avec les nouveaux paramètres.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-3 py-2 text-xs"
          >
            Fermer
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-3 text-sm font-medium text-slate-200">Résolution</h3>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-bastion-800 bg-bastion-900/60 p-3">
                <input
                  type="radio"
                  name="resolutionMode"
                  className="mt-1"
                  checked={draft.resolutionMode === "auto"}
                  onChange={() => updateDraft({ resolutionMode: "auto" satisfies RdpResolutionMode })}
                />
                <span>
                  <span className="block text-sm text-slate-200">Automatique</span>
                  <span className="block text-xs text-slate-500">
                    Adapte la résolution à la taille du panneau d&apos;affichage.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-bastion-800 bg-bastion-900/60 p-3">
                <input
                  type="radio"
                  name="resolutionMode"
                  className="mt-1"
                  checked={draft.resolutionMode === "manual"}
                  onChange={() => updateDraft({ resolutionMode: "manual" satisfies RdpResolutionMode })}
                />
                <span>
                  <span className="block text-sm text-slate-200">Manuelle</span>
                  <span className="block text-xs text-slate-500">
                    Force une résolution fixe côté serveur distant.
                  </span>
                </span>
              </label>
            </div>

            {draft.resolutionMode === "manual" && (
              <div className="mt-4 space-y-3 rounded-lg border border-bastion-800 bg-bastion-900/40 p-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Préréglage
                  </label>
                  <select
                    className="input-field"
                    value={preset}
                    onChange={(e) => handlePresetChange(e.target.value)}
                  >
                    {RDP_RESOLUTION_PRESETS.map((item) => (
                      <option key={item.label} value={`${item.width}x${item.height}`}>
                        {item.label}
                      </option>
                    ))}
                    <option value="custom">Personnalisée</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Largeur
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      min={RDP_MIN_WIDTH}
                      max={RDP_MAX_WIDTH}
                      value={draft.width}
                      onChange={(e) => {
                        setPreset("custom");
                        updateDraft({ width: parseInt(e.target.value, 10) });
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Hauteur
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      min={RDP_MIN_HEIGHT}
                      max={RDP_MAX_HEIGHT}
                      value={draft.height}
                      onChange={(e) => {
                        setPreset("custom");
                        updateDraft({ height: parseInt(e.target.value, 10) });
                      }}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Bornes : {RDP_MIN_WIDTH}–{RDP_MAX_WIDTH} × {RDP_MIN_HEIGHT}–{RDP_MAX_HEIGHT}
                </p>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-slate-200">Profil qualité</h3>
            <div className="space-y-2">
              {(Object.keys(RDP_QUALITY_PROFILES) as RdpQualityProfile[]).map((profile) => {
                const meta = RDP_QUALITY_PROFILES[profile];
                return (
                  <label
                    key={profile}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      draft.qualityProfile === profile
                        ? "border-bastion-accent/50 bg-bastion-accent/10"
                        : "border-bastion-800 bg-bastion-900/60 hover:border-bastion-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="qualityProfile"
                      className="mt-1"
                      checked={draft.qualityProfile === profile}
                      onChange={() => updateDraft({ qualityProfile: profile })}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-200">
                        {meta.label}
                      </span>
                      <span className="block text-xs text-slate-500">{meta.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-bastion-800 px-5 py-4">
          <button type="button" onClick={handleReset} className="btn-secondary text-xs">
            Réinitialiser
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Annuler
            </button>
            <button type="button" onClick={handleApply} className="btn-primary text-xs">
              Appliquer
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
