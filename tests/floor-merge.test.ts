import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import type { FloorDef } from '../src/server/building.js';

/**
 * A plugin that provides its own floors (an OpenFox project per floor, say) adds to the building:
 * the floors the office already has, and the ones people added themselves, stay where they are.
 * Merging is what the plugin's list means: "these are mine", not "these are all there are".
 */

function def(id: string, dir: string, extra: Partial<FloorDef> = {}): FloorDef {
  return { id, name: id, repo: id, dir, palette: 0, addedBy: 'plugin', addedAt: 1, ...extra };
}

test("a plugin's floors are merged into the building, not swapped for it", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'floors-merge-'));
  try {
    const building = new Building(dataDir, '/');
    // The office's own floors: one a project folder on disk, one a clone of a repository.
    building.addExisting('/disk/web', 'web', 'the office');
    building.addExisting('/disk/api', 'api', 'the office');
    const before = building.list().map((d) => d.id);
    assert.equal(before.length, 2);

    // The plugin's list, as it comes back from listFloors(): its own projects only.
    building.mergeList([def('openfox-a', '/disk/web'), def('openfox-b', '/home/me/b')]);
    const after = building.list().map((d) => d.id);
    // Both of the office's own floors are still there...
    assert.ok(after.includes(building.list().find((d) => d.dir === '/disk/web')!.id), 'the project folder floor stays');
    assert.ok(after.includes(building.list().find((d) => d.dir === '/disk/api')!.id), 'the repository floor stays');
    // ...and the plugin's new one arrived.
    assert.ok(after.includes('openfox-b'), "the plugin's own floor arrives");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a floor the office already has, under another name, is not duplicated", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'floors-dup-'));
  try {
    const building = new Building(dataDir, '/');
    const added = building.addExisting('/disk/web', 'web', 'the office');
    assert.equal(typeof added, 'object');
    const own = (added as FloorDef).id;
    building.mergeList([def('openfox-web', '/disk/web')]);
    // Same checkout as a floor the building already has: it is not added a second time.
    assert.equal(building.list().filter((d) => path.resolve(d.dir) === path.resolve('/disk/web')).length, 1);
    assert.equal(building.list()[0]!.id, own, 'the floor it already had keeps its identity');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a plugin's floor that was there and is gone from its list is taken off", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'floors-gone-'));
  try {
    const building = new Building(dataDir, '/');
    building.mergeList([def('openfox-a', '/p/a'), def('openfox-b', '/p/b')]);
    assert.equal(building.list().length, 2);
    building.mergeList([def('openfox-a', '/p/a')]);
    assert.deepEqual(building.list().map((d) => d.id), ['openfox-a'], 'the one it no longer lists goes');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a floor the office added itself is never taken off by a plugin's list", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'floors-theirs-'));
  try {
    const building = new Building(dataDir, '/');
    building.addExisting('/disk/api', 'api', 'the office');
    // The plugin lists several of its own; the office's floor is in none of them.
    building.mergeList([def('openfox-a', '/p/a')]);
    const stillThere = building.list().some((d) => path.resolve(d.dir) === path.resolve('/disk/api'));
    assert.ok(stillThere, 'a floor nobody but the office added stays');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
