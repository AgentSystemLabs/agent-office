import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Arcade, DROP_POINTS, GAME_BURST, GAME_EVERY, HighScores, PIECE_BURST, PIECES_PER_SECOND, RECORD_EVERY, clearPoints, type Player } from '../src/server/cabinet.js';
import { SCORES_KEPT, WELL_COLS, WELL_ROWS, checkFrame, levelFor, type CabinetFrame } from '../src/shared/cabinet.js';
import { Blocks } from '../src/client/ui/blocks.js';
import { lostGame } from '../src/client/ui/cabinet.js';

const game = (n: number) => `game${String(n).padStart(8, '0')}`;
const entry = (n: number, score: number, name = 'Ada') => ({ game: game(n), name, color: '#ef476f', score, lines: 1, level: 1 });
/** Whether the table changed, and which game took first place. */
const news = (r: { changed: boolean; first: { game: string } | null }) => ({ changed: r.changed, first: r.first?.game ?? null });

test('a high score set by one person is still on the table after a restart', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = new HighScores(dir);
  assert.deepEqual(news(before.record(entry(1, 1200))), { changed: true, first: game(1) });
  assert.deepEqual(news(before.record(entry(2, 400, 'Grace'))), { changed: true, first: null });
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
  assert.deepEqual(news(table.record(entry(51, 150, 'Grace'))), { changed: true, first: null });
  assert.equal(table.top().length, SCORES_KEPT);
  assert.equal(table.top().at(-1)!.score, 150);
  assert.deepEqual(news(table.record(entry(52, 5000, 'Grace'))), { changed: true, first: game(52) });
  // Raising your own lead isn't taking first place again.
  assert.deepEqual(news(table.record(entry(52, 6000, 'Grace'))), { changed: true, first: null });
});

test('several games go on the table at once, and the one that ends up in front is the news', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const table = new HighScores(dir);
  table.record(entry(1, 1000));
  assert.deepEqual(news(table.record(entry(2, 1500, 'Grace'), entry(3, 2000, 'Linus'), entry(4, 0, 'Nobody'))), { changed: true, first: game(3) });
  assert.deepEqual(
    table.top().map((s) => s.score),
    [2000, 1500, 1000],
  );
  assert.deepEqual(news(table.record(entry(1, 900), entry(2, 1400, 'Grace'))), { changed: false, first: null });
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

// ---- The office following games: scores it saw played, and nothing else --------------------------

const ada: Player = { owner: 'name:Ada', name: 'Ada', color: '#ef476f' };
const grace: Player = { owner: 'account:grace', name: 'Grace', color: '#06d6a0' };
const CELLS = '0'.repeat(WELL_COLS * WELL_ROWS);
const frame = (f: Partial<CabinetFrame> = {}): CabinetFrame => ({ cells: CELLS, next: 1, hold: 0, score: 0, lines: 0, level: 1, pieces: 0, state: 'play', ...f });

/** An arcade with its table in a fresh folder, on a clock the test moves; `news` is every change to the table. */
function arcadeFor(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const table = new HighScores(dir);
  const news: ({ game: string; floor: string } | null)[] = [];
  const arcade = new Arcade(table, (first) => news.push(first && { game: first.score.game, floor: first.floor }));
  const record = t.mock.method(table, 'record');
  return { dir, table, arcade, news, record, tick: (ms: number) => t.mock.timers.tick(ms) };
}

/** Game internals, for a bot to look at the well and put the piece where it wants it. */
type Engine = {
  well: Uint8Array;
  piece: { kind: number; rot: number; x: number; y: number };
  fits(p: Engine['piece'], dx?: number, dy?: number): boolean;
  at(p: Engine['piece'], dx?: number, dy?: number): [number, number][];
};

/** How good a well looks to the bot: few holes, low and flat, lines cleared. */
function rate(well: Uint8Array): number {
  const rows: Uint8Array[] = [];
  for (let r = 0; r < well.length / WELL_COLS; r++) rows.push(well.subarray(r * WELL_COLS, (r + 1) * WELL_COLS));
  const left = rows.filter((row) => !row.every(Boolean));
  const cleared = rows.length - left.length;
  const heights = Array.from({ length: WELL_COLS }, (_, c) => {
    const top = left.findIndex((row) => row[c]);
    return top < 0 ? 0 : left.length - top;
  });
  let holes = 0;
  for (let c = 0; c < WELL_COLS; c++) for (let r = left.length - heights[c]; r < left.length; r++) if (!left[r][c]) holes++;
  let bumps = 0;
  for (let c = 1; c < WELL_COLS; c++) bumps += Math.abs(heights[c] - heights[c - 1]);
  return -0.51 * heights.reduce((a, b) => a + b, 0) + 0.76 * cleared - 0.36 * holes - 0.18 * bumps;
}

/** Turns and slides the falling piece to where it leaves the best well, and says how far it has to fall there. */
function aim(g: Blocks): number {
  const e = g as unknown as Engine;
  const { kind, y } = e.piece;
  let best = { p: e.piece, fall: 0, rating: -Infinity };
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x < WELL_COLS; x++) {
      const p = { kind, rot, x, y };
      if (!e.fits(p)) continue;
      let fall = 0;
      while (e.fits(p, 0, fall + 1)) fall++;
      const well = e.well.slice();
      for (const [cx, cy] of e.at(p, 0, fall)) well[cy * WELL_COLS + cx] = kind;
      const rating = rate(well);
      if (rating > best.rating) best = { p, fall, rating };
    }
  }
  e.piece = best.p;
  return best.fall;
}

