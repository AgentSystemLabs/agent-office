import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';
import { forgeOfDir, originRepo } from '../src/server/forge.js';

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

test("floors that aren't there can't be taken off", (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);

  assert.equal(building.remove('nope'), 'No such floor');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs']);
});

test('the floor the office was started in comes off too, stays off after a restart, and moves back in when its repository is added again', async (t) => {
  const { root, dataDir, defs } = office(t);
  // The office's own checkout, with its GitHub origin (how it's recognised once it's no longer a floor).
  execFileSync('git', ['init', '-q', defs[0].dir]);
  execFileSync('git', ['-C', defs[0].dir, 'remote', 'add', 'origin', 'https://github.com/acme/api.git']);
  const building = new Building(dataDir, root);
  building.ensureLocal(defs[0].dir, 'the office');
  assert.ok(building.isLocal('api'));
  assert.ok(!building.isLocal('web'));

  const r = building.remove('api', 'Sam');
  assert.equal((r as FloorDef).id, 'api');
  assert.ok(!building.isLocal('api'));
  assert.deepEqual(saved(dataDir), ['web', 'docs']);
  assert.ok(existsSync(defs[0].dir), 'the checkout stays on disk');

  // The next start doesn't put it back.
  const again = new Building(dataDir, root);
  assert.equal(again.ensureLocal(defs[0].dir, 'the office'), undefined);
  assert.deepEqual(again.list().map((d) => d.id), ['web', 'docs']);
  assert.deepEqual(saved(dataDir), ['web', 'docs']);

  // Adding acme/api again uses the checkout it always was (no clone, no GitHub needed).
  const started: string[] = [];
  const back = await again.add('https://github.com/acme/api', 'Sam', (d) => started.push(d.dir));
  assert.equal(typeof back, 'object', String(back));
  assert.equal((back as FloorDef).dir, defs[0].dir);
  assert.deepEqual(started, [defs[0].dir]);
  assert.ok(again.isLocal((back as FloorDef).id));
  assert.deepEqual(saved(dataDir), ['web', 'docs', 'api']);
  assert.ok(!existsSync(path.join(dataDir, 'local-floor.json')));

  // ...and it's a floor again at the next start.
  const third = new Building(dataDir, root);
  assert.equal(third.ensureLocal(defs[0].dir, 'the office')?.id, 'api');
  assert.deepEqual(third.list().map((d) => d.id), ['web', 'docs', 'api']);
});

// --- The forge a checkout is on ---------------------------------------------------------------------

/** A checkout whose origin is `url`, in a folder nothing else has. */
function checkout(t: { after(fn: () => void): void }, url: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-origin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'project');
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  return dir;
}

