import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicalChairs, type Cast } from '../src/server/chairs.js';
import { EXIT, GATHER_LINE, MIN_PLAYERS, NO_CHAIRS, RING, TIMING, caption, chairAt, inGame, musicMs, musicOn, outLine, playing, ringRadius, ringSpot, seated, statusLine, stranded, type ChairsState } from '../src/shared/chairs.js';
import { BEANBAGS, DESKS, DESK_SIZE, FLOOR, MEETING_ROOM, PLANTS, POLES, STAIRS, WHITEBOARD } from '../src/shared/layout.js';
import { chairFrame, CHAIR_BPM } from '../src/client/chairstune.js';
import { phones, speechTime } from '../src/client/pa.js';

// Musical chairs: the rules the office plays a game by (shared/chairs.ts), the game itself, played out
// here in milliseconds (server/chairs.ts), the tune the workers dance to (client/chairstune.ts) and the
// voice that calls it (client/pa.ts).

/** `n` workers to play with, named in the order they were hired. */
function cast(n: number): Cast[] {
  return Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, name: `Worker ${i + 1}`, color: '#4f86f7' }));
}

/** A game with the timings turned down, so a whole one runs in a few hundred milliseconds. */
function game(n: number, timing: Partial<typeof TIMING> = {}) {
  const players = cast(n);
  const seen: ChairsState[] = [];
  const chairs = new MusicalChairs(() => players, (state) => seen.push(state), { gather: 10, music: 20, musicFloor: 20, musicStep: 0, scramble: 10, react: 10, over: 20, ...timing });
  return { chairs, players, seen };
}

/** Waits for the game to reach `phase`, or gives up and says where it got to. */
async function until(t: { chairs: MusicalChairs }, phase: ChairsState['phase'], within = 4000) {
  const start = Date.now();
  for (;;) {
    const s = t.chairs.state();
    if (s.phase === phase) return s;
    assert.ok(Date.now() - start < within, `still ${s.phase} after ${within}ms, waiting for ${phase}`);
    await new Promise((r) => setTimeout(r, 4));
  }
}

// ---- Where the ring stands ---------------------------------------------------------------------------

test('the ring stands on the open floor, out of the way of everything round it', () => {
  // The whole ring, and the ring of workers dancing round it, has to fit inside the room with the
  // furniture left over: the desks, the stairs, the plant by the meeting room's glass, the whiteboard.
  const biggest = RING.most;
  const dance = ringRadius(biggest) + 1.1;
  assert.ok(RING.x - dance > FLOOR.minX && RING.x + dance < FLOOR.maxX);
  assert.ok(RING.z - dance > FLOOR.minZ && RING.z + dance < FLOOR.maxZ);
  const clear = (x: number, z: number, r: number, what: string) => assert.ok(Math.hypot(RING.x - x, RING.z - z) > dance + r, `${what} is in the dance circle`);
  for (const [x, z, s] of PLANTS) clear(x, z, 0.3 * s, 'a plant');
  for (const p of POLES) clear(p.x, p.z, 0.9, 'the fire pole');
  clear(WHITEBOARD.x, WHITEBOARD.z, Math.max(WHITEBOARD.width, WHITEBOARD.height) / 2, 'the whiteboard');
  // The desks and the bean bags: the nearest corner of each, so a ring of ten never lands on one.
  for (const d of [...DESKS, ...BEANBAGS]) {
    const dx = Math.max(0, Math.abs(d.x - RING.x) - (d.beanbag ? 0.5 : DESK_SIZE.width / 2));
    const dz = Math.max(0, Math.abs(d.z - RING.z) - (d.beanbag ? 0.5 : DESK_SIZE.depth / 2));
    assert.ok(Math.hypot(dx, dz) > dance, `${d.id} is in the dance circle`);
  }
  // The stairs run along the south wall from x STAIRS.fromX, and the meeting room's glass is east of the loft.
  assert.ok(RING.z + dance < STAIRS.minZ, 'the ring runs into the stairs');
  assert.ok(RING.x + dance < MEETING_ROOM.minX, 'the ring runs into the meeting room');
});

