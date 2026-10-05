// The chess corner: the engine's rules, the idle-agent AI, and the corner's place in the office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame, at, squareName } from '../src/client/features/chess/engine.js';
import { SEATING_BY_ID, seatAt } from '../src/shared/layout.js';
import { route, walkable } from '../src/shared/nav.js';

// idleOpponents and chooseMove read the store, which keeps things in localStorage: stand one in first.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
const { store } = await import('../src/client/state/index.js');
const { chooseMove, idleOpponents } = await import('../src/client/features/chess/ai.js');

/** Plays `moves` (like 'e2e4', or 'e7e8q' to promote) on a fresh game, returning it. */
function played(moves: string[]): ChessGame {
  const g = new ChessGame();
  for (const m of moves) {
    const promo = m.length === 5 ? (m[4] as 'q') : undefined;
    const from = 'abcdefgh'.indexOf(m[0]) + (Number(m[1]) - 1) * 8;
    const to = 'abcdefgh'.indexOf(m[2]) + (Number(m[3]) - 1) * 8;
    g.play(promo ? { from, to, promo } : { from, to });
  }
  return g;
}

test('the starting position has 20 legal moves, and pawns march from e2', () => {
  const g = new ChessGame();
  assert.equal(g.allMoves().length, 20);
  assert.deepEqual(
    g.movesFrom(at(4, 1)).map((m) => squareName(m.to)),
    ['e3', 'e4'],
  );
  assert.equal(g.turn, 'w');
  assert.deepEqual(g.status(), { over: false, check: false });
});

test("fool's mate is checkmate for Black", () => {
  const g = played(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual(g.moves(), ['f3', 'e5', 'g4', 'Qh4#']);
  const st = g.status();
  assert.equal(st.over, true);
  assert.equal(st.reason, 'checkmate');
  assert.equal(st.winner, 'b');
  assert.equal(st.check, true);
  assert.equal(g.allMoves().length, 0);
});

test('castling works with SAN, and takes the rights away', () => {
  const g = played(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']);
  assert.ok(g.movesFrom(at(4, 0)).some((m) => squareName(m.to) === 'g1'), 'White can castle kingside');
  const san = g.play({ from: at(4, 0), to: at(6, 0) });
  assert.equal(san, 'O-O');
  assert.equal(g.castle.K, false);
  assert.equal(g.castle.Q, false);
});

test('queenside castling has its own name', () => {
  const g = played(['d2d4', 'd7d5', 'c1f4', 'c8f5', 'b1c3', 'b8c6', 'd1d3', 'd8d6']);
  assert.ok(g.movesFrom(at(4, 0)).some((m) => squareName(m.to) === 'c1'), 'White can castle queenside');
  assert.equal(g.play({ from: at(4, 0), to: at(2, 0) }), 'O-O-O');
  assert.equal(g.pieces[at(3, 0)]?.t, 'r');
});

test('en passant takes the pawn that just pushed past', () => {
  const g = played(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  assert.deepEqual(g.moves().slice(-1), ['exd6']);
  assert.equal(g.pieces[at(3, 5)]?.t, 'p');
  assert.equal(g.pieces[at(3, 5)]?.c, 'w');
  assert.equal(g.pieces[at(3, 4)], null);
});

test('a pawn marches up and becomes a queen', () => {
  const g = played(['e2e4', 'd7d5', 'e4d5', 'a7a6', 'd5d6', 'h7h6', 'd6c7', 'g8f6', 'c7b8q']);
  assert.deepEqual(g.moves().slice(-1), ['cxb8=Q']);
  assert.deepEqual(g.pieces[at(1, 7)], { c: 'w', t: 'q' });
  // The march took a pawn, another pawn and the knight it promoted on.
  assert.deepEqual(
    g.capturedBy('w').map((p) => p.t).sort(),
    ['n', 'p', 'p'],
  );
});

test('knights out and back twice is the same position three times: draw', () => {
  const g = played(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  const st = g.status();
  assert.equal(st.over, true);
  assert.equal(st.reason, 'repetition');
});

test('a queen hunt ends in stalemate, naming the rook that could', () => {
  const g = played(['e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'h2h4', 'a6h6', 'a5c7', 'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6', 'c8e6']);
  assert.ok(g.moves().includes('Rah6'), 'the rooks are told apart');
  const st = g.status();
  assert.equal(st.over, true);
  assert.equal(st.reason, 'stalemate');
});

test('an illegal move throws', () => {
  const g = new ChessGame();
  assert.throws(() => g.play({ from: at(4, 1), to: at(4, 4) }), /illegal/);
});

test('the agent never misses mate in one', () => {
  const g = played(['f2f3', 'e7e5', 'g2g4']);
  const m = chooseMove(g, () => 0);
  assert.ok(m, 'Black has a move');
  g.play(m!);
  assert.equal(g.status().reason, 'checkmate');
  assert.equal(g.status().winner, 'b');
});

test('the agent takes a free pawn back', () => {
  const g = played(['e2e4', 'd7d5', 'e4d5']);
  const m = chooseMove(g, () => 0);
  assert.ok(m, 'Black has a move');
  assert.equal(squareName(m!.to), 'd5');
});

test('only idle agents are offered as opponents, by name', () => {
  store.workers.clear();
  store.workers.set('w1', { id: 'w1', kind: 'agent', status: 'working', deskId: 'desk-1', name: 'Zed', color: '#fff', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] });
  store.workers.set('w2', { id: 'w2', kind: 'agent', status: 'idle', deskId: 'desk-2', name: 'Mochi', color: '#fff', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] });
  store.workers.set('w3', { id: 'w3', kind: 'shell', status: 'idle', deskId: 'desk-3', name: 'Shell', color: '#fff', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] });
  store.workers.set('w4', { id: 'w4', kind: 'agent', status: 'idle', deskId: 'desk-4', name: 'Ada', color: '#fff', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] });
  try {
    assert.deepEqual(idleOpponents(), [
      { id: 'w4', name: 'Ada' },
      { id: 'w2', name: 'Mochi' },
    ]);
  } finally {
    store.workers.clear();
  }
});

test('the chess chairs face each other across the table behind the couch', () => {
  const one = SEATING_BY_ID.get('chess-chair-1')!;
  const two = SEATING_BY_ID.get('chess-chair-2')!;
  assert.ok(one.chess && two.chess);
  assert.equal(one.rotY, Math.PI / 2);
  assert.equal(two.rotY, -Math.PI / 2);
  // Chair 1 west of the table at x 8.1, chair 2 east of it.
  assert.ok(one.x < 8.1 && two.x > 8.1);
  assert.ok(seatAt('chess-chair-1:0'));
  assert.ok(seatAt('chess-chair-2:0'));
});

test('both chess chairs are reachable on open floor, and the room stays connected', () => {
  // Up beside either chair, clear of the table and the fire pole.
  assert.ok(walkable(7.3, -1.3), 'beside chair 1');
  assert.ok(walkable(8.95, 1.3), 'beside chair 2');
  // From the spawn to the east chair, and from the elevator past the corner to the south.
  for (const [from, to] of [
    [[8, 7], [8.95, -1.3]],
    [[8.5, -10], [8, 7]],
  ] as const) {
    const way = route(from, to);
    const [ex, ez] = way[way.length - 1];
    assert.ok(Math.hypot(ex - to[0], ez - to[1]) < 0.6, `gets to ${to}`);
  }
});
