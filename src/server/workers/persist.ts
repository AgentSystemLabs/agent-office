// workers.json: every worker as the office last saw it, to pick them all back up after a restart.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentProvider, WorkerInfo, WorkerStatus, WorkerTask } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { isAgentProvider, savedEffort, savedModel } from '../../shared/providers.js';
import { providerAdapter } from '../providers/index.js';
import { reportedUsage } from '../reported-usage.js';
import { restoreTracker, trackerUsage } from '../usage.js';
import { workedMs } from './clock.js';
import { midTurn } from './lifecycle.js';
import type { Worker } from './types.js';
import { COLORS, newWorker } from './worker.js';
import { validRepos } from './worktree.js';

/** What a worker with a live terminal can be doing. */
const RUNNING = new Set<unknown>(['starting', 'idle', 'working', 'done', 'needs_input'] satisfies WorkerStatus[]);

/** Saves every worker; `stopping`: the office is closing for good, so nobody is in the middle of anything. */
export function saveWorkers(file: string, workers: Iterable<Worker>, stopping: boolean) {
  const saved = [...workers].map(({ info, owner, tracker, state, hookToken, pty, bootBlocked, interrupted }) => ({
    id: info.id,
    owner,
    kind: info.kind,
    provider: info.provider,
    model: info.model,
    effort: info.effort,
    deskId: info.deskId,
    name: info.name,
    color: info.color,
    createdBy: info.createdBy,
    createdAt: info.createdAt,
    prompt: info.prompt,
    worktree: info.worktree,
    repos: info.repos,
    title: info.title,
    sessionId: info.sessionId,
    activity: info.activity,
    task: info.task,
    pr: info.pr,
    pastPrs: info.pastPrs,
    meeting: info.meeting,
    workedMs: workedMs(info),
    tracker: info.kind === 'agent' ? tracker : undefined,
    usage: providerAdapter(info.provider)?.usage?.persisted ? info.usage : undefined,
    ...providerAdapter(info.provider)?.usage?.save?.(state),
    // A terminal still running in the host, to pick back up after a restart. Its hooks keep the token.
    hookToken,
    pty: pty?.id ? { id: pty.id, status: info.status, acked: info.acked, waitingSince: info.waitingSince } : undefined,
    // In the middle of something: if its terminal doesn't make it through a restart, it carries on after.
    midTurn: !stopping && (!!interrupted || midTurn({ info, bootBlocked })),
  }));
  try {
    writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  } catch {
    // disk issues shouldn't take the office down
  }
}

/** Takes back the workers saved in `file` into `workers`, each at its desk (while it is free), all of them offline. */
export function restoreWorkers(file: string, workers: Map<string, Worker>, defaultProvider: AgentProvider, deskOccupied: (deskId: string) => boolean) {
  if (!existsSync(file)) return;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as (Partial<WorkerInfo> & { owner?: unknown; tracker?: unknown; hookToken?: unknown; pty?: any; midTurn?: unknown } & Record<string, unknown>)[];
    for (const s of saved) {
      if (!s.id || !s.deskId || !DESK_BY_ID.has(s.deskId) || deskOccupied(s.deskId)) continue;
      const tracker = restoreTracker(s.tracker);
      const provider = s.kind === 'shell'
        ? undefined
        : isAgentProvider(s.provider)
          ? s.provider
          : tracker.transcript
            ? 'claude'
            : defaultProvider;
      const usage = providerAdapter(provider)?.usage;
      const info: WorkerInfo = {
        id: s.id,
        kind: s.kind === 'shell' ? 'shell' : 'agent',
        provider,
        model: savedModel(provider, s.model),
        effort: savedEffort(provider, s.effort),
        deskId: s.deskId,
        name: s.name ?? 'Worker',
        color: s.color ?? COLORS[0],
        status: 'offline',
        acked: true,
        createdBy: s.createdBy ?? '?',
        createdAt: s.createdAt ?? Date.now(),
        prompt: s.prompt,
        worktree: s.worktree,
        repos: s.worktree ? validRepos(s.repos) : undefined,
        title: s.title,
        sessionId: s.sessionId,
        activity: s.activity,
        task: validTask(s.task),
        pr: s.pr && typeof s.pr.number === 'number' && typeof s.pr.url === 'string' ? { number: s.pr.number, url: s.pr.url } : undefined,
        pastPrs: Array.isArray(s.pastPrs) && s.pastPrs.every((n: unknown) => typeof n === 'number') && s.pastPrs.length ? s.pastPrs : undefined,
        usage: usage?.persisted ? reportedUsage(s.usage) : usage?.transcript && tracker.transcript ? trackerUsage(tracker) : undefined,
        cols: 100,
        rows: 30,
        viewers: [],
        viewerIds: [],
        meeting: typeof s.meeting === 'string' && DESK_BY_ID.get(s.deskId)?.room ? s.meeting : undefined,
        workedMs: typeof s.workedMs === 'number' && Number.isFinite(s.workedMs) && s.workedMs > 0 ? s.workedMs : undefined,
      };
      const w = newWorker(info, tracker, typeof s.hookToken === 'string' && s.hookToken ? s.hookToken : undefined);
      if (typeof s.owner === 'string' && s.owner) w.owner = s.owner;
      usage?.restore?.(w.state, s);
      w.screenDirty = false;
      if (typeof s.pty?.id === 'string') {
        const status: WorkerStatus = RUNNING.has(s.pty.status) ? s.pty.status : 'idle';
        w.saved = { ptyId: s.pty.id, status, acked: s.pty.acked !== false, waitingSince: typeof s.pty.waitingSince === 'number' ? s.pty.waitingSince : undefined };
      }
      // Mid-turn as the office went down: cut off, unless its terminal is picked back up still
      // running (adopt). An office from before midTurn only said so for a terminal in the host.
      w.interrupted = typeof s.midTurn === 'boolean' ? s.midTurn : s.pty?.status === 'working' || s.pty?.status === 'needs_input';
      if (info.prompt) w.prompts = [info.prompt.replace(/\s+/g, ' ').trim()];
      workers.set(info.id, w);
    }
  } catch {
    // corrupt state file: start fresh
  }
}

function validTask(t: unknown): WorkerTask | undefined {
  const v = t as Partial<WorkerTask> | undefined;
  return typeof v?.name === 'string' && typeof v.summary === 'string' ? { name: v.name, summary: v.summary } : undefined;
}
