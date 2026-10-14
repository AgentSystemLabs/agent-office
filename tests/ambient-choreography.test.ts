import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST } from '../src/client/features/ambient-office/cast.js';
import { SCENES } from '../src/client/features/ambient-office/scenes.js';
import { MANNER, perform, TALK_AT, BEAT_MS, RESPONSE_AT } from '../src/client/features/ambient-office/choreography.js';
import { DAY_MS, SLOT_MS, sampleOffice } from '../src/client/features/ambient-office/simulation.js';
import { GesturePlayer } from '../src/client/features/ambient-office/performance.js';
import { EMOTE_BY_ID } from '../src/shared/emotes.js';
import type { Person } from '../src/client/world/character/person.js';

test('every coworker has an executable speaking and reaction manner', () => {
  assert.deepEqual(Object.keys(MANNER).sort(), CAST.map(p => p.id).sort());
  for (const p of CAST) {
    assert.ok(EMOTE_BY_ID.has(MANNER[p.id].speaks));
    assert.ok(MANNER[p.id].responds === null || EMOTE_BY_ID.has(MANNER[p.id].responds!));
  }
  assert.notEqual(MANNER.jim.responds, MANNER.dwight.responds);
  assert.equal(MANNER.stanley.responds, null);
});

test('all exchanges gather, speak, react, perform together and settle in a shared order', () => {
  for (const scene of SCENES) {
    assert.equal(perform(scene, 10000, 1).stage, 'gather');
    for (let beat = 0; beat < scene.beats.length; beat++) {
      const at = TALK_AT + beat * BEAT_MS;
      const speak = perform(scene, at + 500, 1);
      assert.equal(speak.speaker, scene.beats[beat].who);
      assert.equal(speak.stage, 'dialogue');
      assert.equal(speak.cues[speak.speaker!].age, 0.5);
      assert.notEqual(speak.listener, speak.speaker);
      const reply = perform(scene, at + RESPONSE_AT + 500, 1);
      assert.equal(reply.stage, 'reaction');
      assert.ok(!reply.cues[reply.speaker!]);
      for (const who of Object.keys(reply.cues)) assert.equal(who, reply.listener);
    }
    const end = TALK_AT + scene.beats.length * BEAT_MS;
    assert.equal(perform(scene, end + 500, 1).stage, 'ensemble');
    assert.deepEqual(perform(scene, end + 500, 1), perform(scene, end + 500, 1));
    assert.equal(perform(scene, end + 8000, 1).stage, 'settle');
    assert.deepEqual(perform(scene, end + 8000, 1).cues, {});
  }
});

test('relationship replies and ensemble moments preserve individual personalities', () => {
  const prank = SCENES.find(s => s.id === 'paperclips')!;
  assert.equal(perform(prank, TALK_AT + RESPONSE_AT + 200, 2).cues.jim.emote, 'facepalm');
  assert.equal(perform(prank, TALK_AT + BEAT_MS + RESPONSE_AT + 200, 2).cues.dwight.emote, 'point');
  const briefing = SCENES.find(s => s.id === 'meeting')!;
  const end = TALK_AT + briefing.beats.length * BEAT_MS;
  assert.ok(!perform(briefing, end + 500, 2).cues.stanley);
  const awards = SCENES.find(s => s.id === 'dundies')!;
  const group = perform(awards, TALK_AT + awards.beats.length * BEAT_MS + 500, 2);
  assert.equal(group.cues.michael.emote, 'wave');
  assert.equal(group.cues.pam.emote, 'clap');
  assert.equal(group.cues.dwight.age, group.cues.pam.age);
});

test('the snapshot separates speech from reactions and supplies partner attention', () => {
  const start = 20 * DAY_MS + 4 * SLOT_MS;
  const talking = sampleOffice(start + TALK_AT + 500, 'office');
  const speaking = talking.people.find(p => p.line)!;
  assert.ok(speaking.gesture && speaking.attention);
  const listener = talking.people.find(p => p.person.id === speaking.attention)!;
  assert.equal(listener.attention, speaking.person.id);
  const reply = sampleOffice(start + TALK_AT + RESPONSE_AT + 500, 'office');
  assert.equal(reply.people.filter(p => p.line).length, 0);
  assert.equal(reply.performance!.stage, 'reaction');
  assert.equal(sampleOffice(start + 95000, 'office').performance, undefined);
});

test('animation seeks on late joins, does not restart each frame, and cancels on interruption', () => {
  const starts: string[] = [], deltas: number[] = [];
  const person = { emote: (id: string) => starts.push(id), update: (dt: number) => deltas.push(dt) } as unknown as Person;
  const player = new GesturePlayer();
  player.update(person, { key: 'one', emote: 'clap', age: 1.1 }, 0.016, 0, false);
  player.update(person, { key: 'one', emote: 'clap', age: 1.3 }, 0.016, 0, false);
  assert.deepEqual(starts, ['clap']);
  assert.equal(deltas[0], 1.1);
  assert.ok(Math.abs(deltas[1] - 0.2) < 1e-10);
  player.update(person, undefined, 0.016, 0, true);
  assert.deepEqual(deltas.slice(-2), [5, 0.016]);
  player.update(person, { key: 'one', emote: 'clap', age: 1.8 }, 0.016, 0, false);
  assert.equal(starts.length, 2);
  assert.equal(deltas.at(-1), 1.8);
});
