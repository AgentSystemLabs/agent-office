// The safe (issue #210): a floor's .env, written into every worktree the office makes for a worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from '../src/shared/vault.js';
import { readVault, saveVault, STOCK_MARK, stocked } from '../src/server/vault.js';
import { workerEnv } from '../src/server/workers/env.js';
import { Worktrees } from '../src/server/worktrees.js';

/** A floor's project: a git checkout that ignores .agent-office/, as the office sets them up. */
function project(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-vault-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, '.gitignore'), '.agent-office/\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'init');
  return { dir, run };
}

const envOf = (at: string) => readFileSync(path.join(at, '.env'), 'utf8');

test('parseEnv names the variables in a .env, and the line it cannot read', () => {
  assert.deepEqual(parseEnv('# a comment\n\nAPI_TOKEN=abc\nexport DB_URL = "postgres://x"\nAPI_TOKEN=again # the new one\n'), { keys: ['API_TOKEN', 'DB_URL'], values: { API_TOKEN: 'again', DB_URL: 'postgres://x' } });
  assert.deepEqual(parseEnv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1'), { keys: ['KEY', 'NEXT'], values: { KEY: '-----BEGIN-----\nabc\n-----END-----', NEXT: '1' } });
  assert.deepEqual(parseEnv(`A="line\\nnext \\"q\\""\nB='as \\n is'\nC=has#hash`).values, { A: 'line\nnext "q"', B: 'as \\n is', C: 'has#hash' });
  assert.equal(parseEnv('just some words').error, "Line 1 isn't NAME=value");
  assert.equal(parseEnv('A=1\nB="never closed\nC=3').error, 'The value on line 2 never closes its "');
  assert.deepEqual(parseEnv(''), { keys: [], values: {} });
});

test('a new worktree gets the safe as its .env, and git ignores it', (t) => {
  const { dir, run } = project(t);
  const saved = saveVault(dir, 'API_TOKEN=secret\n', 'Ada');
  assert.deepEqual(saved, { keys: ['API_TOKEN'], stocked: 1 });
  assert.equal(readVault(dir)?.by, 'Ada');
  assert.equal(statSync(path.join(dir, '.agent-office', 'vault.json')).mode & 0o777, 0o600);
  // The floor's own checkout got it too.
  assert.equal(envOf(dir), `${STOCK_MARK}\nAPI_TOKEN=secret\n`);

  const wt = new Worktrees(dir).create('ada-1234');
  assert.equal(typeof wt, 'object');
  const abs = path.join(dir, (wt as { path: string }).path);
  assert.equal(envOf(abs), `${STOCK_MARK}\nAPI_TOKEN=secret\n`);
  assert.equal(statSync(path.join(abs, '.env')).mode & 0o777, 0o600);
  // Nothing for the worker to commit by mistake.
  assert.equal(run(abs, 'status', '--porcelain'), '');
  assert.equal(stocked(dir), 2);
});

test('changing the safe rewrites the .env it wrote, and leaves a .env of your own alone', (t) => {
  const { dir } = project(t);
  const trees = new Worktrees(dir);
  saveVault(dir, 'A=1\n', 'Ada');
  const one = path.join(dir, (trees.create('one-0001') as { path: string }).path);
  const two = path.join(dir, (trees.create('two-0002') as { path: string }).path);
  writeFileSync(path.join(two, '.env'), 'MINE=1\n');

  const saved = saveVault(dir, 'A=2\nB=3\n', 'Grace');
  assert.deepEqual(saved, { keys: ['A', 'B'], stocked: 2 });
  assert.equal(envOf(one), `${STOCK_MARK}\nA=2\nB=3\n`);
  assert.equal(envOf(two), 'MINE=1\n');

  // Emptied, the safe takes back the .env files it wrote.
  assert.deepEqual(saveVault(dir, '  \n', 'Grace'), { keys: [], stocked: 0 });
  assert.equal(readVault(dir), undefined);
  assert.equal(existsSync(path.join(one, '.env')), false);
  assert.equal(existsSync(path.join(dir, '.env')), false);
  assert.equal(envOf(two), 'MINE=1\n');
});

test('the safe turns down what is not a .env file', (t) => {
  const { dir } = project(t);
  assert.deepEqual(saveVault(dir, 'oops\n', 'Ada'), { error: "Line 1 isn't NAME=value" });
  assert.equal(readVault(dir), undefined);
  assert.equal(existsSync(path.join(dir, '.env')), false);
});

test("a worker starts with the safe's variables in its environment, but not over the office's own", (t) => {
  const { dir } = project(t);
  assert.equal(workerEnv(dir).API_TOKEN, undefined);
  saveVault(dir, 'API_TOKEN="a b"\nPATH=/nowhere\nHOME=/tmp\nAGENT_OFFICE_WORKER_ID=x\n', 'Ada');
  const env = workerEnv(dir);
  assert.equal(env.API_TOKEN, 'a b');
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(env.AGENT_OFFICE_WORKER_ID, undefined);
});
