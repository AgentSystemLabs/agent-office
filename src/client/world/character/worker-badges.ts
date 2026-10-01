import type * as THREE from 'three';
import type { WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { cardSprite, textSprite } from '../toon';
import { L } from '../../i18n';

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

/** Status pill on a worker's task card: [text, background, text color]. */
const TASK_CHIP: Record<string, [string, string, string]> = {
  starting: [L.wchar.chips.starting, STATUS_BULB.starting, '#2b2d42'],
  idle: [L.wchar.chips.idle, STATUS_BULB.idle, '#2b2d42'],
  working: [L.wchar.chips.working, STATUS_BULB.working, '#2b2d42'],
  needs_input: [L.wchar.chips.needs_input, STATUS_BULB.needs_input, '#ffffff'],
  done: [L.wchar.chips.done, STATUS_BULB.done, '#2b2d42'],
  exited: [L.wchar.chips.asleep, STATUS_BULB.exited, '#ffffff'],
  offline: [L.wchar.chips.asleep, STATUS_BULB.offline, '#ffffff'],
};

/** The chip (or bubble) of a worker whose worktree was deleted outside the office. */
const LOST_CHIP: [string, string, string] = [`🌿 ${L.game.worktreeDeleted.toUpperCase()}`, '#ffb703', '#2b2d42'];

/** The outline of a worker's bubble, and its pill, once it has a pull request: GitHub's open green, or the PR board's merged purple. */
const PR_INK: Record<WorkerPr['state'], string> = { open: '#2da44e', merged: '#9d4edd' };
const PR_ICON: Record<WorkerPr['state'], string> = { open: '🔀', merged: '🎉' };

/**
 * The bubble (or the task card) over a worker's head, and a key that changes whenever it would look
 * different: `draw` makes it, or null for none.
 */
export function bubbleFor(status: WorkerStatus, bounce: boolean, task: WorkerTask | undefined, pr: WorkerPr | undefined, lost: boolean): { key: string; draw(): THREE.Sprite | null } {
  const hot = status === 'needs_input' || (status === 'done' && bounce);
  const bg = hot ? (status === 'done' ? '#caffbf' : '#ffd6e0') : status === 'working' ? '#ffec99' : '#fffaf3';
  const border = pr && PR_INK[pr.state];
  // Not working on or waiting for something more: its pull request in place of ready / done / asleep.
  const prLabel = pr && status !== 'working' && status !== 'needs_input' && status !== 'starting' ? `${PR_ICON[pr.state]} PR #${pr.number} ${pr.state}` : undefined;
  const bubble = lost
    ? `🌿 ${L.game.worktreeDeleted}`
    : prLabel ?? (status === 'needs_input' ? L.wchar.needsYou : status === 'done' && bounce ? L.wchar.done : status === 'working' ? L.wchar.working : isAsleep(status) ? '💤' : '');
  const key = `${lost}|${border}|${prLabel}|${task ? `${status}|${bounce}|${task.name}|${task.summary}` : bubble}`;
  return {
    key,
    draw: () => {
      if (task) {
        const [text, chipBg, color] = lost ? LOST_CHIP : prLabel ? [prLabel.toUpperCase(), border!, '#ffffff'] : (TASK_CHIP[status] ?? TASK_CHIP.idle);
        return cardSprite({ chip: { text, bg: chipBg, color }, title: task.name, body: task.summary, bg: isAsleep(status) ? '#e9ecef' : bg, border });
      }
      return bubble ? textSprite(bubble, { bg: lost ? LOST_CHIP[1] : bg, size: 38, border }) : null;
    },
  };
}
