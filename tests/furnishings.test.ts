import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FurnishingsStore } from '../src/server/furnishings.js';
import { FURNISH_SLOTS, FURNISH_SLOT_IDS, defaultFurnishings, sanitizeFurnishings } from '../src/shared/furnishings.js';

test('every slot starts on its first look, and every look has a name and an id of its own', () => {
  const start = defaultFurnishings();
  for (const slot of FURNISH_SLOT_IDS) {
    const ids = FURNISH_SLOTS[slot].variants.map((v) => v.id);
    assert.equal(start[slot], ids[0]);
    assert.equal(new Set(ids).size, ids.length, `${slot} has two looks of the same id`);
  }
});

test('furnishings from a file or the wire come out whole, with only looks the wardrobe has', () => {
  assert.deepEqual(sanitizeFurnishings(null), defaultFurnishings());
  assert.deepEqual(sanitizeFurnishings({ plants: 'ficus', rugs: 'tartan', lamps: 7, extra: 'x' }), { ...defaultFurnishings(), plants: 'ficus' });
});

test('a floor keeps the looks swapped at its wardrobe, across a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'furnish-'));
  try {
    const store = new FurnishingsStore(dir);
    assert.deepEqual(store.get(), defaultFurnishings());
    assert.equal(store.set('plants', 'cactus'), "The wardrobe doesn't have that");
    assert.equal(store.set('ceiling', 'cone'), "The wardrobe doesn't have that");
    assert.deepEqual(store.set('lamps', 'disco'), FURNISH_SLOTS.lamps.variants.find((v) => v.id === 'disco'));
    // The same look again changes nothing.
    assert.equal(store.set('lamps', 'disco'), null);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'furnishings.json'), 'utf8')).lamps, 'disco');
    assert.equal(new FurnishingsStore(dir).get().lamps, 'disco');
    // A broken file is the office as it always was.
    writeFileSync(path.join(dir, 'furnishings.json'), '{nope');
    assert.deepEqual(new FurnishingsStore(dir).get(), defaultFurnishings());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
