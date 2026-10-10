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
  const g = canvas.getContext('2d')!;
  function paint(state: PlaytestState | null, error = false) {
    const W = canvas.width, H = canvas.height;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b2d42'; g.font = '900 86px Nunito, sans-serif';
    g.fillText('Playtest checklist', 30, 95);
    const done = state?.items.filter(t => t.done).length ?? 0;
    g.font = '700 43px Nunito, sans-serif'; g.fillStyle = '#667085';
    g.fillText(error ? 'Could not refresh · E to retry' : !state ? 'Loading your checklist…' : `${done} / ${state.items.length} checked · ${state.items.length - done} still to test`, 32, 170);
    if (state) {
      const rows = [...state.items].sort((a,b) => Number(a.done)-Number(b.done) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title)).slice(0, 6);
      rows.forEach((item, i) => {
        const y = 245 + i * 98;
        g.strokeStyle = item.done ? '#26916b' : '#8a92a0'; g.lineWidth = 4; g.strokeRect(34, y, 38, 38);
        if (item.done) { g.beginPath(); g.moveTo(40,y+18);g.lineTo(49,y+28);g.lineTo(67,y+7);g.stroke(); }
        g.fillStyle = item.done ? '#718096' : '#2b2d42'; g.font = '800 43px Nunito, sans-serif';
        let title = item.title;
        while (g.measureText(title).width > W - 140 && title.length > 1) title = title.slice(0,-2) + '…';
        g.fillText(title, 98, y + 34);
        g.fillStyle = '#7d659c'; g.font = '600 28px Nunito, sans-serif'; g.fillText(item.category, 98, y + 67);
      });
      if (!rows.length) { g.font = '700 46px Nunito, sans-serif'; g.fillText('Your next play session starts here.', 34, 300); }
    }
    g.fillStyle = '#eaf7f0'; g.fillRect(0, H - 105, W, 105);
    g.fillStyle = '#246c53'; g.font = '800 39px Nunito, sans-serif';
    g.fillText('Press E · Open, check off & add notes', 30, H - 55);
    g.font = '600 27px Nunito, sans-serif'; g.fillText('Personal playtests · never a worker or PR blocker', 30, H - 18);
    board.show(canvas);
  }
  paint(null);
  const handle: PlaytestBoard = { ...board, paint };
  return { group: board.group, colliders: board.colliders, interactables: [board.interactable], handle: { playtestBoard: handle } };
};
