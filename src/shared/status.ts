// What a worker's status means, for the checks the server and the browser both make.

import type { GhPull, QueueTask, WorkerInfo, WorkerStatus } from './protocol.js';

/** Its process isn't running: it exited, or came back asleep after a restart. R wakes it. */
export function isAsleep(status: WorkerStatus): boolean {
  return status === 'exited' || status === 'offline';
}

/** In the middle of a turn: booting, working, or waiting on an answer. */
export function isBusy(status: WorkerStatus): boolean {
  return status === 'starting' || status === 'working' || status === 'needs_input';
}

/**
 * One line for a notification about a worker: what it's asking for when it needs input, or what it
 * was on when it's done (its last activity may be a permission prompt it has long got past).
 */
export function alertDetail(w: WorkerInfo): string | undefined {
  return w.status === 'needs_input' ? (w.activity ?? w.task?.summary) : (w.task?.summary ?? w.prompt);
}

/** A worker's pull request: still open, or merged (time to send it home). */
export interface WorkerPr {
  state: 'open' | 'merged';
  number: number;
}

/**
 * Where its work stands on GitHub: a pull request from its desk, its worktree branch or its queue
 * task, or one it opened itself, is open (one still open wins, e.g. a follow-up on the same branch), or merged, so it can be
 * sent home. Undefined when it has none, or only closed ones.
 */
export function workerPr(w: WorkerInfo, pulls: GhPull[], tasks: QueueTask[]): WorkerPr | undefined {
  const mine = new Set<number>();
  if (w.pr) mine.add(w.pr.number);
  for (const n of w.pastPrs ?? []) mine.add(n);
  for (const t of tasks) if (t.workerId === w.id && t.pr) mine.add(t.pr.number);
  const seen = pulls.filter((p) => mine.has(p.number) || (w.worktree && w.worktree.branch === p.headRefName)).map((p) => ({ number: p.number, state: p.state }));
  // Its task's PR can drop off the list GitHub sends (the last 30 merged): keep what the queue saw.
  for (const t of tasks) if (t.workerId === w.id && t.pr && !seen.some((p) => p.number === t.pr!.number)) seen.push({ number: t.pr.number, state: t.pr.state });
  // Opened from its desk but not on the list yet (still loading, or no gh to ask): it's open.
  if (w.pr && !seen.some((p) => p.number === w.pr!.number)) seen.push({ number: w.pr.number, state: 'OPEN' });
  const open = seen.find((p) => p.state === 'OPEN' || p.state === 'DRAFT');
  if (open) return { state: 'open', number: open.number };
  const merged = seen.find((p) => p.state === 'MERGED');
  return merged && { state: 'merged', number: merged.number };
}