/** Math.random, but the same every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
  };
}

test('a real game, played well, goes on the table at the score it got, frame by frame', (t) => {
  const { arcade, table, news, tick } = arcadeFor(t);
  t.mock.method(Math, 'random', seeded(46));
  const g = new Blocks();
  const id = arcade.start(ada);
  const send = () => assert.equal(arcade.frame(id, g.frame(), 'f1'), 'ok', `frame at ${g.pieces} pieces, ${g.lines} lines, ${g.score} points`);
  // Two pieces a second for two and a half minutes, with holds and soft drops thrown in.
  for (let n = 1; n <= 300 && !g.over; n++) {
    if (n % 7 === 0) g.hold();
    const fall = aim(g);
    if (n % 5 === 0 && fall > 4) {
      g.softDrop(true);
      for (let i = 0; i < 3; i++) {
        g.update(0.05);
        tick(50);
        send();
      }
      g.softDrop(false);
    }
    g.hardDrop();
    tick(n % 2 ? 300 : 700);
    send();
  }
  assert.ok(g.lines >= 40 && g.level >= 5, `the bot cleared ${g.lines} lines`);
  arcade.leave(id, 'f1');
  tick(1);
  assert.deepEqual(
    table.top().map((s) => [s.game, s.name, s.score, s.lines, s.level]),
    [[id, 'Ada', g.score, g.lines, g.level]],
  );
  assert.deepEqual(news, [{ game: id, floor: 'f1' }]);
});

test('a game that ends goes on the table without anyone walking away', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const id = arcade.start(ada);
  tick(3000);
  assert.equal(arcade.frame(id, frame({ pieces: 6, score: 120 }), 'f1'), 'ok');
  assert.equal(arcade.frame(id, frame({ pieces: 7, score: 140, state: 'over' }), 'f1'), 'ok');
  tick(1);
  assert.deepEqual(
    table.top().map((s) => [s.game, s.score]),
    [[id, 140]],
  );
  // It's finished: nothing more for it, even from its own player.
  assert.equal(arcade.frame(id, frame({ pieces: 8, score: 180 }), 'f1'), 'none');
});

test('a forged score never makes the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  // Straight in at a score no game gets to.
  const id = arcade.start(ada);
  assert.equal(arcade.frame(id, frame({ pieces: 1, score: 99_999_999 }), 'f1'), 'void');
  arcade.leave(id, 'f1');
  // Just past what its pieces could score dropping (without a line to show for it).
  const nudged = arcade.start(ada);
  tick(10_000);
  assert.equal(arcade.frame(nudged, frame({ pieces: 10, score: DROP_POINTS * 11 }), 'f1'), 'ok');
  assert.equal(arcade.frame(nudged, frame({ pieces: 10, score: DROP_POINTS * 11 + 1 }), 'f1'), 'void');
  // Lines its pieces couldn't have filled, a level its lines don't make, a score going down.
  tick(10_000);
  const lines = arcade.start(ada);
  assert.equal(arcade.frame(lines, frame({ pieces: 2, lines: 1, score: 200 }), 'f1'), 'void');
  const level = arcade.start(ada);
  assert.equal(arcade.frame(level, frame({ pieces: 2, level: 9, score: 20 }), 'f1'), 'void');
  const down = arcade.start(grace);
  assert.equal(arcade.frame(down, frame({ pieces: 2, score: 60 }), 'f1'), 'ok');
  assert.equal(arcade.frame(down, frame({ pieces: 3, score: 40 }), 'f1'), 'void');
  // Lines cleared one at a time, scored as if they'd all gone at once.
  const linus: Player = { owner: 'name:Linus', name: 'Linus', color: '#ffd166' };
  const singles = arcade.start(linus);
  for (const [pieces, lines] of [[3, 1], [6, 2], [9, 3]]) {
    assert.equal(arcade.frame(singles, frame({ pieces, lines, score: DROP_POINTS * (pieces + 1) + 100 * lines }), 'f1'), 'ok');
  }
  assert.equal(arcade.frame(singles, frame({ pieces: 10, lines: 4, score: DROP_POINTS * 11 + 800 }), 'f1'), 'void');
  // Four lines at once, scored at the level they took the game up to rather than the one it was on.
  tick(10_000);
  const up = arcade.start(linus);
  for (const n of [1, 2]) {
    tick(4000);
    assert.equal(arcade.frame(up, frame({ pieces: 10 * n, lines: 4 * n, score: DROP_POINTS * (10 * n + 1) + 800 * n }), 'f1'), 'ok');
  }
  tick(1000);
  assert.equal(arcade.frame(up, frame({ pieces: 21, lines: 12, level: 2, score: DROP_POINTS * 22 + 800 * 2 + 1600 }), 'f1'), 'void');
  // Once caught, a game stays off the table, however it carries on.
  assert.equal(arcade.frame(id, frame({ pieces: 2, score: 30 }), 'f1'), 'none');
  for (const g of [id, nudged, lines, level, down, singles, up]) arcade.leave(g, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(table.top(), []);
});

test("a game id the office didn't start gets nobody anywhere", (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const madeUp = 'deadbeefdeadbeef';
  assert.equal(arcade.frame(madeUp, frame({ pieces: 1, score: 40, state: 'over' }), 'f1'), 'none');
  // Asking to carry on with it starts a new game from nothing instead.
  const id = arcade.start(ada, madeUp);
  assert.notEqual(id, madeUp);
  assert.match(id, /^[0-9a-f]{16}$/);
  // Someone else's game waiting for them is theirs to carry on with, not yours.
  const hers = arcade.start(grace);
  tick(2000);
  assert.equal(arcade.frame(hers, frame({ pieces: 5, score: 100 }), 'f1'), 'ok');
  arcade.leave(hers, 'f1');
  assert.notEqual(arcade.start(ada, hers), hers);
  assert.equal(arcade.start({ ...ada, name: 'Grace' }, hers) === hers, false, 'going by her name is not being her');
  // Grace herself carries on where she left off.
  assert.equal(arcade.start(grace, hers), hers);
  assert.equal(arcade.frame(hers, frame({ pieces: 6, score: 120 }), 'f1'), 'ok');
  // Inventing games to fill the table: each one starts from nothing, so none of them is on it.
  for (let i = 0; i < 30; i++) {
    const g = arcade.start(ada, `${i}`.padStart(16, 'f'));
    arcade.leave(g, 'f1');
  }
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top().map((s) => [s.name, s.score]),
    [['Grace', 100]],
  );
});

test('a game going faster than anyone plays is off the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  // More pieces at once than a burst of hard drops.
  const jump = arcade.start(ada);
  assert.equal(arcade.frame(jump, frame({ pieces: PIECE_BURST + 1, score: 40 }), 'f1'), 'void');
  // Quick but human: two pieces a second for a minute, three a second for a stretch in the middle of it.
  const quick = arcade.start(ada);
  for (let i = 1; i <= 125; i++) {
    tick(i > 50 && i <= 80 ? 333 : 500);
    assert.equal(arcade.frame(quick, frame({ pieces: i, score: i * 20 }), 'f1'), 'ok', `piece ${i}`);
  }
  arcade.leave(quick, 'f1');
  // A piece every 80 ms: through the burst in a second or two, and out.
  const fast = arcade.start(grace);
  let caught = 0;
  for (let i = 1; i <= 100 && !caught; i++) {
    tick(80);
    if (arcade.frame(fast, frame({ pieces: i, score: i * 20 }), 'f1') === 'void') caught = i;
  }
  assert.ok(caught > PIECE_BURST && caught < 20, `caught at piece ${caught}`);
  // Walking away doesn't save up time to spend in one go.
  const banked = arcade.start({ ...grace, owner: 'account:grace2' });
  tick(1000);
  assert.equal(arcade.frame(banked, frame({ pieces: 4, score: 80 }), 'f1'), 'ok');
  arcade.leave(banked, 'f1');
  tick(60 * 60_000);
  assert.equal(arcade.start({ ...grace, owner: 'account:grace2' }, banked), banked);
  assert.equal(arcade.frame(banked, frame({ pieces: 4 + PIECES_PER_SECOND * 60, score: 80 * 60 }), 'f1'), 'void');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top().map((s) => [s.game, s.score]),
    [
      [quick, 2500],
      [banked, 80],
    ],
  );
});

test("a burst of pieces is the player's, not each new game's", (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  /** From the console: a new game, and one frame that lands a whole burst of pieces for all they could score, and ends it. */
  const burst = (p: Player) => arcade.frame(arcade.start(p), frame({ pieces: PIECE_BURST, lines: 4, score: DROP_POINTS * (PIECE_BURST + 1) + 800, state: 'over' }), 'f1');
  // Ten times over in a millisecond: the first is a (very) good game, and the rest come too soon after it.
  assert.deepEqual(
    Array.from({ length: 10 }, () => burst(ada)),
    ['ok', ...new Array(9).fill('void')],
  );
  // Nor does another connection signed in as the same person get a burst of its own, or a new name on the same connection.
  assert.equal(burst({ ...grace, connection: 'c1' }), 'ok');
  assert.equal(burst({ ...grace, connection: 'c2' }), 'void');
  assert.equal(burst({ owner: 'name:Eve', name: 'Eve', color: '#4f86f7', connection: 'c3' }), 'ok');
  assert.equal(burst({ owner: 'name:Mallory', name: 'Mallory', color: '#4f86f7', connection: 'c3' }), 'void');
  // Once it has come back, another burst: that's playing fast, not replaying.
  tick((PIECE_BURST / PIECES_PER_SECOND) * 1000);
  assert.equal(burst({ ...grace, connection: 'c2' }), 'ok');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top().map((s) => s.name),
    ['Ada', 'Grace', 'Eve', 'Grace'],
  );
});

