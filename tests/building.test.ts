import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';
import { suggestedFolder } from '../src/server/setup.js';

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'droid-office-building-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.droid-office');
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
  assert.deepEqual(
    building.list().map((d) => d.id),
    ['api', 'docs'],
  );
  assert.deepEqual(saved(dataDir), ['api', 'docs']);
  assert.ok(existsSync(defs[1].dir), 'the checkout stays on disk');

  // After a restart it's still gone.
  assert.deepEqual(
    new Building(dataDir, root).list().map((d) => d.id),
    ['api', 'docs'],
  );
});

test("floors that aren't there can't be taken off", (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);

  assert.equal(building.remove('nope'), 'No such floor');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs']);
});

for (const [forge, origin, repo] of [
  ['GitHub', 'https://github.com/acme/api.git', 'https://github.com/acme/api'],
  ['GitLab', 'https://gitlab.com/acme/platform/api.git', 'https://gitlab.com/acme/platform/api'],
] as const) {
  test(`the floor the office was started in comes off too, stays off after a restart, and moves back in when its ${forge} repository is added again`, async (t) => {
    const { root, dataDir, defs } = office(t);
    // The office's own checkout, with its origin (how it's recognised once it's no longer a floor).
    execFileSync('git', ['init', '-q', defs[0].dir]);
    execFileSync('git', ['-C', defs[0].dir, 'remote', 'add', 'origin', origin]);
    // The started-in floor is recorded as its origin's repository, not the one the fixture wrote.
    writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify(defs.slice(1)));
    const building = new Building(dataDir, root);
    const local = building.ensureLocal(defs[0].dir, 'the office');
    assert.ok(local && building.isLocal(local.id));
    assert.ok(!building.isLocal('web'));

    const r = building.remove((local as FloorDef).id, 'Sam');
    assert.equal((r as FloorDef).id, 'api');
    assert.ok(!building.isLocal('api'));
    assert.deepEqual(saved(dataDir), ['web', 'docs']);
    assert.ok(existsSync(defs[0].dir), 'the checkout stays on disk');

    // The next start doesn't put it back.
    const again = new Building(dataDir, root);
    assert.equal(again.ensureLocal(defs[0].dir, 'the office'), undefined);
    assert.deepEqual(
      again.list().map((d) => d.id),
      ['web', 'docs'],
    );
    assert.deepEqual(saved(dataDir), ['web', 'docs']);

    // Adding it again uses the checkout it always was (no clone, no gh or glab needed).
    const started: string[] = [];
    const back = await again.add(repo, 'Sam', (d) => started.push(d.dir));
    assert.equal(typeof back, 'object', String(back));
    assert.equal((back as FloorDef).dir, defs[0].dir);
    assert.deepEqual(started, [defs[0].dir]);
    assert.ok(again.isLocal((back as FloorDef).id));
    assert.deepEqual(saved(dataDir), ['web', 'docs', 'api']);
    assert.ok(!existsSync(path.join(dataDir, 'local-floor.json')));

    // ...and it's a floor again at the next start.
    const third = new Building(dataDir, root);
    assert.equal(third.ensureLocal(defs[0].dir, 'the office')?.id, 'api');
    assert.deepEqual(
      third.list().map((d) => d.id),
      ['web', 'docs', 'api'],
    );
  });
}

test('the walkthrough suggests a code folder that is already in the home folder, else the default', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'droid-office-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const fallback = path.join(home, '.droid-office', 'projects');
  assert.equal(suggestedFolder(fallback, home), fallback);
  writeFileSync(path.join(home, 'code'), 'a file, not a folder');
  assert.equal(suggestedFolder(fallback, home), fallback);
  mkdirSync(path.join(home, 'projects'));
  assert.equal(suggestedFolder(fallback, home), path.join(home, 'projects'));
  mkdirSync(path.join(home, 'Workspace'));
  assert.equal(suggestedFolder(fallback, home), path.join(home, 'Workspace'));
});
