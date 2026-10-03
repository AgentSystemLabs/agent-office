import test from 'node:test';
import assert from 'node:assert/strict';
import { START_FEN, applyMove, inCheck, insufficientMaterial, legalMoves, outcome, parseFen, parseSquare, perft, playMove, squareName, startState, toFen, type ChessState } from '../src/shared/chess.js';

const fen = (f: string): ChessState => {
  const s = parseFen(f);
  assert.ok(s, `parses: ${f}`);
  return s;
};
/** "e2e4" or "e7e8q" played from `s`, which has to be legal. */
const play = (s: ChessState, ...moves: string[]): ChessState => {
  for (const m of moves) {
    const p = playMove(s, parseSquare(m.slice(0, 2)), parseSquare(m.slice(2, 4)), m[4] as 'q' | undefined);
    assert.ok(p, `${m} is legal in ${toFen(s)}`);
    s = p.state;
  }
  return s;
};
const dests = (s: ChessState, from: string) => legalMoves(s, parseSquare(from)).map((m) => squareName(m.to)).sort();

test('squares: a1 is 0, h8 is 63, and names go both ways', () => {
  assert.equal(parseSquare('a1'), 0);
  assert.equal(parseSquare('e4'), 28);
  assert.equal(parseSquare('h8'), 63);
  assert.equal(squareName(12), 'e2');
  assert.equal(parseSquare('i9'), -1);
});

test('FEN: the start position round-trips, and nonsense is turned away', () => {
  assert.equal(toFen(startState()), START_FEN);
  const f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.equal(toFen(fen(f)), f);
  assert.equal(parseFen('nonsense'), null);
  assert.equal(parseFen('8/8/8/8/8/8/8 w - - 0 1'), null);
  assert.equal(parseFen('8/8/8/8/8/8/8/8 w - - 0 1'), null, 'no kings');
  assert.equal(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'), null);
});

test('perft from the start: 20, 400, 8902', () => {
  const s = startState();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});

test('perft: kiwipete, a position with every special move in it', () => {
  const s = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});

test('perft: the well-known positions that trip up en passant, castling and promotion', () => {
  // En passant along a rank with a rook behind it (taking would expose the king), and pins.
  const rooks = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.deepEqual([1, 2, 3].map((d) => perft(rooks, d)), [14, 191, 2812]);
  // Promotions, taking onto the back rank, castling out of and into check.
  const promo = fen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.deepEqual([1, 2, 3].map((d) => perft(promo, d)), [6, 264, 9467]);
  assert.deepEqual([1, 2].map((d) => perft(fen('r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1'), d)), [6, 264]);
  assert.deepEqual([1, 2, 3].map((d) => perft(fen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), d)), [44, 1486, 62379]);
  assert.deepEqual([1, 2].map((d) => perft(fen('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'), d)), [46, 2079]);
});

test('pawns: a double step from the home rank only, blocked by anything in front', () => {
  const s = startState();
  assert.deepEqual(dests(s, 'e2'), ['e3', 'e4']);
  assert.deepEqual(dests(play(s, 'e2e4', 'a7a6'), 'e4'), ['e5']);
  assert.deepEqual(dests(fen('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1'), 'e2'), []);
  assert.deepEqual(dests(fen('4k3/8/8/8/4p3/8/4P3/4K3 w - - 0 1'), 'e2'), ['e3']);
});

test('you can only move your own pieces, on your own turn', () => {
  const s = startState();
  assert.equal(playMove(s, parseSquare('e7'), parseSquare('e5')), null);
  assert.equal(playMove(s, parseSquare('e2'), parseSquare('e5')), null, 'three steps');
  assert.equal(playMove(s, parseSquare('e4'), parseSquare('e5')), null, 'an empty square');
  assert.equal(playMove(s, parseSquare('a1'), parseSquare('a3')), null, 'a rook through its own pawn');
  assert.ok(playMove(s, parseSquare('g1'), parseSquare('f3')));
});

