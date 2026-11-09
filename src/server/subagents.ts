// A Claude Code worker's subagents (the Agent tool, a workflow's agents), from its hooks: each one
// stands beside its worker's desk from SubagentStart to SubagentStop (see features/subagents in the
// page). A subagent's own tool calls reach the worker's hooks too, with its agent_id, and keep it up
// to date; one the office only hears of that way (it started before the office did) is taken in then.
// What it was asked to do is read off the meta file Claude Code writes next to its transcript.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Subagent, WorkerInfo } from '../shared/protocol.js';
import { SUBAGENT_STALE_MS } from '../shared/protocol.js';
import { truncate } from './workers/util.js';

/** A worker keeps at most this many (a big workflow runs dozens at once). */
export const MAX_SUBAGENTS = 24;

/** Claude Code's agent ids are short hex; anything else is never used in a path. */
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What Claude Code's `agent-<id>.meta.json` says about a subagent. */
export interface SubagentMeta {
  agentType?: string;
  description?: string;
  workflowPhase?: string;
  finished?: boolean;
}

function readMeta(file: string): SubagentMeta | undefined {
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    return m && typeof m === 'object' ? m : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The meta file of subagent `id` of the session whose transcript is `transcript`: next to its own
 * transcript when the hook named it (SubagentStop does), else in the session's `subagents/` folder,
 * or in one of its workflows' folders under it.
 */
export function subagentMeta(transcript: string | undefined, id: string, agentTranscript?: string): SubagentMeta | undefined {
  if (!AGENT_ID.test(id)) return undefined;
  if (agentTranscript?.endsWith(`agent-${id}.jsonl`)) {
    const m = readMeta(agentTranscript.replace(/\.jsonl$/, '.meta.json'));
    if (m) return m;
  }
  if (!transcript?.endsWith('.jsonl')) return undefined;
  const dir = path.join(transcript.slice(0, -'.jsonl'.length), 'subagents');
  const own = readMeta(path.join(dir, `agent-${id}.meta.json`));
  if (own) return own;
  let runs: string[] = [];
  try {
    runs = readdirSync(path.join(dir, 'workflows'));
  } catch {
    return undefined;
  }
  for (const run of runs) {
    const m = readMeta(path.join(dir, 'workflows', run, `agent-${id}.meta.json`));
    if (m) return m;
  }
  return undefined;
}

function text(v: unknown, max = 80): string | undefined {
  return typeof v === 'string' && v.trim() ? truncate(v.trim(), max) : undefined;
}

export interface SubagentNote {
  /** The worker's own session transcript, where its subagents' files are. */
  transcript?: string;
  /** What a PreToolUse from the subagent says it's doing ("Bash: npm test"). */
  activity?: string;
  now?: number;
}

/**
 * Takes one of a worker's Claude Code hook events into its subagents (WorkerInfo.subagents): a new
 * session has none yet, SubagentStart adds one, SubagentStop takes it off, and any event from inside
 * one (it carries an agent_id) says it's still at it. Ones not heard from in SUBAGENT_STALE_MS went
 * with a turn that was stopped. Says whether the list changed in a way worth showing.
 */
export function noteSubagent(info: WorkerInfo, event: string, payload: any, note: SubagentNote = {}): boolean {
  const now = note.now ?? Date.now();
  const before = info.subagents ?? [];
  let list = before.filter((s) => now - s.seenAt < SUBAGENT_STALE_MS);
  let changed = list.length !== before.length;
  const done = (): boolean => {
    info.subagents = list.length ? list : undefined;
    return changed;
  };
  if (event === 'SessionStart') {
    changed ||= list.length > 0;
    list = [];
    return done();
  }
  const id = typeof payload?.agent_id === 'string' && AGENT_ID.test(payload.agent_id) ? payload.agent_id : undefined;
  if (!id) return done();
  if (event === 'SubagentStop') {
    const kept = list.filter((s) => s.id !== id);
    changed ||= kept.length !== list.length;
    list = kept;
    return done();
  }
  let s = list.find((x) => x.id === id);
  if (!s) {
    if (list.length >= MAX_SUBAGENTS) return done();
    s = { id, type: text(payload?.agent_type, 40) ?? 'agent', since: now, seenAt: now };
    list = [...list, s];
    changed = true;
  }
  s.seenAt = now;
  if (!s.title) {
    const meta = subagentMeta(note.transcript, id, typeof payload?.agent_transcript_path === 'string' ? payload.agent_transcript_path : undefined);
    const title = text(meta?.description);
    if (title) {
      s.title = title;
      s.phase = text(meta?.workflowPhase, 40);
      s.type = text(meta?.agentType, 40) ?? s.type;
      changed = true;
    }
  }
  if (event === 'PreToolUse' && note.activity) {
    s.activity = note.activity;
    changed = true;
  }
  return done();
}
