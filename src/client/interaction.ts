import { canLabel } from '../shared/floorplan';
import type { GhIssue, WorkerInfo } from '../shared/protocol';
import { isAsleep } from '../shared/status';
import type { Interactable } from './world/types';

export const DESK_KEYS = { KeyE: 'E', KeyP: 'P', KeyR: 'R', KeyX: 'X', KeyB: 'B', KeyC: 'C', KeyO: 'O', KeyL: 'L' } as const;
export type DeskKey = (typeof DESK_KEYS)[keyof typeof DESK_KEYS];

export interface InteractionState {
  worker?: WorkerInfo;
  room: boolean;
  note: GhIssue | null;
  carrying: boolean;
}

/** Whether a desk key has an action at the interaction currently in reach. */
export function interactionAvailable(it: Interactable | null, key: DeskKey, state: InteractionState): boolean {
  if (!it) return false;

  // A carried issue can be handed to any desk, queued, returned/swapped, or taken into a meeting.
  if (key === 'E' && state.carrying && (it.kind === 'desk' || it.kind === 'queue' || it.kind === 'issues' || it.kind === 'meeting')) {
    return it.kind !== 'desk' || !!it.deskId;
  }

  if (it.kind === 'desk') {
    if (!it.deskId) return false;
    // Any desk can have a sign hung over it, whoever sits there (not a bean bag or a meeting chair).
    if (key === 'L') return canLabel(it.deskId);
    if (!state.worker && state.room) return key === 'E';
    if (key === 'B') return !state.worker;
    if (key === 'P' || key === 'E') return true;
    if (key === 'R') return !!state.worker && isAsleep(state.worker.status);
    return !!state.worker && (key === 'C' || key === 'X' || key === 'O');
  }

  if (it.kind === 'station') {
    if (!it.deskId) return false;
    return key === 'E' || key === 'P' || (!!state.worker && (key === 'O' || key === 'X'));
  }

  if (state.note && it.kind === 'issues') return key === 'E' || key === 'O';
  if (key !== 'E') return false;

  if (it.kind === 'decor') return !!it.decorId;
  if (it.kind === 'seat') return !!it.seatId;
  if (it.kind === 'pole') return it.pole !== undefined;
  if (it.kind === 'car') return it.car !== undefined;
  return true;
}
