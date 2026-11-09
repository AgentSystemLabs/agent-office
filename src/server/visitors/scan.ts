// Finding the Claude Code sessions in use right now under its projects folder
// (<projects>/<cwd with / turned into ->/<session>.jsonl), with the subagents each has running
// (<session>/subagents/agent-<id>.jsonl, a workflow's under <session>/subagents/workflows/<run>/).
// It only lists, stats and reads: nothing under that folder is ever written, moved or locked.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Subagent } from '../../shared/protocol.js';
import { entries, readSlice, sessionOf, turnOf, type SessionFacts, type TurnFacts } from './transcript.js';
import { truncate } from '../workers/util.js';

export interface ScanTimes {
  /** A session whose transcript was written this recently is about (unless it has subagents at work). */
  window: number;
  /** A subagent whose transcript was written this recently is still at work. */
  agentWindow: number;
  /** A session older than this can't have subagents at work: its folder isn't looked in. */
  long: number;
  /** Transcripts older than `long` are only stat'ed again this often. */
  restat: number;
}

export const SCAN_TIMES: ScanTimes = { window: 10 * 60_000, agentWindow: 3 * 60_000, long: 6 * 3600_000, restat: 60_000 };

/** How much of a transcript is read: its head for its first prompt and where it runs, its tail for how it's doing. */
const HEAD = 64 * 1024;
const TAIL = 256 * 1024;
/** A tail that's all one huge line (a big tool result) is read again this big. */
const BIG_TAIL = 2 * 1024 * 1024;
const AGENT_TAIL = 32 * 1024;
/** Session ids are UUIDs; agent ids short hex. Nothing else is taken for one. */
const SESSION_FILE = /^([0-9a-f-]{8,64})\.jsonl$/i;
const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,64})\.jsonl$/;

/** A session in use, as its files say. */
export interface Sighting {
  id: string;
  file: string;
  /** When its transcript, or one of its subagents', was last written. */
  seenAt: number;
  facts: SessionFacts;
  turn: TurnFacts;
  /** Its subagents at work, most recently heard from first. */
  subagents: Subagent[];
}

interface Known {
  size: number;
  mtime: number;
  facts: SessionFacts;
  turn: TurnFacts;
}

