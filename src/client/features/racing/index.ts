import type { Ctx } from '../../core/context';
import { Racing } from './ui';

/** Local time trials launched from the lounge cabinet; never submitted as BLOCKFALL scores. */
export function installRacing(ctx: Ctx): Racing {
  const racing = new Racing();
  ctx.ticks.add('play', ({ dt }) => racing.update(dt));
  ctx.view.add({ covers: () => racing.active });
  ctx.activities.add({ id: 'racing', active: () => racing.active, stop: () => racing.stop() });
  return racing;
}
