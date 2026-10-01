import type { AccountsState, ChatLine, FloorInfo, FloorView, GhIssue, GhPull, GhState, JailState, LeaveOnMergeState, MachineState, MapState, MeetingState, NotifyState, PeerInfo, PlanLimits, Me, ProjectInfo, ProjectsDirState, PromptsState, QueueState, QueueTask, RepoChoice, ServerMsg, ServicesState, SignInsState, SkyState, TeamState, ThemeState, UpgradeState, Usage, UsageState, WorkerInfo } from '../shared/protocol';
import type { ScreenState } from './world/laptop';
import { randomLook, sanitizeLook, type Look } from '../shared/avatar';
import type { Decoration } from '../shared/decor';
import { EMPTY_PLAN, type FloorPlan } from '../shared/floorplan';
import { newer, type WbElement } from '../shared/whiteboard';
import type { DogState } from '../shared/dog';
import type { HelperState } from '../shared/helper';
import { JUKEBOX_HOME, JUKEBOX_TUNES, type JukeboxState } from '../shared/jukebox';
import { TV_OFF, type TvState } from '../shared/tv';
import type { CabinetFrame, CabinetState } from '../shared/cabinet';
import type { BallState } from '../shared/hoop';
import { NO_CHAIRS, type ChairsState } from '../shared/chairs';
import { parked, type CarSeat, type CarState } from '../shared/garage';
import { OFFICE_MAP, planOf, type MapPlan } from '../shared/maps';

export type Topic = 'peers' | 'workers' | 'issues' | 'pulls' | 'chat' | 'project' | 'screens' | 'team' | 'upgrade' | 'services' | 'decor' | 'floorPlan' | 'usage' | 'limits' | 'queue' | 'me' | 'accounts' | 'signins' | 'notify' | 'machine' | 'floors' | 'floor' | 'projectsDir' | 'repos' | 'dog' | 'jukebox' | 'tv' | 'sky' | 'theme' | 'map' | 'leaveOnMerge' | 'whiteboard' | 'drawing' | 'cabinet' | 'cabinetFrame' | 'meeting' | 'prompts' | 'ball' | 'cars' | 'jail' | 'chairs' | 'helper';

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 });

export interface Profile {
  name: string;
  color: string;
  look: Look;
}

const PROFILE_KEY = 'agent-office.profile';
export const AVATAR_COLORS = ['#ff8a5b', '#4f86f7', '#06d6a0', '#ef476f', '#ffd166', '#9d4edd', '#00b4d8', '#f77f00'];

/** Your saved profile. `look` is missing if you joined before there was a character select screen. */
export function loadProfile(): (Omit<Profile, 'look'> & { look?: Look }) | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (p && typeof p.name === 'string' && typeof p.color === 'string') {
      return { name: p.name, color: p.color, look: p.look ? sanitizeLook(p.look, randomLook()) : undefined };
    }
  } catch {
    // storage blocked
  }
  return null;
}

/** Without a look, the 3D office still has you pick a character (the 2D view saves only a name). */
export function saveProfile(p: Omit<Profile, 'look'> & { look?: Look }) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage blocked
  }
}

export type ViewMode = 'first' | 'third';

/** The panels you can show or hide on screen, from the ☰ menu. */
export type HudPanel = 'workers' | 'people' | 'spend' | 'limits' | 'chat' | 'floor';
/** Out of the way by default: only the chat shows until you turn the rest on. */
export const HUD_DEFAULTS: Record<HudPanel, boolean> = { workers: false, people: false, spend: false, limits: false, chat: true, floor: false };

export interface Settings {
  view: ViewMode;
  /** Office sounds, 0–1. */
  volume: number;
  muted: boolean;
  /** The lounge jukebox, 0–1, apart from the office sounds. */
  music: number;
  musicMuted: boolean;
  /** The lounge TV, 0–1, apart from the office sounds too: your own speakers only. */
  tv: number;
  tvMuted: boolean;
  /** Put the dance floor with disco lights in front of the TV (see world/disco.ts). */
  danceFloor: boolean;
  /** The swish of a page turning as you read at the bookshelf. */
  pageTurns: boolean;
  /** Voice chat starts muted and V is held down to talk, instead of an open mic. */
  pushToTalk: boolean;
  /** Desktop notifications when a worker needs input or finishes while you're in another tab (once the browser allows them). */
  notify: boolean;
  /** Which panels show on screen. */
  hud: Record<HudPanel, boolean>;
  /** The ☰ menu's actions you pinned to the top bar, by id. */
  pins: string[];
}

