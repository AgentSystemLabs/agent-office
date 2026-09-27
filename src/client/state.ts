import type { ChatLine, GhIssue, GhIssuesState, GhPull, GhState, PeerInfo, ProjectInfo, QueueState, QueueTask, ServerMsg, ServicesState, TeamState, UpgradeState, Usage, UsageState, WorkerInfo } from '../shared/protocol';
import type { ScreenState } from './world/laptop';
import { randomLook, sanitizeLook, type Look } from '../shared/avatar';
import type { Decoration } from '../shared/decor';
import { normalizeIssueRepository, sameRepository } from '../shared/issue-repositories';

export type Topic = 'peers' | 'workers' | 'issues' | 'pulls' | 'chat' | 'project' | 'screens' | 'team' | 'upgrade' | 'services' | 'decor' | 'usage' | 'queue';

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

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage blocked
  }
}

export type ViewMode = 'first' | 'third';

export interface Settings {
  view: ViewMode;
  /** Office sounds, 0–1. */
  volume: number;
  muted: boolean;
}

const SETTINGS_KEY = 'agent-office.settings';

export function loadSettings(): Settings {
  const s: Settings = { view: 'first', volume: 0.7, muted: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved?.view === 'first' || saved?.view === 'third') s.view = saved.view;
    if (typeof saved?.volume === 'number' && Number.isFinite(saved.volume)) s.volume = Math.max(0, Math.min(1, saved.volume));
    if (typeof saved?.muted === 'boolean') s.muted = saved.muted;
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

function repositoryFromUrl(url: string): string | undefined {
  const match = /github\.com\/([^/]+\/[^/#?]+)/i.exec(url);
  return normalizeIssueRepository(match?.[1]?.replace(/\.git$/, ''));
}

/** The worker whose worktree branch a pull request came from, scoped to its repository. */
export function workerForPull(workers: Iterable<WorkerInfo>, pr: { number: number; headRefName: string; url?: string }, currentRepository?: string): WorkerInfo | undefined {
  const pullRepository = pr.url ? repositoryFromUrl(pr.url) : undefined;
  for (const w of workers) {
    const workerRepository = w.project?.repository ?? currentRepository;
    if (pullRepository && workerRepository && !sameRepository(pullRepository, workerRepository)) continue;
    if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w;
  }
  return undefined;
}

export function projectRepository(project: ProjectInfo | null): string | undefined {
  const remote = project?.remote?.trim();
  if (!remote) return undefined;
  const name = remote.replace(/^https?:\/\/[^/]+\//i, '').replace(/^git@[^:]+:/i, '').replace(/\.git$/i, '');
  return normalizeIssueRepository(name);
}

export function issueIdentityKey(issue: Pick<GhIssue, 'number' | 'repository'>): string {
  return `${issue.repository?.toLowerCase() ?? ''}#${issue.number}`;
}

export function taskForIssueMatches(task: Pick<QueueTask, 'issue' | 'issueRepository'>, issue: number, repository?: string, currentRepository?: string): boolean {
  if (task.issue !== issue) return false;
  // Queue entries written before multi-repository execution had no repository field; they belong
  // to the office's current checkout. A repository-qualified task must match the issue's repo.
  const taskRepository = task.issueRepository ?? currentRepository;
  const issueRepository = repository ?? currentRepository;
  return !!taskRepository && !!issueRepository && sameRepository(taskRepository, issueRepository);
}

export type IssueRepositoryFilter = 'all' | string;

export function issueRepositoryLabel(issue: Pick<GhIssue, 'repository'>): string {
  return issue.repository ?? 'current project';
}

export function visibleIssues(items: GhIssue[], filter: IssueRepositoryFilter): GhIssue[] {
  return filter === 'all' ? items : items.filter((it) => sameRepository(it.repository, filter));
}

class Store {
  you = '';
  profile: Profile = { name: 'Guest', color: AVATAR_COLORS[1], look: randomLook() };
  peers = new Map<string, PeerInfo>();
  workers = new Map<string, WorkerInfo>();
  screens = new Map<string, ScreenState>();
  project: ProjectInfo | null = null;
  issues: GhIssuesState = { items: [], fetchedAt: 0, loading: true };
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
  usage: UsageState = { total: zeroUsage(), today: zeroUsage(), day: '', pauseHiring: false };
  queue: QueueState = { tasks: [], maxWorkers: 0 };
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

  workerAtDesk(deskId: string): WorkerInfo | undefined {
    for (const w of this.workers.values()) if (w.deskId === deskId) return w;
    return undefined;
  }

  /** The queue task for an issue: the one on the queue if there is one, else the latest finished one. */
  taskForIssue(issue: number, repository?: string): QueueTask | undefined {
    const currentRepository = this.issues.currentRepository ?? projectRepository(this.project);
    const tasks = this.queue.tasks.filter((t) => taskForIssueMatches(t, issue, repository, currentRepository));
    return tasks.find((t) => t.status !== 'done') ?? tasks[tasks.length - 1];
  }

  apply(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.workers = new Map(msg.workers.map((w) => [w.id, w]));
        this.screens.clear(); // fresh full frames follow the welcome
        this.project = msg.project;
        this.issues = msg.issues;
        this.pulls = msg.pulls;
        this.ice = msg.ice as RTCIceServer[];
        this.chat = msg.chat;
        this.invites = msg.invites;
        this.upgrade = msg.upgrade;
        this.services = msg.services;
        this.decor = msg.decor;
        this.usage = msg.usage;
        this.queue = msg.queue;
        for (const t of ['peers', 'workers', 'issues', 'pulls', 'chat', 'project', 'upgrade', 'services', 'decor', 'usage', 'queue'] as Topic[]) this.emit(t);
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
        this.emit('workers');
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
      case 'usage':
        this.usage = msg.state;
        this.emit('usage');
        break;
      case 'queue':
        this.queue = msg.state;
        this.emit('queue');
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
