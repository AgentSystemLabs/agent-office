import type { ChatLine, GhIssue, GhPull, GhState, PeerInfo, ProjectInfo, ServerMsg, TeamState, WorkerInfo } from '../shared/protocol';
import type { ScreenState } from './world/laptop';

type Topic = 'peers' | 'workers' | 'issues' | 'pulls' | 'chat' | 'project' | 'screens' | 'team';

export interface Profile {
  name: string;
  color: string;
}

const PROFILE_KEY = 'agent-office.profile';
export const AVATAR_COLORS = ['#ff8a5b', '#4f86f7', '#06d6a0', '#ef476f', '#ffd166', '#9d4edd', '#00b4d8', '#f77f00'];

export function loadProfile(): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (p && typeof p.name === 'string' && typeof p.color === 'string') return p;
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

class Store {
  you = '';
  profile: Profile = { name: 'Guest', color: AVATAR_COLORS[1] };
  peers = new Map<string, PeerInfo>();
  workers = new Map<string, WorkerInfo>();
  screens = new Map<string, ScreenState>();
  project: ProjectInfo | null = null;
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: true };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: true };
  ice: RTCIceServer[] = [];
  chat: ChatLine[] = [];
  /** Whether this office can invite teammates (deployed with deploy/aws.sh). */
  invites = false;
  team: TeamState | null = null;
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
        for (const t of ['peers', 'workers', 'issues', 'pulls', 'chat', 'project'] as Topic[]) this.emit(t);
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
      case 'chat':
        this.chat.push(msg);
        if (this.chat.length > 200) this.chat.shift();
        this.emit('chat');
        break;
    }
  }
}

export const store = new Store();
