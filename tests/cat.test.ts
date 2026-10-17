import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Dog, type DogEnv } from '../src/server/dog.js';
import { DOG_BREEDS, dogBreed, dogDefaults, petEmoji } from '../src/shared/dog.js';
import { voiceOf, type DogSounds } from '../src/client/features/dog/voice.js';

// The cat: a breed as far as the rig, the clips and the server go (dog-model.test.ts checks its model with
// the dogs'), with its own voice on the page.

const env: DogEnv = { workers: () => [], people: () => [], send: () => {} };

/** Sounds that only write down what was played. */
function heard() {
  const played: string[] = [];
  const sounds: DogSounds = {
    bark: (_x, _z, n) => played.push(`bark ${n}`),
    yip: () => played.push('yip'),
    meow: (_x, _z, n) => played.push(`meow ${n}`),
    purr: () => played.push('purr'),
  };
  return { played, sounds };
}

test('the cat can be picked for any floor, but no floor is dealt one', () => {
  assert.ok(DOG_BREEDS.includes('cat'));
  assert.equal(dogBreed('cat'), 'cat');
  for (let i = 0; i < 200; i++) assert.notEqual(dogDefaults(`floor-${i}`).breed, 'cat');
  const dir = mkdtempSync(path.join(tmpdir(), 'cat-'));
  const dog = new Dog('floor-a', dir, env);
  assert.equal(dog.setBreed('cat'), 'cat');
  dog.stop();
  const again = new Dog('floor-a', dir, env);
  assert.equal(again.view().breed, 'cat', 'still a cat after a restart');
  again.stop();
});

test('the cat meows and purrs, and a dog barks and yips', () => {
  const cat = heard();
  voiceOf('cat').call(cat.sounds, 0, 0, 3);
  voiceOf('cat').petted(cat.sounds, 0, 0);
  assert.deepEqual(cat.played, ['meow 2', 'purr']);
  const dog = heard();
  voiceOf('pug').call(dog.sounds, 0, 0, 3);
  voiceOf('pug').petted(dog.sounds, 0, 0);
  assert.deepEqual(dog.played, ['bark 3', 'yip']);
});

test("the cat doesn't pant, half-shuts its eyes when petted, and says what a cat does", () => {
  const cat = voiceOf('cat');
  assert.equal(cat.pants, false);
  assert.ok(cat.pettedEyes < 0.5);
  assert.ok(cat.calls.every((c) => c.startsWith('Meow')));
  assert.equal(petEmoji('cat'), '🐱');
  assert.equal(cat.doing('bark', false, 'Ada'), 'meowing at Ada: needs input');
  assert.equal(cat.doing('wag', false, 'Ada', 'Bo'), 'purring at Bo');
  assert.equal(voiceOf('pup').doing('bark', false, 'Ada'), 'barking at Ada: needs input');
  assert.equal(petEmoji('corgi'), '🐶');
});
