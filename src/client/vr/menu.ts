/**
 * The VR core menu: a wrist-or-dash panel with the VR-essential actions as ray-clickable
 * buttons. Every action calls the same underlying function the DOM UI calls — the wiring
 * arrives through VrMenuActions (see attach.ts for the exact main.ts snippet), so there is
 * no forked logic here. Read-only views render from the same stores the DOM boards read.
 *
 * Views: main (Hire, Next waiting, Queue, Issues/PRs, Floors, Jukebox, Bar, Chat, Mute, Leave voice, Exit VR),
 * hire (free desks, with the worktree toggle), queue (running/queued/done, with tap-twice remove + requeue), board (issues/PRs tabs, read + hand-to-worker),
 * a detail view for one issue or PR (hand it over, queue it, comment, close it, review a PR), floors (ride the elevator), jukebox (tunes + a stream row), bar (drinks),
 * chat (the floor's chat + say something + search it), search (the search hits — chat lines and
 * terminal lines, tap one to open its terminal at the line), assign (hand an issue to a worker), meeting (the room's
 * status + call one with the pattern defaults, and the earlier meetings), services (the workers' web servers, tap to copy
 * a tunnel command), people (who else is around — tap a row to walk over), and settings
 * (glide, turning, turn speed, teleport fade, the dog's name — the ⚙️ Settings VR section
 * plus the office dog, in the headset).
 */

import type * as THREE from 'three';
import type { ChatLine, FloorInfo, GhIssue, GhPull, GhState, MeetingState, PeerInfo, QueueState, QueueTask, SearchResults, ServicesState, TerminalHit, WorkerInfo } from '../../shared/protocol';
import { fmtTokens } from '../../shared/protocol';
import { MEETING_PATTERNS, meetingSpend } from '../../shared/meetings';
import { JUKEBOX_TUNES, STREAM, trackTitle, type JukeboxState } from '../../shared/jukebox';
import { DRINKS, ROOF, ROOF_NAME, type Drink } from '../../shared/rooftop';
import { searchKey } from '../../shared/search';
import { isAsleep } from '../../shared/status';
import { TERM_FONT } from '../fonts';
import { waitingInOrder } from '../nextup';
import type { VrSettings } from '../state';
import { timeAgo } from '../ui/dom';
import type { TerminalFind } from '../ui/terminal';
import { whereabouts } from '../ui/whereabouts';
import { clampScroll, type HeadPose, type Rect } from './math';
import { WorldPanel } from './panel';

/** The office search's latest answer, for the menu's search view (main.ts runs the fetch). */
export interface VrSearchState {
  query: string;
  status: 'searching' | 'done' | 'error';
  results?: SearchResults;
  error?: string;
}

export interface VrMenuStores {
  subscribe: (topic: 'workers' | 'issues' | 'pulls' | 'queue' | 'chat' | 'floors' | 'floor' | 'jukebox' | 'meeting' | 'services' | 'peers' | 'dog', fn: () => void) => () => void;
  getWorkers: () => WorkerInfo[];
  getIssues: () => GhState<GhIssue>;
  getPulls: () => GhState<GhPull>;
  getQueue: () => QueueState;
  getFreeDesks: () => { id: string; label: string }[];
  getChat: () => ChatLine[];
  getFloors: () => FloorInfo[];
  currentFloor: () => string | null;
  getJukebox: () => JukeboxState;
  /** Up on the roof, where the bar is (the Bar row hides below). */
  onRoof: () => boolean;
  /** Had enough: the bar pours nothing stronger than water. */
  barCutOff: () => boolean;
  isMuted: () => boolean;
  inVoice: () => boolean;
  /** VR locomotion and comfort (the ⚙️ Settings VR section's values, live). */
  getVrSettings: () => VrSettings;
  /** The meeting room: the meeting at the table, and the ones before. */
  getMeeting: () => MeetingState;
  /** Web servers the workers are running (the 🌐 Services board's list). */
  getServices: () => ServicesState;
  /** Everyone else around (the sidebar's people, without you). */
  getPeers: () => PeerInfo[];
  /** The floor dog's name (the ⚙️ Settings office-dog row's value). */
  getDogName: () => string | null;
  /** Your own sound levels (the ⚙️ Settings volume rows' values, live). */
  getSound: () => { volume: number; muted: boolean; music: number; musicMuted: boolean };
  /** Whether the next hire gets its own git worktree (the hire dialog checkbox's memory). */
  getWorktree: () => boolean;
  /** The office search's latest answer (nothing until the first search runs). */
  getSearch: () => VrSearchState | null;
}

export interface VrMenuActions {
  /** Opens the hire choices for a desk — the DOM hire dialog's function (main.ts hireAtDesk). */
  hire: (deskId: string) => void;
  /** Flips the next hire's worktree choice — the DOM hire dialog's checkbox. */
  toggleWorktree: () => void;
  /** To the longest-waiting worker — the DOM N key's function (main.ts goToNextWaiting). */
  nextWaiting: () => void;
  /** Hands an issue to a worker — the DOM board's assign path (issuePrompt + worker.prompt). */
  promptWorker: (workerId: string, issueNumber: number, title: string) => void;
  /** Puts an issue on the task queue — the DOM board's queue path (queue.add with issuePrompt). */
  queueIssue: (issueNumber: number, title: string) => void;
  /** Rides the elevator — the DOM floor button's function (main.ts ride). */
  ride: (floorId: string) => void;
  /** The jukebox: play a tune (or resume), stop, or skip — the DOM jukebox's messages. */
  jukebox: (op: 'play' | 'stop' | 'skip', track?: string) => void;
  /** Plays a pasted stream on the jukebox — the DOM jukebox's URL box (main.ts vrJukeboxStream). */
  playStream: () => void;
  /** Orders a drink — the DOM bar menu's function (main.ts orderDrink). */
  orderDrink: (id: Drink['id']) => void;
  /** Says it on the floor's chat — the DOM chat box's function (net chat). */
  sendChat: (text: string) => void;
  /** Searches the chat and every worker's terminal — the DOM search window's fetch (main.ts vrSearchOffice). */
  searchOffice: (query: string) => void;
  /** Walks over to a teammate — the sidebar people list's click (main.ts vrWalkToPeer). */
  walkToPeer: (peerId: string) => void;
  /** Mutes/unmutes in voice, or joins it — the DOM M/V keys' function (main.ts voice toggle). */
  toggleMute: () => void;
  /** Leaves voice — the DOM V key's function while in it (main.ts voice leave). */
  leaveVoice: () => void;
  /** Patches VR locomotion/comfort — the DOM ⚙️ Settings VR section's function (assign + save). */
  vrSettings: (patch: Partial<VrSettings>) => void;
  /** Renames the floor dog — the DOM ⚙️ Settings office-dog row (main.ts vrRenameDog). */
  renameDog: () => void;
  /** Mutes/unmutes the jukebox or the office sounds — the DOM ⚙️ Settings mute buttons. */
  toggleSound: (kind: 'music' | 'sounds') => void;
  /** Calls a meeting with the pattern defaults — the DOM meeting form's send (main.ts vrMeeting). */
  meetingCall: () => void;
  /** Stops the running meeting — the DOM meeting window's stop (meeting.stop). */
  meetingStop: () => void;
  /** Clears the room — the DOM meeting window's clear (meeting.clear). */
  meetingClear: () => void;
  /** Copies a service's tunnel command — the DOM services list's tap (main.ts copyServiceTunnel). */
  copyServiceTunnel: (port: number) => void;
  /** Adds a project as a new floor — the elevator panel's add (main.ts vrAddFloor). */
  addFloor: () => void;
  /** Adds a task to the queue — the queue window's form (main.ts vrQueueAdd). */
  addQueueTask: () => void;  /** How many workers the queue keeps busy (0 pauses it) — the queue window's stepper. */
  queueLimit: (maxWorkers: number) => void;
  /** Takes a queued task off the queue — the window's ✕ (queue.remove). */
  removeQueueTask: (taskId: string) => void;
  /** Puts a finished task back on the queue — the window's Requeue (queue.retry). */
  retryQueueTask: (taskId: string) => void;
  /** Comments on an issue or PR — the board windows' comment box (main.ts vrComment). */
  commentOn: (kind: 'issue' | 'pull', number: number) => void;
  /** Closes an issue or PR — the board windows' close dialog at its defaults (main.ts vrClose). */
  closeItem: (kind: 'issue' | 'pull', number: number) => void;
  /** Reviews a PR in the meeting room — the PR window's Review panel button (main.ts vrReviewPanel). */
  reviewPanel: (number: number) => void;
  /** Leaves the immersive session — the XR session owner's exit. */
  exitVr: () => void;
}

export type MenuView = 'main' | 'hire' | 'queue' | 'board' | 'detail' | 'floors' | 'jukebox' | 'bar' | 'chat' | 'search' | 'assign' | 'settings' | 'meeting' | 'services' | 'people';

