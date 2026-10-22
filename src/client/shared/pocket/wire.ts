import type { ChatLine, PeerInfo, ServerMsg, WorkerInfo } from '../../../shared/protocol';
import { EMPTY_PLAN } from '../../../shared/floorplan';
import { parked } from '../../../shared/garage';
import { JUKEBOX_TUNES } from '../../../shared/jukebox';

/** The parent authorizes every field. Extra parent-only binding fields are ignored. */
export interface PocketSnapshot {
  source: number;
  title: string;
  cwd: string;
  model?: string;
  you: string;
  peers: PeerInfo[];
  chat: ChatLine[];
  workers: WorkerInfo[];
}

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

function workers(s: PocketSnapshot): WorkerInfo[] {
  return s.workers.map((w) => ({
    ...w,
    status: w.status === 'working' ? 'working' : w.status === 'idle' ? 'idle' : 'offline',
    // The public list does not expose each child's current model. Never label it with the source's current model.
    model: undefined,
    usage: undefined, // Office has no authoritative Pocket usage or pricing.
  }));
}

export function pocketWelcome(s: PocketSnapshot): Welcome {
  const unknownUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0, costKnown: false, callsKnown: false, incomplete: true });
  return {
    t: 'welcome', you: s.you, peers: s.peers.map((p) => ({ ...p, floor: 'pocket' })), chat: s.chat,
    floors: [{ id: 'pocket', name: s.title, dir: s.cwd, workers: s.workers.length, people: s.peers.length, wing: 0, palette: 0, addedBy: 'Pocket', addedAt: 0, busy: s.workers.filter((w) => w.status === 'working').length, waiting: 0 }],
    projectsDir: { dir: s.cwd, custom: false }, ice: [], invites: false, version: 'pocket',
    upgrade: { available: false, phase: 'idle' },
    usage: { total: unknownUsage(), today: unknownUsage(), day: '', pauseHiring: false },
    limits: { windows: [], at: 0 }, me: { admin: false }, notify: {},
    machine: { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: s.workers.length },
    sky: { lat: 0, lon: 0, utcOffset: 0, weather: 'clear', intensity: 0, realTime: true },
    theme: { pick: 'off', active: null }, map: { pick: 'office', custom: [] },
    prompts: { custom: {} }, leaveOnMerge: { on: false }, floor: 'pocket',
    project: { name: s.title, dir: s.cwd, agentCmd: 'Pocket · inherited model', defaultProvider: 'pi', agentProviders: ['pi'] },
    workers: workers(s), issues: { items: [], loading: false, fetchedAt: 0 }, pulls: { items: [], loading: false, fetchedAt: 0 },
    queue: { tasks: [], maxWorkers: 0 }, decor: [], plan: { ...EMPTY_PLAN, labels: {} },
    services: { items: [], port: 0 }, dog: null,
    jukebox: { on: false, track: JUKEBOX_TUNES[0].id, startedAt: 0, elapsed: 0 },
    cabinet: { player: null, scores: [], frame: null }, whiteboard: { elements: [], people: [] },
    meeting: { current: null, past: [] }, ball: {}, cars: parked(), jail: { prisoners: [], bones: 0 },
  };
}

/** Polls are deltas, not welcomes: they must not reset the player or rebuild the floor. */
export function pocketUpdates(before: PocketSnapshot, next: PocketSnapshot): ServerMsg[] {
  const messages: ServerMsg[] = [];
  const peers = new Map(before.peers.map((p) => [p.id, p]));
  for (const p of next.peers) {
    messages.push({ t: peers.has(p.id) ? 'peer.update' : 'peer.join', peer: { ...p, floor: 'pocket' } });
    peers.delete(p.id);
  }
  for (const id of peers.keys()) messages.push({ t: 'peer.leave', id });
  const old = new Map(workers(before).map((w) => [w.id, w]));
  for (const worker of workers(next)) {
    if (JSON.stringify(old.get(worker.id)) !== JSON.stringify(worker)) messages.push({ t: 'worker.update', worker });
    old.delete(worker.id);
  }
  for (const workerId of old.keys()) messages.push({ t: 'worker.remove', workerId });
  const seen = new Set(before.chat.map((line) => JSON.stringify(line)));
  for (const line of next.chat) if (!seen.has(JSON.stringify(line))) messages.push({ t: 'chat', ...line });
  return messages;
}
