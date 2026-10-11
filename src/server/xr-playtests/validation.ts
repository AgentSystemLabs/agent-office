import { readXrContext, readXrRequirements } from '../../shared/xr-playtests.js';
import type { XrDevice, XrRule, XrSnapshot } from '../../shared/xr-session.js';
import { PlaytestError } from '../playtests.js';
export function bounded(value: unknown, max: number, name = 'value'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PlaytestError(`Invalid ${name}`);
  return value;
}
export function devices(value: unknown): XrDevice[] {
  if (!Array.isArray(value) || value.length > 16) throw new PlaytestError('Invalid devices');
  const result = value.map(d => ({ serial: bounded(d.serial, 100), name: bounded(d.name, 160), status: bounded(d.status, 300) }));
  if (result.some(d => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(d.serial))) throw new PlaytestError('Invalid device serial');
  if (new Set(result.map(d => d.serial)).size !== result.length) throw new PlaytestError('Duplicate device');
  return result;
}
export function snapshot(value: unknown, now: number): XrSnapshot {
  if (!value || typeof value !== 'object') throw new PlaytestError('Invalid snapshot');
  const s = value as XrSnapshot;
  if (s.protocol !== 1 || !Number.isSafeInteger(s.sequence) || s.sequence < 0 || !['solo', 'host', 'guest'].includes(s.role)) throw new PlaytestError('Unsupported snapshot');
  let context;
  try { context = readXrContext(s.context); } catch { throw new PlaytestError('Invalid XR context'); }
  // Host receipt time is authoritative. The helper rejects slow device calls before sending.
  context.sampledAt = now;
  if (!s.signals || typeof s.signals !== 'object' || Array.isArray(s.signals) || Object.keys(s.signals).length > 160) throw new PlaytestError('Invalid signals');
  for (const [key, v] of Object.entries(s.signals)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/.test(key) || !['number', 'string', 'boolean'].includes(typeof v)
      || (typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && v.length > 1000)) throw new PlaytestError('Invalid signal');
  }
  if (!Array.isArray(s.events) || s.events.length > 64 || s.events.some(e => !Number.isSafeInteger(e.id) || e.id < 0 || typeof e.message !== 'string' || e.message.length > 1000 || typeof e.kind !== 'string' || e.kind.length > 40)) throw new PlaytestError('Invalid events');
  if (s.request && !['pause', 'resume', 'stop', 'bug'].includes(s.request)) throw new PlaytestError('Invalid headset request');
  return { protocol: 1, appSession: bounded(s.appSession, 100), sequence: s.sequence, context, role: s.role, signals: s.signals, events: s.events, request: s.request };
}
export function rule(value: unknown): XrRule {
  if (!value || typeof value !== 'object') throw new PlaytestError('Invalid rule');
  const r = value as XrRule;
  const phases = readXrRequirements({ test: r }).test.phases;
  if (!Number.isSafeInteger(r.revision) || r.revision < 1 || (r.role && !['host', 'guest'].includes(r.role)) || (r.twoDevices !== undefined && typeof r.twoDevices !== 'boolean')) throw new PlaytestError('Invalid prerequisites');
  if (r.signal && (!/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/.test(r.signal) || !['string', 'boolean', 'number'].includes(typeof r.equals) || (typeof r.equals === 'number' && !Number.isFinite(r.equals)) || (typeof r.equals === 'string' && r.equals.length > 1000))) throw new PlaytestError('Invalid observation criterion');
  return { phases, revision: r.revision, role: r.role, twoDevices: r.twoDevices, signal: r.signal || undefined, equals: r.equals };
}
