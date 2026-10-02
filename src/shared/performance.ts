/** Building-wide background-work cadence, editable only by office admins. */
export const OFFICE_PERFORMANCE_CHOICES = {
  screenFps: [1, 2, 4],
  serviceScanSeconds: [4, 10, 30],
  changesPollSeconds: [2, 5, 10],
  usageScanSeconds: [2, 5, 10, 30],
} as const;

export type OfficePerformanceSettings = {
  [K in keyof typeof OFFICE_PERFORMANCE_CHOICES]: (typeof OFFICE_PERFORMANCE_CHOICES)[K][number];
};

export const DEFAULT_OFFICE_PERFORMANCE: Readonly<OfficePerformanceSettings> = {
  screenFps: 2, serviceScanSeconds: 10, changesPollSeconds: 5, usageScanSeconds: 10,
};

export function isOfficePerformanceSettings(value: unknown): value is OfficePerformanceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(OFFICE_PERFORMANCE_CHOICES).every(([key, choices]) =>
    choices.some(choice => choice === record[key]));
}
