import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_AUDIO_REF, ROOM_AUDIO_ROLLOFF, roomDistanceGain, roomMediaGain } from '../src/client/spatial-audio';

test('room audio stays full strength throughout its near field', () => {
  assert.equal(roomDistanceGain(0), 1);
  assert.equal(roomDistanceGain(ROOM_AUDIO_REF), 1);
});

test('HTML media follows the same inverse-distance curve as the jukebox panner', () => {
  const distance = 12;
  const pannerCurve = ROOM_AUDIO_REF / (ROOM_AUDIO_REF + ROOM_AUDIO_ROLLOFF * (distance - ROOM_AUDIO_REF));
  assert.equal(roomDistanceGain(distance), pannerCurve);
  assert.ok(roomDistanceGain(24) < roomDistanceGain(distance));
});

test('room media uses the jukebox slider curve before distance attenuation', () => {
  assert.equal(roomMediaGain(0.5, ROOM_AUDIO_REF), 0.25);
  assert.equal(roomMediaGain(1, 12), roomDistanceGain(12));
  assert.equal(roomMediaGain(0, 12), 0);
});

test('room media is silent when its room is not present', () => {
  assert.equal(roomMediaGain(1, ROOM_AUDIO_REF, false), 0);
});