export interface MenuDetail {
  kind: 'issue' | 'pull';
  number: number;
}

/** The issue being handed to a worker in the assign view. */
export interface AssignTarget {
  number: number;
  title: string;
}

const HEADER_H = 0.12;
const BODY: Rect = { x: 0.03, y: HEADER_H + 0.02, w: 0.94, h: 1 - HEADER_H - 0.05 };
const BACK_BTN: Rect = { x: 0.03, y: 0.015, w: 0.16, h: 0.09 };
/** Detail view: ✕ Close in the header (tap twice: the first arms it, like the terminal's ⏻). */
const CLOSE_BTN: Rect = { x: 0.78, y: 0.015, w: 0.19, h: 0.09 };
/** Hire view: the next hire's worktree choice, as a header toggle. */
const HIRE_WT: Rect = { x: 0.76, y: 0.015, w: 0.21, h: 0.09 };
/** A tap-twice arm stays live this long (the detail ✕, the queue rows). */
const TAP_ARM_MS = 6000;
const TABS: Rect = { x: 0.55, y: 0.015, w: 0.42, h: 0.09 };
/** Jukebox transport: play/resume, stop, skip — small round buttons in the header. */
const JB_PLAY: Rect = { x: 0.58, y: 0.015, w: 0.13, h: 0.09 };
const JB_STOP: Rect = { x: 0.72, y: 0.015, w: 0.13, h: 0.09 };
const JB_SKIP: Rect = { x: 0.86, y: 0.015, w: 0.11, h: 0.09 };
/** Chat view: the "say something" and "search the office" buttons in the header. */
const SAY_BTN: Rect = { x: 0.60, y: 0.015, w: 0.16, h: 0.09 };
const CHAT_FIND: Rect = { x: 0.77, y: 0.015, w: 0.20, h: 0.09 };
/** Floors view: the "add a project" button in the header. */
const FLOORS_ADD: Rect = { x: 0.72, y: 0.015, w: 0.25, h: 0.09 };
/** Queue view: add a task, and pause/unpause the line. */
const QB_ADD: Rect = { x: 0.60, y: 0.015, w: 0.15, h: 0.09 };
const QB_TOGGLE: Rect = { x: 0.76, y: 0.015, w: 0.21, h: 0.09 };
/** Header buttons for the meeting view: call one, stop it, or clear the room. */
const MTG_CALL: Rect = { x: 0.72, y: 0.015, w: 0.25, h: 0.09 };
const MTG_STOP: Rect = { x: 0.72, y: 0.015, w: 0.25, h: 0.09 };
const MTG_CLEAR: Rect = { x: 0.72, y: 0.015, w: 0.25, h: 0.09 };

/** A seat's turn in words (the DOM meeting window's PART_LABEL). */
function partLabel(state: string): string {
  return { waiting: 'up next', sent: 'handed over', working: 'on it', done: 'written' }[state] ?? state;
}

/** A worker status in words, without the DOM module's label table. */
function statusLabel(status: string): string {
  return { working: 'working', needs_input: 'needs input', done: 'done', idle: 'idle', asleep: 'asleep', offline: 'offline' }[status] ?? status;
}

/** How hard a drink hits, in the bar list (the DOM bar menu's kick()). */
function kick(d: Drink): string {
  if (d.strength < 0) return '💧 sobers you up';
  if (d.strength === 0) return 'no alcohol';
  return d.strength >= 0.55 ? '🌀🌀🌀 strong' : d.strength >= 0.4 ? '🌀🌀 heady' : '🌀 light';
}

interface MainItem {
  id: string;
  icon: string;
  title: string;
  sub: () => string;
}

const DETAIL_BODY_MAX = 900;

export class VrMenu {
  readonly panel: WorldPanel;
  /** Opening a worker's terminal from a queue row (wired by attach.ts to the VR terminal panel). */
  onOpenTerminal: ((workerId: string, find?: TerminalFind) => void) | null = null;
  /** Opening the controls card from the ❓ row (wired by attach.ts to the VR controls panel). */
  onShowControls: (() => void) | null = null;
  /** Opening the chat prompt from the ✍️ button (wired by attach.ts to the VR prompt panel). */
  onChatSay: (() => void) | null = null;
  /** Opening the search prompt from the 🔎 button (wired by attach.ts to the VR prompt panel). */
  onChatSearch: (() => void) | null = null;

  private stores: VrMenuStores;
  private actions: VrMenuActions;
  private unsubs: (() => void)[] = [];
  private view: MenuView = 'main';
  private boardTab: 'issues' | 'pulls' = 'issues';
  private detail: MenuDetail | null = null;
  private assignTarget: AssignTarget | null = null;
  /** Scroll offset (and list identity) the row buttons were last synced to. */
  private rowSyncKey = '';
  private lastMuted = '';
  /** The queue's last unpaused width: the ⏸ toggle goes back to it. */
  private lastLimit = 2;
  /** The detail ✕ confirms while now is before this (the first tap arms it). */
  private closeArmedUntil = 0;
  /** Which issue or PR the armed ✕ would close ("issue:12"). */
  private closeArmedFor: string | null = null;
  /** The queue row's arm: the task id tap-twice would remove or requeue, while now is before this. */
  private queueArmedUntil = 0;
  private queueArmedFor: string | null = null;
  /** The PR review button's arm: the PR number tap-twice would call a panel for. */
  private reviewArmedUntil = 0;
  private reviewArmedFor: number | null = null;

