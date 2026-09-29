import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DroidSessionReader } from '../src/server/droid-session.js';

const ID = '11111111-2222-3333-4444-555555555555';

function sessions(): { root: string; put(dir: string, id: string, body: unknown): void } {
  const root = mkdtempSync(path.join(tmpdir(), 'droid-sessions-'));
  return {
    root,
    put(dir, id, body) {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, `${id}.settings.json`), typeof body === 'string' ? body : JSON.stringify(body));
    },
  };
}

test('reads the model and effort droid recorded for the session in the working directory', async (t) => {
  const s = sessions();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.put('-Users-nik-repos-app', ID, { model: 'claude-sonnet-5-5', reasoningEffort: 'high' });
  const seen = await new DroidSessionReader(s.root).read(ID, '/Users/nik/repos/app');
  assert.deepEqual(seen, { model: 'claude-sonnet-5-5', effort: 'high' });
});

test('finds the session in whichever directory droid filed it under', async (t) => {
  const s = sessions();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.put('some-other-spelling', ID, { model: 'custom:droidproxy:opus-5' });
  const seen = await new DroidSessionReader(s.root).read(ID, '/Users/nik/repos/app/.droid-office/worktrees/pixel');
  assert.deepEqual(seen, { model: 'custom:droidproxy:opus-5' });
});

test('sees a model change on the next read', async (t) => {
  const s = sessions();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  const reader = new DroidSessionReader(s.root);
  s.put('-app', ID, { model: 'glm-5', reasoningEffort: 'low' });
  assert.equal((await reader.read(ID, '/app'))?.model, 'glm-5');
  s.put('-app', ID, { model: 'kimi-k2.6' });
  assert.deepEqual(await reader.read(ID, '/app'), { model: 'kimi-k2.6' });
});

test('says nothing for a missing, unreadable or model-less session, or an unsafe id', async (t) => {
  const s = sessions();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  const reader = new DroidSessionReader(s.root);
  assert.equal(await reader.read(ID, '/app'), undefined);
  s.put('-app', ID, '{ not json');
  assert.equal(await reader.read(ID, '/app'), undefined);
  s.put('-app', ID, { reasoningEffort: 'high' });
  assert.equal(await reader.read(ID, '/app'), undefined);
  assert.equal(await reader.read('../../etc/passwd', '/app'), undefined);
});

test('ignores an effort the office does not know', async (t) => {
  const s = sessions();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.put('-app', ID, { model: 'glm-5', reasoningEffort: 'off' });
  assert.deepEqual(await new DroidSessionReader(s.root).read(ID, '/app'), { model: 'glm-5' });
});
