import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LinearKey } from '../src/server/linear-key.js';
import type { LinearKeyState } from '../src/shared/protocol.js';

function scratch(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-linear-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const who = async () => ({ viewerId: 'u1', viewer: 'Greg Brinker', workspace: 'CompanyCam' });

test('a key is checked, saved for the server alone, and shown to clients as a hint', async (t) => {
  const dir = scratch(t);
  const states: LinearKeyState[] = [];
  const keys = new LinearKey(dir, (s) => states.push(s));
  assert.deepEqual(keys.state(), {});
  assert.equal(keys.key(), undefined);
  const checked: string[] = [];
  assert.equal(
    await keys.set('  lin_api_abcdefghij7f3a ', 'Ada', async (k) => {
      checked.push(k);
      return who();
    }),
    undefined,
  );
  assert.deepEqual(checked, ['lin_api_abcdefghij7f3a']);
  assert.equal(keys.key(), 'lin_api_abcdefghij7f3a');
  assert.equal(keys.viewerId(), 'u1');
  const s = keys.state();
  assert.equal(s.key?.hint, 'lin_api_…7f3a');
  assert.equal(s.key?.by, 'Ada');
  assert.equal(s.key?.viewer, 'Greg Brinker');
  assert.equal(s.key?.workspace, 'CompanyCam');
  assert.ok(!JSON.stringify(s).includes('abcdefghij'), 'the key itself never goes to clients');
  assert.deepEqual(states, [s]);
  // On disk for the next office, and for nobody else.
  const file = path.join(dir, 'linear.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).key, 'lin_api_abcdefghij7f3a');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const again = new LinearKey(dir, () => {});
  assert.equal(again.key(), 'lin_api_abcdefghij7f3a');
  assert.deepEqual(again.state(), s);
});

test('a key Linear refuses is turned away with its reason and never written', async (t) => {
  const dir = scratch(t);
  const keys = new LinearKey(dir, () => {});
  assert.equal(await keys.set('lin_api_wrong', 'Ada', async () => Promise.reject(new Error('Linear rejected the API key'))), 'Linear rejected the API key');
  assert.equal(keys.key(), undefined);
  assert.ok(!existsSync(path.join(dir, 'linear.json')));
  assert.equal(await keys.set('   ', 'Ada', who), 'Paste the API key');
  assert.match((await keys.set('has a space', 'Ada', who)) ?? '', /doesn't look like/);
  assert.match((await keys.set('x'.repeat(201), 'Ada', who)) ?? '', /doesn't look like/);
});

test('an OAuth token gets its own hint; a refused saved key stays but says why; remove forgets it', async (t) => {
  const dir = scratch(t);
  const states: LinearKeyState[] = [];
  const keys = new LinearKey(dir, (s) => states.push(s));
  await keys.set('lin_oauth_zzzzzzzzzzzz9999', 'Ada', who);
  assert.equal(keys.state().key?.hint, 'lin_oauth_…9999');
  keys.failed('Linear rejected the API key. Paste a new one on the 📌 Issues board.');
  keys.failed('Linear rejected the API key. Paste a new one on the 📌 Issues board.');
  assert.equal(keys.key(), 'lin_oauth_zzzzzzzzzzzz9999');
  assert.match(keys.state().error ?? '', /rejected/);
  assert.equal(states.length, 2, 'the same failure is not announced twice');
  keys.clear();
  assert.deepEqual(keys.state(), {});
  assert.equal(new LinearKey(dir, () => {}).key(), undefined);
  keys.clear();
  assert.equal(states.length, 3, 'clearing nothing says nothing');
});

test('a broken or odd file means no key', (t) => {
  const dir = scratch(t);
  writeFileSync(path.join(dir, 'linear.json'), '{nope');
  assert.deepEqual(new LinearKey(dir, () => {}).state(), {});
  writeFileSync(path.join(dir, 'linear.json'), JSON.stringify({ key: 42 }));
  assert.deepEqual(new LinearKey(dir, () => {}).state(), {});
  writeFileSync(path.join(dir, 'linear.json'), JSON.stringify({ key: 'lin_api_x1234' }));
  const k = new LinearKey(dir, () => {});
  assert.equal(k.key(), 'lin_api_x1234');
  assert.equal(k.state().key?.by, '?');
});
