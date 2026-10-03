import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PIECE_SQUARE, pieceParts, type PieceKind } from '../src/client/features/chess/pieces.js';

const KINDS: PieceKind[] = ['p', 'r', 'n', 'b', 'q', 'k'];
const box = (kind: PieceKind) => new THREE.Box3().setFromBufferAttribute(pieceParts(kind).wood.attributes.position as THREE.BufferAttribute);

test('every piece stands on the board and fits in its square, and has the normals to be lit', () => {
  for (const k of KINDS) {
    const b = box(k);
    const wood = pieceParts(k).wood;
    assert.ok(Math.abs(b.min.y) < 1e-6, `${k} stands on y = 0`);
    assert.ok(b.max.x - b.min.x < PIECE_SQUARE * 0.8 && b.max.z - b.min.z < PIECE_SQUARE * 0.8, `${k} fits its square`);
    assert.ok(wood.attributes.normal && wood.attributes.uv, `${k} has normals and uvs`);
    for (const v of wood.attributes.position.array) assert.ok(Number.isFinite(v), `${k} has no NaNs`);
  }
});

test('Staunton heights: pawn < rook < knight < bishop < queen < king', () => {
  const h = KINDS.map((k) => box(k).max.y);
  for (let i = 1; i < h.length; i++) assert.ok(h[i] > h[i - 1], `${KINDS[i]} (${h[i].toFixed(3)}) is taller than ${KINDS[i - 1]} (${h[i - 1].toFixed(3)})`);
  assert.ok(h[5] < 0.13 && h[5] > 0.11, 'a king is about 12 cm on a board with 8 cm squares');
});

test('the knight has a head to one side of its base (looking along +x) and eyes; the bishop its slit', () => {
  const b = box('n');
  assert.ok(b.max.x > 0.025 && b.min.x > -0.03);
  assert.ok(pieceParts('n').ink && pieceParts('b').ink);
  assert.equal(pieceParts('q').ink, undefined);
});