test('en passant: only straight after the double step, and the passed pawn goes', () => {
  let s = play(startState(), 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  assert.equal(squareName(s.ep), 'd6');
  assert.deepEqual(dests(s, 'e5'), ['d6', 'e6']);
  const took = playMove(s, parseSquare('e5'), parseSquare('d6'))!;
  assert.equal(took.captured, 'p');
  assert.equal(took.state.board[parseSquare('d5')], '', 'the pawn it passed is gone');
  assert.equal(took.state.board[parseSquare('d6')], 'P');
  // Wait a move and the chance is gone.
  s = play(s, 'h2h3', 'h7h6');
  assert.deepEqual(dests(s, 'e5'), ['e6']);
});

test('en passant that would leave your own king in check is not allowed', () => {
  // Both pawns come off the fifth rank at once, opening it to the rook.
  const s = fen('8/8/8/KPp4r/8/8/8/7k w - c6 0 1');
  assert.deepEqual(dests(s, 'b5'), ['b6']);
});

test('castling: both sides, and what stops it', () => {
  const s = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.deepEqual(dests(s, 'e1'), ['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
  const short = play(s, 'e1g1');
  assert.equal(short.board[parseSquare('f1')], 'R');
  assert.equal(short.board[parseSquare('h1')], '');
  assert.equal(short.castling, 'kq', 'White has lost both');
  const long = play(s, 'e1c1');
  assert.equal(long.board[parseSquare('d1')], 'R');
  assert.equal(long.board[parseSquare('c1')], 'K');
  assert.equal(long.castling, 'kq');
  // (Black's long side is covered now by the rook on d1.)
  assert.ok(!dests(long, 'e8').includes('c8'));
  assert.ok(dests(long, 'e8').includes('g8'));
  // Through an attacked square, out of check, a piece in the way, or the rights gone: no.
  assert.ok(!dests(fen('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1'), 'e1').includes('g1'), 'f1 is attacked');
  assert.ok(dests(fen('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1'), 'e1').includes('c1'), 'the long side is clear of it');
  assert.ok(!dests(fen('r3k2r/8/8/8/8/4r3/8/R3K2R w KQkq - 0 1'), 'e1').some((d) => d === 'g1' || d === 'c1'), 'in check');
  assert.ok(!dests(fen('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1'), 'e1').includes('c1'), 'a knight in the way');
  // The rook that's attacked (not the king's path) doesn't matter on the long side.
  assert.ok(dests(fen('1r2k2r/8/8/8/8/8/8/R3K2R w KQk - 0 1'), 'e1').includes('c1'));
  assert.ok(!dests(fen('r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1'), 'e1').includes('g1'));
});

test('castling rights go when the king or a rook moves, or the rook is taken', () => {
  let s = startState();
  s = play(s, 'a2a4', 'a7a5', 'a1a2');
  assert.equal(s.castling, 'Kkq');
  s = play(s, 'h7h5', 'h2h4', 'h8h6');
  assert.equal(s.castling, 'Kq');
  s = play(fen('r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1'), 'g2a8');
  assert.equal(s.castling, 'KQk', 'a rook taken on its own square');
  s = play(fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1e2');
  assert.equal(s.castling, 'kq');
});

test('promotion: a queen unless another piece is asked for, and it comes once for each', () => {
  const s = fen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(legalMoves(s, parseSquare('a7')).map((m) => m.promo).sort(), ['b', 'n', 'q', 'r']);
  assert.equal(playMove(s, parseSquare('a7'), parseSquare('a8'))!.state.board[parseSquare('a8')], 'Q');
  assert.equal(playMove(s, parseSquare('a7'), parseSquare('a8'), 'n')!.state.board[parseSquare('a8')], 'N');
  const black = fen('4k3/8/8/8/8/8/p7/1R2K3 b - - 0 1');
  assert.equal(play(black, 'a2b1r').board[parseSquare('b1')], 'r', 'taking a piece and promoting at once, as Black');
  assert.equal(playMove(black, parseSquare('a2'), parseSquare('b1'))!.captured, 'R');
});

test('pins and check: a pinned piece stays on its line, and a check has to be answered', () => {
  // The bishop is pinned to its king by the rook.
  assert.deepEqual(dests(fen('4r3/8/8/8/8/8/4B3/4K2k w - - 0 1'), 'e2'), []);
  assert.deepEqual(dests(fen('4r3/8/8/8/8/8/4R3/4K2k w - - 0 1'), 'e2'), ['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  // In check from a knight: take it, or move the king (not onto f2, which it also covers).
  const s = fen('4k3/8/8/8/8/3n4/4P3/R3K3 w - - 0 1');
  assert.ok(inCheck(s));
  assert.deepEqual(legalMoves(s).map((m) => `${squareName(m.from)}${squareName(m.to)}`).sort(), ['e1d1', 'e1d2', 'e1f1', 'e2d3']);
  assert.ok(!inCheck(startState()));
});

test("fool's mate: Black mates in two moves", () => {
  const s = play(startState(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.ok(inCheck(s));
  assert.deepEqual(legalMoves(s), []);
  assert.deepEqual(outcome(s), { over: true, kind: 'checkmate', winner: 'b' });
  assert.deepEqual(outcome(startState()), { over: false });
});

test("scholar's mate, from the other side", () => {
  const s = play(startState(), 'e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7');
  assert.deepEqual(outcome(s), { over: true, kind: 'checkmate', winner: 'w' });
});

test('stalemate: no legal move and not in check', () => {
  const s = fen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(!inCheck(s));
  assert.deepEqual(legalMoves(s), []);
  assert.deepEqual(outcome(s), { over: true, kind: 'stalemate' });
});

test('insufficient material: bare kings, one minor piece, bishops on one color; not a pawn, a rook, or bishops on both', () => {
  assert.ok(insufficientMaterial(fen('4k3/8/8/8/8/8/8/4K3 w - - 0 1')));
  assert.ok(insufficientMaterial(fen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1')));
  assert.ok(insufficientMaterial(fen('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1')), 'c1 and f8 are both dark');
  assert.ok(!insufficientMaterial(fen('4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1')), 'c1 dark, g8 light');
  assert.ok(!insufficientMaterial(fen('4k3/8/8/8/8/8/P7/4K3 w - - 0 1')));
  assert.ok(!insufficientMaterial(fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')));
  assert.deepEqual(outcome(fen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1')), { over: true, kind: 'insufficient' });
});

test('the fifty-move rule: a hundred half moves without a pawn move or a capture', () => {
  assert.deepEqual(outcome(fen('4k3/8/8/8/8/8/8/R3K3 w - - 99 80')), { over: false });
  assert.deepEqual(outcome(fen('4k3/8/8/8/8/8/8/R3K3 w - - 100 80')), { over: true, kind: 'fifty' });
  // A move that takes or moves a pawn starts the count again, any other adds to it.
  assert.equal(play(fen('4k3/8/8/8/8/8/8/R3K3 w - - 40 50'), 'a1a2').halfmove, 41);
  assert.equal(play(fen('4k3/8/8/8/8/8/P7/R3K3 w - - 40 50'), 'a2a4').halfmove, 0);
  assert.equal(play(fen('r3k3/8/8/8/8/8/8/R3K3 w - - 40 50'), 'a1a8').halfmove, 0);
});

test('turns and move numbers advance, and a capture is reported', () => {
  const a = play(startState(), 'e2e4');
  assert.equal(a.turn, 'b');
  assert.equal(a.fullmove, 1);
  assert.equal(toFen(a), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const b = play(a, 'd7d5');
  assert.equal(b.fullmove, 2);
  const c = playMove(b, parseSquare('e4'), parseSquare('d5'))!;
  assert.equal(c.captured, 'p');
  assert.equal(playMove(b, parseSquare('e4'), parseSquare('e5'))!.captured, '');
});

test('applyMove leaves the position it was given alone', () => {
  const s = startState();
  const before = toFen(s);
  applyMove(s, legalMoves(s)[0]);
  assert.equal(toFen(s), before);
});
