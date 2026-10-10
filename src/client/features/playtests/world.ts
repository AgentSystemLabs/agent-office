import { paintPlaytestSummary } from './summary';
import type { Fixture } from '../../world/office/fixture';
import { buildRollingBoard, type RollingBoard } from '../../world/rolling-board';
import type { PlaytestState } from '../../../shared/playtests';

/** Opposite the drawing board, left of the couch when looking into the office. */
export const PLAYTEST_BOARD = { x: 5.4, z: 5.4, width: 4, height: 2.2, bottom: 0.5 };
export interface PlaytestBoard extends RollingBoard { paint(state: PlaytestState | null, error?: boolean): void; }
declare module '../../world/types' { interface OfficeHandles { playtestBoard: PlaytestBoard; } }

export const playtestBoard: Fixture<'playtestBoard'> = () => {
  const board = buildRollingBoard({ ...PLAYTEST_BOARD, kind: 'playtests', label: '☑ Playtest checklist' });
  board.group.rotation.y = Math.PI;
  board.interactable.z = PLAYTEST_BOARD.z - 1.7;
  const canvas = document.createElement('canvas');
  canvas.width = board.fit.width; canvas.height = board.fit.height;
  function paint(state: PlaytestState | null, error = false) {
    paintPlaytestSummary(canvas, state, error);
    board.show(canvas);
  }
  paint(null);
  const handle: PlaytestBoard = { ...board, paint };
  return { group: board.group, colliders: board.colliders, interactables: [board.interactable], handle: { playtestBoard: handle } };
};
