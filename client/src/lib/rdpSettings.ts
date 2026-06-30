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

export function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

function isLandscapeOrientation(): boolean {
  return window.matchMedia("(orientation: landscape)").matches;
}

/** iOS Safari peut inverser ou retarder width/height après rotation */
function alignToOrientation(
  width: number,
  height: number,
  landscape: boolean
): { width: number; height: number } {
  if (landscape && width < height) {
    return { width: height, height: width };
  }
  if (!landscape && width > height) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function measureViewport(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  const vv = window.visualViewport;
  const landscape = isLandscapeOrientation();
  const containerWidth = container?.clientWidth ?? 0;
  const containerHeight = container?.clientHeight ?? 0;

  if (isMobileViewport()) {
    let width = Math.round(vv?.width ?? window.innerWidth);
    let height = Math.round(vv?.height ?? window.innerHeight);
    if (containerWidth > 0) width = Math.max(width, containerWidth);
    if (containerHeight > 0) height = Math.max(height, containerHeight);
    return alignToOrientation(width, height, landscape);
  }

  let width = containerWidth;
  let height = containerHeight;
  if (width < 64 || height < 64) {
    width = Math.round(vv?.width ?? window.innerWidth);
    height = Math.round(vv?.height ?? window.innerHeight);
  }
  return alignToOrientation(width, height, landscape);
}

/** Facteur d'échelle Guacamole — paysage mobile : remplir la largeur (pas de bandes latérales) */
export function computeDisplayScale(
  viewport: { width: number; height: number },
  display: { width: number; height: number },
  options: { mobile: boolean; coarse: boolean }
): number {
  const { width: vw, height: vh } = viewport;
  const { width: dw, height: dh } = display;
  if (!dw || !dh || !vw || !vh) return 1;

  const widthRatio = vw / dw;
  const heightRatio = vh / dh;
  const landscape = vw > vh;

  if ((options.mobile || options.coarse) && landscape) {
    return widthRatio;
  }
  if (options.mobile || options.coarse) {
    return Math.min(widthRatio, heightRatio, 1);
  }
  return Math.min(widthRatio, heightRatio);
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

  const measured = measureViewport(container);
  const fallbackWidth = isMobileViewport() ? 390 : DEFAULT_RDP_DISPLAY_SETTINGS.width;
  const fallbackHeight = isMobileViewport() ? 844 : DEFAULT_RDP_DISPLAY_SETTINGS.height;
  return {
    width: Math.min(
      RDP_MAX_WIDTH,
      Math.max(RDP_MIN_WIDTH, measured.width || fallbackWidth)
    ),
    height: Math.min(
      RDP_MAX_HEIGHT,
      Math.max(RDP_MIN_HEIGHT, measured.height || fallbackHeight)
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
