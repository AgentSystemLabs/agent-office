import { PLAYTEST_MODES, PLAY_STYLES, type PlaytestMode, type PlayStyle } from './playtest-categories.js';
import type { Playtest } from './playtests.js';
export const XR_PHASES = ['lobby', 'playing', 'break', 'game-over'] as const;
export interface XrContext {
  mode: Exclude<PlaytestMode, 'Allgemein'>; style: PlayStyle; phase: typeof XR_PHASES[number];
  build: string; focused: boolean; connected: boolean; sampledAt: number;
}
export interface XrRequirements { phases?: (typeof XR_PHASES[number])[] }
export function readXrContext(value: unknown): XrContext {
  if (!value || typeof value !== 'object') throw new Error('Invalid XR context');
  const v = value as XrContext;
  if (!PLAYTEST_MODES.includes(v.mode) || (v.mode as string) === 'Allgemein' || !PLAY_STYLES.includes(v.style)
    || !XR_PHASES.includes(v.phase) || typeof v.build !== 'string' || !v.build.trim() || v.build.length > 160
    || typeof v.focused !== 'boolean' || typeof v.connected !== 'boolean'
    || !Number.isSafeInteger(v.sampledAt) || v.sampledAt < 0) throw new Error('Invalid XR context');
  return { mode: v.mode, style: v.style, phase: v.phase, build: v.build.trim(), focused: v.focused, connected: v.connected, sampledAt: v.sampledAt };
}
export function readXrRequirements(value: unknown): Record<string, XrRequirements> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid requirements');
  const entries = Object.entries(value);
  if (entries.length > 2000) throw new Error('Too many requirements');
  const out: Record<string, XrRequirements> = Object.create(null);
  for (const [id, raw] of entries) {
    if (!id || id.length > 160 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid requirements');
    const phases = (raw as XrRequirements).phases;
    if (phases !== undefined && (!Array.isArray(phases) || phases.length > 4 || phases.some(p => !XR_PHASES.includes(p)))) throw new Error('Invalid phases');
    out[id] = { phases: phases === undefined ? undefined : [...new Set(phases)] };
  }
  return out;
}
/** Selection never infers scope from prose or writes a human test result. */
export function selectXrPlaytests(items: readonly Playtest[], context: XrContext | undefined, requirements: Record<string, XrRequirements> = {}, now = Date.now()) {
  const active: { id: string; revision: number }[] = [];
  const excluded: { id: string; reason: string }[] = [];
  for (const t of items) {
    let reason: string | undefined;
    if (!context || !context.connected || !context.focused || now - context.sampledAt > 5000 || context.sampledAt > now) reason = 'context-unavailable';
    else if (!t.modes?.length || t.playStyles === undefined) reason = 'classification-required';
    else if (!t.modes.includes('Allgemein') && !t.modes.includes(context.mode)) reason = 'mode';
    else if (t.playStyles.length && !t.playStyles.includes(context.style)) reason = 'style';
    else if (requirements[t.id]?.phases?.length && !requirements[t.id].phases!.includes(context.phase)) reason = 'phase';
    if (reason) excluded.push({ id: t.id, reason }); else active.push({ id: t.id, revision: t.revision });
  }
  return { active, excluded };
}
