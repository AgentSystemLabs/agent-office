import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSquare } from '../src/shared/chess.js';
import { chessSeatKey } from '../src/shared/chess-seats.js';
import { ROOF } from '../src/shared/rooftop.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import { ChessTables } from '../src/server/chess.js';
import { chessHandlers, chessHooks } from '../src/server/ws/handlers/chess.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';

const sq = (name: string) => parseSquare(name);
const noChange = () => new Set<number>();

/** Two people at table 1, White and Black. */
function seated() {
  const t = new ChessTables();
  assert.equal(t.join(1, 'w', { id: 'ann', name: 'Ann' }, noChange()), undefined);
  assert.equal(t.join(1, 'b', { id: 'bob', name: 'Bob' }, noChange()), undefined);
  return t;
}

test('the chair is the side: the first to sit takes it, and nobody else can', () => {
  const t = new ChessTables();
  const changed = new Set<number>();
  assert.equal(t.join(2, 'b', { id: 'ann', name: 'Ann' }, changed), undefined);
  assert.deepEqual([...changed], [2]);
  assert.deepEqual(t.view(2).b, { id: 'ann', name: 'Ann' });
  assert.equal(t.join(2, 'b', { id: 'bob', name: 'Bob' }, noChange()), 'Ann is sitting there');
  assert.equal(t.join(9, 'w', { id: 'bob', name: 'Bob' }, noChange()), 'There is no such table');
  assert.deepEqual(t.seatOf('ann'), { table: 2, side: 'b' });
  // Sitting down again at the chair you're in changes nothing; moving to another one leaves the first.
  assert.equal(t.join(2, 'b', { id: 'ann', name: 'Ann' }, noChange()), undefined);
  t.join(3, 'w', { id: 'ann', name: 'Ann' }, noChange());
  assert.equal(t.view(2).b, undefined);
  assert.deepEqual(t.seatOf('ann'), { table: 3, side: 'w' });
});

test('moves must be legal and on your own turn, and only for the two playing', () => {
  const t = seated();
  assert.equal(t.move('bob', 1, sq('e7'), sq('e5'), undefined), "It isn't your move");
  assert.equal(t.move('ann', 1, sq('e2'), sq('e5'), undefined), 'That move is not allowed');
  assert.equal(t.move('ann', 1, -1, 99, undefined), 'That move is not allowed');
  assert.equal(t.move('cat', 1, sq('e2'), sq('e4'), undefined), "You aren't playing at that table");
  assert.equal(t.move('ann', 2, sq('e2'), sq('e4'), undefined), "You aren't playing at that table");
  assert.equal(t.move('ann', 1, sq('e2'), sq('e4'), undefined), undefined);
  assert.equal(t.view(1).moves, 1);
  assert.deepEqual(t.view(1).last, [sq('e2'), sq('e4')]);
  assert.equal(t.move('ann', 1, sq('d2'), sq('d4'), undefined), "It isn't your move");
  assert.equal(t.move('bob', 1, sq('d7'), sq('d5'), undefined), undefined);
  assert.equal(t.move('ann', 1, sq('e4'), sq('d5'), undefined), undefined);
  assert.equal(t.view(1).taken, 'p');
});

test('nobody moves until there are two of them', () => {
  const t = new ChessTables();
  t.join(1, 'w', { id: 'ann', name: 'Ann' }, noChange());
  assert.equal(t.move('ann', 1, sq('e2'), sq('e4'), undefined), 'Waiting for an opponent');
});

test("a mate ends the game, and then nothing more can be played, until a new one's set up", () => {
  const t = seated();
  for (const [who, from, to] of [['ann', 'f2', 'f3'], ['bob', 'e7', 'e5'], ['ann', 'g2', 'g4'], ['bob', 'd8', 'h4']] as const) assert.equal(t.move(who, 1, sq(from), sq(to), undefined), undefined);
  assert.deepEqual(t.view(1).end, { kind: 'checkmate', winner: 'b' });
  assert.equal(t.move('ann', 1, sq('a2'), sq('a3'), undefined), 'The game is over');
  assert.equal(t.resign('ann', 1), 'There is no game to resign');
  assert.equal(t.newGame('cat', 1), "You aren't playing at that table");
  assert.equal(t.newGame('bob', 1), undefined);
  const v = t.view(1);
  assert.equal(v.moves, 0);
  assert.equal(v.end, undefined);
  assert.equal(v.taken, '');
  assert.deepEqual([v.w?.id, v.b?.id], ['ann', 'bob'], 'the same two, in the same chairs');
});

test('resigning hands the win to the other side; a new game mid-game has to wait for that', () => {
  const t = seated();
  assert.equal(t.resign('ann', 1), 'There is no game to resign', 'nothing played yet');
  t.move('ann', 1, sq('e2'), sq('e4'), undefined);
  assert.equal(t.newGame('ann', 1), 'Finish the game first (or resign)');
  assert.equal(t.resign('bob', 1), undefined);
  assert.deepEqual(t.view(1).end, { kind: 'resign', winner: 'w' });
});

test('getting up leaves the game for whoever sits there next, and an empty table starts over', () => {
  const t = seated();
  t.move('ann', 1, sq('e2'), sq('e4'), undefined);
  const changed = new Set<number>();
  t.leave('bob', changed);
  assert.deepEqual([...changed], [1]);
  assert.equal(t.view(1).b, undefined);
  assert.equal(t.view(1).moves, 1, 'the game waits');
  assert.equal(t.join(1, 'b', { id: 'cat', name: 'Cat' }, noChange()), undefined);
  assert.equal(t.move('cat', 1, sq('e7'), sq('e5'), undefined), undefined, 'and Cat carries on from where Bob was');
  t.leave('ann', noChange());
  t.leave('cat', noChange());
  assert.equal(t.view(1).moves, 0);
  assert.equal(t.view(1).fen.startsWith('rnbqkbnr/'), true);
  t.leave('nobody', noChange());
});