const SETTINGS_KEY = 'agent-office.settings';
const FLOOR_KEY = 'agent-office.floor';

/** The floor you were last on, to come back to it after a reload. */
export function lastFloor(): string | null {
  try {
    return localStorage.getItem(FLOOR_KEY);
  } catch {
    return null;
  }
}

function rememberFloor(id: string | null) {
  try {
    if (id) localStorage.setItem(FLOOR_KEY, id);
  } catch {
    // storage blocked
  }
}

const SPOT_KEY = 'agent-office.spot';

/** Where you were standing, on which floor (or the roof), to be back there when you come back in. */
export interface Spot {
  floor: string;
  /** What that floor was called, to say so if it's gone by then. */
  name: string;
  /** The building's map then (see shared/maps): a spot on another map is nowhere on this one. */
  map?: string;
  /** Sitting on its throne. */
  throne?: boolean;
  x: number;
  y: number;
  z: number;
  facing: number;
}

/** The spot you were last in, if this browser has one. */
export function lastSpot(): Spot | null {
  try {
    const s = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null');
    const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if (s && typeof s.floor === 'string' && s.floor && finite(s.x) && finite(s.y) && finite(s.z) && finite(s.facing)) {
      return { floor: s.floor, name: typeof s.name === 'string' ? s.name : '', ...(typeof s.map === 'string' ? { map: s.map } : {}), ...(s.throne === true ? { throne: true } : {}), x: s.x, y: s.y, z: s.z, facing: s.facing };
    }
  } catch {
    // storage blocked
  }
  return null;
}

export function rememberSpot(s: Spot) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(s));
  } catch {
    // storage blocked
  }
}

export function loadSettings(): Settings {
  const s: Settings = { view: 'first', volume: 0.7, muted: false, music: 0.5, musicMuted: false, tv: 0.7, tvMuted: false, danceFloor: true, pageTurns: true, pushToTalk: false, notify: true, hud: { ...HUD_DEFAULTS }, pins: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved?.view === 'first' || saved?.view === 'third') s.view = saved.view;
    if (typeof saved?.volume === 'number' && Number.isFinite(saved.volume)) s.volume = Math.max(0, Math.min(1, saved.volume));
    if (typeof saved?.muted === 'boolean') s.muted = saved.muted;
    if (typeof saved?.music === 'number' && Number.isFinite(saved.music)) s.music = Math.max(0, Math.min(1, saved.music));
    if (typeof saved?.musicMuted === 'boolean') s.musicMuted = saved.musicMuted;
    if (typeof saved?.tv === 'number' && Number.isFinite(saved.tv)) s.tv = Math.max(0, Math.min(1, saved.tv));
    if (typeof saved?.tvMuted === 'boolean') s.tvMuted = saved.tvMuted;
    if (typeof saved?.danceFloor === 'boolean') s.danceFloor = saved.danceFloor;
    if (typeof saved?.pageTurns === 'boolean') s.pageTurns = saved.pageTurns;
    if (typeof saved?.pushToTalk === 'boolean') s.pushToTalk = saved.pushToTalk;
    if (typeof saved?.notify === 'boolean') s.notify = saved.notify;
    for (const k of Object.keys(s.hud) as HudPanel[]) if (typeof saved?.hud?.[k] === 'boolean') s.hud[k] = saved.hud[k];
    if (Array.isArray(saved?.pins)) s.pins = saved.pins.filter((p: unknown): p is string => typeof p === 'string').slice(0, 30);
  } catch {
    // storage blocked
  }
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage blocked
  }
}

/** The worker whose worktree branch a pull request came from, if it is still at a desk. */
export function workerForPull(workers: Iterable<WorkerInfo>, pr: { number: number; headRefName: string }): WorkerInfo | undefined {
  for (const w of workers) if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w;
  return undefined;
}