test('there is a walk between any two chairs, and they all face out of the ring', () => {
  for (const count of [1, 2, 5, 9, RING.most]) {
    const r = ringRadius(count);
    assert.ok(count === 1 || (2 * Math.PI * r) / count > 1, `${count} chairs are too close together`);
    for (let i = 0; i < count; i++) {
      const c = chairAt(i, count);
      assert.ok(Math.abs(Math.hypot(c.x - RING.x, c.z - RING.z) - r) < 1e-9);
      // Its back is to the middle of the ring, so whoever sits on it faces out of it.
      const out = { x: Math.sin(c.rotY), z: Math.cos(c.rotY) };
      assert.ok(out.x * (c.x - RING.x) + out.z * (c.z - RING.z) > 0);
    }
  }
});

test('the workers dance out past the chairs, facing back in at them', () => {
  const spot = ringSpot(2, 5, 4);
  assert.ok(Math.hypot(spot.x - RING.x, spot.z - RING.z) > ringRadius(4));
  // Looking the way it's told to means looking at the middle of the ring.
  assert.ok(Math.sin(spot.rotY) * (RING.x - spot.x) + Math.cos(spot.rotY) * (RING.z - spot.z) > 0);
});

test('the worker left out goes where the chairs were stacked: out of the circle, in the room', () => {
  assert.ok(EXIT.x > FLOOR.minX && EXIT.x < FLOOR.maxX && EXIT.z > FLOOR.minZ && EXIT.z < FLOOR.maxZ, 'the spot is inside the office');
  assert.ok(Math.hypot(EXIT.x - RING.x, EXIT.z - RING.z) > ringRadius(RING.most) + 1.1, 'the spot is out in the dance circle');
});

// ---- What everyone is told ----------------------------------------------------------------------------

test('the announcement is read out word for word, and the words are there to read', () => {
  assert.equal(GATHER_LINE, 'Attention everyone! The musical chairs game is starting! Everyone, please gather in the living room and get ready to play!');
  const state: ChairsState = { ...NO_CHAIRS, phase: 'gathering', players: cast(3).map((p) => ({ ...p, chair: null })) };
  assert.equal(caption(state), GATHER_LINE);
  assert.match(statusLine(state), /gathering/);
});

test('each phase has something to say, and the one left out is told why', () => {
  const three = cast(3).map((p, i) => ({ ...p, chair: i < 2 ? i : null, outIn: i === 2 ? 2 : undefined }));
  const base: ChairsState = { ...NO_CHAIRS, round: 2, chairs: 2, players: three, startedAt: 1, phaseAt: 2 };
  assert.equal(caption({ ...base, phase: 'music' }), 'Round 2! Music on — dance while you can!');
  assert.equal(caption({ ...base, phase: 'scramble' }), 'Music off! Grab a chair!');
  assert.equal(caption({ ...base, phase: 'react' }), outLine(three[2]));
  assert.equal(caption({ ...base, phase: 'over', winner: 'w1' }), 'Worker 1 wins musical chairs!');
  // The same worker is given the same line on every page, whoever's asking.
  assert.equal(outLine(three[2]), outLine({ ...three[2] }));
  assert.equal(statusLine({ ...base, phase: 'music' }), '🪑 round 2 · 2 chairs · music on');
  assert.equal(caption(NO_CHAIRS), '');
});

test('the PA turns the announcement into speech, and says it in a sensible time', () => {
  const said = phones(GATHER_LINE);
  assert.ok(said.length > 60, `only ${said.length} sounds in the announcement`);
  // Every sound has a voice, a hiss or a gap, and lasts something you could hold.
  for (const p of said) assert.ok(p.len > 0.01 && p.len < 0.3, `a sound lasting ${p.len}s`);
  const seconds = speechTime(GATHER_LINE);
  assert.ok(seconds > 3 && seconds < TIMING.gather / 1000, `the announcement takes ${seconds}s, and gathering is ${TIMING.gather / 1000}s`);
  // Figures are said as words, and punctuation is never read out.
  assert.ok(phones('3 chairs')[0].len > 0);
  assert.equal(phones('Chair!').length, phones('Chair').length);
});

