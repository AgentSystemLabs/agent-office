import type { Usage, PlanLimits } from '../shared/protocol.js';

/** Validate a provider snapshot before displaying or restoring it. Never turn invalid data into zero. */
export function reportedUsage(value: unknown): Usage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!['input', 'output', 'cacheWrite', 'cacheRead', 'calls'].every(k => count(v[k]))) return;
  if (typeof v.cost !== 'number' || !Number.isFinite(v.cost) || v.cost < 0) return;
  if (v.reasoning !== undefined && !count(v.reasoning)) return;
  if (v.totalTokens !== undefined && !count(v.totalTokens)) return;
  if (v.contextSize !== undefined && !count(v.contextSize)) return;
  if (v.callsKnown !== undefined && typeof v.callsKnown !== 'boolean') return;
  if (v.incomplete !== undefined && typeof v.incomplete !== 'boolean') return;
  if (v.costKnown !== undefined && typeof v.costKnown !== 'boolean') return;
  let planLimits: PlanLimits | undefined;
  if (v.planLimits && typeof v.planLimits === 'object') {
    const limits = v.planLimits as PlanLimits;
    if (count(limits.at) && Array.isArray(limits.windows) && limits.windows.length <= 2
      && limits.windows.every(w => w && typeof w.label === 'string' && w.label.length <= 24
        && typeof w.pct === 'number' && Number.isFinite(w.pct) && w.pct >= 0 && w.pct <= 100
        && (w.resetsAt === undefined || count(w.resetsAt)))) {
      planLimits = { at: limits.at, windows: limits.windows.map(w => ({ label: w.label, pct: w.pct, resetsAt: w.resetsAt })) };
    }
  }
  return {
    ...(planLimits ? { planLimits } : {}),
    input: v.input as number, output: v.output as number,
    cacheWrite: v.cacheWrite as number, cacheRead: v.cacheRead as number,
    cost: v.cost, calls: v.calls as number,
    ...(v.reasoning === undefined ? {} : { reasoning: v.reasoning as number }),
    ...(v.totalTokens === undefined ? {} : { totalTokens: v.totalTokens as number }),
    ...(v.contextSize === undefined ? {} : { contextSize: v.contextSize as number }),
    ...(v.callsKnown === undefined ? {} : { callsKnown: v.callsKnown as boolean }),
    ...(v.incomplete === undefined ? {} : { incomplete: v.incomplete as boolean }),
    ...(v.costKnown === undefined ? {} : { costKnown: v.costKnown as boolean }),
  };
}
