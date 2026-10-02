import type { Ctx } from '../../core/context';

/** Thumbnail demand follows this 3D page's visibility; raw terminal streaming stays independent. */
export function installPerformance(ctx: Ctx) {
  const subscribe = () => ctx.net.send({ t: 'screen.watch', on: !document.hidden });
  document.addEventListener('visibilitychange', subscribe);
  ctx.messages.on('welcome', subscribe);
  ctx.messages.on('floor.enter', subscribe);
}