// ---- The tune -----------------------------------------------------------------------------------------

test('the tune is in time, and its beat and claps go by the same patterns it plays', () => {
  const beat = 60 / CHAIR_BPM;
  const bar = beat * 4;
  // A beat falls from 1 to 0 over itself, whatever it's in the middle of.
  for (let i = 0; i < 20; i++) {
    const at = i * 0.31;
    const f = chairFrame(at);
    assert.ok(f.beat >= 0 && f.beat <= 1);
    if (Math.abs((at % beat) - 0) < 0.01) assert.ok(f.beat > 0.9, `no beat on the beat at ${at}s`);
  }
  // The kick lands on the first beat of a bar and the claps on two and four, and both fall off after.
  assert.ok(chairFrame(0).kick > 0.9);
  assert.ok(chairFrame(0.5 * beat).kick < chairFrame(0).kick);
  assert.ok(chairFrame(beat).clap > 0.9, 'no clap on two');
  assert.ok(chairFrame(3 * beat).clap > 0.9, 'no clap on four');
  assert.ok(chairFrame(0.1).clap < 0.2);
  // Eight bars of it, and it comes round again, building into the top of each eight.
  assert.equal(chairFrame(0).bar, 0);
  assert.equal(chairFrame(7 * bar + 1).bar, 7);
  assert.ok(chairFrame(7 * bar + 1).rise > chairFrame(7 * bar).rise);
  assert.equal(chairFrame(8 * bar).bar, 0);
  assert.equal(chairFrame(8 * bar).rise, 0);
});

// ---- The game -----------------------------------------------------------------------------------------

test('a game needs workers, and one already on can’t be started again', () => {
  const { chairs } = game(1);
  assert.deepEqual(chairs.start('someone'), { error: `Musical chairs needs ${MIN_PLAYERS} workers on this floor` });
  assert.equal(chairs.playing(), false);
  const more = game(3);
  assert.deepEqual(more.chairs.start('someone'), { ok: true });
  assert.equal(more.chairs.playing(), true);
  assert.match(more.chairs.start('someone').error ?? '', /already on/);
  more.chairs.stop();
  assert.deepEqual(more.chairs.state(), NO_CHAIRS);
});

test('every worker plays, there’s a chair fewer than players, and one is out each round', async () => {
  const t = game(4);
  t.chairs.start('Ada');
  const gathering = t.chairs.state();
  assert.equal(gathering.phase, 'gathering');
  assert.equal(gathering.players.length, 4, 'every worker on the floor plays');
  assert.equal(gathering.chairs, 0, 'the chairs come out when the music does');
  assert.equal(musicOn(gathering), true, 'the music plays while they gather');

  const music = await until(t, 'music');
  assert.equal(music.round, 1);
  assert.equal(music.chairs, 3);
  assert.equal(seated(music).length, 3, 'three of the four get a chair');
  assert.equal(musicOn(music), true);
  // Each of the three that got one got a chair of its own, and there's one worker left out.
  const got = seated(music);
  assert.equal(new Set(got.map((p) => p.chair)).size, 3);
  for (const p of got) assert.ok((p.chair ?? -1) >= 0 && (p.chair ?? 9) < music.chairs);
  const out = music.players.filter((p) => p.outIn !== undefined);
  assert.equal(out.length, 1);
  assert.equal(out[0].chair, null, 'the one with no chair is out');
  assert.ok(got.every((p) => p.id !== out[0].id));
});