test('new games started one after another stop going on the table, until they slow down', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  /** A new game for Ada, over after a piece: says whether it goes on the table. */
  const quickGame = () => {
    const id = arcade.start(ada);
    const counts = arcade.counts(id);
    tick(500);
    assert.equal(arcade.frame(id, frame({ pieces: 1, score: 30, state: 'over' }), 'f1'), 'ok');
    return counts;
  };
  assert.deepEqual(
    Array.from({ length: GAME_BURST + 2 }, quickGame),
    [...new Array(GAME_BURST).fill(true), false, false],
  );
  tick(GAME_EVERY);
  assert.equal(quickGame(), true);
  // Coming back to a game that's waiting for you isn't starting a new one.
  const waiting = arcade.start(grace);
  for (let i = 0; i < 20; i++) {
    arcade.leave(waiting, 'f1');
    assert.equal(arcade.start(grace, waiting), waiting);
  }
  assert.equal(arcade.counts(waiting), true);
  tick(RECORD_EVERY);
  assert.equal(table.top().length, GAME_BURST + 1);
});

test('made-up frames at the fastest pace allowed score what flawless play at that pace could, and no more', (t) => {
  const { arcade, tick } = arcadeFor(t);
  // What lines score: each landing's clear at the level it was on, the best way they could have gone.
  assert.equal(clearPoints(0, 4, 1), 800);
  assert.equal(clearPoints(0, 4, 4), 800);
  assert.equal(clearPoints(9, 5, 2), 100 + 2 * 800, 'a single that takes it to level 2, then four lines there');
  assert.equal(clearPoints(0, 5, 1), -Infinity);
  // Every piece as soon as it's allowed, every line those pieces could fill (four at once), and
  // every point they could score doing it: flawless, at PIECES_PER_SECOND.
  const id = arcade.start(ada);
  let f = frame();
  let cleared = 0;
  const land = (pieces: number) => {
    const lines = 4 * Math.floor(pieces / 10);
    cleared += clearPoints(f.lines, lines - f.lines, pieces - f.pieces);
    f = frame({ pieces, lines, level: levelFor(lines), score: DROP_POINTS * (pieces + 1) + cleared });
    assert.equal(arcade.frame(id, f, 'f1'), 'ok', `${pieces} pieces`);
  };
  land(PIECE_BURST);
  const byMinute: number[] = [];
  for (let n = 1; n <= 10 * 60 * PIECES_PER_SECOND; n++) {
    tick(1000 / PIECES_PER_SECOND);
    land(f.pieces + 1);
    if (n % (60 * PIECES_PER_SECOND) === 0) byMinute.push(f.score);
  }
  // A point more is more than those pieces could have scored.
  assert.equal(arcade.frame(id, { ...f, score: f.score + 1 }, 'f1'), 'void');
  // It used to be 264,000 after a minute and 19 million after ten.
  assert.ok(byMinute[0] < 60_000, `${byMinute[0]} after a minute`);
  assert.ok(byMinute[9] < 4_000_000, `${byMinute[9]} after ten minutes`);
});

