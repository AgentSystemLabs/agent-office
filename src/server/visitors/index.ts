// Visitors: Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an
// IDE) show up as characters on the floor whose repository they work in, or in the lobby (the
// building's first floor) when no floor's is theirs, with their subagents round them. Read-only:
// the office looks at the transcripts Claude Code writes (see scan.ts) and never writes to them,
// never types into those sessions and never signals them.
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { normalizeRepo, sameRepo } from '../../shared/floors.js';
import { VISITOR_SUBAGENTS, type Visitor, type VisitorsState } from '../../shared/protocol.js';
import { SessionScanner, type Sighting } from './scan.js';

/** How often the projects folder is looked over, while anyone is in the office. */
const EVERY_MS = 4000;
/** A floor shows at most this many visitors. */
export const MAX_VISITORS = 8;
/** A folder's git origin is asked again after this long. */
const ORIGIN_TTL = 10 * 60_000;

/** Claude Code's projects folder: under CLAUDE_CONFIG_DIR when that's set, else ~/.claude. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** One floor, as the visitors need it. */
export interface VisitorFloor {
  id: string;
  /** Its checkout. */
  dir: string;
  /** owner/name on GitHub, when known. */
  repo?: string;
}

export interface VisitorsDeps {
  /** The building's floors, the lobby (its first) first. */
  floors(): VisitorFloor[];
  /** The session ids of the office's own workers, on every floor: those are never visitors. */
  workerSessions(): Set<string>;
  /** Whether anyone is in the office to see them: nobody looks while nobody's there. */
  watched(): boolean;
  /** A floor's visitors changed. */
  send(floor: string, state: VisitorsState): void;
}

/** Whether `child` is `dir` or inside it. */
function inside(child: string, dir: string): boolean {
  const rel = path.relative(dir, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The folder a session runs in, as its last two parts. */
export function shortFolder(cwd: string | undefined): string {
  if (!cwd) return '?';
  return cwd.split(/[\\/]+/).filter(Boolean).slice(-2).join('/') || cwd;
}

/**
 * The floor a session in `cwd` visits: the one whose checkout it's in, else the one whose repository
 * its folder's origin is, else the lobby. Undefined for a worker's own folder under a floor's
 * .agent-office (a worktree, a workspace) and when there are no floors.
 */
export function floorFor(cwd: string | undefined, origin: string | undefined, floors: VisitorFloor[]): { floor: string; lobby: boolean } | undefined {
  if (!floors.length) return undefined;
  if (cwd) {
    if (floors.some((f) => inside(cwd, path.join(f.dir, '.agent-office')))) return undefined;
    const own = floors.find((f) => inside(cwd, f.dir));
    if (own) return { floor: own.id, lobby: false };
  }
  const byRepo = origin ? floors.find((f) => sameRepo(f.repo, origin)) : undefined;
  if (byRepo) return { floor: byRepo.id, lobby: false };
  return { floor: floors[0].id, lobby: true };
}

/** What a sighting looks like on the floor. */
export function visitorOf(s: Sighting, lobby: boolean): Visitor {
  const { facts, turn, subagents } = s;
  // Its own turn is over, but it has subagents at work (a workflow it started): it waits on them.
  const status = turn.status === 'done' && subagents.length ? 'working' : turn.status;
  const activity = turn.status === 'done' && subagents.length ? `${subagents.length} subagent${subagents.length === 1 ? '' : 's'} at work` : turn.activity;
  return {
    id: s.id,
    title: facts.title ?? facts.prompt ?? shortFolder(facts.cwd),
    app: facts.app,
    folder: shortFolder(facts.cwd),
    ...(facts.branch ? { branch: facts.branch } : {}),
    status,
    ...(activity ? { activity } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    seenAt: Math.round(s.seenAt),
    lobby,
    subagents: subagents.slice(0, VISITOR_SUBAGENTS),
    subagentCount: subagents.length,
  };
}

/** The repository a folder is a checkout of, by its git origin: asked once in a while, without waiting on it. */
class Origins {
  private known = new Map<string, { repo?: string; at: number; asking?: Promise<void> }>();

  /** What's known now; asks git again in the background when that's stale. */
  async of(cwd: string, now: number): Promise<string | undefined> {
    const had = this.known.get(cwd);
    if (had && (had.asking || now - had.at < ORIGIN_TTL)) {
      if (had.asking) await had.asking;
      return this.known.get(cwd)?.repo;
    }
    const entry: { repo?: string; at: number; asking?: Promise<void> } = { repo: had?.repo, at: now };
    entry.asking = new Promise<void>((resolve) => {
      execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000, encoding: 'utf8' }, (err, out) => {
        entry.repo = err ? undefined : normalizeRepo(out.trim());
        entry.asking = undefined;
        resolve();
      });
    });
    this.known.set(cwd, entry);
    await entry.asking;
    return entry.repo;
  }
}

export class Visitors {
  readonly scanner: SessionScanner;
  private timer?: NodeJS.Timeout;
  private origins = new Origins();
  private byFloor = new Map<string, Visitor[]>();
  private sent = new Map<string, string>();
  private busy = false;
  /** Every session the office's workers have had: one a worker left behind (a /clear) is no visitor either. */
  private workers = new Set<string>();

  constructor(
    private opts: { root: string; off?: boolean },
    private deps: VisitorsDeps,
  ) {
    this.scanner = new SessionScanner(opts.root);
  }

  start() {
    if (this.opts.off || this.timer) return;
    this.timer = setInterval(() => {
      if (this.deps.watched()) void this.look();
    }, EVERY_MS);
    this.timer.unref();
    void this.look();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The visitors on `floor`, for someone arriving there. */
  state(floor: string | undefined): VisitorsState {
    if (this.opts.off) return { visitors: [], off: true };
    return { visitors: (floor && this.byFloor.get(floor)) || [] };
  }

  /** Looks over the projects folder once, and tells each floor whose visitors changed. */
  async look(now = Date.now()): Promise<void> {
    if (this.busy || this.opts.off) return;
    this.busy = true;
    try {
      for (const id of this.deps.workerSessions()) this.workers.add(id);
      const floors = this.deps.floors();
      const sightings = this.scanner.scan((id) => this.workers.has(id), now);
      const next = new Map<string, Visitor[]>();
      for (const s of sightings) {
        const cwd = s.facts.cwd;
        const origin = cwd && !floors.some((f) => inside(cwd, f.dir)) ? await this.origins.of(cwd, now) : undefined;
        const where = floorFor(cwd, origin, floors);
        if (!where) continue;
        const list = next.get(where.floor) ?? [];
        list.push(visitorOf(s, where.lobby));
        next.set(where.floor, list);
      }
      this.byFloor = new Map([...next].map(([floor, list]) => [floor, list.sort((a, b) => this.scanner.since(a.id) - this.scanner.since(b.id) || a.id.localeCompare(b.id)).slice(0, MAX_VISITORS)]));
      for (const f of floors) {
        const state = this.state(f.id);
        const key = JSON.stringify(state);
        if (this.sent.get(f.id) === key) continue;
        this.sent.set(f.id, key);
        this.deps.send(f.id, state);
      }
    } finally {
      this.busy = false;
    }
  }
}
