import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';
import { suggestedFolder } from '../src/server/config.js';

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

for (const [forge, origin] of [
  ['GitHub', 'https://github.com/acme/api.git'],
  ['GitLab', 'https://gitlab.com/acme/platform/api.git'],
] as const) {
  test(`the floor the office was started in comes off too, stays off after a restart, and moves back in when its ${forge} checkout is added again`, (t) => {
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

    // Adding it again uses the checkout it always was.
    const back = again.add(defs[0].dir, 'Sam');
    assert.equal(typeof back, 'object', String(back));
    assert.equal((back as FloorDef).dir, defs[0].dir);
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

test('the workspace folder defaults to a code folder that is already in the home folder, else the fallback', (t) => {
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

/** A workspace folder with a few git checkouts in it, laid out the way people keep them. */
function workspace(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'droid-office-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'office', '.droid-office');
  mkdirSync(dataDir, { recursive: true });
  const work = path.join(root, 'repos');
  const checkout = (rel: string, origin?: string) => {
    const dir = path.join(work, rel);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', dir]);
    if (origin) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
    return dir;
  };
  const api = checkout('acme/api', 'git@github.com:acme/api.git');
  const notes = checkout('notes');
  mkdirSync(path.join(work, 'node_modules', 'dep', '.git'), { recursive: true });
  mkdirSync(path.join(work, '.hidden', 'repo', '.git'), { recursive: true });
  mkdirSync(path.join(api, 'vendor', 'nested', '.git'), { recursive: true });
  const outside = path.join(root, 'elsewhere', 'stray');
  mkdirSync(outside, { recursive: true });
  execFileSync('git', ['init', '-q', outside]);
  const building = new Building(dataDir, work);
  return { root, work, dataDir, api, notes, outside, building };
}

test('the workspace folder is searched for existing checkouts, without going into any of them', async (t) => {
  const { building, api, notes } = workspace(t);
  const found = await building.repos();
  assert.deepEqual(found.map((r) => r.dir).sort(), [api, notes].sort());
  const repo = found.find((r) => r.dir === api);
  assert.equal(repo?.name, 'acme/api');
  assert.equal(repo?.repo, 'acme/api');
  assert.equal(repo?.forge, 'github');
  assert.equal(found.find((r) => r.dir === notes)?.name, 'notes', 'no GitHub or GitLab origin: named for its folder');
});

test('adding a checkout uses it where it is: nothing is cloned, copied or written into it', (t) => {
  const { building, dataDir, work, api } = workspace(t);
  const before = execFileSync('find', [work, '-not', '-path', '*/.git/*'], { encoding: 'utf8' });
  const r = building.add(api, 'Sam');
  assert.equal(typeof r, 'object', String(r));
  assert.equal((r as FloorDef).dir, api);
  assert.equal((r as FloorDef).repo, 'acme/api');
  assert.equal((r as FloorDef).name, 'api');
  assert.equal(execFileSync('find', [work, '-not', '-path', '*/.git/*'], { encoding: 'utf8' }), before, 'the workspace folder is untouched');
  assert.deepEqual(saved(dataDir), ['api']);
});

test('a checkout can only be added once, and only if it is a checkout in the workspace folder', (t) => {
  const { building, work, api, outside } = workspace(t);
  assert.equal(typeof building.add(api, 'Sam'), 'object');
  assert.match(building.add(api, 'Sam') as string, /already has a floor/);
  assert.match(building.add(outside, 'Sam') as string, /isn't in the workspace folder/);
  assert.match(building.add(path.join(work, 'acme'), 'Sam') as string, /isn't a git checkout/);
  assert.match(building.add(path.join(work, 'missing'), 'Sam') as string, /doesn't exist/);
  assert.match(building.add('acme/api', 'Sam') as string, /full path/);
  assert.match(building.add('', 'Sam') as string, /Pick a checkout/);
  assert.match(building.add(path.join(work, '..', 'elsewhere', 'stray'), 'Sam') as string, /isn't in the workspace folder/);
});

test('the workspace folder has to be an existing folder, and moving it changes what is offered', async (t) => {
  const { building, root, notes } = workspace(t);
  assert.match(building.setProjectsDir(path.join(root, 'nope'), 'Sam') ?? '', /isn't a folder/);
  assert.match(building.setProjectsDir('relative/path', 'Sam') ?? '', /full path/);
  assert.equal(building.setProjectsDir(path.join(root, 'elsewhere'), 'Sam'), undefined);
  assert.deepEqual(
    (await building.repos()).map((r) => r.name),
    ['stray'],
  );
  assert.equal(building.projectsDirState().custom, true);
  assert.match(building.add(notes, 'Sam') as string, /isn't in the workspace folder/);
});