test('back at a game the office lost in a restart, the browser starts a fresh one, and that one counts', (t) => {
  const { arcade, dir, tick } = arcadeFor(t);
  t.mock.method(Math, 'random', seeded(7));
  // Ada plays a while and steps away: her game waits for her, in her browser and at the office.
  const old = new Blocks();
  old.id = arcade.start(ada);
  for (let n = 0; n < 12; n++) {
    aim(old);
    old.hardDrop();
    tick(500);
    assert.equal(arcade.frame(old.id, old.frame(), 'f1'), 'ok');
  }
  arcade.leave(old.id, 'f1');
  // Back at it before a restart, she carries on with it.
  assert.equal(lostGame(old.id, arcade.start(ada, old.id)), false);
  arcade.leave(old.id, 'f1');
  tick(RECORD_EVERY);
  // The office restarts: its high scores are still there, the games it was following aren't.
  const table = new HighScores(dir);
  const after = new Arcade(table, () => {});
  const id = after.start(ada, old.id);
  assert.notEqual(id, old.id);
  // Her browser sees the office started her a new game instead: it can't follow the old one on from
  // where it was, so a fresh game goes with it.
  assert.equal(lostGame(old.id, id), true);
  assert.equal(after.frame(after.start(ada, old.id), old.frame(), 'f1'), 'void', 'the old game, carried on under the new id');
  const fresh = new Blocks();
  fresh.id = id;
  for (let n = 0; n < 12; n++) {
    aim(fresh);
    fresh.hardDrop();
    tick(500);
    assert.equal(after.frame(id, fresh.frame(), 'f1'), 'ok');
  }
  after.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table
      .top()
      .map((s) => [s.game, s.score])
      .sort(),
    [
      [old.id, old.score],
      [id, fresh.score],
    ].sort(),
  );
  // Asking for a new game, whichever the office names is it: even an old one's, still on its way.
  assert.equal(lostGame('', old.id), false);
});

