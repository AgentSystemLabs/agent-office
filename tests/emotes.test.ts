import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, EMOTE_BURST, EMOTE_EVERY, EmoteBucket, isEmote } from '../src/shared/emotes.js';

test('the wheel has the six emotes from the issue, each with an emoji', () => {
  assert.deepEqual(
    EMOTES.map((e) => e.id),
    ['wave', 'thumbs', 'clap', 'dance', 'point', 'facepalm'],
  );
  for (const e of EMOTES) assert.ok(e.emoji && e.label && e.seconds > 0);
});

test('only known emotes get through', () => {
  assert.ok(isEmote('wave'));
  assert.ok(!isEmote('moonwalk'));
  assert.ok(!isEmote(1));
  assert.ok(!isEmote(undefined));
});

test('a burst of emotes, then one every EMOTE_EVERY ms', () => {
  const b = new EmoteBucket();
  const t0 = 1_000_000;
  for (let i = 0; i < EMOTE_BURST; i++) assert.ok(b.take(t0), `emote ${i + 1} of the burst`);
  assert.ok(!b.take(t0), 'one too many');
  assert.ok(!b.take(t0 + EMOTE_EVERY * 0.9), 'still too soon');
  assert.ok(b.take(t0 + EMOTE_EVERY), 'one more after a wait');
  assert.ok(!b.take(t0 + EMOTE_EVERY + 10));
});

test('mashing the keys never gets more through than the burst plus the refill', () => {
  const b = new EmoteBucket();
  let passed = 0;
  // Ten seconds of pressing an emote key every 50 ms.
  for (let t = 0; t <= 10_000; t += 50) if (b.take(1_000_000 + t)) passed++;
  assert.equal(passed, EMOTE_BURST + Math.floor(10_000 / EMOTE_EVERY));
});

test("the server's more lenient bucket lets through everything the page's does, even bunched up on the way", () => {
  const page = new EmoteBucket();
  const server = new EmoteBucket(EMOTE_EVERY * 0.8);
  // Sent as fast as the page allows for ten seconds. The opening burst is held up on the wire and
  // arrives late, all at once; the next one gets there straight away.
  let sent = 0;
  for (let t = 1_000_000; t <= 1_010_000; t += 50) {
    if (!page.take(t)) continue;
    const delay = sent++ < EMOTE_BURST ? 300 : 0;
    assert.ok(server.take(t + delay), `emote ${sent} sent at ${t} arrives at ${t + delay}`);
  }
  assert.ok(sent > EMOTE_BURST + 3);
});
