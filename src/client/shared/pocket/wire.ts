import type { ChatLine, PeerInfo, ServerMsg, WorkerInfo } from '../../../shared/protocol';
import { EMPTY_PLAN } from '../../../shared/floorplan';
import { parked } from '../../../shared/garage';
import { JUKEBOX_TUNES } from '../../../shared/jukebox';
import { pocketFloorId, pocketFloorViews, type PocketFloor } from './floors';

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
  /** The root inspector is separate from all regular desks and worker counts. */
  master?: { workerId: string; title: string; busy?: boolean };
  events?: { seq: number; at: number; message: Extract<ServerMsg, { t: 'peer.act' | 'peer.emote' | 'sit.refused' }> }[];
}

export function validPocketMaster(s: PocketSnapshot): boolean {
  const master = s.master;
  return master === undefined || (!!master && master.workerId === `pocket-master-${s.source}`
    && typeof master.title === 'string' && (master.busy === undefined || typeof master.busy === 'boolean'));
}

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;
const machine = (s: PocketSnapshot): Welcome['machine'] => ({cpu:0,cores:0,memUsed:0,memTotal:0,history:[],workers:s.workers.length,limit:16});

function workers(s: PocketSnapshot): WorkerInfo[] {
  return s.workers.map((w) => ({
    ...w,
    status: w.status === 'working' ? 'working' : w.status === 'idle' ? 'idle' : 'offline',
    // The public list does not expose each child's current model. Never label it with the source's current model.
    model: undefined,
    usage: undefined, // Office has no authoritative Pocket usage or pricing.
  }));
}

export function pocketWelcome(s: PocketSnapshot, floors: PocketFloor[] = [{ id: s.source, title: s.title, cwd: s.cwd, busy: false, archived: false }]): Welcome {
  const unknownUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0, costKnown: false, callsKnown: false, incomplete: true });
  return {
    t: 'welcome', you: s.you, peers: s.peers.map((p) => ({ ...p, floor: pocketFloorId(s.source) })), chat: s.chat,
    floors: pocketFloorViews(floors, s),
    projectsDir: { dir: s.cwd, custom: false }, ice: [], invites: false, version: 'pocket',
    upgrade: { available: false, phase: 'idle' },
    usage: { total: unknownUsage(), today: unknownUsage(), day: '', pauseHiring: false },
    limits: { windows: [], at: 0 }, me: { admin: false }, notify: {},
    machine: machine(s),
    sky: { lat: 0, lon: 0, utcOffset: 0, weather: 'clear', intensity: 0, realTime: true },
    theme: { pick: 'off', active: null }, map: { pick: 'office', custom: [] },
    prompts: { custom: {} }, leaveOnMerge: { on: false }, floor: pocketFloorId(s.source),
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
export function pocketUpdates(before: PocketSnapshot, next: PocketSnapshot, eventCursor = pocketEventCursor(before)): ServerMsg[] {
  const messages: ServerMsg[] = [];
  if (before.workers.length !== next.workers.length) messages.push({t:'machine',state:machine(next)});
  const peers = new Map(before.peers.map((p) => [p.id, p]));
  for (const p of next.peers) {
    messages.push({ t: peers.has(p.id) ? 'peer.update' : 'peer.join', peer: { ...p, floor: pocketFloorId(next.source) } });
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
  for (const event of next.events ?? []) {
    if (event.seq <= eventCursor || event.at <= Date.now() - 15_000) continue;
    // Local actions already animate the player. Refusals must reach that player only.
    if (event.message.t !== 'sit.refused' && event.message.id === next.you) continue;
    messages.push(event.message);
  }
  return messages;
}

export function pocketEventCursor(snapshot: PocketSnapshot): number {
  return (snapshot.events ?? []).reduce((seq, event) => Math.max(seq, event.seq), 0);
}
