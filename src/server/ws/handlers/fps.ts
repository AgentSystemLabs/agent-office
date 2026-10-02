import { FpsDuel } from '../../fps.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { throttle } from '../../office/client.js';
import type { FpsClientMsg } from '../../../shared/protocol/fps.js';
import type { FeatureHooks, HandlerMap } from './types.js';

interface Arena { duel: FpsDuel; timer: ReturnType<typeof setInterval> }
const arenas = new WeakMap<Ctx, Arena>();

function publish(ctx: Ctx, arena: Arena, droppable = false) {
  const state = arena.duel.state(Date.now());
  for (const p of state.players) {
    const c = ctx.clients.get(p.id);
    if (c && (!droppable || c.ws.bufferedAmount < 256000)) ctx.sendTo(c, { t: 'fps.state', state });
  }
}

function arenaOf(ctx: Ctx): Arena {
  let arena = arenas.get(ctx);
  if (arena) return arena;
  const duel = new FpsDuel();
  arena = { duel, timer: setInterval(() => {
    for (const shot of duel.tick(Date.now())) for (const p of duel.state(Date.now()).players) {
      const c = ctx.clients.get(p.id);
      if (c) ctx.sendTo(c, { t: 'fps.shot', shot });
    }
    publish(ctx, arena!, true);
  }, 50) };
  arena.timer.unref(); arenas.set(ctx, arena);
  return arena;
}

function leave(ctx: Ctx, c: Client) {
  const arena = arenas.get(ctx);
  if (!arena || !arena.duel.leave(c.id, Date.now())) return;
  publish(ctx, arena);
  if (!arena.duel.state(Date.now()).players.length) { clearInterval(arena.timer); arenas.delete(ctx); }
}

export const fpsHandlers = {
  'fps.join': (ctx, c) => {
    if (c.peer.lite || !throttle(c, 'fps.join', 500)) return;
    const arena = arenaOf(ctx);
    if (!arena.duel.join(c.id, c.peer.name.slice(0, 32), Date.now())) return ctx.warn(c, '竞技场已有两位玩家，请等本场结束。');
    publish(ctx, arena);
  },
  'fps.leave': leave,
  'fps.input': (ctx, c, msg) => { if (throttle(c, 'fps.input', 15)) arenas.get(ctx)?.duel.input(c.id, msg.input, Date.now()); },
  'fps.reload': (ctx, c) => { arenas.get(ctx)?.duel.reload(c.id, Date.now()); },
  'fps.rematch': (ctx, c) => { arenas.get(ctx)?.duel.rematch(c.id, Date.now()); },
} satisfies HandlerMap<FpsClientMsg>;

export const fpsHooks: FeatureHooks = { closed: leave, leaving: (ctx, c) => leave(ctx, c) };
