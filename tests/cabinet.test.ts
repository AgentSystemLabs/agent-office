import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HighScores } from '../src/server/cabinet.js';
import { SCORES_KEPT, WELL_COLS, WELL_ROWS, checkFrame } from '../src/shared/cabinet.js';
import { Blocks } from '../src/client/ui/blocks.js';

const game = (n: number) => `game${String(n).padStart(8, '0')}`;
const entry = (n: number, score: number, name = 'Ada') => ({ game: game(n), name, color: '#ef476f', score, lines: 1, level: 1 });

test('a high score set by one person is still on the table after a restart', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = new HighScores(dir);
  assert.deepEqual(before.record(entry(1, 1200)), { changed: true, first: true });
  assert.deepEqual(before.record(entry(2, 400, 'Grace')), { changed: true, first: false });
  const after = new HighScores(dir);
  assert.deepEqual(
    after.top().map((s) => [s.name, s.score]),
    [
      ['Ada', 1200],
      ['Grace', 400],
    ],
  );
});

test('the same game only ever goes up, and only its own player can raise it', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const table = new HighScores(dir);
  table.record(entry(1, 500));
  // Saved as Ada walked away from it, then again when it ended: one entry, the higher score.
  assert.equal(table.record(entry(1, 900)).changed, true);
  assert.equal(table.record(entry(1, 300)).changed, false);
  assert.equal(table.record(entry(1, 5000, 'Mallory')).changed, false);
  assert.deepEqual(
    table.top().map((s) => [s.game, s.score]),
    [[game(1), 900]],
  );
  // Nothing scored is nothing to show.
  assert.equal(table.record(entry(2, 0)).changed, false);
});

test('the table keeps the best games, and a new leader is news', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const table = new HighScores(dir);
  for (let i = 1; i <= SCORES_KEPT; i++) table.record(entry(i, i * 100));
  // Worse than every game on a full table: it doesn't make it.
  assert.equal(table.record(entry(50, 50)).changed, false);
  assert.deepEqual(table.record(entry(51, 150, 'Grace')), { changed: true, first: false });
  assert.equal(table.top().length, SCORES_KEPT);
  assert.equal(table.top().at(-1)!.score, 150);
  assert.deepEqual(table.record(entry(52, 5000, 'Grace')), { changed: true, first: true });
  // Raising your own lead isn't taking first place again.
  assert.deepEqual(table.record(entry(52, 6000, 'Grace')), { changed: true, first: false });
});

test('a broken or tampered table file is read as far as it makes sense', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, 'arcade.json'),
    JSON.stringify([
      { ...entry(1, 300), at: 1 },
      { ...entry(2, 700), color: 'red; x', at: 2 },
      { ...entry(3, 900), score: 'lots', at: 3 },
      null,
      { ...entry(4, 100), name: '', at: 4 },
      entry(5, 800),
    ]),
  );
  const table = new HighScores(dir);
  assert.deepEqual(
    table.top().map((s) => [s.score, s.color]),
    [
      [700, '#4f86f7'],
      [300, '#ef476f'],
    ],
  );
  writeFileSync(path.join(dir, 'arcade.json'), '{ not json');
  assert.deepEqual(new HighScores(dir).top(), []);
});

test('frames from a browser are checked before anyone else sees them', () => {
  const g = new Blocks();
  const f = g.frame();
  assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
  assert.equal(checkFrame({ ...f, cells: f.cells.slice(1) }), null);
  assert.equal(checkFrame({ ...f, cells: `<${f.cells.slice(1)}` }), null);
  assert.equal(checkFrame({ ...f, score: -1 }), null);
  assert.equal(checkFrame({ ...f, state: 'won' }), null);
  assert.equal(checkFrame('nope'), null);
});

/** Game internals, for setting up a well by hand. */
type Inside = { well: Uint8Array; piece: { kind: number; rot: number; x: number; y: number }; spawn(kind?: number): void };
const inside = (g: Blocks) => g as unknown as Inside;
const HIDDEN = 2;

test('a new game shows its piece at the top of the well and a ghost at the bottom', () => {
  const f = new Blocks().frame();
  assert.equal(f.cells.length, WELL_COLS * WELL_ROWS);
  assert.equal(f.state, 'play');
  const rows = Array.from({ length: WELL_ROWS }, (_, r) => f.cells.slice(r * WELL_COLS, (r + 1) * WELL_COLS));
  assert.match(rows[0], /[1-7]/);
  assert.match(rows[WELL_ROWS - 1], /8/);
});

test('dropping an I into a four-deep gap clears four lines', () => {
  const g = new Blocks();
  const { well } = inside(g);
  for (let r = HIDDEN + WELL_ROWS - 4; r < HIDDEN + WELL_ROWS; r++) for (let c = 1; c < WELL_COLS; c++) well[r * WELL_COLS + c] = 3;
  // Upright, its blocks are the third column of its box: that's column 0 of the well.
  inside(g).piece = { kind: 1, rot: 1, x: -2, y: 1 };
  let landed = -1;
  g.onLand = (lines) => (landed = lines);
  g.hardDrop();
  assert.equal(landed, 4);
  assert.equal(g.lines, 4);
  // 17 rows down at 2 points a row, and 800 for four lines at level 1.
  assert.equal(g.score, 17 * 2 + 800);
  assert.equal(g.pieces, 1);
  assert.ok(!/[1-7]/.test(g.frame().cells.slice(-4 * WELL_COLS).replace(/8/g, '0')), 'the bottom four rows are empty again');
});

test('a piece turned against the wall is kicked out from it', () => {
  const g = new Blocks();
  // A T pointing right, flat against the left wall.
  inside(g).piece = { kind: 3, rot: 1, x: -1, y: 8 };
  g.rotate(1);
  assert.deepEqual(inside(g).piece, { kind: 3, rot: 2, x: 0, y: 8 });
});

test('a paused game stands still, and a piece with no room to come in ends it', () => {
  const g = new Blocks();
  const y = inside(g).piece.y;
  g.pause(true);
  g.update(5);
  assert.equal(inside(g).piece.y, y);
  g.pause(false);
  g.update(1.01);
  assert.equal(inside(g).piece.y, y + 1);
  inside(g).well.fill(5, 0, (HIDDEN + 2) * WELL_COLS);
  inside(g).spawn();
  assert.equal(g.state, 'over');
});
