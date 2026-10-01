import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Changes } from '../src/server/changes.js';
import { excludeFromGit } from '../src/server/config.js';
import { landedWorkers } from '../src/server/leave-on-merge.js';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, relatedBlock, withRelated, workspaceNames, type RepoSource, type WorkerEvents } from '../src/server/workers.js';
import { Worktrees } from '../src/server/worktrees.js';
import type { ChangesState, GhPull, WorkerInfo } from '../src/shared/protocol.js';

// A worker across repositories (WorkerInfo.repos): hired on one floor with other floors' projects,
// it works in a workspace holding a worktree of each, all on one branch, and opens a PR in each.

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A checkout of github.com/acme/<name> whose pushes land in a local bare repository instead. */
function project(root: string, name: string): string {
  const bare = path.join(root, 'remotes', `${name}.git`);
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const dir = path.join(root, 'projects', name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'remote', 'add', 'origin', `https://github.com/acme/${name}.git`);
  git(dir, 'config', `url.${bare}.pushInsteadOf`, `https://github.com/acme/${name}.git`);
  git(dir, 'push', '-q', 'origin', 'main');
  excludeFromGit(dir);
  return dir;
}

/** Records where it was started and whether git finds a repository there, then waits. */
const fakeAgent = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
let top = null;
try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ cwd: process.cwd(), ceiling: process.env.GIT_CEILING_DIRECTORIES, top }) + '\\n');
setInterval(() => {}, 1000);
`;

/** Pull requests kept in $GH_STATE: list, create, view (the body) and edit (the body). */
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const file = process.env.GH_STATE;
const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { prs: [] };
const a = process.argv.slice(2);
const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const repo = () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim().replace(/^https:\\/\\/github\\.com\\//, '').replace(/\\.git$/, '');
const done = (out, code = 0) => { fs.writeFileSync(file, JSON.stringify(st)); process.stdout.write(out); process.exit(code); };
if (a[0] === 'pr' && a[1] === 'list') done(JSON.stringify(st.prs.filter((p) => p.repo === repo() && p.head === opt('--head') && p.state === 'OPEN').slice(0, 1).map((p) => ({ number: p.number, url: p.url }))));
if (a[0] === 'pr' && a[1] === 'create') {
  const r = repo();
  const number = st.prs.filter((p) => p.repo === r).length + 1;
  const url = 'https://github.com/' + r + '/pull/' + number;
  st.prs.push({ repo: r, number, url, head: opt('--head'), base: opt('--base'), title: opt('--title'), body: opt('--body'), state: 'OPEN' });
  done(url + '\\n');
}
const pr = st.prs.find((p) => p.url === a[2]);
if (a[0] === 'pr' && a[1] === 'view' && pr) done(pr.body + '\\n');
if (a[0] === 'pr' && a[1] === 'edit' && pr) { pr.body = opt('--body'); done(''); }
done('', 1);
`;

interface Fixture {
  root: string;
  a: string;
  b: string;
  c: string;
  log: string;
  agent: string;
  ghState: string;
  starts(): { cwd: string; ceiling?: string; top: string | null }[];
  prs(): { repo: string; number: number; url: string; head: string; base?: string; title: string; body: string }[];
}

function fixture(t: { after(fn: () => void): void }): Fixture {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-repos-')));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const agent = path.join(bin, 'fake-agent');
  writeFileSync(agent, fakeAgent, { mode: 0o755 });
  writeFileSync(path.join(bin, 'gh'), fakeGh, { mode: 0o755 });
  // The task namer asks `claude -p`: not the real one.
  writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const log = path.join(root, 'starts.jsonl');
  writeFileSync(log, '');
  const ghState = path.join(root, 'gh.json');
  const saved = { PATH: process.env.PATH, FAKE_AGENT_LOG: process.env.FAKE_AGENT_LOG, GH_STATE: process.env.GH_STATE };
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
  process.env.FAKE_AGENT_LOG = log;
  process.env.GH_STATE = ghState;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    a: project(root, 'web'),
    b: project(root, 'api'),
    c: project(root, 'admin'),
    log,
    agent,
    ghState,
    starts: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    prs: () => (existsSync(ghState) ? JSON.parse(readFileSync(ghState, 'utf8')).prs : []),
  };
}

