/** Browser-local quality controls. Concrete choices also serve the settings UI and storage parser. */
export const BROWSER_PERFORMANCE_CHOICES = {
  fps: [30, 60, 90, 120, 'display'],
  idleFps: [5, 10, 15, 30],
  pixelRatio: [0.75, 1, 1.25, 1.5, 2],
  outlines: [false, true],
  shadowSize: [0, 512, 1024, 2048],
  previewFps: [15, 30, 60],
  laptopWidth: [256, 512, 1024],
  laptopRefreshMs: [250, 500, 1000, 2000],
} as const;

export type BrowserPerformance = { [K in keyof typeof BROWSER_PERFORMANCE_CHOICES]: (typeof BROWSER_PERFORMANCE_CHOICES)[K][number] };

export const PERFORMANCE_PRESETS = {
  economy: { fps: 30, idleFps: 5, pixelRatio: 1, outlines: false, shadowSize: 512, previewFps: 15, laptopWidth: 256, laptopRefreshMs: 1000 },
  balanced: { fps: 60, idleFps: 15, pixelRatio: 1.25, outlines: true, shadowSize: 1024, previewFps: 30, laptopWidth: 512, laptopRefreshMs: 500 },
  quality: { fps: 120, idleFps: 30, pixelRatio: 2, outlines: true, shadowSize: 2048, previewFps: 60, laptopWidth: 1024, laptopRefreshMs: 250 },
} as const satisfies Record<string, BrowserPerformance>;
export const DEFAULT_BROWSER_PERFORMANCE: Readonly<BrowserPerformance> = PERFORMANCE_PRESETS.balanced;

function choice<K extends keyof BrowserPerformance>(key: K, value: unknown): BrowserPerformance[K] {
  const choices: readonly unknown[] = BROWSER_PERFORMANCE_CHOICES[key];
  return choices.includes(value) ? value as BrowserPerformance[K] : DEFAULT_BROWSER_PERFORMANCE[key];
}

/** Old or malformed storage keeps each valid choice and defaults the rest. Always returns a fresh object. */
export function parseBrowserPerformance(value: unknown): BrowserPerformance {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    fps: choice('fps', saved.fps), idleFps: choice('idleFps', saved.idleFps), pixelRatio: choice('pixelRatio', saved.pixelRatio),
    outlines: choice('outlines', saved.outlines), shadowSize: choice('shadowSize', saved.shadowSize), previewFps: choice('previewFps', saved.previewFps),
    laptopWidth: choice('laptopWidth', saved.laptopWidth), laptopRefreshMs: choice('laptopRefreshMs', saved.laptopRefreshMs),
  };
}

/** Preset identity is derived, so editing one control immediately becomes Custom. */
export function performancePreset(value: BrowserPerformance): keyof typeof PERFORMANCE_PRESETS | 'custom' {
  return (Object.keys(PERFORMANCE_PRESETS) as (keyof typeof PERFORMANCE_PRESETS)[])
    .find((name) => (Object.keys(BROWSER_PERFORMANCE_CHOICES) as (keyof BrowserPerformance)[]).every((key) => value[key] === PERFORMANCE_PRESETS[name][key])) ?? 'custom';
}