interface KnownAgent {
  size: number;
  mtime: number;
  sub: Subagent;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function stat(file: string): { size: number; mtime: number; dir: boolean } | undefined {
  try {
    const s = statSync(file);
    return { size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() };
  } catch {
    return undefined;
  }
}

function json(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Looks over Claude Code's projects folder for the sessions in use; keeps what it read of each until the file changes. */
export class SessionScanner {
  private known = new Map<string, Known>();
  private agents = new Map<string, KnownAgent>();
  /** Transcripts too old to matter, and when they were last stat'ed. */
  private quiet = new Map<string, number>();
  /** When each session was first seen in use, which keeps the visitors in the order they came. */
  private firstSeen = new Map<string, number>();
  /** The subagents' transcripts looked at in this scan: what's kept of the others goes. */
  private looked = new Set<string>();

  constructor(
    readonly root: string,
    private times: ScanTimes = SCAN_TIMES,
  ) {}

  /** When a session was first seen in use. */
  since(id: string): number {
    return this.firstSeen.get(id) ?? 0;
  }

  /** The sessions in use, but for those `skip` says are the office's own. */
  scan(skip: (id: string) => boolean, now = Date.now()): Sighting[] {
    const out: Sighting[] = [];
    const seen = new Set<string>();
    this.looked.clear();
    for (const project of list(this.root)) {
      const dir = path.join(this.root, project);
      for (const name of list(dir)) {
        const m = SESSION_FILE.exec(name);
        if (!m) continue;
        const id = m[1];
        const file = path.join(dir, name);
        const quietAt = this.quiet.get(file);
        if (quietAt !== undefined && now - quietAt < this.times.restat) continue;
        const st = stat(file);
        if (!st || st.dir) continue;
        if (now - st.mtime > this.times.long) {
          this.quiet.set(file, now);
          this.known.delete(file);
          continue;
        }
        this.quiet.delete(file);
        if (skip(id)) continue;
        const subagents = this.subagentsOf(file, now);
        const fresh = now - st.mtime < this.times.window;
        if (!fresh && !subagents.length) continue;
        const read = this.read(file, st);
        if (!read.turn.found && !subagents.length) continue;
        seen.add(id);
        if (!this.firstSeen.has(id)) this.firstSeen.set(id, now);
        const seenAt = Math.max(st.mtime, ...subagents.map((s) => s.seenAt));
        out.push({ id, file, seenAt, facts: read.facts, turn: read.turn, subagents });
      }
    }
    for (const id of this.firstSeen.keys()) if (!seen.has(id)) this.firstSeen.delete(id);
    for (const file of this.agents.keys()) if (!this.looked.has(file)) this.agents.delete(file);
    return out;
  }

  /** What a transcript says, read again only when it has changed. */
  private read(file: string, st: { size: number; mtime: number }): Known {
    const had = this.known.get(file);
    if (had && had.size === st.size && had.mtime === st.mtime) return had;
    const headSlice = readSlice(file, 'head', HEAD);
    const head = entries(headSlice, 'head');
    let tail = headSlice.whole ? head : entries(readSlice(file, 'tail', TAIL), 'tail');
    let turn = turnOf(tail);
    if (!turn.found && !headSlice.whole) {
      tail = entries(readSlice(file, 'tail', BIG_TAIL), 'tail');
      turn = turnOf(tail);
    }
    let facts = sessionOf(head, tail);
    if (!facts.title) {
      // The desktop app keeps its title beside the transcript too.
      const named = json(path.join(file.slice(0, -'.jsonl'.length), 'custom-title.json'))?.customTitle;
      if (typeof named === 'string' && named.trim()) facts = { ...facts, title: truncate(named.trim(), 70) };
    }
    const known = { size: st.size, mtime: st.mtime, facts, turn };
    this.known.set(file, known);
    return known;
  }

  /** The subagents of the session whose transcript is `file` that are at work: written to lately, and not marked finished. */
  private subagentsOf(file: string, now: number): Sighting['subagents'] {
    const base = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
    const dirs = [base, ...list(path.join(base, 'workflows')).map((run) => path.join(base, 'workflows', run))];
    const out: Subagent[] = [];
    for (const dir of dirs) {
      for (const name of list(dir)) {
        const m = AGENT_FILE.exec(name);
        if (!m) continue;
        const agentFile = path.join(dir, name);
        const st = stat(agentFile);
        if (!st || st.dir || now - st.mtime > this.times.agentWindow) {
          this.agents.delete(agentFile);
          continue;
        }
        this.looked.add(agentFile);
        const sub = this.agent(agentFile, m[1], st);
        if (sub) out.push(sub);
      }
    }
    return out.sort((a, b) => b.seenAt - a.seenAt);
  }

  private agent(file: string, id: string, st: { size: number; mtime: number }): Subagent | undefined {
    const had = this.agents.get(file);
    if (had && had.size === st.size && had.mtime === st.mtime) return had.sub;
    const meta = json(file.replace(/\.jsonl$/, '.meta.json')) ?? {};
    if (meta.finished === true) {
      this.agents.delete(file);
      return undefined;
    }
    const turn = turnOf(entries(readSlice(file, 'tail', AGENT_TAIL), 'tail'), true);
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? truncate(v.trim(), max) : undefined);
    const sub: Subagent = {
      id,
      type: text(meta.agentType, 40) ?? 'agent',
      title: text(meta.description, 80),
      phase: text(meta.workflowPhase, 40),
      activity: turn.activity,
      since: had?.sub.since ?? Math.round(st.mtime),
      seenAt: Math.round(st.mtime),
    };
    this.agents.set(file, { size: st.size, mtime: st.mtime, sub });
    return sub;
  }
}
