import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { XrRun } from '../../shared/xr-session.js';
import { PlaytestError } from '../playtests.js';
export function requestCommand(run: XrRun, value: unknown, now = Date.now()) {
  const v = value as { device: string; kind: string; confirmed?: boolean };
  if (!v || !run.selected.includes(v.device) || !['screenshot', 'reserve-ammo'].includes(v.kind) || run.status !== 'running') throw new PlaytestError('Aktiven Testlauf und ausgewähltes Headset verwenden.');
  if (v.kind === 'reserve-ammo' && v.confirmed !== true) throw new PlaytestError('Testvorbereitung muss ausdrücklich gewählt werden.');
  if (run.commands?.some(c => c.status === 'pending')) throw new PlaytestError('Eine Geräteaktion läuft bereits.', 409);
  const sample = run.snapshots[v.device];
  if (!sample || now - sample.context.sampledAt > 5000 || !sample.context.focused) throw new PlaytestError('Headset ist nicht aktiv verbunden.', 409);
  run.commands = [...(run.commands ?? []), { id: randomUUID(), device: v.device, kind: v.kind as 'screenshot' | 'reserve-ammo', at: now, build: sample.context.build, appSession: sample.appSession, status: 'pending' as const }].slice(-30);
}
export function commandResults(dir: string, run: XrRun, results: unknown, now: number) {
  if (results !== undefined && (!Array.isArray(results) || results.length > 2)) throw new PlaytestError('Invalid command results');
  for (const result of (results ?? []) as { id: string; error?: string; message?: string; png?: string }[]) {
    const command = run.commands?.find(c => c.id === result.id);
    if (!command) throw new PlaytestError('Unknown device action');
    if (command.status !== 'pending') continue;
    if (result.error) { command.status = 'error'; command.result = String(result.error).slice(0, 500); continue; }
    if (command.kind === 'screenshot') {
      if (typeof result.png !== 'string' || result.png.length > 16000000) throw new PlaytestError('Invalid screenshot');
      const bytes = Buffer.from(result.png, 'base64');
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new PlaytestError('Not a PNG screenshot');
      const folder = path.join(dir, '.agent-office', 'xr-evidence', run.id); mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, command.id + '.png'), bytes); command.artifact = true;
    }
    command.status = 'done'; command.result = String(result.message ?? 'Gespeichert').slice(0, 500);
  }
  for (const c of run.commands ?? []) if (c.status === 'pending' && now - c.at > 30000) { c.status = 'error'; c.result = 'Keine Bestätigung erhalten. Wirkung nicht bestätigt; nicht automatisch wiederholt.'; }
}
