import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Playtest } from '../../shared/playtests.js';
import type { XrRun, XrRule, XrView, XrSnapshot } from '../../shared/xr-session.js';
import { selectXrPlaytests } from '../../shared/xr-playtests.js';
import { PlaytestError } from '../playtests.js';
import { devices, rule, snapshot } from './validation.js';
import { commandResults, requestCommand } from './commands.js';
type StoredRun = XrRun & { tokenHash: string; bridgeId?: string };
type RunRef = Pick<StoredRun, 'id' | 'owner' | 'createdAt' | 'status'>;
interface Data { runs: (StoredRun | RunRef)[]; rules: Record<string, XrRule> }
const evidenceVersion = Symbol('evidence version');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class XrSessions {
  private file: string;
  constructor(private dir: string) { this.file = path.join(dir, '.agent-office', 'xr-sessions.json'); }
  private load(): Data {
    return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { runs: [], rules: {} };
  }
  private save(data: Data) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const atomic = (file: string, value: unknown) => {
      const temp = file + '.' + randomUUID() + '.tmp';
      writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, file);
    };
    const runs = data.runs.map(run => {
      if ('tokenHash' in run) {
        const folder = path.join(this.dir, '.agent-office', 'xr-runs'); mkdirSync(folder, { recursive: true });
        const { observations, ...state } = run;
        // Heartbeats must not rewrite every historical run or the unchanged evidence ring.
        if ((run as StoredRun & { [evidenceVersion]?: string })[evidenceVersion] !== observations.at(-1)?.id || !existsSync(path.join(folder, run.id + '.evidence.json')))
          atomic(path.join(folder, run.id + '.evidence.json'), observations);
        atomic(path.join(folder, run.id + '.json'), state);
      }
      const { id, owner, createdAt, status } = run; return { id, owner, createdAt, status };
    });
    atomic(this.file, { runs, rules: data.rules });
  }
  tests(): Playtest[] {
    const file = path.join(this.dir, '.agent-office', 'playtests.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).items : [];
  }
  start(owner: string) {
    const data = this.load();
    if (data.runs.some(r => r.owner === owner && r.status !== 'stopped')) throw new PlaytestError('Eine Begleitung läuft bereits. Öffne sie oder beende sie zuerst.', 409);
    const token = randomBytes(32).toString('hex');
    const run: StoredRun = { id: randomUUID(), owner, tokenHash: hash(token), createdAt: Date.now(), status: 'pairing', selected: [], devices: [], snapshots: {}, pinnedBuilds: {}, observations: [] };
    data.runs.push(run);
    while (data.runs.length > 100) { const expired = data.runs.findIndex(r => r.status === 'stopped'); if (expired < 0) break; data.runs.splice(expired, 1); }
    this.save(data);
    return { id: run.id, token };
  }
  private find(data: Data, id: string, owner?: string) {
    let run = data.runs.find(r => r.id === id && (!owner || r.owner === owner));
    if (!run) throw new PlaytestError('Testlauf nicht gefunden', 404);
    if (!('tokenHash' in run)) {
      const folder = path.join(this.dir, '.agent-office', 'xr-runs');
      const stored = JSON.parse(readFileSync(path.join(folder, run.id + '.json'), 'utf8')) as StoredRun;
      stored.observations = JSON.parse(readFileSync(path.join(folder, run.id + '.evidence.json'), 'utf8'));
      (stored as StoredRun & { [evidenceVersion]?: string })[evidenceVersion] = stored.observations.at(-1)?.id;
      data.runs[data.runs.indexOf(run)] = stored; run = stored;
    }
    return run as StoredRun;
  }
  verifyToken(id: string, token: string) {
    const run = this.find(this.load(), id);
    if (hash(token) !== run.tokenHash) throw new PlaytestError('Ungültige Kopplung', 401);
  }
  control(owner: string, id: string, action: string, value?: unknown) {
    const data = this.load(), run = this.find(data, id, owner);
    if (run.status === 'stopped') throw new PlaytestError('Testlauf ist beendet', 409);
    let token: string | undefined;
    if (action === 'select') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 2 || new Set(value).size !== value.length || value.some(v => typeof v !== 'string' || !run.devices.some(d => d.serial === v))) throw new PlaytestError('Ein oder zwei verbundene Headsets auswählen');
      run.selected = value; run.snapshots = {}; run.status = 'running';
    } else if (action === 'command') requestCommand(run, value);
    else if (action === 'pause') run.status = 'paused';
    else if (action === 'resume') { if (!run.selected.length) throw new PlaytestError('Headset auswählen'); run.status = 'running'; run.snapshots = {}; }
    else if (action === 'stop') { run.status = 'stopped'; run.endedAt = Date.now(); }
    else if (action === 'pair') { token = randomBytes(32).toString('hex'); run.tokenHash = hash(token); delete run.bridgeId; run.snapshots = {}; }
    else throw new PlaytestError('Unbekannte Aktion');
    this.save(data); return token ? { id, token } : {};
  }
  setRule(testId: string, raw: unknown) {
    const data = this.load(), next = rule(raw), test = this.tests().find(t => t.id === testId);
    if (!test || test.revision !== next.revision) throw new PlaytestError('Test geändert. Bitte aktualisieren.', 409);
    data.rules[testId] = next; this.save(data);
  }
  private active(run: XrRun, serial: string, tests: Playtest[], rules: Data['rules'], now: number) {
    const s = run.snapshots[serial];
    if (run.status !== 'running' || !s || now - (run.heartbeat ?? 0) > 5000) return { serial, active: [], reason: 'Warte auf aktive, aktuelle Headset-Verbindung' };
    if (run.pinnedBuilds[serial] !== s.context.build) return { serial, active: [], reason: 'Build gewechselt. Testlauf beenden und neu starten.' };
    const selected = selectXrPlaytests(tests, s.context, rules, now);
    const active = selected.active.filter(t => {
      const r = rules[t.id];
      if (r && r.revision !== t.revision) return false;
      if (r?.role && r.role !== s.role) return false;
      if (r?.twoDevices && !(run.selected.length === 2 && run.selected.every(d => {
        const other = run.snapshots[d];
        return other && other.context.focused && other.context.connected && now - other.context.sampledAt <= 5000
          && other.context.build === s.context.build && other.context.mode === s.context.mode && other.context.style === s.context.style
          && !!s.signals.sessionGroup && other.signals.sessionGroup === s.signals.sessionGroup
          && run.pinnedBuilds[d] === other.context.build;
      }) && new Set(run.selected.map(d => run.snapshots[d]?.role)).size === 2 && run.selected.every(d => run.snapshots[d]?.role !== 'solo'))) return false;
      return true;
    }).map(t => t.id);
    return { serial, active, reason: !s.context.focused ? 'Headset nicht aktiv' : !active.length ? 'Keine passenden Tests oder Voraussetzungen fehlen' : undefined };
  }
  view(owner: string, id?: string, now = Date.now(), full = true): XrView {
    const data = this.load(), tests = this.tests();
    const selected = id ?? [...data.runs].reverse().find(r => r.owner === owner)?.id;
    const run = selected ? this.find(data, selected, owner) : undefined;
    const clean = run && (({ tokenHash: _, bridgeId: __, ...rest }) => rest)(run);
    if (clean) { clean.observationCount = clean.observations.length; if (!full) clean.observations = clean.observations.slice(-250); }
    return { run: clean, tests, rules: data.rules, history: data.runs.filter(r => r.owner === owner).map(({ id, createdAt, status }) => ({ id, createdAt, status })).reverse(), devices: run ? run.selected.map(s => this.active(run, s, tests, data.rules, now)) : [] };
  }
  ingest(id: string, token: string, body: { bridgeId: string; devices: unknown; snapshots: Record<string, unknown>; results?: unknown }, now = Date.now()) {
    const data = this.load(), run = this.find(data, id);
    if (hash(token) !== run.tokenHash) throw new PlaytestError('Ungültige Kopplung', 401);
    if (run.status === 'stopped') return { stopped: true, selected: [], overlays: {} };
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.bridgeId)) throw new PlaytestError('Invalid bridge');
    if (run.bridgeId && run.bridgeId !== body.bridgeId) throw new PlaytestError('Helfer bereits verbunden. Für einen Wechsel neu koppeln.', 409);
    const inventory = devices(body.devices);
    if (!body.snapshots || typeof body.snapshots !== 'object' || Array.isArray(body.snapshots) || Object.keys(body.snapshots).length > 2) throw new PlaytestError('Invalid snapshots');
    const incoming: Record<string, XrSnapshot> = {};
    for (const [serial, raw] of Object.entries(body.snapshots)) {
      if (!run.selected.includes(serial) || !inventory.some(d => d.serial === serial)) throw new PlaytestError('Headset nicht ausgewählt');
      const next = snapshot(raw, now), old = run.snapshots[serial];
      if (old?.appSession === next.appSession && next.sequence <= old.sequence) continue;
      incoming[serial] = next;
    }
    run.bridgeId = body.bridgeId; run.devices = inventory; run.heartbeat = now;
    commandResults(this.dir, run, body.results, now);
    for (const [serial, s] of Object.entries(incoming)) {
      run.snapshots[serial] = s; run.pinnedBuilds[serial] ??= s.context.build;
      if (s.request === 'bug') {
        const event = [...s.events].reverse().find(e => e.kind === 'tester' && e.message === 'bug');
        const id = `${serial}:${s.appSession}:${event?.id ?? s.sequence}`;
        if (!(run.markers ?? []).some(m => m.id === id)) run.markers = [...(run.markers ?? []), { id, device: serial, build: s.context.build, appSession: s.appSession, at: now, context: s.context, signals: s.signals, events: s.events }].slice(-30);
      }
      if (s.request === 'pause') run.status = 'paused';
      if (s.request === 'resume') run.status = 'running';
      if (s.request === 'stop') { run.status = 'stopped'; run.endedAt = now; }
    }
    const tests = this.tests(), overlays: Record<string, unknown> = {};
    for (const serial of run.selected) {
      const selection = this.active(run, serial, tests, data.rules, now), s = incoming[serial];
      for (const testId of selection.active) {
        if (!s) continue;
        const test = tests.find(t => t.id === testId)!, r = data.rules[testId];
        const outcome = r?.signal && Object.hasOwn(s.signals, r.signal) ? (s.signals[r.signal] === r.equals ? 'matched' : 'mismatch') : 'observed';
        const previous = [...run.observations].reverse().find(o => o.testId === testId && o.device === serial);
        if (s.request !== 'bug' && previous && now - previous.at < 30000 && previous.outcome === outcome && previous.revision === test.revision && previous.appSession === s.appSession && previous.context.mode === s.context.mode && previous.context.phase === s.context.phase && previous.context.style === s.context.style) continue;
        run.observations.push({ id: randomUUID(), testId, revision: test.revision, device: serial, build: s.context.build, appSession: s.appSession, at: now, context: s.context, signals: s.signals, events: s.events, outcome, note: s.request === 'bug' ? 'Tester hat im Headset einen Fehler markiert; Beschreibung im Office ergänzen.' : '' });
      }
      const offset = selection.active.length ? Math.floor(now / 15000) % selection.active.length : 0;
      const hint = tests.find(t => t.id === selection.active[offset]);
      overlays[serial] = { run: run.id, status: run.status, ack: s?.sequence ?? 0, title: `${selection.active.length} passende Tests`,
        text: selection.reason || (hint ? `${hint.title}\n${hint.steps.slice(0, 500)}\nSoll: ${hint.expected.slice(0, 200)}` : '') };
    }
    run.observations = run.observations.slice(-1500); this.save(data);
    return { stopped: run.status === 'stopped', selected: run.selected, overlays, commands: run.status === 'running' ? (run.commands ?? []).filter(c => c.status === 'pending').map(c => ({ ...c, expiresInMs: 30000 - (now - c.at) })) : [] };
  }
}
