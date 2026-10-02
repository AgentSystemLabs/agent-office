import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Dog, type DogEnv } from '../src/server/dog.js';
import { dogDefaults } from '../src/shared/dog.js';

const env: DogEnv = { workers: () => [], people: () => [], send: () => {} };

test("a floor's dog is the breed and coat someone picked, and stays so after a restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dog-breed-'));
  const dog = new Dog('floor-a', dir, env);
  assert.equal(dog.view().breed, dogDefaults('floor-a').breed);
  const other = dogDefaults('floor-a').breed === 'shiba' ? 'pug' : 'shiba';
  assert.equal(dog.setBreed(other), other);
  assert.equal(dog.setBreed('wolf'), undefined);
  assert.equal(dog.setCoat(6), true);
  assert.equal(dog.setCoat(99), false);
  dog.rename('Pipoca');
  dog.stop();
  const again = new Dog('floor-a', dir, env);
  assert.equal(again.view().breed, other);
  assert.equal(again.view().name, 'Pipoca');
  assert.equal(again.view().coat, 6);
  again.stop();
});