  constructor(stores: VrMenuStores, actions: VrMenuActions, widthM = 0.62, heightM = 0.72) {
    this.stores = stores;
    this.actions = actions;
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setScrollRegion('list', BODY);
    this.panel.setVisible(false);
    this.unsubs = (['workers', 'issues', 'pulls', 'queue', 'chat', 'floors', 'floor', 'jukebox', 'meeting', 'services', 'peers', 'dog'] as const).map((t) => stores.subscribe(t, () => this.refresh()));
    this.syncButtons();
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  toggle() {
    this.panel.setVisible(!this.panel.visible);
    if (this.panel.visible) {
      this.refresh();
      this.panel.markDirty();
    }
  }

  show(view: MenuView = 'main') {
    this.view = view;
    this.detail = view === 'detail' ? this.detail : null;
    this.assignTarget = view === 'assign' ? this.assignTarget : null;
    this.closeArmedUntil = 0;
    this.closeArmedFor = null;
    this.queueArmedUntil = 0;
    this.queueArmedFor = null;
    this.reviewArmedUntil = 0;
    this.reviewArmedFor = null;
    this.panel.setScrollOffset('list', 0);
    this.panel.setVisible(true);
    this.refresh();
    this.panel.markDirty();
  }

  /** The assign view for an issue: pick one of the awake workers to hand it to. */
  openAssign(number: number, title: string) {
    this.assignTarget = { number, title };
    this.view = 'assign';
    this.detail = null;
    this.closeArmedUntil = 0;
    this.closeArmedFor = null;
    this.queueArmedUntil = 0;
    this.queueArmedFor = null;
    this.reviewArmedUntil = 0;
    this.reviewArmedFor = null;
    this.panel.setScrollOffset('list', 0);
    this.panel.setVisible(true);
    this.refresh();
    this.panel.markDirty();
  }
  /** The detail view for one issue or PR (the board rows' tap, callable outright). */
  openDetail(kind: 'issue' | 'pull', number: number) {
    this.detail = { kind, number };
    this.view = 'detail';
    this.assignTarget = null;
    this.closeArmedUntil = 0;
    this.closeArmedFor = null;
    this.queueArmedUntil = 0;
    this.queueArmedFor = null;
    this.reviewArmedUntil = 0;
    this.reviewArmedFor = null;
    this.panel.setScrollOffset('list', 0);
    this.panel.setVisible(true);
    this.refresh();
    this.panel.markDirty();
  }

  assignFor(): AssignTarget | null {
    return this.assignTarget;
  }

  hide() {
    this.panel.setVisible(false);
  }

  currentView(): MenuView {
    return this.view;
  }

  private go(view: MenuView, detail: MenuDetail | null = null) {
    this.view = view;
    this.detail = detail;
    if (view !== 'assign') this.assignTarget = null;
    this.closeArmedUntil = 0;
    this.closeArmedFor = null;
    this.queueArmedUntil = 0;
    this.queueArmedFor = null;
    this.reviewArmedUntil = 0;
    this.reviewArmedFor = null;
    this.panel.setScrollOffset('list', 0);
    this.refresh();
    this.panel.markDirty();
  }

  private refresh() {
    if (!this.panel.visible) return;
    const muted = `${this.stores.isMuted()}|${this.stores.inVoice()}`;
    if (muted !== this.lastMuted) this.lastMuted = muted;
    const limit = this.stores.getQueue().maxWorkers;
    if (limit > 0) this.lastLimit = limit;
    this.syncButtons();
    this.panel.markDirty();
  }

  /** The queue's ⏸/▶ toggle: pause the line, or run it at its old width again. */
  private toggleQueue() {
    const at = this.stores.getQueue().maxWorkers;
    this.actions.queueLimit(at > 0 ? 0 : this.lastLimit);
  }

  // ---- Data -------------------------------------------------------------------------------

  private waiting(): WorkerInfo[] {
    return waitingInOrder(this.stores.getWorkers());
  }

  private openIssues(): GhIssue[] {
    return this.stores.getIssues().items.filter((i) => i.state === 'OPEN');
  }

  private openPulls(): GhPull[] {
    return this.stores.getPulls().items.filter((p) => p.state === 'OPEN');
  }

  private queueLists(): { running: QueueTask[]; queued: QueueTask[]; done: QueueTask[] } {
    const tasks = this.stores.getQueue().tasks;
    return {
      running: tasks.filter((t) => t.status === 'running'),
      queued: tasks.filter((t) => t.status === 'queued'),
      done: tasks.filter((t) => t.status === 'done').slice(-8).reverse(),
    };
  }

  /** Elevator rows: every floor plus the roof (the roof is a ride like any other). */
  private floorRows(): ({ id: string; name: string; here: boolean; cloning: boolean; sub: string } | { roof: true })[] {
    const here = this.stores.currentFloor();
    const onRoof = this.stores.onRoof();
    const rows: ({ id: string; name: string; here: boolean; cloning: boolean; sub: string } | { roof: true })[] = this.stores.getFloors().map((f) => ({
      id: f.id,
      name: f.name,
      here: f.id === here && !onRoof,
      cloning: !!f.cloning,
      sub: f.cloning ? '⏳ cloning…' : `${f.people} 🧑 · ${f.workers} 💻${f.waiting ? ` · ${f.waiting} 🙋` : ''}`,
    }));
    rows.push({ roof: true });
    return rows;
  }

  private chatLines(): ChatLine[] {
    return this.stores.getChat().slice(-40);
  }

  /** The search view's rows: matching chat lines first, then terminal lines (the search window's order). */
  private searchRows(): ({ kind: 'chat'; chat: ChatLine } | { kind: 'term'; hit: TerminalHit })[] {
    const s = this.stores.getSearch();
    if (!s || s.status !== 'done' || !s.results) return [];
    const rows: ({ kind: 'chat'; chat: ChatLine } | { kind: 'term'; hit: TerminalHit })[] = s.results.chat.map((chat) => ({ kind: 'chat' as const, chat }));
    // Workers sent home since the search ran have nothing left to open (the search window's rule).
    for (const hit of s.results.terminals) {
      if (!this.stores.getWorkers().some((w) => w.id === hit.workerId)) continue;
      rows.push({ kind: 'term', hit });
    }
    return rows;
  }

  /** Awake agents, for the assign view (the DOM Ask window's worker list). */
  private awakeWorkers(): WorkerInfo[] {
    return this.stores.getWorkers().filter((w) => w.kind === 'agent' && !isAsleep(w.status));
  }

  /** The settings view's rows: the ⚙️ Settings VR section as tap-to-toggle rows. */
  private settingsRows(): { id: string; icon: string; title: string; sub: string }[] {
    const s = this.stores.getVrSettings();
    const sound = this.stores.getSound();
    const rows = [
      { id: 'glide', icon: '🚶', title: `Stick glide: ${s.glide ? 'on' : 'off'}`, sub: s.glide ? 'the left stick walks you · tap for teleport-only' : 'teleport-only · tap for smooth gliding' },
      { id: 'turn', icon: '🔄', title: `Turning: ${s.turn}`, sub: s.turn === 'snap' ? '45° steps · tap for smooth' : `${s.turnSpeed}°/s · tap for snap steps` },
      { id: 'speed', icon: '🎚️', title: `Turn speed: ${s.turnSpeed}°/s`, sub: 'smooth turning only · tap to step up' },
      { id: 'fade', icon: '🌑', title: `Teleport fade: ${s.fade ? 'on' : 'off'}`, sub: s.fade ? 'through black · tap for instant' : 'instant · tap for the fade' },
    ];
    const dog = this.stores.getDogName();
    if (dog) rows.push({ id: 'dog', icon: '🐶', title: `Office dog: ${dog}`, sub: 'tap to rename for the floor' });
    rows.push(
      { id: 'music', icon: sound.musicMuted ? '🔇' : '🎵', title: sound.musicMuted ? 'Jukebox: muted' : `Jukebox: ${Math.round(sound.music * 100)}%`, sub: 'your ears only · tap to mute/unmute' },
      { id: 'sounds', icon: sound.muted ? '🔇' : '🔊', title: sound.muted ? 'Office sounds: muted' : `Office sounds: ${Math.round(sound.volume * 100)}%`, sub: 'your ears only · tap to mute/unmute' },
    );
    return rows;
  }

  // ---- Buttons ----------------------------------------------------------------------------

  private mainItems(): MainItem[] {
    const waiting = this.waiting();
    const needs = waiting.filter((w) => w.status === 'needs_input').length;
    const q = this.stores.getQueue();
    const activeQueue = q.tasks.filter((t) => t.status !== 'done').length;
    const j = this.stores.getJukebox();
    const items: MainItem[] = [
      { id: 'hire', icon: '✨', title: 'Hire worker', sub: () => `${this.stores.getFreeDesks().length} free desks` },
      {
        id: 'next', icon: needs ? '🙋' : '✅', title: 'Next waiting worker',
        sub: () => (waiting.length ? `${waiting[0].name}${waiting.length > 1 ? ` +${waiting.length - 1} more` : ''} (N)` : 'nobody waiting (N)'),
      },
      { id: 'queue', icon: '📋', title: 'Task queue', sub: () => (q.maxWorkers === 0 ? `paused · ${activeQueue} tasks` : `${activeQueue} active · ${q.maxWorkers} at once`) },
      { id: 'board', icon: '📌', title: 'Issues / PRs', sub: () => `${this.openIssues().length} issues · ${this.openPulls().length} PRs` },
      {
        id: 'services', icon: '🌐', title: 'Services',
        sub: () => {
          const n = this.stores.getServices().items.length;
          return n ? `${n} running · tap one to copy its tunnel` : 'nothing running yet';
        },
      },
      { id: 'floors', icon: '🛗', title: 'Floors', sub: () => `${this.stores.getFloors().length} floors · ride the elevator` },
      { id: 'jukebox', icon: '🎵', title: 'Jukebox', sub: () => (j.on ? trackTitle(j) : 'off — pick a tune') },
      { id: 'chat', icon: '💬', title: 'Chat', sub: () => { const c = this.chatLines(); return c.length ? `${c[c.length - 1].name}: ${c[c.length - 1].text.slice(0, 24)}` : 'say hi to the floor'; } },
      {
        id: 'people', icon: '🧑', title: 'People',
        sub: () => {
          const n = this.stores.getPeers().length;
          return n ? `${n === 1 ? 'one more here' : `${n} around`} · what they're up to` : 'just you here';
        },
      },
      {
        id: 'meeting', icon: '🤝', title: 'Meeting room',
        sub: () => {
          const m = this.stores.getMeeting().current;
          if (!m) return 'the table is empty · call one';
          return m.status === 'running' ? `🔴 ${m.title}` : `${m.status} · ${m.title}`;
        },
      },
      // Out of voice the row joins it (the V key's function); in voice it mutes.
      ...(this.stores.inVoice()
        ? [{
          id: 'mute', icon: this.stores.isMuted() ? '🔇' : '🎙️', title: this.stores.isMuted() ? 'Unmute' : 'Mute',
          sub: () => 'in voice (M)',
        },
        {
          id: 'leave', icon: '📞', title: 'Leave voice',
          sub: () => 'back to silence (V)',
        }]
        : [{
          id: 'mute', icon: '🎙️', title: 'Join voice',
          sub: () => 'talk to the floor (V)',
        }]),
      { id: 'settings', icon: '⚙️', title: 'VR settings', sub: () => 'glide · turning · fade' },
      { id: 'controls', icon: '❓', title: 'VR controls', sub: () => 'pinches, teleports, sticks' },
      { id: 'exit', icon: '🚪', title: 'Exit VR', sub: () => 'back to the flat screen' },
    ];
    // The bar only exists up on the roof (its E is the menu's way in, like the elevator's).
    if (this.stores.onRoof()) items.splice(7, 0, { id: 'bar', icon: '🍸', title: 'Sky Bar', sub: () => (this.stores.barCutOff() ? "you've had enough — water's on the house" : 'the bartender is pouring') });
    return items;
  }

  private mainRect(i: number, n: number): Rect {
    const gap = 0.018;
    const h = (BODY.h - gap * (n - 1)) / n;
    return { x: BODY.x, y: BODY.y + i * (h + gap), w: BODY.w, h };
  }

  /** Rows currently listed in the scroll body, each a button-height unit. */
  private syncButtons() {
    if (this.view === 'main') {
      const items = this.mainItems();
      this.panel.setButtons(items.map((item, i) => ({ id: item.id, rect: this.mainRect(i, items.length), onClick: () => this.mainClick(item.id) })));
      return;
    }
    const buttons: { id: string; rect: Rect; onClick: () => void }[] = [{ id: 'back', rect: BACK_BTN, onClick: () => this.go('main') }];
    if (this.view === 'board') {
      buttons.push(
        { id: 'tab:issues', rect: { x: TABS.x, y: TABS.y, w: TABS.w / 2, h: TABS.h }, onClick: () => { this.boardTab = 'issues'; this.panel.setScrollOffset('list', 0); this.refresh(); } },
        { id: 'tab:pulls', rect: { x: TABS.x + TABS.w / 2, y: TABS.y, w: TABS.w / 2, h: TABS.h }, onClick: () => { this.boardTab = 'pulls'; this.panel.setScrollOffset('list', 0); this.refresh(); } },
      );
    }
    if (this.view === 'jukebox') {
      const on = this.stores.getJukebox().on;
      buttons.push(
        ...(on
          ? [
              { id: 'jb:stop', rect: JB_STOP, onClick: () => this.actions.jukebox('stop') },
              { id: 'jb:skip', rect: JB_SKIP, onClick: () => this.actions.jukebox('skip') },
            ]
          : [{ id: 'jb:play', rect: JB_PLAY, onClick: () => this.actions.jukebox('play') }]),
      );
    }
    if (this.view === 'chat') {
      buttons.push(
        { id: 'say', rect: SAY_BTN, onClick: () => this.onChatSay?.() },
        { id: 'find', rect: CHAT_FIND, onClick: () => this.onChatSearch?.() },
      );
    }
    if (this.view === 'floors') {
      buttons.push({ id: 'add', rect: FLOORS_ADD, onClick: () => this.actions.addFloor() });
    }
    if (this.view === 'queue') {
      buttons.push(
        { id: 'q:add', rect: QB_ADD, onClick: () => this.actions.addQueueTask() },
        { id: 'q:pause', rect: QB_TOGGLE, onClick: () => this.toggleQueue() },
      );
    }
    if (this.view === 'hire') {
      buttons.push({ id: 'hire:wt', rect: HIRE_WT, onClick: () => { this.actions.toggleWorktree(); this.panel.markDirty(); } });
    }
    if (this.view === 'meeting') {
      const m = this.stores.getMeeting().current;
      // One header button, whatever the state: the ended summary row taps to call another.
      if (!m) buttons.push({ id: 'mtg:call', rect: MTG_CALL, onClick: () => this.actions.meetingCall() });
      else if (m.status === 'running') buttons.push({ id: 'mtg:stop', rect: MTG_STOP, onClick: () => this.actions.meetingStop() });
      else buttons.push({ id: 'mtg:clear', rect: MTG_CLEAR, onClick: () => this.actions.meetingClear() });
    }
    if (this.view === 'detail' && this.detail) {
      const d = this.detail;
      const item = d.kind === 'issue'
        ? this.stores.getIssues().items.find((i) => i.number === d.number)
        : this.stores.getPulls().items.find((p) => p.number === d.number);
      // Gone from the board: back only (no invisible buttons under the note).
      if (!item) {
        this.panel.setButtons(buttons);
        return;
      }
      buttons.push({ id: 'act:close', rect: CLOSE_BTN, onClick: () => this.tapClose() });
      if (d.kind === 'issue') {
        buttons.push(
          { id: 'act:hand', rect: { x: 0.05, y: 0.82, w: 0.28, h: 0.12 }, onClick: () => this.openAssign(d.number, this.issueTitle(d.number)) },
          { id: 'act:queue', rect: { x: 0.36, y: 0.82, w: 0.28, h: 0.12 }, onClick: () => this.actions.queueIssue(d.number, this.issueTitle(d.number)) },
          { id: 'act:comment', rect: { x: 0.67, y: 0.82, w: 0.28, h: 0.12 }, onClick: () => this.actions.commentOn('issue', d.number) },
        );
      }
      if (d.kind === 'pull') {
        const w = this.pullWorker(d.number);
        const open = (item as { state?: string }).state === 'OPEN';
        const termR = { x: 0.05, y: 0.82, w: open ? 0.42 : 0.55, h: 0.12 };
        const commentR = w
          ? (open ? { x: 0.49, y: 0.82, w: 0.24, h: 0.12 } : { x: 0.62, y: 0.82, w: 0.33, h: 0.12 })
          : (open ? { x: 0.05, y: 0.82, w: 0.44, h: 0.12 } : { x: 0.05, y: 0.82, w: 0.9, h: 0.12 });
        const reviewR = w ? { x: 0.75, y: 0.82, w: 0.2, h: 0.12 } : { x: 0.51, y: 0.82, w: 0.44, h: 0.12 };
        if (w) buttons.push({ id: 'act:term', rect: termR, onClick: () => this.onOpenTerminal?.(w) });
        buttons.push({ id: 'act:comment', rect: commentR, onClick: () => this.actions.commentOn('pull', d.number) });
        if (open) buttons.push({ id: 'act:review', rect: reviewR, onClick: () => this.tapReview(d.number) });
      }
      this.panel.setButtons(buttons);
      return;
    }
    // Scrollable rows: buttons sit where the rows paint (scroll offset applied); rows
    // scrolled out of the body simply never get hit.
    const count = this.rowCount();
    const rowH = this.rowHPx();
    const off = this.panel.scrollOffset('list');
    for (let i = 0; i < count; i++) {
      buttons.push({ id: `row:${i}`, rect: { x: BODY.x, y: BODY.y + (i - off) * rowH, w: BODY.w, h: rowH * 0.92 }, onClick: () => this.rowClick(i) });
    }
    this.rowSyncKey = `${this.view}|${this.boardTab}|${this.assignTarget?.number ?? ''}|${count}|${off.toFixed(3)}`;
    this.panel.setButtons(buttons);
  }

  /** Row buttons track the list's scroll offset; re-syncs only when it (or the list) moved. */
  private syncRowsIfMoved() {
    const key = `${this.view}|${this.boardTab}|${this.assignTarget?.number ?? ''}|${this.rowCount()}|${this.panel.scrollOffset('list').toFixed(3)}`;
    if (key !== this.rowSyncKey) this.syncButtons();
  }

  private rowHPx(): number {
    // In normalized units; ~9 rows visible.
    return BODY.h / 9;
  }

  private rowCount(): number {
    if (this.view === 'hire') return Math.max(1, this.stores.getFreeDesks().length);
    if (this.view === 'queue') {
      const l = this.queueLists();
      return l.running.length + l.queued.length + l.done.length;
    }
    if (this.view === 'floors') return this.floorRows().length;
    if (this.view === 'jukebox') return JUKEBOX_TUNES.length + 1;
    if (this.view === 'bar') return DRINKS.length;
    if (this.view === 'chat') return Math.max(1, this.chatLines().length);
    if (this.view === 'search') return this.searchRows().length;
    if (this.view === 'assign') return Math.max(1, this.awakeWorkers().length);
    if (this.view === 'settings') return this.settingsRows().length;
    if (this.view === 'meeting') {
      const m = this.stores.getMeeting().current;
      return (m ? m.seats.length + 1 : 0) + this.stores.getMeeting().past.length;
    }
    if (this.view === 'services') return this.stores.getServices().items.length;
    if (this.view === 'people') return this.stores.getPeers().length;
    // board
    return this.boardTab === 'issues' ? Math.max(1, this.openIssues().length) : Math.max(1, this.openPulls().length);
  }

  private mainClick(id: string) {
    switch (id) {
      case 'hire': return this.go('hire');
      case 'next': return this.actions.nextWaiting();
      case 'queue': return this.go('queue');
      case 'board': return this.go('board');
      case 'floors': return this.go('floors');
      case 'jukebox': return this.go('jukebox');
      case 'bar': return this.go('bar');
      case 'chat': return this.go('chat');
      case 'meeting': return this.go('meeting');
      case 'services': return this.go('services');
      case 'people': return this.go('people');
      case 'mute': return this.actions.toggleMute();
      case 'leave': return this.actions.leaveVoice();
      case 'settings': return this.go('settings');
      case 'controls': return this.onShowControls?.();
      case 'exit': return this.actions.exitVr();
    }
  }

  private rowClick(i: number) {
    if (this.view === 'hire') {
      const desks = this.stores.getFreeDesks();
      const d = desks[i];
      if (d) this.actions.hire(d.id);
      else this.panel.markDirty();
      return;
    }
    if (this.view === 'queue') {
      const t = this.queueTaskAt(i);
      if (!t) return;
      // Running work opens its terminal (whose ⏻ stops it); queued and done arm tap-twice.
      if (t.status === 'running') {
        const w = t.workerId && this.stores.getWorkers().some((x) => x.id === t.workerId) ? t.workerId : null;
        if (w) this.onOpenTerminal?.(w);
        return;
      }
      if (t.status !== 'queued' && t.status !== 'done') return;
      if (this.queueArmedFor === t.id && performance.now() < this.queueArmedUntil) {
        this.queueArmedFor = null;
        this.queueArmedUntil = 0;
        if (t.status === 'queued') this.actions.removeQueueTask(t.id);
        else this.actions.retryQueueTask(t.id);
        this.panel.markDirty();
        return;
      }
      this.queueArmedFor = t.id;
      this.queueArmedUntil = performance.now() + TAP_ARM_MS;
      this.panel.markDirty();
      return;
    }
    if (this.view === 'floors') {
      const row = this.floorRows()[i];
      if (!row) return;
      if ('roof' in row) {
        if (!this.stores.onRoof()) this.actions.ride(ROOF);
        return;
      }
      if (!row.here && !row.cloning) this.actions.ride(row.id);
      return;
    }
    if (this.view === 'jukebox') {
      const t = JUKEBOX_TUNES[i];
      if (t) this.actions.jukebox('play', t.id);
      else if (i === JUKEBOX_TUNES.length) this.actions.playStream();
      return;
    }
    if (this.view === 'bar') {
      const d = DRINKS[i];
      if (d && !(this.stores.barCutOff() && d.strength > 0)) this.actions.orderDrink(d.id);
      return;
    }
    if (this.view === 'chat') return; // lines are read-only; ✍️ says something
    if (this.view === 'search') {
      const s = this.stores.getSearch();
      const row = this.searchRows()[i];
      // A terminal line opens that terminal right at it (the search window's jump); chat lines
      // are read-only — they're already in the chat view.
      if (s?.results && row?.kind === 'term') {
        this.onOpenTerminal?.(row.hit.workerId, { needle: searchKey(s.results.q), fromEnd: row.hit.rows - row.hit.row });
      }
      return;
    }
    if (this.view === 'meeting') {
      // Row 0 is the summary (tap it to call another once the room is free); a seat opens
      // its worker's terminal, like the queue rows.
      if (i === 0) {
        const m = this.stores.getMeeting().current;
        if (m && m.status !== 'running') this.actions.meetingCall();
        return;
      }
      const seat = this.stores.getMeeting().current?.seats[i - 1];
      const w = seat?.workerId ? this.stores.getWorkers().find((x) => x.id === seat.workerId) : undefined;
      if (w) this.onOpenTerminal?.(w.id);
      return;
    }
    if (this.view === 'settings') {
      const s = this.stores.getVrSettings();
      const id = this.settingsRows()[i]?.id;
      if (id === 'glide') this.actions.vrSettings({ glide: !s.glide });
      else if (id === 'turn') this.actions.vrSettings({ turn: s.turn === 'snap' ? 'smooth' : 'snap' });
      else if (id === 'speed') {
        const next = s.turnSpeed + 30;
        this.actions.vrSettings({ turnSpeed: next > 180 ? 30 : next });
      } else if (id === 'fade') this.actions.vrSettings({ fade: !s.fade });
      else if (id === 'dog') this.actions.renameDog();
      else if (id === 'music') this.actions.toggleSound('music');
      else if (id === 'sounds') this.actions.toggleSound('sounds');
      this.refresh();
      return;
    }
    if (this.view === 'assign') {
      const w = this.awakeWorkers()[i];
      const target = this.assignTarget;
      if (w && target) {
        this.actions.promptWorker(w.id, target.number, target.title);
        this.go('detail', { kind: 'issue', number: target.number });
      }
      return;
    }
    if (this.view === 'services') {
      const svc = this.stores.getServices().items[i];
      if (svc) this.actions.copyServiceTunnel(svc.port);
      return;
    }
    if (this.view === 'people') {
      const p = this.stores.getPeers()[i];
      if (p) this.actions.walkToPeer(p.id);
      return;
    }
    if (this.view === 'board') {
      if (this.boardTab === 'issues') {
        const it = this.openIssues()[i];
        if (it) this.go('detail', { kind: 'issue', number: it.number });
      } else {
        const pr = this.openPulls()[i];
        if (pr) this.go('detail', { kind: 'pull', number: pr.number });
      }
    }
  }

  private queueTaskAt(i: number): QueueTask | null {
    const l = this.queueLists();
    return [...l.running, ...l.queued, ...l.done][i] ?? null;
  }
  /** The queue row's arm: live while the same task id is armed and the window holds. */
  private queueArmed(i: number): boolean {
    const t = this.queueTaskAt(i);
    return !!t && this.queueArmedFor === t.id && performance.now() < this.queueArmedUntil;
  }

  private issueTitle(number: number): string {
    return this.stores.getIssues().items.find((i) => i.number === number)?.title ?? '';
  }

  private pullWorker(number: number): string | null {
    const pr = this.stores.getPulls().items.find((p) => p.number === number);
    if (!pr) return null;
    for (const w of this.stores.getWorkers()) {
      if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w.id;
    }
    return null;
  }

  // ---- Paint --------------------------------------------------------------------------------

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    ctx.fillStyle = 'rgba(12,12,15,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.02));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, h * 0.003);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.02));
    ctx.clip();

    const title = this.view === 'main' ? '☰ Menu' : this.view === 'hire' ? '✨ Hire worker' : this.view === 'queue' ? '📋 Task queue' : this.view === 'board' ? '📌 Issues / PRs' : this.view === 'floors' ? '🛗 Floors' : this.view === 'jukebox' ? '🎵 Jukebox' : this.view === 'bar' ? '🍸 Sky Bar' : this.view === 'chat' ? '💬 Chat' : this.view === 'search' ? `🔎 ${this.stores.getSearch()?.query.trim() || 'Search'}` : this.view === 'settings' ? '⚙️ VR settings' : this.view === 'meeting' ? '🤝 Meeting room' : this.view === 'services' ? '🌐 Services' : this.view === 'people' ? '🧑 People' : this.view === 'assign' ? `🤖 Hand #${this.assignTarget?.number ?? ''} to…` : this.detailTitle();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.042)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(title, w * (this.view === 'main' ? 0.05 : 0.22), h * HEADER_H * 0.55, w * (this.view === 'board' ? 0.3 : this.view === 'jukebox' || this.view === 'chat' || this.view === 'meeting' || this.view === 'queue' ? 0.34 : 0.5));
    if (this.view !== 'main') this.paintBack(ctx, w, h, state);
    if (this.view === 'detail') this.paintCloseBtn(ctx, w, h, state);
    if (this.view === 'board') this.paintTabs(ctx, w, h, state);
    if (this.view === 'jukebox') this.paintTransport(ctx, w, h, state);
    if (this.view === 'chat') this.paintSay(ctx, w, h, state);
    if (this.view === 'floors') this.paintFloorsAdd(ctx, w, h, state);
    if (this.view === 'queue') this.paintQueueBtns(ctx, w, h, state);
    if (this.view === 'hire') this.paintHireWt(ctx, w, h, state);
    if (this.view === 'meeting') this.paintMeetingBtns(ctx, w, h, state);
    ctx.strokeStyle = '#ee6018';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(0, h * HEADER_H);
    ctx.lineTo(w, h * HEADER_H);
    ctx.stroke();

