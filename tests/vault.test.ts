import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../src/server/vault.js';
import { copyEnvFiles } from '../src/server/envfiles.js';
import { addFloorEnv, childEnv } from '../src/server/workers/env.js';
import { badVaultName, parseDotenv, VAULT_MAX } from '../src/shared/vault.js';

const tmp = (t: TestContext, prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the vault keeps its variables across a restart, in a file only the office can read, and never shows their values', (t) => {
  const dir = tmp(t, 'agent-office-vault-');
  const vault = new Vault(dir);
  assert.deepEqual(vault.set([{ name: 'API_KEY', value: 's3cret' }, { name: 'DB_URL', value: 'postgres://x' }], 'Ada'), { names: ['API_KEY', 'DB_URL'] });
  const again = new Vault(dir);
  assert.deepEqual(again.env(), { API_KEY: 's3cret', DB_URL: 'postgres://x' });
  const state = again.state('f1');
  assert.deepEqual(state.entries.map((e) => [e.name, e.by]), [['API_KEY', 'Ada'], ['DB_URL', 'Ada']]);
  assert.ok(!JSON.stringify(state).includes('s3cret'));
  if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'vault.json')).mode & 0o777, 0o600);
  assert.equal(again.delete('API_KEY'), true);
  assert.equal(again.delete('API_KEY'), false);
  assert.deepEqual(new Vault(dir).env(), { DB_URL: 'postgres://x' });
});

test('the vault takes all of a batch or none of it', (t) => {
  const vault = new Vault(tmp(t, 'agent-office-vault-'));
  assert.ok('error' in vault.set([{ name: 'GOOD', value: '1' }, { name: '1BAD', value: '2' }], 'Ada'));
  assert.ok('error' in vault.set([{ name: 'PATH', value: '/evil' }], 'Ada'));
  assert.ok('error' in vault.set([{ name: 'AGENT_OFFICE_HOOK_TOKEN', value: 'x' }], 'Ada'));
  assert.ok('error' in vault.set([{ name: 'NO_VALUE' }], 'Ada'));
  assert.ok('error' in vault.set('API_KEY=1', 'Ada'));
  assert.ok('error' in vault.set(Array.from({ length: VAULT_MAX + 1 }, (_, i) => ({ name: `V${i}`, value: '' })), 'Ada'));
  assert.deepEqual(vault.env(), {});
});

test("a floor's workers start with its vault, and no other floor's do", () => {
  const off = addFloorEnv('/projects/a', () => ({ API_KEY: 'a-key' }));
  try {
    assert.equal(childEnv('/projects/a').API_KEY, 'a-key');
    assert.equal(childEnv('/projects/b').API_KEY, process.env.API_KEY);
    assert.equal(childEnv().API_KEY, process.env.API_KEY);
  } finally {
    off();
  }
  assert.equal(childEnv('/projects/a').API_KEY, process.env.API_KEY);
});

test('variable names, and what isn’t one', () => {
  assert.equal(badVaultName('STRIPE_KEY'), undefined);
  assert.equal(badVaultName('_x1'), undefined);
  for (const bad of ['', '9LIVES', 'MY-KEY', 'A B', 'path', 'Agent_Office_X']) assert.ok(badVaultName(bad), bad);
});

test('a pasted .env file: comments, export, quotes and multi-line values', () => {
  const text = [
    '# a comment',
    '',
    'export API_KEY=abc123',
    'PLAIN = spaced value  # trailing comment',
    "SINGLE='keeps \\n and # as they are'",
    'DOUBLE="line1\\nline2 \\"quoted\\""',
    'PEM="-----BEGIN KEY-----',
    'abc',
    '-----END KEY-----"',
    'EMPTY=',
    'not a variable',
  ].join('\r\n');
  const { vars, bad } = parseDotenv(text);
  assert.deepEqual(Object.fromEntries(vars.map((v) => [v.name, v.value])), {
    API_KEY: 'abc123',
    PLAIN: 'spaced value',
    SINGLE: 'keeps \\n and # as they are',
    DOUBLE: 'line1\nline2 "quoted"',
    PEM: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
    EMPTY: '',
  });
  assert.deepEqual(bad, ['not a variable']);
});

test("a new worktree gets the project's ignored .env files, never the tracked ones or over its own", (t) => {
  const project = tmp(t, 'agent-office-envfiles-');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(path.join(project, '.gitignore'), '.env\n.env.local\n');
  writeFileSync(path.join(project, '.env.example'), 'API_KEY=\n');
  git('add', '.');
  git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init');
  writeFileSync(path.join(project, '.env'), 'API_KEY=real\n');
  writeFileSync(path.join(project, '.env.local'), 'LOCAL=1\n');
  writeFileSync(path.join(project, '.envrc'), 'not a .env file\n');
  const into = tmp(t, 'agent-office-envfiles-wt-');
  writeFileSync(path.join(into, '.env.local'), 'MINE=1\n');
  assert.deepEqual(copyEnvFiles(project, into), ['.env']);
  assert.equal(readFileSync(path.join(into, '.env'), 'utf8'), 'API_KEY=real\n');
  assert.equal(readFileSync(path.join(into, '.env.local'), 'utf8'), 'MINE=1\n');
  assert.ok(!existsSync(path.join(into, '.env.example')));
  assert.ok(!existsSync(path.join(into, '.envrc')));
});
