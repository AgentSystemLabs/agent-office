import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { openPlaytests } from '../../ui/playtests';
import { playtestUpdates } from './updates';
import type { PlaytestState } from '../../../shared/playtests';

declare module '../../world/types' { interface InteractKinds { playtests: true; } }
export function installPlaytests(ctx: Ctx) {
  const board = ctx.office.playtestBoard;
  let floor: string | null = store.floor, state: PlaytestState | null = null, due = 0, pending = false, generation = 0;
  playtestUpdates.on((id, data) => { if (id === store.floor) { generation++; state = data; board.paint(data); } });
  async function refresh() {
    if (pending || !store.floor || document.hidden) return;
    pending = true; due = performance.now() + 30000;
    const id = store.floor, version = generation;
    try {
      const response = await fetch(`/api/playtests?floor=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('Could not refresh');
      const data: PlaytestState = await response.json();
      if (id === store.floor && version === generation) { state = data; board.paint(state); }
    } catch { if (id === store.floor && version === generation) board.paint(state, true); }
    finally { pending = false; }
  }
  store.on('floor', () => { floor = store.floor; generation++; state = null; due = 0; board.paint(null); void refresh(); });
  ctx.ticks.add('hud', () => { if (floor && performance.now() >= due) void refresh(); });
  ctx.interactions.define('playtests', {
    reach: 7,
    hint: () => ({ k: String(state?.items.length), parts: [hintTitle('☑ Playtest checklist'), aside('Your next play session'), key('E', 'Open checklist')] }),
    use: onE(() => openPlaytests()),
  });
}