const events: WorkerEvents = { update() {}, remove() {}, data() {}, screen() {}, toast() {} };

function manager(f: Fixture, t: { after(fn: () => void): void }): WorkerManager {
  const data = path.join(f.a, '.agent-office');
  mkdirSync(data, { recursive: true });
  const workers = new WorkerManager(f.a, data, f.agent, [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  t.after(() => workers.shutdown());
  return workers;
}

const source = (floor: string, dir: string): RepoSource => ({ floor, name: path.basename(dir), repo: `acme/${path.basename(dir)}`, dir });

async function waitFor<T>(read: () => T, ok: (v: T) => boolean, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  let v = read();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    v = read();
  }
  assert.ok(ok(v), 'timed out');
  return v;
}

test('a worker across repositories gets a workspace with a worktree of each on one branch, and starts in it', async (t) => {
  const f = fixture(t);
  const workers = manager(f, t);
  const w = workers.spawn('desk-1', 'Cody', undefined, true, 'agent', undefined, undefined, undefined, undefined, undefined, [source('floor-api', f.b), source('floor-admin', f.c)]);
  assert.equal(typeof w, 'object', String(w));
  if (typeof w === 'string') return;
  const slug = w.worktree!.branch.replace(/^office\//, '');
  const ws = path.join(f.a, '.agent-office', 'worktrees', slug);
  assert.equal(w.worktree!.path, path.join('.agent-office', 'worktrees', slug, 'web'));
  assert.deepEqual(w.repos!.map((r) => [r.floor, r.name, r.path, r.branch, r.from]), [
    ['floor-api', 'api', path.join('.agent-office', 'worktrees', slug, 'api'), w.worktree!.branch, 'main'],
    ['floor-admin', 'admin', path.join('.agent-office', 'worktrees', slug, 'admin'), w.worktree!.branch, 'main'],
  ]);
  // Each is a worktree of its own repository, on the worker's branch.
  for (const [name, dir] of [['web', f.a], ['api', f.b], ['admin', f.c]]) {
    assert.equal(git(path.join(ws, name), 'rev-parse', '--abbrev-ref', 'HEAD'), w.worktree!.branch);
    assert.equal(realpathSync(path.resolve(path.join(ws, name), git(path.join(ws, name), 'rev-parse', '--git-common-dir'))), realpathSync(path.join(dir, '.git')));
  }
  // The brief says which folder is which, for Claude (CLAUDE.md) and the others (AGENTS.md).
  const brief = readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8');
  assert.equal(readFileSync(path.join(ws, 'AGENTS.md'), 'utf8'), brief);
  for (const line of ['`web/`: acme/web, cut from main', '`api/`: acme/api, cut from main', '`admin/`: acme/admin', w.worktree!.branch, 'acme/web#12']) assert.ok(brief.includes(line), line);
  assert.ok(!brief.includes('{{'), brief);

  // It starts in the workspace, where git finds no repository (not the web floor's own checkout).
  const [start] = await waitFor(() => f.starts(), (s) => s.length === 1);
  assert.equal(realpathSync(start.cwd), ws);
  assert.equal(start.top, null);
  assert.equal(start.ceiling, path.dirname(ws));

  // It comes back with them after a restart.
  workers.shutdown();
  const again = manager(f, t);
  assert.deepEqual(again.get(w.id)?.repos?.map((r) => r.name), ['api', 'admin']);
});

test('hiring across repositories needs its own worktree and different repositories, and leaves nothing behind when it fails', async (t) => {
  const f = fixture(t);
  const workers = manager(f, t);
  const hire = (repos: RepoSource[], worktree = true) => workers.spawn('desk-1', 'Cody', undefined, worktree, 'agent', undefined, undefined, undefined, undefined, undefined, repos);
  assert.match(String(hire([source('floor-api', f.b)], false)), /own worktree/);
  // Another checkout of the web repository is still the web repository.
  const twin = path.join(f.root, 'web-twin');
  git(f.a, 'worktree', 'add', '-q', twin, '-b', 'twin');
  assert.match(String(hire([source('floor-twin', twin)])), /same repository/);
  assert.match(String(hire([source('floor-api', f.b), source('floor-api-2', f.b)])), /same repository/);
  const plain = path.join(f.root, 'projects', 'notes');
  mkdirSync(plain);
  assert.match(String(hire([source('floor-notes', plain)])), /isn't a git checkout/);

  // api can't have the branch (one of that name is there already): web's new worktree and branch are taken out again.
  const before = git(f.a, 'branch', '--list', 'office/*');
  git(f.b, 'branch', 'office/sprocket-0000');
  const failed = (workers as any).makeWorkspace('sprocket-0000', [source('floor-api', f.b)]);
  assert.match(String(failed), /^api: Could not create a git worktree/);
  await waitFor(() => git(f.a, 'branch', '--list', 'office/sprocket-0000'), (out) => out === '');
  assert.equal(git(f.a, 'branch', '--list', 'office/*'), before);
  await waitFor(() => existsSync(path.join(f.a, '.agent-office', 'worktrees', 'sprocket-0000')), (there) => !there);
  assert.equal(git(f.b, 'branch', '--list', 'office/sprocket-0000'), 'office/sprocket-0000', "api's own branch stays");
});

test('sending a worker across repositories home checks every worktree, and deletes them all and its workspace', async (t) => {
  const f = fixture(t);
  const workers = manager(f, t);
  const hire = () => workers.spawn('desk-1', 'Cody', undefined, true, 'agent', undefined, undefined, undefined, undefined, undefined, [source('floor-api', f.b)]) as WorkerInfo;
  const w = hire();
  const ws = path.join(f.a, '.agent-office', 'worktrees', w.worktree!.branch.slice('office/'.length));
  writeFileSync(path.join(ws, 'api', 'server.js'), 'wip\n');
  const state = await workers.inspectWorktree(w.id);
  assert.deepEqual(state?.repos?.map((r) => [r.name, r.state.dirty]), [['web', 0], ['api', 1]]);
  assert.equal(state?.dirty, 1);
  // Nobody said what to do, and api holds work: everything stays.
  const kept = await workers.kill(w.id);
  assert.match(kept.note ?? '', /Kept .*worktrees and branch office\/\S+ in web, api — api has 1 uncommitted change/);
  assert.ok(existsSync(path.join(ws, 'api', 'server.js')));

  const w2 = hire();
  const ws2 = path.join(f.a, '.agent-office', 'worktrees', w2.worktree!.branch.slice('office/'.length));
  const done = await workers.kill(w2.id, 'all');
  assert.match(done.note ?? '', /Deleted .*worktrees and branch office\/\S+ in web, api/);
  assert.equal(existsSync(ws2), false);
  assert.equal(git(f.a, 'branch', '--list', w2.worktree!.branch), '');
  assert.equal(git(f.b, 'branch', '--list', w2.worktree!.branch), '');
});

test('O opens a pull request in each repository with commits, and each one lists them all', async (t) => {
  const f = fixture(t);
  const workers = manager(f, t);
  const w = workers.spawn('desk-1', 'Cody', 'Work on GitHub issue #12: "Sign in with passkeys".', true, 'agent', undefined, undefined, undefined, undefined, undefined, [source('floor-api', f.b), source('floor-admin', f.c)]) as WorkerInfo;
  const ws = path.join(f.a, '.agent-office', 'worktrees', w.worktree!.branch.slice('office/'.length));
  await waitFor(() => workers.get(w.id)?.status, (s) => s !== 'starting');
  // Work in web and api; nothing in admin.
  for (const name of ['web', 'api']) {
    writeFileSync(path.join(ws, name, 'passkeys.js'), `// ${name}\n`);
    git(path.join(ws, name), 'add', '-A');
    git(path.join(ws, name), 'commit', '-q', '-m', `Passkeys in ${name}`);
  }
  (workers as any).workers.get(w.id).info.status = 'done';
  const r = await workers.openPr(w.id, 'Cody');
  assert.equal(typeof r, 'object', String(r));
  if (typeof r === 'string') return;
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.prs.map((p) => [p.repo, p.number, p.existed]), [['web', 1, false], ['api', 1, false]]);
  const prs = f.prs();
  const web = prs.find((p) => p.repo === 'acme/web')!;
  const api = prs.find((p) => p.repo === 'acme/api')!;
  assert.equal(prs.length, 2);
  assert.equal(web.base, 'main');
  assert.equal(web.title, 'Sign in with passkeys');
  // The issue is web's: its PR closes it, api's only points at it.
  assert.match(web.body, /\nCloses #12\n/);
  assert.match(api.body, /\nPart of acme\/web#12\n/);
  assert.doesNotMatch(api.body, /Closes/);
  for (const p of [web, api]) {
    assert.match(p.body, /One change across 2 repositories/);
    assert.ok(p.body.includes('**web**: acme/web#1') && p.body.includes('**api**: acme/api#1'), p.body);
    assert.ok(p.body.includes(`${p.repo}#1 (this one)`));
  }
  // Pushed to each repository's origin.
  for (const name of ['web', 'api']) assert.ok(git(path.join(f.root, 'remotes', `${name}.git`), 'rev-parse', w.worktree!.branch));
  assert.deepEqual(workers.get(w.id)?.pr, { number: 1, url: 'https://github.com/acme/web/pull/1' });
  assert.deepEqual(workers.get(w.id)?.repos?.map((x) => x.pr?.url), ['https://github.com/acme/api/pull/1', undefined]);

  // Later, admin gets work too: O again opens its PR and brings every list up to date.
  writeFileSync(path.join(ws, 'admin', 'passkeys.js'), '// admin\n');
  git(path.join(ws, 'admin'), 'add', '-A');
  git(path.join(ws, 'admin'), 'commit', '-q', '-m', 'Passkeys in admin');
  const again = await workers.openPr(w.id, 'Cody');
  if (typeof again === 'string') return assert.fail(again);
  assert.deepEqual(again.prs.map((p) => [p.repo, p.existed]), [['web', true], ['api', true], ['admin', false]]);
  for (const p of f.prs()) {
    assert.match(p.body, /One change across 3 repositories/);
    assert.equal(p.body.split('agent-office:related').length, 3, 'one list, replaced rather than added again');
  }
});

test('the list of related pull requests goes in once and is replaced after', () => {
  const block = relatedBlock([{ repo: 'web', url: 'https://github.com/acme/web/pull/3' }, { repo: 'api', url: 'https://github.com/acme/api/pull/9' }], 'https://github.com/acme/api/pull/9', 'office/pip-1');
  assert.match(block, /- \*\*web\*\*: acme\/web#3\n- \*\*api\*\*: acme\/api#9 \(this one\)/);
  const once = withRelated('## Task\n\nDo it\n', block);
  assert.equal(once, `## Task\n\nDo it\n\n${block}`);
  const newer = relatedBlock([{ repo: 'web', url: 'https://github.com/acme/web/pull/3' }], 'x', 'office/pip-1');
  assert.equal(withRelated(`${once}\n\nsigned`, newer), `## Task\n\nDo it\n\n${newer}\n\nsigned`);
  assert.equal(withRelated('', block), block);
});

test("each checkout's folder in a workspace is named after it, once", () => {
  assert.deepEqual(workspaceNames(['/p/acme/web', '/p/other/web', '/p/acme/api', '/x/.hidden', '/y/AGENTS.md', '/z/my repo']), ['web', 'web-2', 'api', 'hidden', 'AGENTS.md-repo', 'my-repo']);
});

test('the Changes window follows each repository of a worker across repositories against its own branch', async (t) => {
  const f = fixture(t);
  const wt = new Worktrees(f.b).create('pip-1', 'api', f.a);
  if (typeof wt === 'string') return assert.fail(wt);
  const cwd = path.join(f.a, wt.path);
  writeFileSync(path.join(cwd, 'new.js'), 'x\n');
  const states: ChangesState[] = [];
  // The web floor's office was opened on a branch api doesn't have: api's diff is against its own main.
  const changes = new Changes(f.a, 'trunk', (id, repo) => (id === 'w1' && repo === 'floor-api' ? { name: 'Pip', cwd, rel: wt.path, worktreeBase: wt.base, baseBranch: 'main', openPull: () => ({ number: 4, url: 'u' }) } : undefined), () => undefined, {
    state: (s) => states.push(s),
    toast() {},
    refreshGitHub() {},
  });
  t.after(() => changes.stop());
  changes.watch('w1', 'c1', 'floor-api');
  const [s] = await waitFor(() => states, (x) => x.length > 0);
  assert.equal(s.repo, 'floor-api');
  assert.equal(s.branch, 'office/pip-1');
  assert.equal(s.base, 'main');
  assert.equal(s.prBase, 'main');
  assert.deepEqual(s.pr, { number: 4, url: 'u' });
  assert.deepEqual(s.files.map((x) => [x.path, x.status]), [['new.js', '?']]);
  assert.equal(await changes.commit('w1', 'Add new.js', 'Cody', undefined, 'floor-api'), undefined);
  assert.equal(git(cwd, 'log', '-1', '--format=%s'), 'Add new.js');
  // Its own floor's checkout is a different target.
  assert.equal(await changes.diff('w1', 'new.js'), 'No such worker');
});

test('prune leaves a workspace with worktrees in it alone, and lists the other repository’s branch as checked out elsewhere', async (t) => {
  const f = fixture(t);
  const web = new Worktrees(f.a);
  const api = new Worktrees(f.b);
  assert.equal(typeof web.create('pip-1', 'web'), 'object');
  assert.equal(typeof api.create('pip-1', 'api', f.a), 'object');
  const listed = await web.list();
  assert.deepEqual(listed.worktrees.map((w) => [w.path, w.branch]), [[path.join('.agent-office', 'worktrees', 'pip-1', 'web'), 'office/pip-1']]);
  assert.deepEqual(listed.strays, []);
  const theirs = await api.list();
  assert.deepEqual(theirs.worktrees, []);
  assert.deepEqual([...theirs.elsewhere], [['office/pip-1', path.join(f.a, '.agent-office', 'worktrees', 'pip-1', 'api')]]);
});

const pull = (number: number, state: string, headRefName: string, headRefOid?: string): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: '', author: '', labels: [], reviewDecision: '',
  headRefName, headRefOid, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
  checks: 'none', body: '', closes: [],
});

test('a worker across repositories goes home once its pull requests have merged and none is open, on any floor', () => {
  const w: WorkerInfo = {
    id: 'pip', kind: 'agent', deskId: 'desk-1', name: 'Pip', color: '#fff', status: 'done', acked: true, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [],
    worktree: { path: '.agent-office/worktrees/pip-1/web', branch: 'office/pip-1', base: 'a' },
    repos: [{ floor: 'api', name: 'api', dir: '/api', path: '.agent-office/worktrees/pip-1/api', branch: 'office/pip-1', base: 'b', pr: { number: 9, url: '' } }],
  };
  const web = [pull(3, 'MERGED', 'office/pip-1', 'h3')];
  const floors = (api: GhPull[] | undefined) => (id: string) => (id === 'api' ? api : undefined);
  // api's PR still open, or not on api's list (yet): it stays.
  assert.deepEqual(landedWorkers([w], web, [], floors([pull(9, 'OPEN', 'office/pip-1')])), []);
  assert.deepEqual(landedWorkers([w], web, [], floors([])), []);
  assert.deepEqual(landedWorkers([w], web, [], floors(undefined)), []);
  // Both merged: it goes, with each merged head.
  assert.deepEqual(landedWorkers([w], web, [], floors([pull(9, 'MERGED', 'office/pip-1', 'h9')])), [{ worker: w, pr: 3, head: 'h3', heads: { api: 'h9' }, prs: ['web #3', 'api #9'] }]);
  // Only api had work: its PR merging is enough.
  const apiOnly = { ...w, repos: [{ ...w.repos![0] }] };
  assert.deepEqual(landedWorkers([apiOnly], [], [], floors([pull(9, 'MERGED', 'office/pip-1', 'h9')])).map((l) => l.prs), [['api #9']]);
  // web's own PR open: it stays.
  assert.deepEqual(landedWorkers([w], [pull(3, 'OPEN', 'office/pip-1')], [], floors([pull(9, 'MERGED', 'office/pip-1')])), []);
});