// ---- The handlers, with a stand-in for the office ---------------------------------------------------------

function office() {
  const clients = new Map<string, Client>();
  const sent: { to: string; msg: ServerMsg }[] = [];
  const warned: string[] = [];
  const ctx = {
    clients,
    sendTo: (c: Client, msg: ServerMsg) => void sent.push({ to: c.id, msg }),
    warn: (_c: Client, error: string | undefined) => void (error && warned.push(error)),
  } as unknown as Ctx;
  const join = (id: string, floor: string | null = ROOF): Client => {
    const c = { id, peer: { id, name: id, floor: floor ?? undefined }, throttles: new Map() } as unknown as Client;
    clients.set(id, c);
    return c;
  };
  return { ctx, clients, sent, warned, join, tables: (c: Client) => sent.filter((s) => s.to === c.id).map((s) => s.msg) };
}

test('chess.join only counts from the chair itself, and tells everyone up on the roof', () => {
  const o = office();
  const ann = o.join('ann');
  const bob = o.join('bob');
  const down = o.join('dan', '__floor');
  // Not sitting there yet: nothing.
  chessHandlers['chess.join'](o.ctx, ann, { t: 'chess.join', table: 1, side: 'w' });
  assert.equal(o.sent.length, 0);
  ann.peer.seat = chessSeatKey(1, 'w');
  chessHandlers['chess.join'](o.ctx, ann, { t: 'chess.join', table: 1, side: 'w' });
  assert.deepEqual(o.sent.map((s) => s.to).sort(), ['ann', 'bob'], 'not dan, who is on a floor');
  assert.deepEqual(down.peer.floor, '__floor');
  const msg = o.sent[0].msg;
  assert.equal(msg.t, 'chess.table');
  assert.ok(msg.t === 'chess.table' && msg.table.w?.id === 'ann');
  // Sitting on the other side of the table says so too.
  bob.peer.seat = chessSeatKey(1, 'w');
  chessHandlers['chess.join'](o.ctx, bob, { t: 'chess.join', table: 1, side: 'b' });
  assert.equal(o.sent.length, 2, "bob isn't in black's chair");
});

test('chess.move: a move goes out to the roof, a bad one is only said to the one who tried it', () => {
  const o = office();
  const ann = o.join('ann');
  const bob = o.join('bob');
  for (const [c, side] of [[ann, 'w'], [bob, 'b']] as const) {
    c.peer.seat = chessSeatKey(2, side);
    chessHandlers['chess.join'](o.ctx, c, { t: 'chess.join', table: 2, side });
  }
  o.sent.length = 0;
  chessHandlers['chess.move'](o.ctx, bob, { t: 'chess.move', table: 2, from: sq('e7'), to: sq('e5') });
  assert.deepEqual(o.warned, ["It isn't your move"]);
  assert.equal(o.sent.length, 0);
  chessHandlers['chess.move'](o.ctx, ann, { t: 'chess.move', table: 2, from: sq('e2'), to: sq('e4') });
  assert.equal(o.sent.length, 2);
  const last = o.sent[0].msg;
  assert.ok(last.t === 'chess.table' && last.table.moves === 1 && last.table.fen.includes(' b '));
});

test('chess.sync sends every table to whoever asks, and only up on the roof', () => {
  const o = office();
  const ann = o.join('ann');
  const dan = o.join('dan', null);
  chessHandlers['chess.sync'](o.ctx, dan, { t: 'chess.sync' });
  assert.equal(o.sent.length, 0);
  chessHandlers['chess.sync'](o.ctx, ann, { t: 'chess.sync' });
  const [reply] = o.tables(ann);
  assert.ok(reply.t === 'chess.tables' && reply.tables.length === 3);
});

test('whoever gets out of the chair (or goes down in the elevator, or off the net) is out of the game', () => {
  const o = office();
  const ann = o.join('ann');
  ann.peer.seat = chessSeatKey(3, 'b');
  chessHandlers['chess.join'](o.ctx, ann, { t: 'chess.join', table: 3, side: 'b' });
  const sees = () => (o.sent.at(-1)!.msg as Extract<ServerMsg, { t: 'chess.table' }>).table;
  assert.equal(sees().b?.id, 'ann');
  // Stood up without saying so (the next message anyone sends notices).
  delete ann.peer.seat;
  chessHandlers['chess.sync'](o.ctx, ann, { t: 'chess.sync' });
  const tables = o.tables(ann).find((m) => m.t === 'chess.tables');
  assert.ok(tables && tables.t === 'chess.tables' && !tables.tables[2].b);
  // On the elevator down.
  ann.peer.seat = chessSeatKey(3, 'b');
  chessHandlers['chess.join'](o.ctx, ann, { t: 'chess.join', table: 3, side: 'b' });
  chessHooks.leaving!(o.ctx, ann, undefined);
  assert.equal(sees().b, undefined);
  // The socket closing.
  chessHandlers['chess.join'](o.ctx, ann, { t: 'chess.join', table: 3, side: 'b' });
  assert.equal(sees().b?.id, 'ann');
  chessHooks.closed!(o.ctx, ann);
  assert.equal(sees().b, undefined);
});
