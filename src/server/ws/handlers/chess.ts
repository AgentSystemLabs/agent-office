// The rooftop's chess tables: sitting down at one, moving, resigning, starting again.
import type { ChessClientMsg } from '../../../shared/protocol.js';
import { chessSeatKey } from '../../../shared/chess-seats.js';
import { ROOF } from '../../../shared/rooftop.js';
import { ChessTables } from '../../chess.js';
import { throttle, type Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { num } from '../../office/input.js';
import type { FeatureHooks, HandlerMap } from './types.js';

/** The office's tables, made the first time anyone asks. */
const offices = new WeakMap<Ctx, ChessTables>();
export const chessTables = (ctx: Ctx): ChessTables => {
  let t = offices.get(ctx);
  if (!t) offices.set(ctx, (t = new ChessTables()));
  return t;
};

/** Tells everyone on the roof how these tables stand now. */
function changed(ctx: Ctx, tables: ChessTables, which: Iterable<number>) {
  for (const n of which) for (const o of ctx.clients.values()) if (o.peer.floor === ROOF) ctx.sendTo(o, { t: 'chess.table', table: tables.view(n) });
}

/** Whoever has a chair but isn't in it any more (stood up, or took another seat) gets up from it. */
function prune(ctx: Ctx, tables: ChessTables, out: Set<number>) {
  for (const t of tables.all()) {
    for (const side of ['w', 'b'] as const) {
      const who = t[side];
      const c = who && ctx.clients.get(who.id);
      if (who && (!c || c.peer.floor !== ROOF || c.peer.seat !== chessSeatKey(t.n, side))) tables.leave(who.id, out);
    }
  }
}

/** Runs what a message does to the tables, then tells the roof about each one it changed (and `c` what was wrong). */
function act(ctx: Ctx, c: Client, fn: (tables: ChessTables, out: Set<number>) => string | undefined) {
  const tables = chessTables(ctx);
  const out = new Set<number>();
  prune(ctx, tables, out);
  const wrong = fn(tables, out);
  changed(ctx, tables, out);
  if (wrong) ctx.warn(c, wrong);
}

const tableOf = (n: unknown) => num(n) | 0;

export const chessHandlers = {
  'chess.sync'(ctx, c) {
    const tables = chessTables(ctx);
    const out = new Set<number>();
    prune(ctx, tables, out);
    changed(ctx, tables, out);
    if (c.peer.floor === ROOF) ctx.sendTo(c, { t: 'chess.tables', tables: tables.all() });
  },
  'chess.join'(ctx, c, msg) {
    const side = msg.side === 'b' ? 'b' : 'w';
    const table = tableOf(msg.table);
    // Only from the chair itself: sitting there is what puts someone at the table.
    if (c.peer.floor !== ROOF || c.peer.seat !== chessSeatKey(table, side)) return;
    act(ctx, c, (tables, out) => tables.join(table, side, { id: c.id, name: c.peer.name }, out));
  },
  'chess.leave'(ctx, c) {
    act(ctx, c, (tables, out) => void tables.leave(c.id, out));
  },
  'chess.move'(ctx, c, msg) {
    if (!throttle(c, 'chess.move', 150)) return;
    const promo = msg.promo === 'r' || msg.promo === 'b' || msg.promo === 'n' ? msg.promo : undefined;
    act(ctx, c, (tables, out) => {
      const table = tableOf(msg.table);
      const wrong = tables.move(c.id, table, num(msg.from), num(msg.to), promo);
      if (!wrong) out.add(table);
      return wrong;
    });
  },
  'chess.resign'(ctx, c, msg) {
    act(ctx, c, (tables, out) => {
      const table = tableOf(msg.table);
      const wrong = tables.resign(c.id, table);
      if (!wrong) out.add(table);
      return wrong;
    });
  },
  'chess.new'(ctx, c, msg) {
    act(ctx, c, (tables, out) => {
      const table = tableOf(msg.table);
      const wrong = tables.newGame(c.id, table);
      if (!wrong) out.add(table);
      return wrong;
    });
  },
} satisfies HandlerMap<ChessClientMsg>;

/** Leaving the roof, or the office, gets you up from your chair (the game waits there for whoever sits next). */
export const chessHooks: FeatureHooks = {
  leaving(ctx, c) {
    const tables = chessTables(ctx);
    const out = new Set<number>();
    tables.leave(c.id, out);
    changed(ctx, tables, out);
  },
  closed(ctx, c) {
    const tables = chessTables(ctx);
    const out = new Set<number>();
    tables.leave(c.id, out);
    changed(ctx, tables, out);
  },
};