class Store {
  you = '';
  profile: Profile = { name: 'Guest', color: AVATAR_COLORS[1], look: randomLook() };
  peers = new Map<string, PeerInfo>();
  workers = new Map<string, WorkerInfo>();
  screens = new Map<string, ScreenState>();
  project: ProjectInfo | null = null;
  /** Every floor of the building, and the one you're on (null while there are none). */
  floors: FloorInfo[] = [];
  floor: string | null = null;
  /** Where the office clones new floors to. */
  projectsDir: ProjectsDirState = { dir: '', custom: false };
  /** The repositories the office's gh login can clone, once asked for (see floor.repos). */
  repos: { list: RepoChoice[]; error?: string; loading: boolean; at: number } = { list: [], loading: false, at: 0 };
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: true };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: true };
  ice: RTCIceServer[] = [];
  chat: ChatLine[] = [];
  /** Whether this office can invite teammates (deployed with deploy/aws.sh). */
  invites = false;
  team: TeamState | null = null;
  upgrade: UpgradeState = { available: false, phase: 'idle' };
  services: ServicesState = { items: [], port: 4600 };
  /** Pictures on the walls. */
  decor: Decoration[] = [];
  /** The signs over the desks, and how far the back office is built out (not the map's plan: see plan()). */
  floorPlan: FloorPlan = EMPTY_PLAN;
  /** What the lounge jukebox is playing; `since` is when the track started, on performance.now()'s clock. */