test('a checkout of a GitHub or Bitbucket repository is a floor; anything else is not', (t) => {
  assert.equal(originRepo(checkout(t, 'https://github.com/acme/api.git')), 'acme/api');
  assert.equal(originRepo(checkout(t, 'git@github.com:acme/api.git')), 'acme/api');
  assert.equal(originRepo(checkout(t, 'https://bitbucket.org/acme/web.git')), 'acme/web');
  assert.equal(originRepo(checkout(t, 'git@bitbucket.org:acme/web.git')), 'acme/web');
  // Some other host (a self-hosted GitLab, say) has no forge the office can read.
  assert.equal(originRepo(checkout(t, 'https://gitlab.com/acme/app.git')), undefined);
  // Not a git checkout at all.
  const plain = mkdtempSync(path.join(tmpdir(), 'agent-office-plain-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.equal(originRepo(plain), undefined);
});

// --- A personal Bitbucket workspace -----------------------------------------------------------------
//
// bb works out its own workspace and that is the only way to reach a *personal* one, whose slug is
// often not the username: named outright it answers "No workspace with identifier 'tradai'" and says
// the repository is not found, while the bare name works. The fake below answers exactly like that,
// and like bb really does: a workspace list whose entries wrap the workspace in `workspace`, and a
// `workspace/repo` argument that only project workspaces answer to.

/** bb as it behaves against a personal workspace, and one project workspace that does answer. */
const PERSONAL_BB = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const mine = {
  'tradai/discovery': 'A repo of trades.',
  'tradai/mock_server': '',
  'tradai/strategies': 'Strategies.',
};
const theirs = { 'acme/web': 'The web.', 'acme/api': 'The API.' };
const list = (names, ws) => names.map((full_name) => ({ full_name, description: mine[full_name] ?? theirs[full_name] ?? '', is_private: true, updated_on: '2026-09-27T10:00:00.000000+00:00' }));
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
const nope = (m) => { process.stdout.write(JSON.stringify({ name: 'APIError', code: 2002, message: m })); process.exit(1); };
if (a[0] === 'workspace' && a[1] === 'list') out({ count: 2, workspaces: [
  { type: 'workspace_access', administrator: true, workspace: { type: 'workspace_base', slug: 'tradai' } },
  { type: 'workspace_access', administrator: false, workspace: { type: 'workspace_base', slug: 'acme' } },
] });
if (a[0] === 'repo' && a[1] === 'list') {
  const ws = opt('--workspace');
  // Naming a personal workspace is what fails; the workspace bb has for itself is not named.
  if (ws === 'tradai') return nope("No workspace with identifier 'tradai'.");
  if (ws === 'acme') return out(list(Object.keys(theirs), ws));
  return out(list(Object.keys(mine), 'tradai'));
}
if (a[0] === 'repo' && a[1] === 'view') {
  const asked = a[2];
  // Keyed on presence, not truthiness: a repository with no description is still there.
  const full = Object.keys({ ...mine, ...theirs }).find((k) => k === asked || k.split('/')[1] === asked);
  if (!full) return nope("Repository " + asked + " not found.");
  out({ full_name: full });
}
if (a[0] === 'repo' && a[1] === 'clone') {
  const dest = opt('--directory');
  const asked = a[2];
  const full = Object.keys({ ...mine, ...theirs }).find((k) => k === asked || k.split('/')[1] === asked);
  if (!full) return nope("Repository " + asked + " not found.");
  fs.mkdirSync(dest, { recursive: true });
  require('node:child_process').execFileSync('git', ['init', '-q', '-b', 'main', dest]);
  require('node:child_process').execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', 'git@bitbucket.org:' + full + '.git']);
  out({ success: true, repository: full, path: dest });
}
out('');
`;

function personal(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-personal-'));
  const bin = path.join(root, 'bin');
  const dataDir = path.join(root, '.agent-office');
  const projects = path.join(root, 'projects');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(bin, 'bb'), PERSONAL_BB, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`;
  t.after(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  });
  return new Building(dataDir, projects);
}

test('the elevator lists a personal workspace’s repositories, and the ones it can reach by name', async (t) => {
  const repos = await personal(t).repos(true);
  const names = repos.map((r) => r.name);
  // The workspace bb has for itself: asked for without a workspace, which is the only way to reach it.
  assert.ok(names.includes('tradai/discovery'), `got ${names.join(', ')}`);
  // A project workspace answers to its own name, so its repositories come too.
  assert.ok(names.includes('acme/web'), `got ${names.join(', ')}`);
  // Each is marked as Bitbucket, with what the elevator shows.
  const discovery = repos.find((r) => r.name === 'tradai/discovery')!;
  assert.equal(discovery.forge, 'bitbucket');
  assert.equal(discovery.description, 'A repo of trades.');
  assert.equal(discovery.private, true);
  assert.equal(discovery.pushedAt, '2026-09-27T10:00:00.000000+00:00');
  // A workspace that won't answer to its name is still reached through the default, so nothing is
  // lost: tradi's repositories are here even though `repo list --workspace tradi` failed.
  assert.ok(names.includes('tradai/strategies'), `got ${names.join(', ')}`);
  assert.equal(new Set(names).size, names.length, 'and nothing is listed twice');
});

test('a floor can be added by a full name on a workspace bb cannot be given by name', async (t) => {
  const building = personal(t);
  const r = await building.add('tradai/mock_server', 'Sam', () => {}, 'bitbucket');
  assert.equal(typeof r, 'object', 'the name is asked about and cloned both ways bb understands it');
  const def = r as FloorDef;
  assert.equal(def.repo, 'tradai/mock_server', 'the full name is what the floor records');
  assert.equal(path.basename(def.dir), 'mock_server');
  // Cloned the way bb can actually clone it, and it is a checkout of that repository.
  assert.ok(existsSync(def.dir), 'the clone landed');
  assert.equal(originRepo(def.dir), 'tradai/mock_server');
  assert.equal(forgeOfDir(def.dir), 'bitbucket', 'and the new floor knows which forge it is on');
});

test('a name bb does not know is refused with a reason, rather than a floor that cannot be read', async (t) => {
  const building = personal(t);
  const r = await building.add('tradai/nope', 'Sam', () => {}, 'bitbucket');
  assert.equal(typeof r, 'string');
  assert.match(r as string, /isn't on GitHub or Bitbucket/);
  assert.deepEqual(building.list(), [], 'and no floor is left behind');
});

