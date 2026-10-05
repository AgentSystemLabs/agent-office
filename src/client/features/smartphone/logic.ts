// The smartphone's pure helpers: what a contact row says, and what the SMS view may promise.
// Nothing here touches the DOM or the network, so tests cover it without a browser.

import type { WorkerInfo } from '../../../shared/protocol';

/** The icon before a contact's name: a shell is a shared login shell, the rest are agents. */
export function kindIcon(w: Pick<WorkerInfo, 'kind'>): string {
  return w.kind === 'shell' ? '🐚' : '🤖';
}

/** A plain hex color only: worker colors come from the avatar palette, but nothing at the call
 * sites constrains them, so anything else falls back instead of becoming raw CSS. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export function dotColor(w: Pick<WorkerInfo, 'color'>): string {
  return HEX_COLOR.test(w.color) ? w.color : '#888888';
}

/** The line under a contact's name: what it's doing now. Work standing (a PR) is the badge's job, so it never doubles up here. */
export function contactSub(w: Pick<WorkerInfo, 'activity' | 'lost'>): string | undefined {
  if (w.lost) return '🌿 worktree deleted — tap to fix it';
  if (w.activity) return w.activity;
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
    case 'exited':
    case 'offline':
      return `💤 ${w.name} is asleep — wake it (R at its desk, or call) before texting`;
    default:
      return `📩 ${w.name} · ${w.status}`;
  }
}
