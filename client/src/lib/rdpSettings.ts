export type RdpQualityProfile = "performance" | "balanced" | "quality";

export type RdpResolutionMode = "auto" | "manual";

export interface RdpDisplaySettings {
  resolutionMode: RdpResolutionMode;
  width: number;
  height: number;
  qualityProfile: RdpQualityProfile;
}

export const RDP_RESOLUTION_PRESETS = [
  { label: "1280 × 720 (HD)", width: 1280, height: 720 },
  { label: "1920 × 1080 (Full HD)", width: 1920, height: 1080 },
  { label: "2560 × 1440 (QHD)", width: 2560, height: 1440 },
  { label: "3840 × 2160 (4K)", width: 3840, height: 2160 },
] as const;

export const RDP_MIN_WIDTH = 320;
export const RDP_MAX_WIDTH = 3840;
export const RDP_MIN_HEIGHT = 240;
export const RDP_MAX_HEIGHT = 2160;

/** Résolution RDP virtuelle sur mobile — affichée réduite pour voir tout le bureau */
export const MOBILE_RDP_WIDTH = 1280;
export const MOBILE_RDP_HEIGHT = 720;

export function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

export function measureViewport(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  const vv = window.visualViewport;
  let width = container?.clientWidth ?? 0;
  let height = container?.clientHeight ?? 0;
  if (width < 64 || height < 64) {
    width = vv?.width ?? window.innerWidth;
    height = vv?.height ?? window.innerHeight;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

export const RDP_QUALITY_PROFILES: Record<
  RdpQualityProfile,
  { label: string; description: string }
> = {
  performance: {
    label: "Performance",
    description: "16 bits, sans effets visuels — idéal pour connexions lentes",
  },
  balanced: {
    label: "Équilibré",
    description: "24 bits, lissage des polices — bon compromis (défaut)",
  },
  quality: {
    label: "Qualité",
    description: "32 bits, GFX RDP et effets bureau — meilleur rendu",
  },
};

const STORAGE_PREFIX = "bastion_rdp_settings_";

export const DEFAULT_RDP_DISPLAY_SETTINGS: RdpDisplaySettings = {
  resolutionMode: "auto",
  width: 1920,
  height: 1080,
  qualityProfile: "balanced",
};

function clampResolution(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isQualityProfile(value: unknown): value is RdpQualityProfile {
  return value === "performance" || value === "balanced" || value === "quality";
}

function isResolutionMode(value: unknown): value is RdpResolutionMode {
  return value === "auto" || value === "manual";
}

export function normalizeRdpDisplaySettings(
  raw: Partial<RdpDisplaySettings> | null | undefined
): RdpDisplaySettings {
  const settings = { ...DEFAULT_RDP_DISPLAY_SETTINGS, ...raw };
  return {
    resolutionMode: isResolutionMode(settings.resolutionMode)
      ? settings.resolutionMode
      : DEFAULT_RDP_DISPLAY_SETTINGS.resolutionMode,
    width: clampResolution(
      settings.width,
      RDP_MIN_WIDTH,
      RDP_MAX_WIDTH,
      DEFAULT_RDP_DISPLAY_SETTINGS.width
    ),
    height: clampResolution(
      settings.height,
      RDP_MIN_HEIGHT,
      RDP_MAX_HEIGHT,
      DEFAULT_RDP_DISPLAY_SETTINGS.height
    ),
    qualityProfile: isQualityProfile(settings.qualityProfile)
      ? settings.qualityProfile
      : DEFAULT_RDP_DISPLAY_SETTINGS.qualityProfile,
  };
}

export function loadRdpDisplaySettings(hostId: string): RdpDisplaySettings {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${hostId}`);
    if (!raw) return { ...DEFAULT_RDP_DISPLAY_SETTINGS };
    return normalizeRdpDisplaySettings(JSON.parse(raw) as Partial<RdpDisplaySettings>);
  } catch {
    return { ...DEFAULT_RDP_DISPLAY_SETTINGS };
  }
}

export function saveRdpDisplaySettings(hostId: string, settings: RdpDisplaySettings): void {
  localStorage.setItem(
    `${STORAGE_PREFIX}${hostId}`,
    JSON.stringify(normalizeRdpDisplaySettings(settings))
  );
}

export function resolveRdpResolution(
  settings: RdpDisplaySettings,
  container: HTMLElement | null
): { width: number; height: number } {
  if (settings.resolutionMode === "manual") {
    return {
      width: settings.width,
      height: settings.height,
    };
  }

  if (isMobileViewport()) {
    return { width: MOBILE_RDP_WIDTH, height: MOBILE_RDP_HEIGHT };
  }

  const measured = measureViewport(container);
  return {
    width: Math.min(
      RDP_MAX_WIDTH,
      Math.max(RDP_MIN_WIDTH, measured.width || DEFAULT_RDP_DISPLAY_SETTINGS.width)
    ),
    height: Math.min(
      RDP_MAX_HEIGHT,
      Math.max(RDP_MIN_HEIGHT, measured.height || DEFAULT_RDP_DISPLAY_SETTINGS.height)
    ),
  };
}

export function rdpSettingsSignature(settings: RdpDisplaySettings): string {
  const normalized = normalizeRdpDisplaySettings(settings);
  return [
    normalized.resolutionMode,
    normalized.width,
    normalized.height,
    normalized.qualityProfile,
  ].join(":");
}
