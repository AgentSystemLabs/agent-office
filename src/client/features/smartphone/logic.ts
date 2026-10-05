// The smartphone's pure helpers: what a contact row says, and what the SMS view may promise.
// Nothing here touches the DOM or the network, so tests cover it without a browser.

import type { WorkerInfo } from '../../../shared/protocol';

/** The icon before a contact's name: a shell is a shared login shell, the rest are agents. */
export function kindIcon(w: Pick<WorkerInfo, 'kind'>): string {
  return w.kind === 'shell' ? '🐚' : '🤖';
}

/** The line under a contact's name: what it's doing now, or where its work stands. */
export function contactSub(w: Pick<WorkerInfo, 'activity' | 'pr' | 'lost'>): string | undefined {
  if (w.lost) return '🌿 worktree deleted — tap to fix it';
  if (w.activity) return w.activity;
  if (w.pr) return `🔀 PR #${w.pr.number}`;
  return undefined;
}

/**
 * What the SMS view may honestly say about delivery, from the worker's status alone: a prompt lands
 * in its input box (queued while it's busy); only its terminal shows the answer. Sleeping workers
 * can't take one until someone wakes them (see actions.promptAtDesk).
 */
export function statusNote(w: Pick<WorkerInfo, 'name' | 'status'>): string {
  switch (w.status) {
    case 'needs_input':
      return `💬 ${w.name} might have answered — call to read it`;
    case 'working':
    case 'starting':
      return '📩 delivered — working on it';
    case 'done':
      return '📩 delivered — done, call to follow up';
    case 'idle':
      return '📩 delivered — ready when you are';
    default:
      return `💤 ${w.name} is asleep — wake it (R at its desk, or call) before texting`;
  }
}
