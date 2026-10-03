import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseSquare, playMove, startState, toFen, parseFen, type ChessState } from '../src/shared/chess.js';
import type { ChessTable } from '../src/shared/protocol.js';

// A canvas that takes every drawing call and ignores it: the board's textures are for the GPU, not this.
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
const { ChessTableView, SQUARE, TABLE_H, squareAtPoint, squarePos } = await import('../src/client/features/chess/board.js');

const sq = (name: string) => parseSquare(name);
const table = (s: ChessState, moves: number, last?: [number, number], extra: Partial<ChessTable> = {}): ChessTable => ({ n: 1, fen: toFen(s), moves, last, taken: '', ...extra });
const run = (v: InstanceType<typeof ChessTableView>, seconds = 1) => {
  for (let t = 0; t < seconds; t += 1 / 60) v.update(1 / 60);
};
const men = (v: InstanceType<typeof ChessTableView>) => (v as unknown as { pieces: THREE.Group }).pieces.children;
/** Where a square's man stands, on the table. */
const stands = (v: InstanceType<typeof ChessTableView>, name: string) => {
  const p = squarePos(sq(name));
  return men(v).find((g) => Math.hypot(g.position.x - p.x, g.position.z - p.z) < 1e-6 && g.position.y < TABLE_H + 0.02);
};

test('squares: a1 is the near left corner for White; files run along +x and ranks away along -z', () => {
  assert.deepEqual(squarePos(sq('a1')), { x: -3.5 * SQUARE, z: 3.5 * SQUARE });
  assert.equal(squareAtPoint(...(Object.values(squarePos(sq('h8'))) as [number, number])), sq('h8'));
  assert.equal(squareAtPoint(0.01, 0.01), sq('e4'));
  assert.equal(squareAtPoint(0.5, 0), -1);
});

test('a board shows the position and slides a move, taking en passant, castling and promoting as it goes', () => {
  const v = new ChessTableView(1);
  const s = startState();
  v.show(table(s, 0));
  assert.equal(men(v).length, 32);
  assert.ok(stands(v, 'e2'));
  // One move on slides: mid-flight it's between the squares, afterwards on the new one.
  const e4 = playMove(s, sq('e2'), sq('e4'))!;
  v.show(table(e4.state, 1, [sq('e2'), sq('e4')]));
  v.update(0.1);
  const g = men(v).find((m) => m.userData.chessSq === sq('e4'))!;
  assert.ok(g.position.z < squarePos(sq('e2')).z && g.position.z > squarePos(sq('e4')).z, 'on its way');
  run(v);
  assert.ok(stands(v, 'e4') && !stands(v, 'e2'));

  // A capture: the taken man goes once the other arrives.
  let st = e4.state;
  let n = 1;
  const go = (...moves: string[]) => {
    for (const m of moves) {
      const p = playMove(st, sq(m.slice(0, 2)), sq(m.slice(2, 4)), m[4] as 'q' | undefined)!;
      st = p.state;
      v.show(table(st, ++n, [sq(m.slice(0, 2)), sq(m.slice(2, 4))]));
      run(v);
    }
  };
  go('d7d5', 'e4d5');
  assert.equal(men(v).length, 31);
  // En passant: the pawn it passed goes.
  go('c7c5', 'd5c6');
  assert.equal(men(v).length, 30);
  assert.ok(!stands(v, 'c5'), 'the passed pawn is gone');
  assert.ok(stands(v, 'c6'));
  // Castling moves the rook too.
  go('g8f6', 'g1f3', 'e7e6', 'f1e2', 'f8e7', 'e1g1');
  assert.ok(stands(v, 'g1') && stands(v, 'f1'), 'king and rook');
  assert.ok(!stands(v, 'h1'));
  // Promotion: the pawn arrives, then turns into what it's become.
  const promo = parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')!;
  const w = new ChessTableView(1);
  w.show(table(promo, 0));
  const after = playMove(promo, sq('a7'), sq('a8'))!;
  w.show(table(after.state, 1, [sq('a7'), sq('a8')]));
  const pawn = men(w).find((m) => m.userData.chessSq === sq('a8'))!;
  run(w);
  const queen = men(w).find((m) => m.userData.chessSq === sq('a8'))!;
  assert.notEqual(queen, pawn, 'swapped for a queen');
  assert.equal(men(w).length, 3);
});