test('the music stops dead, the round resolves, and the last one standing wins', async () => {
  const t = game(4);
  t.chairs.start('Ada');
  await until(t, 'scramble');
  assert.equal(musicOn(t.chairs.state()), false, 'the music stops the moment the rush starts');
  const react = await until(t, 'react');
  assert.ok(stranded(react), 'somebody is left without a chair');

  await until(t, 'over');
  const over = t.chairs.state();
  assert.equal(over.chairs, 1, 'the winner’s chair is the one left out');
  assert.equal(inGame(over).length, 1);
  assert.equal(over.players.find((p) => p.id === over.winner)?.chair, 0);
  assert.equal(musicOn(over), false);

  // …and then the chairs go back against the wall.
  await until(t, 'idle');
  assert.deepEqual(t.chairs.state(), NO_CHAIRS);
});

test('a whole game plays out: one worker out a round, until there’s a winner', async () => {
  const t = game(5);
  t.chairs.start('Ada');
  const rounds: ChairsState[] = [];
  for (let i = 0; i < 60 && t.chairs.state().phase !== 'idle'; i++) {
    const s = t.chairs.state();
    if (s.phase === 'music' && rounds.at(-1)?.round !== s.round) rounds.push(s);
    await new Promise((r) => setTimeout(r, 5));
  }
  // Four rounds of five: a chair fewer each time, and a different worker out each round.
  assert.deepEqual(
    rounds.map((r) => r.chairs),
    [4, 3, 2, 1],
  );
  assert.deepEqual(
    rounds.map((r) => r.round),
    [1, 2, 3, 4],
  );
  const outIn = rounds.map((r) => stranded(r)?.id);
  assert.equal(new Set(outIn).size, 4, 'nobody is out twice');
  assert.equal(t.chairs.state().phase, 'idle', 'the game clears itself up when it’s over');
  assert.deepEqual(t.seen[t.seen.length - 1], NO_CHAIRS);
});

test('the rounds are announced, and each one is on the office’s clock', async () => {
  const t = game(3, { gather: 20 });
  const before = Date.now();
  t.chairs.start('Ada');
  const music = await until(t, 'music');
  assert.ok(music.startedAt >= before && music.startedAt <= Date.now());
  assert.ok(music.phaseAt >= music.startedAt && music.phaseAt <= Date.now(), 'the phase is stamped for everyone to time the music by');
  await until(t, 'scramble');
  // Every page is told each part of it, and each is stamped as it happens.
  assert.deepEqual(
    t.seen.map((x) => x.phase).slice(0, 3),
    ['gathering', 'music', 'scramble'],
  );
  for (const seen of t.seen) assert.ok(seen.phaseAt >= seen.startedAt);
  t.chairs.stop();
});

test('a worker sent home mid-game is out of the ring, and the game carries on', async () => {
  const t = game(5, { music: 30, musicFloor: 30, musicStep: 0 });
  t.chairs.start('Ada');
  await until(t, 'music');
  // One of the five is killed mid-round: the next round is played without it, and with a chair fewer.
  t.players.splice(1, 1);
  const start = Date.now();
  while (t.chairs.state().round < 2) {
    assert.ok(Date.now() - start < 4000, `still on round ${t.chairs.state().round}`);
    await new Promise((r) => setTimeout(r, 4));
  }
  const s = t.chairs.state();
  assert.equal(s.phase, 'music');
  assert.ok(!s.players.some((p) => p.id === 'w2'), 'the worker that went home is out of the ring');
  assert.equal(s.players.length, 4);
  // One chair each for everyone left in the ring, and one of them is about to miss out.
  assert.equal(s.chairs, s.players.filter((p) => p.outIn === undefined).length);
  t.chairs.stop();
  assert.equal(playing(t.chairs.state()), false);
});

test('the music of each round is shorter than the last, and never shorter than the floor', () => {
  assert.equal(musicMs(1), TIMING.music);
  assert.equal(musicMs(2), TIMING.music - TIMING.musicStep);
  assert.equal(musicMs(9), TIMING.musicFloor);
  assert.equal(musicMs(30), TIMING.musicFloor, 'the last rounds keep dancing a while');
  assert.ok(TIMING.musicFloor > TIMING.scramble, 'there’s music to dance to');
});
