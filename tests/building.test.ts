import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-building-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const floor = (id: string, palette: number): FloorDef => {
    const dir = path.join(root, 'acme', id);
    mkdirSync(dir, { recursive: true });
    return { id, name: id, repo: `acme/${id}`, dir, palette, addedBy: 'Sam', addedAt: 1 };
  };
  const defs = [floor('api', 0), floor('web', 1), floor('docs', 2)];
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify(defs));
  return { root, dataDir, defs };
}

const saved = (dataDir: string) => (JSON.parse(readFileSync(path.join(dataDir, 'floors.json'), 'utf8')) as FloorDef[]).map((d) => d.id);

test('a floor comes off the building and stays off, with its checkout left where it was', (t) => {
  const { root, dataDir, defs } = office(t);
  const building = new Building(dataDir, root);

  const r = building.remove('web');
  assert.equal(typeof r, 'object');
  assert.equal((r as FloorDef).dir, defs[1].dir);
  assert.deepEqual(building.list().map((d) => d.id), ['api', 'docs']);
  assert.deepEqual(saved(dataDir), ['api', 'docs']);
  assert.ok(existsSync(defs[1].dir), 'the checkout stays on disk');

  // After a restart it's still gone.
  assert.deepEqual(new Building(dataDir, root).list().map((d) => d.id), ['api', 'docs']);
});

test("the floor the office was started in, and floors that aren't there, can't be taken off", (t) => {
  const { root, dataDir, defs } = office(t);
  const building = new Building(dataDir, root);
  building.ensureLocal(defs[0].dir, 'the office');

  assert.match(building.remove('api') as string, /started in/);
  assert.equal(building.remove('nope'), 'No such floor');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs']);
  assert.ok(building.isLocal('api'));
  assert.ok(!building.isLocal('web'));
});