test('a flood of scores changes the table at most every RECORD_EVERY ms, and the last one still lands', (t) => {
  const { arcade, table, news, record, tick } = arcadeFor(t);
  const id = arcade.start(ada);
  tick(3000);
  assert.equal(arcade.frame(id, frame({ pieces: PIECE_BURST }), 'f1'), 'ok');
  // Walking away and back 200 times in a second, a point better each time.
  for (let i = 1; i <= 200; i++) {
    assert.equal(arcade.frame(id, frame({ pieces: PIECE_BURST, score: i }), 'f1'), 'ok');
    arcade.leave(id, 'f1');
    assert.equal(arcade.start(ada, id), id);
    tick(5);
  }
  // The first straight away, then everything since in one go once RECORD_EVERY is up.
  assert.equal(record.mock.callCount(), 1);
  assert.equal(table.top()[0].score, 1);
  tick(RECORD_EVERY);
  assert.equal(record.mock.callCount(), 2);
  assert.equal(table.top()[0].score, 200);
  assert.equal(news.length, 2);
  // Games ending on three floors at once: one change to the table, and one leader.
  const games = [arcade.start(grace), arcade.start({ ...ada, owner: 'name:Linus', name: 'Linus' }), arcade.start({ ...ada, owner: 'name:Ken', name: 'Ken' })];
  tick(5000);
  games.forEach((g, i) => assert.equal(arcade.frame(g, frame({ pieces: 5, score: 250 + i * 10, state: 'over' }), `f${i + 1}`), 'ok'));
  tick(1);
  assert.equal(record.mock.callCount(), 3);
  assert.deepEqual(news.at(-1), { game: games[2], floor: 'f3' });
  assert.deepEqual(
    table.top().map((s) => [s.name, s.score]),
    [
      ['Ken', 270],
      ['Linus', 260],
      ['Grace', 250],
      ['Ada', 200],
    ],
  );
  // A flood of frames on their own doesn't touch the table at all.
  const more = arcade.start(ada);
  for (let i = 0; i < 1000; i++) arcade.frame(more, frame({ pieces: 1, score: 10 }), 'f1');
  tick(RECORD_EVERY * 2);
  assert.equal(record.mock.callCount(), 3);
});

test('whatever is waiting for the table is saved when the office shuts down', (t) => {
  const { arcade, dir, tick } = arcadeFor(t);
  const first = arcade.start(ada);
  tick(1000);
  arcade.frame(first, frame({ pieces: 2, score: 40 }), 'f1');
  arcade.leave(first, 'f1');
  tick(1);
  const second = arcade.start(grace);
  tick(1000);
  arcade.frame(second, frame({ pieces: 3, score: 60 }), 'f1');
  arcade.leave(second, 'f1');
  arcade.flush();
  assert.deepEqual(
    new HighScores(dir).top().map((s) => [s.name, s.score]),
    [
      ['Grace', 60],
      ['Ada', 40],
    ],
  );
});