jukebox: JukeboxState & { since: number } = { on: false, track: JUKEBOX_TUNES[0].id, spot: JUKEBOX_HOME, startedAt: 0, elapsed: 0, since: 0 };
  /** What's on the big TV, and how far into it: worked out against `officeNow()` when it's shown (see shared/tv.ts). */
  tv: TvState = TV_OFF;
  /** The office's clock minus performance.now(), from the quickest ping (see 'pong'); for the jukebox. */
  private clock?: { offset: number; rtt: number };
  /** The floor's whiteboard: the newest copy of every element anyone drew, deleted ones too. */
  whiteboard = new Map<string, WbElement>();
  /** Who has the whiteboard open (client ids). */
  drawing: string[] = [];
  /** Who's at the arcade cabinet on your floor, and the building's high scores. */
  cabinet: CabinetState = { player: null, scores: [] };
  /** The game on the cabinet as its player last sent it; null while nobody plays. */
  cabinetFrame: CabinetFrame | null = null;
  usage: UsageState = { total: zeroUsage(), today: zeroUsage(), day: '', pauseHiring: false };
  /** The Claude plan's 5-hour and weekly limits. */
  limits: PlanLimits = { windows: [], at: 0 };
  queue: QueueState = { tasks: [], maxWorkers: 0 };
  /** The meeting room: the meeting at the table, and the ones before. */
  meeting: MeetingState = { current: null, past: [] };
  /** Who you're signed in as (see /api/whoami). */
  me: Me = { admin: false };
  /** Everyone's accounts; only admins get these. */
  accounts: AccountsState | null = null;
  /** Your own Claude and GitHub sign-ins; only accounts have them. */
  signins: SignInsState | null = null;
  /** The office's Slack / Discord webhook. */
  notify: NotifyState = {};
  /** How busy the office's machine is, and its worker limit. */
  machine: MachineState = { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 };
  /** The dog on your floor, and when (performance.now()) the leg it's on began. */
  dog: DogState | null = null;
  dogStart = 0;
  /**
   * The helpers on this floor and where each is walking (see shared/helper.ts), and when
   * (performance.now()) this batch of them was said, which is when the walks began.
   */
  helpers: HelperState[] = [];
  helperStart = 0;
  /** The basketball on this floor, as the office last said (see world/hoop.ts). */
  ball: BallState = {};
  /** Workers sent home and locked up in this floor's dungeon, on a map that has one. */
  jail: JailState = { prisoners: [], bones: 0 };
  /** The musical chairs game on this floor, and which part of it it's in (see shared/chairs.ts). */
  chairs: ChairsState = NO_CHAIRS;
  /**
   * The cars in the garage, as the office last said (see shared/garage.ts), and when (performance.now())
   * each one's driver last said where it is. Their moves change them without a word, like people's.
   */
  cars: CarState[] = parked();
  carsAt: number[] = [];
  /** Outside the windows; null until the server says. */
  sky: SkyState | null = null;
  /** The building's holiday decorations: the same on every floor. */
  theme: ThemeState = { pick: 'auto', active: null };
  /** What the building looks like inside (see shared/maps): the same on every floor. */
  map: MapState = { pick: OFFICE_MAP, custom: [] };
  /** The office's prompts as rewritten in ⚙️ Settings, and the worker everyone starts on: the same on every floor. */
  prompts: PromptsState = { custom: {} };
  /** Whether workers whose pull request merged go home by themselves (⚙️ Settings). */
  leaveOnMerge: LeaveOnMergeState = { on: false };
  private subs = new Map<Topic, Set<() => void>>();

  on(topic: Topic, fn: () => void) {
    let set = this.subs.get(topic);
    if (!set) this.subs.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(topic: Topic) {
    this.subs.get(topic)?.forEach((fn) => fn());
  }

  /** Where everything is on the building's map. */
  plan(): MapPlan {
    return planOf(this.map.pick, this.map.custom);
  }

  /** The floor you're on. */
  currentFloor(): FloorInfo | undefined {
    return this.floors.find((f) => f.id === this.floor);
  }

  /** The office's clock (ms since 1970) as near as this page can tell, which the DJ on the roof keeps time by. */
  officeNow(): number {
    return this.clock ? performance.now() + this.clock.offset : Date.now();
  }

  /** Whether someone is on your floor (people on other floors aren't in the room with you). */
  onMyFloor(peer: PeerInfo): boolean {
    return (peer.floor ?? null) === this.floor;
  }

  workerAtDesk(deskId: string): WorkerInfo | undefined {
    for (const w of this.workers.values()) if (w.deskId === deskId) return w;
    return undefined;
  }

  /** Takes in whiteboard elements, yours or someone else's: each one newer than the copy here replaces it. */
  drew(elements: readonly WbElement[]) {
    let changed = false;
    for (const e of elements) {
      if (!newer(e, this.whiteboard.get(e.id))) continue;
      this.whiteboard.set(e.id, e);
      changed = true;
    }
    if (changed) this.emit('whiteboard');
  }

  /** The queue task for an issue: the one on the queue if there is one, else the latest finished one. */
  taskForIssue(issue: number): QueueTask | undefined {
    const tasks = this.queue.tasks.filter((t) => t.issue === issue);
    return tasks.find((t) => t.status !== 'done') ?? tasks[tasks.length - 1];
  }

  /** Everything on the floor you just arrived on, in place of the last one's. */
  private enter(v: FloorView) {
    this.floor = v.floor;
    rememberFloor(v.floor);
    this.project = v.project;
    this.workers = new Map(v.workers.map((w) => [w.id, w]));
    this.screens.clear(); // fresh full frames follow
    this.issues = v.issues;
    this.pulls = v.pulls;
    this.queue = v.queue;
    this.meeting = v.meeting;
    this.decor = v.decor;
    this.floorPlan = v.plan ?? EMPTY_PLAN;
    this.services = v.services;
    this.whiteboard = new Map(v.whiteboard.elements.map((e) => [e.id, e]));
    this.drawing = v.whiteboard.people;
    this.cabinet = { player: v.cabinet.player, scores: v.cabinet.scores };
    this.cabinetFrame = v.cabinet.frame;
    this.setDog(v.dog);
    this.setJukebox(v.jukebox);
    this.tv = v.tv ?? TV_OFF;
    this.ball = v.ball ?? {};
    this.setCars(v.cars ?? parked());
    this.jail = v.jail ?? { prisoners: [], bones: 0 };
    this.chairs = v.chairs ?? NO_CHAIRS;
    for (const t of ['floor', 'project', 'workers', 'issues', 'pulls', 'queue', 'meeting', 'decor', 'floorPlan', 'services', 'dog', 'helper', 'jukebox', 'tv', 'whiteboard', 'drawing', 'cabinet', 'cabinetFrame', 'ball', 'cars', 'jail', 'chairs'] as Topic[]) this.emit(t);
  }

  private setCars(cars: CarState[]) {
    this.cars = cars;
    const now = performance.now();
    this.carsAt = cars.map(() => now);
  }

  /** The car `id` (a PeerInfo id) is in on this floor, and which seat. */
  carOf(id: string): { car: number; seat: CarSeat } | undefined {
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i].driver === id) return { car: i, seat: 'driver' };
      if (this.cars[i].passenger === id) return { car: i, seat: 'passenger' };
    }
    return undefined;
  }

  private setDog(dog: DogState | null) {
    this.dog = dog;
    this.dogStart = performance.now() - (dog?.elapsed ?? 0);
  }

  /** When the track started on this page's clock: from the office's clock once it's known, else from `elapsed`. */
  private setJukebox(j: JukeboxState) {
    // An office too old to say where its jukebox stands has it in the corner of the lounge.
    this.jukebox = { ...j, spot: j.spot ?? JUKEBOX_HOME, since: this.clock ? j.startedAt - this.clock.offset : performance.now() - j.elapsed };
  }

  apply(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.floors = msg.floors;
        this.projectsDir = msg.projectsDir;
        this.ice = msg.ice as RTCIceServer[];
        this.chat = msg.chat;
        this.invites = msg.invites;
        this.upgrade = msg.upgrade;
        this.usage = msg.usage;
        this.limits = msg.limits;
        this.me = msg.me;
        this.notify = msg.notify;
        this.machine = msg.machine;
        this.clock = undefined; // compared again, in case it's another office (or the same one, restarted)
        this.sky = msg.sky;
        this.theme = msg.theme;
        this.prompts = msg.prompts ?? { custom: {} };
        this.leaveOnMerge = msg.leaveOnMerge ?? { on: false };
        // The map first, so the floor's workers sit down in its seats and not the last one's.
        this.map = msg.map ?? { pick: OFFICE_MAP, custom: [] };
        this.emit('map');
        this.enter(msg);
        for (const t of ['peers', 'chat', 'upgrade', 'usage', 'limits', 'me', 'notify', 'machine', 'floors', 'projectsDir', 'sky', 'theme', 'prompts', 'leaveOnMerge'] as Topic[]) this.emit(t);
        break;
      case 'floor.enter':
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.enter(msg);
        this.emit('peers');
        break;
      case 'floors':
        this.floors = msg.floors;
        this.emit('floors');
        break;
      case 'projectsDir':
        this.projectsDir = msg.state;
        this.emit('projectsDir');
        break;
      case 'floor.repos':
        this.repos = { list: msg.repos, error: msg.error, loading: false, at: Date.now() };
        this.emit('repos');
        break;
      case 'peer.join':
      case 'peer.update':
        this.peers.set(msg.peer.id, msg.peer);
        this.emit('peers');
        break;
      case 'peer.move': {
        const p = this.peers.get(msg.id);
        if (p) Object.assign(p, { x: msg.x, y: msg.y, z: msg.z, rotY: msg.rotY, moving: msg.moving });
        break;
      }
      case 'peer.leave':
        this.peers.delete(msg.id);
        this.emit('peers');
        break;
      case 'worker.update':
        this.workers.set(msg.worker.id, msg.worker);
        this.emit('workers');
        break;
      case 'worker.remove':
        this.workers.delete(msg.workerId);
        this.screens.delete(msg.workerId);
        if (msg.jail) this.jail = msg.jail;
        this.emit('workers');
        if (msg.jail) this.emit('jail');
        break;
      case 'screen': {
        let s = this.screens.get(msg.workerId);
        if (!s || msg.full || s.cols !== msg.cols || s.rows !== msg.rows) {
          s = { cols: msg.cols, rows: msg.rows, lines: [], cursor: msg.cursor, version: (s?.version ?? 0) + 1 };
          this.screens.set(msg.workerId, s);
        }
        for (const [k, v] of Object.entries(msg.lines)) s.lines[Number(k)] = v;
        s.cursor = msg.cursor;
        s.version++;
        this.emit('screens');
        break;
      }
      case 'gh.issues':
        this.issues = msg.state;
        this.emit('issues');
        break;
      case 'gh.pulls':
        this.pulls = msg.state;
        this.emit('pulls');
        break;
      case 'team':
        this.team = msg.state;
        this.emit('team');
        break;
      case 'me':
        this.me = msg.me;
        this.emit('me');
        break;
      case 'accounts':
        this.accounts = msg.state;
        this.emit('accounts');
        break;
      case 'signins':
        this.signins = msg.state;
        this.emit('signins');
        break;
      case 'upgrade':
        this.upgrade = msg.state;
        this.emit('upgrade');
        break;
      case 'services':
        this.services = msg.state;
        this.emit('services');
        break;
      case 'decor':
        this.decor = msg.items;
        this.emit('decor');
        break;
      case 'plan':
        this.floorPlan = msg.plan;
        this.emit('floorPlan');
        break;
      case 'jukebox':
        this.setJukebox(msg.state);
        this.emit('jukebox');
        break;
      case 'tv':
        this.tv = msg.state;
        this.emit('tv');
        break;
      case 'cabinet':
        // Nobody at it any more: the last game's screen goes with them.
        if (!msg.state.player || msg.state.player.id !== this.cabinet.player?.id) this.cabinetFrame = null;
        this.cabinet = msg.state;
        this.emit('cabinet');
        break;
      case 'cabinet.frame':
        this.cabinetFrame = msg.frame;
        this.emit('cabinetFrame');
        break;
      case 'pong': {
        // The answer that came back quickest says best how the two clocks line up.
        const rtt = performance.now() - msg.at;
        if (this.clock && rtt >= this.clock.rtt) break;
        this.clock = { offset: msg.now - (msg.at + rtt / 2), rtt };
        const was = this.jukebox.since;
        this.setJukebox(this.jukebox);
        if (Math.abs(this.jukebox.since - was) > 20) this.emit('jukebox');
        break;
      }
      case 'wb.update':
        this.drew(msg.elements);
        break;
      case 'wb.people':
        this.drawing = msg.people;
        this.emit('drawing');
        break;
      case 'usage':
        this.usage = msg.state;
        this.emit('usage');
        break;
      case 'limits':
        this.limits = msg.state;
        this.emit('limits');
        break;
      case 'queue':
        this.queue = msg.state;
        this.emit('queue');
        break;
      case 'meeting':
        this.meeting = msg.state;
        this.emit('meeting');
        break;
      case 'notify':
        this.notify = msg.state;
        this.emit('notify');
        break;
      case 'machine':
        this.machine = msg.state;
        this.emit('machine');
        break;
      case 'dog':
        this.setDog(msg.dog);
        this.emit('dog');
        break;
      case 'helper':
        this.helpers = msg.helpers;
        this.helperStart = performance.now();
        this.emit('helper');
        break;
      case 'ball':
        this.ball = msg.ball;
        this.emit('ball');
        break;
      case 'chairs':
        this.chairs = msg.state;
        this.emit('chairs');
        break;
      case 'cars':
        this.setCars(msg.cars);
        this.emit('cars');
        break;
      case 'car.move': {
        const c = this.cars[msg.car];
        if (!c) break;
        Object.assign(c, { x: msg.x, z: msg.z, rotY: msg.rotY, speed: msg.speed, steer: msg.steer });
        this.carsAt[msg.car] = performance.now();
        break;
      }
      case 'sky':
        this.sky = msg.state;
        this.emit('sky');
        break;
      case 'theme':
        this.theme = msg.state;
        this.emit('theme');
        break;
      case 'map': {
        // Onto another map: nobody's on a seat of the last one any more (the office forgot them too).
        const moved = msg.state.pick !== this.map.pick;
        this.map = msg.state;
        if (moved) for (const p of this.peers.values()) delete p.seat;
        this.emit('map');
        if (moved) this.emit('peers');
        break;
      }
      case 'prompts':
        this.prompts = msg.state;
        this.emit('prompts');
        break;
      case 'leaveOnMerge':
        this.leaveOnMerge = msg.state;
        this.emit('leaveOnMerge');
        break;
      case 'chat':
        this.chat.push(msg);
        if (this.chat.length > 200) this.chat.shift();
        this.emit('chat');
        break;
    }
  }
}

export const store = new Store();