test('a board that jumps (a new game, arriving late) just sets the pieces up', () => {
  const v = new ChessTableView(1);
  const s = startState();
  const moved = playMove(playMove(s, sq('e2'), sq('e4'))!.state, sq('e7'), sq('e5'))!.state;
  v.show(table(moved, 2, [sq('e7'), sq('e5')]));
  assert.ok(stands(v, 'e4') && stands(v, 'e5'), 'no sliding: they are where they should be');
  v.show(table(s, 0));
  assert.ok(stands(v, 'e2') && stands(v, 'e7'));
  assert.equal(men(v).length, 32);
});

test('men taken are laid out along the edges, and the flag and the coin come out when they should', () => {
  const v = new ChessTableView(1);
  const taken = (v as unknown as { takenGroup: THREE.Group }).takenGroup;
  const tokens = (v as unknown as { tokens: Record<'resign' | 'new', THREE.Group[]> }).tokens;
  v.show(table(startState(), 0));
  assert.equal(taken.children.length, 0);
  assert.ok(tokens.resign.every((t) => !t.visible) && tokens.new.every((t) => !t.visible), 'nothing to resign or restart yet');
  const after = playMove(startState(), sq('e2'), sq('e4'))!.state;
  v.show(table(after, 1, [sq('e2'), sq('e4')], { taken: 'Pnp', w: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } }));
  assert.equal(taken.children.length, 3);
  assert.ok(tokens.resign.every((t) => t.visible) && tokens.new.every((t) => !t.visible), 'a game on: the flag');
  v.show(table(after, 2, undefined, { taken: 'Pnp', end: { kind: 'resign', winner: 'w' } }));
  assert.ok(tokens.resign.every((t) => !t.visible) && tokens.new.every((t) => t.visible), 'over: the coin');
});

test('aiming at the board finds the square, or the man standing on it, or the flag', () => {
  const v = new ChessTableView(1);
  v.show(table(startState(), 1, undefined, { w: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } }));
  v.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    return v.pick(ray);
  };
  assert.deepEqual(down(squarePos(sq('e4')).x, squarePos(sq('e4')).z), { sq: sq('e4') }, 'an empty square');
  assert.deepEqual(down(squarePos(sq('e2')).x, squarePos(sq('e2')).z), { sq: sq('e2') }, 'a pawn on its square');
  assert.deepEqual(down(squarePos(sq('g1')).x, squarePos(sq('g1')).z), { sq: sq('g1') }, 'a knight on its');
  assert.equal(down(0.45, 0.2), null, 'the table beside the board');
  const flag = (v as unknown as { tokens: Record<'resign', THREE.Group[]> }).tokens.resign[0];
  assert.deepEqual(down(flag.position.x, flag.position.z), { act: 'resign' });
  flag.visible = false;
  assert.equal(down(flag.position.x, flag.position.z), null, 'a flag that is not out is not there');
});

test('what is lit is laid on the right squares, and cleared again', () => {
  const v = new ChessTableView(1);
  v.show(table(startState(), 0));
  v.setMarks({ last: [sq('e2'), sq('e4')], selected: sq('g1'), moves: [sq('f3')], takes: [sq('h3')], hover: sq('g1'), check: sq('e1') });
  const lit = () => v.group.children.filter((c) => (c as THREE.Mesh).isMesh && c.visible && c !== v.top && (c as THREE.Mesh).geometry.type === 'PlaneGeometry' && c.position.y > TABLE_H && c.position.y < TABLE_H + 0.01);
  assert.equal(lit().length, 7);
  v.setMarks({});
  assert.equal(lit().length, 0);
});
