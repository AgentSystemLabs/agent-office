import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';

declare module '../../world/types' {
  interface InteractKinds {
    pingpong: true;
  }
}

/** Installs the court's presentation interaction; play rules and a shared ball come next. */
export function installPingPong(ctx: Ctx) {
  ctx.interactions.define('pingpong', {
    reach: 2.5,
    hint: () => ({ k: '', parts: [hintTitle('🏓 Pink ping-pong court'), aside('three tables, playable matches coming soon'), key('E', 'Check out the court')] }),
    use: onE(() => undefined),
  });
}