    if (this.view === 'main') this.paintMain(ctx, w, h, state);
    else if (this.view === 'detail') this.paintDetail(ctx, w, h, state);
    else this.paintList(ctx, w, h, state);
    ctx.restore();
  }

  private detailTitle(): string {
    if (!this.detail) return '';
    return this.detail.kind === 'issue' ? `📌 #${this.detail.number}` : `🔀 #${this.detail.number}`;
  }

  private pill(ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number, id: string, state: { hoverId: string | null; pressedId: string | null }, hot = '#ee6018') {
    const x = r.x * w;
    const y = r.y * h;
    const hot_ = state.hoverId === id || state.pressedId === id;
    ctx.fillStyle = hot_ ? hot : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(x, y, r.w * w, r.h * h, r.h * h * 0.35);
    ctx.fill();
  }

  /** The detail ✕ tap: the first arms it (red, with a ?), the second closes the issue or PR. */
  private tapClose() {
    const d = this.detail;
    if (!d || this.view !== 'detail') return;
    const key = `${d.kind}:${d.number}`;
    if (this.closeArmedFor === key && performance.now() < this.closeArmedUntil) {
      this.closeArmedUntil = 0;
      this.closeArmedFor = null;
      this.actions.closeItem(d.kind, d.number);
      this.panel.markDirty();
      return;
    }
    this.closeArmedFor = key;
    this.closeArmedUntil = performance.now() + TAP_ARM_MS;
    this.panel.markDirty();
  }
  private paintCloseBtn(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const d = this.detail;
    if (!d) return;
    const armed = this.closeArmedFor === `${d.kind}:${d.number}` && performance.now() < this.closeArmedUntil;
    const hot = state.hoverId === 'act:close' || state.pressedId === 'act:close';
    ctx.fillStyle = armed ? '#ef476f' : hot ? '#ee6018' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(CLOSE_BTN.x * w, CLOSE_BTN.y * h, CLOSE_BTN.w * w, CLOSE_BTN.h * h, CLOSE_BTN.h * h * 0.35);
    ctx.fill();
    ctx.fillStyle = armed ? '#111' : '#eeeeee';
    ctx.font = `700 ${Math.round(CLOSE_BTN.h * h * 0.42)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(armed ? '✕ Close?' : '✕ Close', (CLOSE_BTN.x + CLOSE_BTN.w / 2) * w, (CLOSE_BTN.y + CLOSE_BTN.h / 2) * h);
    ctx.textAlign = 'left';
  }
  private paintHireWt(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const on = this.stores.getWorktree();
    const hot = state.hoverId === 'hire:wt' || state.pressedId === 'hire:wt';
    ctx.fillStyle = on ? (hot ? '#ff7a2e' : '#ee6018') : hot ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(HIRE_WT.x * w, HIRE_WT.y * h, HIRE_WT.w * w, HIRE_WT.h * h, HIRE_WT.h * h * 0.35);
    ctx.fill();
    ctx.fillStyle = on ? '#111' : '#eeeeee';
    ctx.font = `700 ${Math.round(HIRE_WT.h * h * 0.42)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(on ? '🌿 on' : '🌿 off', (HIRE_WT.x + HIRE_WT.w / 2) * w, (HIRE_WT.y + HIRE_WT.h / 2) * h);
    ctx.textAlign = 'left';
  }
  private paintBack(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    this.pill(ctx, BACK_BTN, w, h, 'back', state);
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(BACK_BTN.h * h * 0.42)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('← back', (BACK_BTN.x + BACK_BTN.w / 2) * w, (BACK_BTN.y + BACK_BTN.h / 2) * h);
    ctx.textAlign = 'left';
  }

  private paintTabs(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const tabs: { id: string; label: string; tab: 'issues' | 'pulls' }[] = [
      { id: 'tab:issues', label: `📌 ${this.openIssues().length}`, tab: 'issues' },
      { id: 'tab:pulls', label: `🔀 ${this.openPulls().length}`, tab: 'pulls' },
    ];
    tabs.forEach((t, i) => {
      const r: Rect = { x: TABS.x + (TABS.w / 2) * i, y: TABS.y, w: TABS.w / 2 - 0.01, h: TABS.h };
      const active = this.boardTab === t.tab;
      const hot = state.hoverId === t.id || state.pressedId === t.id;
      ctx.fillStyle = active ? '#ee6018' : hot ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.35);
      ctx.fill();
      ctx.fillStyle = active ? '#111' : '#eeeeee';
      ctx.font = `700 ${Math.round(r.h * h * 0.4)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(t.label, (r.x + r.w / 2) * w, (r.y + r.h / 2) * h);
    });
    ctx.textAlign = 'left';
  }

  private paintTransport(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const on = this.stores.getJukebox().on;
    const btns: { id: string; label: string; r: Rect }[] = on
      ? [{ id: 'jb:stop', label: '⏹', r: JB_STOP }, { id: 'jb:skip', label: '⏭', r: JB_SKIP }]
      : [{ id: 'jb:play', label: '▶', r: JB_PLAY }];
    for (const b of btns) {
      this.pill(ctx, b.r, w, h, b.id, state);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(b.r.h * h * 0.44)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, (b.r.x + b.r.w / 2) * w, (b.r.y + b.r.h / 2) * h);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private paintSay(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    this.pill(ctx, SAY_BTN, w, h, 'say', state);
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(SAY_BTN.h * h * 0.38)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✍️ say', (SAY_BTN.x + SAY_BTN.w / 2) * w, (SAY_BTN.y + SAY_BTN.h / 2) * h);
    this.pill(ctx, CHAT_FIND, w, h, 'find', state);
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(CHAT_FIND.h * h * 0.38)}px ${TERM_FONT}`;
    ctx.fillText('🔎 find', (CHAT_FIND.x + CHAT_FIND.w / 2) * w, (CHAT_FIND.y + CHAT_FIND.h / 2) * h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private paintFloorsAdd(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    this.pill(ctx, FLOORS_ADD, w, h, 'add', state);
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(FLOORS_ADD.h * h * 0.38)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➕ add', (FLOORS_ADD.x + FLOORS_ADD.w / 2) * w, (FLOORS_ADD.y + FLOORS_ADD.h / 2) * h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private paintQueueBtns(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const paused = this.stores.getQueue().maxWorkers === 0;
    const btns: { id: string; label: string; r: Rect }[] = [
      { id: 'q:add', label: '➕', r: QB_ADD },
      { id: 'q:pause', label: paused ? '▶ run' : '⏸ pause', r: QB_TOGGLE },
    ];
    for (const b of btns) {
      this.pill(ctx, b.r, w, h, b.id, state);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(b.r.h * h * 0.36)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, (b.r.x + b.r.w / 2) * w, (b.r.y + b.r.h / 2) * h);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private paintMeetingBtns(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const m = this.stores.getMeeting().current;
    const btns: { id: string; label: string; r: Rect }[] = !m
      ? [{ id: 'mtg:call', label: '🤝 call', r: MTG_CALL }]
      : m.status === 'running'
        ? [{ id: 'mtg:stop', label: '⏹ stop', r: MTG_STOP }]
        : [{ id: 'mtg:clear', label: '🧹 clear', r: MTG_CLEAR }];
    for (const b of btns) {
      this.pill(ctx, b.r, w, h, b.id, state);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(b.r.h * h * 0.36)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, (b.r.x + b.r.w / 2) * w, (b.r.y + b.r.h / 2) * h);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private paintMain(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const items = this.mainItems();
    items.forEach((item, i) => {
      const r = this.mainRect(i, items.length);
      const hot = state.hoverId === item.id || state.pressedId === item.id;
      ctx.fillStyle = hot ? (item.id === 'exit' ? 'rgba(239,71,111,0.35)' : 'rgba(238,96,24,0.28)') : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.22);
      ctx.fill();
      if (hot) {
        ctx.strokeStyle = item.id === 'exit' ? '#ef476f' : '#ee6018';
        ctx.lineWidth = Math.max(2, h * 0.003);
        ctx.stroke();
      }
      const cx = (r.x + 0.02) * w;
      const cy = (r.y + r.h / 2) * h;
      ctx.font = `${Math.round(r.h * h * 0.42)}px ${TERM_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(item.icon, cx, cy);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(r.h * h * 0.3)}px ${TERM_FONT}`;
      ctx.fillText(item.title, cx + r.h * h * 0.62, cy - r.h * h * 0.14, r.w * w * 0.7);
      ctx.fillStyle = '#8c8c8c';
      ctx.font = `500 ${Math.round(r.h * h * 0.22)}px ${TERM_FONT}`;
      ctx.fillText(item.sub(), cx + r.h * h * 0.62, cy + r.h * h * 0.26, r.w * w * 0.7);
      ctx.fillStyle = '#eeeeee';
    });
  }

  private paintList(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const count = this.rowCount();
    const rowH = this.rowHPx();
    const visible = BODY.h / rowH;
    this.panel.setScrollContent('list', count, visible);
    // Row buttons track the scroll offset (re-synced while the list moves).
    const top = clampScroll(this.panel.scrollOffset('list'), count, visible);

    const bx = BODY.x * w;
    const by = BODY.y * h;
    const bw = BODY.w * w;
    const bh = BODY.h * h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    const first = Math.floor(top);
    const last = Math.min(count, Math.ceil(top + visible) + 1);
    for (let i = first; i < last; i++) {
      const y = by + (i - top) * rowH * h;
      const rh = rowH * h * 0.92;
      const hot = state.hoverId === `row:${i}` || state.pressedId === `row:${i}`;
      const armed = this.view === 'queue' && this.queueArmed(i);
      ctx.fillStyle = armed ? 'rgba(239,71,111,0.3)' : hot ? 'rgba(238,96,24,0.25)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, rh, rh * 0.2);
      ctx.fill();
      this.paintRow(ctx, i, bx, y, bw, rh);
    }
    // Empty states.
    if (this.view === 'hire' && !this.stores.getFreeDesks().length) this.centerNote(ctx, w, 'Every desk is taken', h);
    if (this.view === 'board' && this.boardTab === 'issues' && !this.openIssues().length) this.centerNote(ctx, w, 'No open issues 🎉', h);
    if (this.view === 'board' && this.boardTab === 'pulls' && !this.openPulls().length) this.centerNote(ctx, w, 'No open PRs', h);
    if (this.view === 'queue' && count === 0) this.centerNote(ctx, w, 'Nothing on the queue', h);
    if (this.view === 'chat' && !this.chatLines().length) this.centerNote(ctx, w, 'Quiet on this floor — say hi ✍️', h);
    if (this.view === 'search') {
      const s = this.stores.getSearch();
      if (s?.status === 'searching') this.centerNote(ctx, w, 'Searching…', h);
      else if (s?.status === 'error') this.centerNote(ctx, w, 'The search failed — try again', h);
      else if (s && !this.searchRows().length) this.centerNote(ctx, w, `Nothing matches “${s.query.trim().slice(0, 24)}”`, h);
    }
    if (this.view === 'assign' && !this.awakeWorkers().length) this.centerNote(ctx, w, 'Nobody awake — hire a worker first', h);
    if (this.view === 'meeting' && !this.stores.getMeeting().current && !this.stores.getMeeting().past.length) this.centerNote(ctx, w, 'The table is empty — 🤝 call one', h);
    if (this.view === 'services' && !this.stores.getServices().items.length) this.centerNote(ctx, w, 'Nothing running yet', h);
    if (this.view === 'people' && !this.stores.getPeers().length) this.centerNote(ctx, w, 'Just you here', h);
    ctx.restore();
    // Scrollbar.
    if (count > visible) {
      const trackX = (BODY.x + BODY.w) * w + w * 0.004;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(trackX, by, Math.max(3, w * 0.005), bh);
      const thumbH = Math.max(bh * 0.06, (bh * visible) / count);
      const thumbY = by + ((bh - thumbH) * top) / (count - visible);
      ctx.fillStyle = '#ee6018';
      ctx.fillRect(trackX, thumbY, Math.max(3, w * 0.005), thumbH);
    }
  }

  private centerNote(ctx: CanvasRenderingContext2D, w: number, text: string, h: number) {
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.032)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(text, (BODY.x + BODY.w / 2) * w, (BODY.y + BODY.h / 2) * h);
    ctx.textAlign = 'left';
  }

  private paintRow(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, bw: number, rh: number) {
    if (this.view === 'hire') {
      const d = this.stores.getFreeDesks()[i];
      if (!d) return;
      this.rowText(ctx, '🪑', d.label, 'tap to hire here', x, y, bw, rh);
      return;
    }
    if (this.view === 'floors') {
      const row = this.floorRows()[i];
      if (!row) return;
      if ('roof' in row) {
        const here = this.stores.onRoof();
        this.rowText(ctx, '🍸', ROOF_NAME, here ? 'you are here' : 'ride up', x, y, bw, rh);
        return;
      }
      this.rowText(ctx, row.here ? '📍' : '🛗', row.name, row.here ? 'you are here' : row.sub, x, y, bw, rh);
      return;
    }
    if (this.view === 'jukebox') {
      const t = JUKEBOX_TUNES[i];
      const j = this.stores.getJukebox();
      if (!t) {
        const playing = j.on && j.track === STREAM;
        this.rowText(ctx, playing ? '🔊' : '📻', 'Play a stream…', playing ? `on now${j.by ? ` · put on by ${j.by}` : ''}` : 'internet radio or an .mp3 link', x, y, bw, rh);
        return;
      }
      const playing = j.on && j.track === t.id;
      this.rowText(ctx, playing ? '🔊' : '🎵', t.title, playing ? `on now${j.by ? ` · put on by ${j.by}` : ''}` : t.mood, x, y, bw, rh);
      return;
    }
    if (this.view === 'bar') {
      const d = DRINKS[i];
      if (!d) return;
      const refused = this.stores.barCutOff() && d.strength > 0;
      this.rowText(ctx, d.emoji, d.name, refused ? "the bartender won't pour this" : `${d.blurb} · ${kick(d)}`, x, y, bw, rh);
      return;
    }
    if (this.view === 'chat') {
      const c = this.chatLines()[i];
      if (!c) return;
      const when = new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.rowText(ctx, '💬', `${c.name}: ${c.text}`, when, x, y, bw, rh);
      return;
    }
    if (this.view === 'search') {
      const row = this.searchRows()[i];
      if (!row) return;
      if (row.kind === 'chat') {
        const when = new Date(row.chat.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.rowText(ctx, '💬', `${row.chat.name}: ${row.chat.text}`, when, x, y, bw, rh);
        return;
      }
      const who = this.stores.getWorkers().find((w) => w.id === row.hit.workerId)?.name ?? 'A worker';
      this.rowText(ctx, '💻', who, row.hit.text, x, y, bw, rh);
      return;
    }
    if (this.view === 'assign') {
      const w = this.awakeWorkers()[i];
      if (!w) return;
      this.rowText(ctx, '🤖', w.name, `${statusLabel(w.status)} · tap to hand #${this.assignTarget?.number ?? ''} over`, x, y, bw, rh);
      return;
    }
    if (this.view === 'settings') {
      const r = this.settingsRows()[i];
      if (!r) return;
      this.rowText(ctx, r.icon, r.title, r.sub, x, y, bw, rh);
      return;
    }
    if (this.view === 'meeting') {
      this.paintMeetingRow(ctx, i, x, y, bw, rh);
      return;
    }
    if (this.view === 'services') {
      const svc = this.stores.getServices().items[i];
      if (!svc) return;
      const who = this.stores.getWorkers().find((w) => w.id === svc.workerId)?.name ?? 'A worker';
      this.rowText(ctx, '🌐', svc.title || svc.command, `${who} · :${svc.port} · started ${timeAgo(svc.since)}`, x, y, bw, rh);
      return;
    }
    if (this.view === 'people') {
      const p = this.stores.getPeers()[i];
      if (!p) return;
      const floor = p.floor ? (this.stores.getFloors().find((f) => f.id === p.floor)?.name ?? null) : null;
      const sub = [whereabouts(p), floor].filter(Boolean).join(' · ') || 'walking around';
      this.rowText(ctx, p.sharing ? '🖥️' : !p.voice ? '🧑' : p.muted ? '🔇' : '🎙️', p.name, `${sub} · tap to walk over`, x, y, bw, rh);
      return;
    }
    if (this.view === 'queue') {
      const t = this.queueTaskAt(i);
      if (!t) return;
      const icon = t.status === 'running' ? '🤖' : t.status === 'queued' ? '⏳' : t.outcome === 'done' ? '✅' : '⚠️';
      const title = t.issue !== undefined ? `#${t.issue} ${t.title}` : t.title;
      const armed = this.queueArmed(i);
      const sub = armed
        ? t.status === 'queued' ? 'tap again to take it off' : 'tap again to put it back on'
        : t.status === 'running' ? `${t.workerName ?? 'a worker'}` : t.status === 'queued' ? `queued by ${t.addedBy}` : t.pr ? `PR #${t.pr.number}` : t.outcome ?? 'done';
      this.rowText(ctx, icon, title, sub, x, y, bw, rh);
      return;
    }
    // board
    if (this.boardTab === 'issues') {
      const it = this.openIssues()[i];
      if (!it) return;
      const task = this.stores.getQueue().tasks.find((t) => t.issue === it.number && t.status !== 'done');
      this.rowText(ctx, task ? '📋' : '📌', `#${it.number} ${it.title}`, `${it.author} · 💬 ${it.comments}`, x, y, bw, rh);
    } else {
      const pr = this.openPulls()[i];
      if (!pr) return;
      this.rowText(ctx, pr.isDraft ? '📝' : '🔀', `#${pr.number} ${pr.title}`, `${pr.author} · +${pr.additions}/-${pr.deletions}`, x, y, bw, rh);
    }
  }

  /** The meeting view's rows: the summary first, then a row per seat, then the earlier meetings (the DOM window, trimmed). */
  private paintMeetingRow(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, bw: number, rh: number) {
    const m = this.stores.getMeeting().current;
    const past = this.stores.getMeeting().past;
    const pastRow = i - (m ? m.seats.length + 1 : 0);
    if (!m || pastRow >= 0) {
      const r = past[pastRow];
      if (!r) return;
      this.rowText(ctx, '🗂️', r.title, r.summary, x, y, bw, rh);
      return;
    }
    const p = MEETING_PATTERNS[m.pattern];
    if (i === 0) {
      const title = m.status === 'running' ? `${p.icon} ${m.title}` : m.status === 'done' ? `✅ ${m.title}` : `⛔ ${m.title}`;
      const doing = [...new Set(m.turns.filter((t) => t.state !== 'done').map((t) => t.doing))].join(', ');
      const sub = m.status === 'running'
        ? `Round ${m.round} of ${m.rounds}${doing ? ` · ${doing}` : ''} · ${meetingSpend(m)} of ${fmtTokens(m.budget)}`
        : m.status === 'done'
          ? `Wrote ${m.output} in ${m.round} round${m.round === 1 ? '' : 's'} · tap to call another`
          : `Stopped in round ${m.round} · tap to call another`;
      this.rowText(ctx, '🤝', title, sub, x, y, bw, rh);
      return;
    }
    const seat = m.seats[i - 1];
    if (!seat) return;
    const turn = m.turns.find((t) => t.seat === i - 1);
    const part = m.status === 'running' ? (turn ? `${partLabel(turn.state)}: ${turn.doing}` : 'listening') : seat.tokens ? `${fmtTokens(seat.tokens)} tokens` : 'sat in';
    this.rowText(ctx, i === 1 ? '👑' : '💺', seat.role, `${seat.workerName ?? '…'} · ${part}`, x, y, bw, rh);
  }

  private rowText(ctx: CanvasRenderingContext2D, icon: string, title: string, sub: string, x: number, y: number, bw: number, rh: number) {
    ctx.fillStyle = '#eeeeee';
    ctx.font = `${Math.round(rh * 0.4)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x + rh * 0.18, y + rh / 2);
    const tx = x + rh * 0.85;
    ctx.font = `600 ${Math.round(rh * 0.32)}px ${TERM_FONT}`;
    ctx.fillText(this.clip(ctx, title, bw - rh), tx, y + rh * 0.32);
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(rh * 0.24)}px ${TERM_FONT}`;
    ctx.fillText(this.clip(ctx, sub, bw - rh), tx, y + rh * 0.72);
    ctx.fillStyle = '#eeeeee';
  }

  private clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  private paintDetail(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null }) {
    const d = this.detail;
    if (!d) return;
    const item = d.kind === 'issue'
      ? this.stores.getIssues().items.find((i) => i.number === d.number)
      : this.stores.getPulls().items.find((p) => p.number === d.number);
    if (!item) {
      this.centerNote(ctx, w, 'Gone from the board', h);
      return;
    }
    const bx = BODY.x * w;
    const bw = BODY.w * w;
    let y = BODY.y * h + h * 0.01;
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.032)}px ${TERM_FONT}`;
    ctx.textBaseline = 'top';
    const titleLines = this.wrap(ctx, item.title, bw);
    for (const line of titleLines.slice(0, 3)) {
      ctx.fillText(line, bx, y);
      y += h * 0.04;
    }
    y += h * 0.005;
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.024)}px ${TERM_FONT}`;
    const meta = d.kind === 'issue'
      ? `by ${(item as GhIssue).author} · 💬 ${(item as GhIssue).comments}`
      : `by ${(item as GhPull).author} · ${(item as GhPull).isDraft ? 'draft' : 'in review'} · +${(item as GhPull).additions}/-${(item as GhPull).deletions}`;
    ctx.fillText(meta, bx, y);
    y += h * 0.045;
    const labels = item.labels.slice(0, 4);
    if (labels.length) {
      ctx.font = `600 ${Math.round(h * 0.022)}px ${TERM_FONT}`;
      let lx = bx;
      for (const l of labels) {
        const tw = ctx.measureText(l.name).width + w * 0.03;
        if (lx + tw > bx + bw) break;
        ctx.fillStyle = `#${l.color}`;
        ctx.beginPath();
        ctx.roundRect(lx, y, tw, h * 0.032, h * 0.01);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillText(l.name, lx + w * 0.015, y + h * 0.004);
        lx += tw + w * 0.015;
      }
      y += h * 0.05;
    }
    // Body, clipped to the space above the action buttons.
    const bottom = h * 0.8;
    ctx.fillStyle = '#cfcfcf';
    ctx.font = `400 ${Math.round(h * 0.023)}px ${TERM_FONT}`;
    const body = (item.body || 'No description.').replace(/\s+/g, ' ').slice(0, DETAIL_BODY_MAX);
    for (const line of this.wrap(ctx, body, bw)) {
      if (y + h * 0.03 > bottom) break;
      ctx.fillText(line, bx, y);
      y += h * 0.03;
    }
    // Actions.
    if (d.kind === 'issue') {
      this.actionBtn(ctx, w, h, { x: 0.05, y: 0.82, w: 0.28, h: 0.12 }, 'act:hand', '🤖 Hand', state, true);
      this.actionBtn(ctx, w, h, { x: 0.36, y: 0.82, w: 0.28, h: 0.12 }, 'act:queue', '📋 Queue', state, false);
      this.actionBtn(ctx, w, h, { x: 0.67, y: 0.82, w: 0.28, h: 0.12 }, 'act:comment', '💬 Comment', state, false);
    } else {
      const workerId = this.pullWorker(d.number);
      const name = workerId ? (this.stores.getWorkers().find((x) => x.id === workerId)?.name ?? '') : '';
      const open = (item as { state?: string }).state === 'OPEN';
      const termR = { x: 0.05, y: 0.82, w: open ? 0.42 : 0.55, h: 0.12 };
      const commentR = workerId
        ? (open ? { x: 0.49, y: 0.82, w: 0.24, h: 0.12 } : { x: 0.62, y: 0.82, w: 0.33, h: 0.12 })
        : (open ? { x: 0.05, y: 0.82, w: 0.44, h: 0.12 } : { x: 0.05, y: 0.82, w: 0.9, h: 0.12 });
      const reviewR = workerId ? { x: 0.75, y: 0.82, w: 0.2, h: 0.12 } : { x: 0.51, y: 0.82, w: 0.44, h: 0.12 };
      if (workerId) this.actionBtn(ctx, w, h, termR, 'act:term', `💻 ${name}`, state, true);
      this.actionBtn(ctx, w, h, commentR, 'act:comment', '💬 Comment', state, !workerId);
      if (open) {
        const armed = this.reviewArmedFor === d.number && performance.now() < this.reviewArmedUntil;
        this.actionBtn(ctx, w, h, reviewR, 'act:review', armed ? '🔍 Sure?' : '🔍 Review', state, false, armed);
      }
    }
  }
  /** The PR 🔍 tap: the first arms it (red, with a ? — a panel seats three workers), the second calls it. */
  private tapReview(number: number) {
    const d = this.detail;
    if (!d || this.view !== 'detail' || d.kind !== 'pull' || d.number !== number) return;
    if (this.reviewArmedFor === number && performance.now() < this.reviewArmedUntil) {
      this.reviewArmedFor = null;
      this.reviewArmedUntil = 0;
      this.actions.reviewPanel(number);
      this.panel.markDirty();
      return;
    }
    this.reviewArmedFor = number;
    this.reviewArmedUntil = performance.now() + TAP_ARM_MS;
    this.panel.markDirty();
  }

  private actionBtn(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rect, id: string, label: string, state: { hoverId: string | null; pressedId: string | null }, primary: boolean, armed = false) {
    const hot = state.hoverId === id || state.pressedId === id;
    ctx.fillStyle = armed ? '#ef476f' : primary ? (hot ? '#ff7a2e' : '#ee6018') : hot ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.3);
    ctx.fill();
    ctx.fillStyle = armed || primary ? '#111' : '#eeeeee';
    ctx.font = `700 ${Math.round(r.h * h * 0.3)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Worker names shrink to fit their narrower button rather than bleeding out.
    ctx.fillText(label, (r.x + r.w / 2) * w, (r.y + r.h / 2) * h, r.w * w * 0.9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  update(dt: number, head?: HeadPose | null) {
    // Mute state can flip from the desktop side; the button label follows it.
    const muted = `${this.stores.isMuted()}|${this.stores.inVoice()}`;
    if (muted !== this.lastMuted && this.panel.visible) {
      this.lastMuted = muted;
      this.syncButtons();
      this.panel.markDirty();
    }
    // Row buttons track the list's scroll offset.
    if (this.panel.visible && this.view !== 'main' && this.view !== 'detail') {
      this.syncRowsIfMoved();
    }
    // The armed ✕ cools back down (repaint once, when it lapses).
    if (this.closeArmedUntil && performance.now() >= this.closeArmedUntil) {
      this.closeArmedUntil = 0;
      this.closeArmedFor = null;
      this.panel.markDirty();
    }
    // The armed queue row cools back down too.
    if (this.queueArmedUntil && performance.now() >= this.queueArmedUntil) {
      this.queueArmedUntil = 0;
      this.queueArmedFor = null;
      this.panel.markDirty();
    }
    // The armed 🔍 cools back down too.
    if (this.reviewArmedUntil && performance.now() >= this.reviewArmedUntil) {
      this.reviewArmedUntil = 0;
      this.reviewArmedFor = null;
      this.panel.markDirty();
    }
    this.panel.update(dt, head);
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.panel.dispose();
  }
}
