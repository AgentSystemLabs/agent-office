import { FpsDuel } from '../../fps.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { throttle } from '../../office/client.js';
import { validBotOptions } from '../../../shared/fps-bots.js';
import type { FpsClientMsg } from '../../../shared/protocol/fps.js';
import type { FeatureHooks, HandlerMap } from './types.js';

interface Arena { duel: FpsDuel; timer: ReturnType<typeof setInterval> }
const arenas = new WeakMap<Ctx, Map<string, Arena>>();
const current = (ctx: Ctx, c: Client) => arenas.get(ctx)?.get(c.id) ?? arenas.get(ctx)?.get('duel');

function publish(ctx: Ctx, arena: Arena, droppable = false) {
  const state = arena.duel.state(Date.now());
  for (const p of state.players) {
    const c = ctx.clients.get(p.id);
    if (c && (!droppable || c.ws.bufferedAmount < 256000)) ctx.sendTo(c, { t: 'fps.state', state });
  }
}

function arenaOf(ctx: Ctx, key = 'duel'): Arena {
  let matches = arenas.get(ctx);
  if (!matches) { matches = new Map(); arenas.set(ctx, matches); }
  let arena = matches.get(key);
  if (arena) return arena;
  const duel = new FpsDuel();
  arena = { duel, timer: setInterval(() => {
    for (const shot of duel.tick(Date.now())) for (const p of duel.state(Date.now()).players) {
      const c = ctx.clients.get(p.id);
      if (c) ctx.sendTo(c, { t: 'fps.shot', shot });
    }
    publish(ctx, arena!, true);
  }, 50) };
  arena.timer.unref(); matches.set(key, arena);
  return arena;
}

function leave(ctx: Ctx, c: Client) {
  const arena = current(ctx, c);
  if (!arena || !arena.duel.leave(c.id, Date.now())) return;
  publish(ctx, arena);
  if (!arena.duel.state(Date.now()).players.length) { clearInterval(arena.timer); arenas.get(ctx)?.delete(arenas.get(ctx)?.has(c.id) ? c.id : 'duel'); }
}

export const fpsHandlers = {
  'fps.join': (ctx, c) => {
    if (c.peer.lite || !throttle(c, 'fps.join', 500)) return;
    if (arenas.get(ctx)?.has(c.id)) leave(ctx, c);
    const arena = arenaOf(ctx);
    if (!arena.duel.join(c.id, c.peer.name.slice(0, 32), Date.now())) return ctx.warn(c, '竞技场已有两位玩家，请等本场结束。');
    publish(ctx, arena);
  },
  'fps.practice': (ctx, c, msg) => {
    if (c.peer.lite || !throttle(c, 'fps.join', 500) || !validBotOptions(msg.bot)) return;
    const privateArena = arenas.get(ctx)?.get(c.id);
    if (privateArena) { privateArena.duel.configureBot(c.id, msg.bot); publish(ctx, privateArena); return; }
    leave(ctx, c);
    const arena = arenaOf(ctx, c.id);
    arena.duel.practice(c.id, c.peer.name.slice(0, 32), msg.bot, Date.now()); publish(ctx, arena);
  },
  'fps.bot': (ctx, c, msg) => {
    const arena = arenas.get(ctx)?.get(c.id);
    if (!arena || !throttle(c, 'fps.bot', 300) || !arena.duel.configureBot(c.id, msg.bot)) return;
    publish(ctx, arena);
  },
  'fps.leave': leave,
  'fps.input': (ctx, c, msg) => { if (throttle(c, 'fps.input', 15)) current(ctx, c)?.duel.input(c.id, msg.input, Date.now()); },
  'fps.reload': (ctx, c) => { current(ctx, c)?.duel.reload(c.id, Date.now()); },
  'fps.rematch': (ctx, c) => { current(ctx, c)?.duel.rematch(c.id, Date.now()); },
} satisfies HandlerMap<FpsClientMsg>;

export const fpsHooks: FeatureHooks = { closed: leave, leaving: (ctx, c) => leave(ctx, c) };
