import type * as THREE from 'three';
import type { WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { cardSprite, textSprite } from '../toon';

// What a worker shows of how it's getting on: its status light, and the bubble or task card over its head.

export const STATUS_BULB: Record<string, string> = {
  starting: '#adb5bd',
  idle: '#8ecae6',
  working: '#ffd166',
  needs_input: '#ef476f',
  done: '#06d6a0',
  exited: '#6c757d',
  offline: '#6c757d',
};

/** A worker that needs you: its bubble is the red of its light, in white capitals, and its card is outlined in it (unless a pull request's color is). */
const NEEDS_YOU = { text: '🙋 NEEDS YOU', bg: STATUS_BULB.needs_input, color: '#ffffff', size: 46, card: '#ffc2d1' };

/** Status pill on a worker's task card: [text, background, text color]. */
const TASK_CHIP: Record<string, [string, string, string]> = {
  starting: ['⏳ STARTING', STATUS_BULB.starting, '#2b2d42'],
  idle: ['💬 READY', STATUS_BULB.idle, '#2b2d42'],
  working: ['⌨️ WORKING', STATUS_BULB.working, '#2b2d42'],
  needs_input: [NEEDS_YOU.text, STATUS_BULB.needs_input, '#ffffff'],
  done: ['✅ DONE', STATUS_BULB.done, '#2b2d42'],
  exited: ['💤 ASLEEP', STATUS_BULB.exited, '#ffffff'],
  offline: ['💤 ASLEEP', STATUS_BULB.offline, '#ffffff'],
};

/** The chip (or bubble) of a worker whose worktree was deleted outside the office. */
const LOST_CHIP: [string, string, string] = ['🌿 WORKTREE DELETED', '#ffb703', '#2b2d42'];

/** The outline of a worker's bubble, and its pill, once it has a pull request: GitHub's open green, or the PR board's merged purple. */
const PR_INK: Record<WorkerPr['state'], string> = { open: '#2da44e', merged: '#9d4edd' };
const PR_ICON: Record<WorkerPr['state'], string> = { open: '🔀', merged: '🎉' };

/**
 * The bubble (or the task card) over a worker's head, and a key that changes whenever it would look
 * different: `draw` makes it, or null for none.
 */
export function bubbleFor(status: WorkerStatus, bounce: boolean, task: WorkerTask | undefined, pr: WorkerPr | undefined, lost: boolean): { key: string; draw(): THREE.Sprite | null } {
  const hot = status === 'needs_input' || (status === 'done' && bounce);
  const asking = status === 'needs_input' && !lost;
  const bg = hot ? (status === 'done' ? '#caffbf' : NEEDS_YOU.card) : status === 'working' ? '#ffec99' : '#fffaf3';
  const border = pr ? PR_INK[pr.state] : asking ? NEEDS_YOU.bg : undefined;
  // Not working on or waiting for something more: its pull request in place of ready / done / asleep.
  const prLabel = pr && status !== 'working' && status !== 'needs_input' && status !== 'starting' ? `${PR_ICON[pr.state]} PR #${pr.number} ${pr.state}` : undefined;
  const bubble = lost
    ? '🌿 worktree deleted'
    : prLabel ?? (status === 'needs_input' ? NEEDS_YOU.text : status === 'done' && bounce ? '✅ done!' : status === 'working' ? '⌨️ working' : isAsleep(status) ? '💤' : '');
  const key = `${lost}|${border}|${prLabel}|${task ? `${status}|${bounce}|${task.name}|${task.summary}` : bubble}`;
  return {
    key,
    draw: () => {
      if (task) {
        const [text, chipBg, color] = lost ? LOST_CHIP : prLabel ? [prLabel.toUpperCase(), border!, '#ffffff'] : (TASK_CHIP[status] ?? TASK_CHIP.idle);
        return cardSprite({ chip: { text, bg: chipBg, color }, title: task.name, body: task.summary, bg: isAsleep(status) ? '#e9ecef' : bg, border });
      }
      if (asking) return textSprite(bubble, { bg: NEEDS_YOU.bg, color: NEEDS_YOU.color, size: NEEDS_YOU.size, border: pr && border });
      return bubble ? textSprite(bubble, { bg: lost ? LOST_CHIP[1] : bg, size: 38, border }) : null;
    },
  };
}
