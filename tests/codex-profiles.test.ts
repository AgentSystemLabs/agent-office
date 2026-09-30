import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { availableProfile, codexProfiles } from '../src/server/codex-profiles.js';

test('profile routing is explicit per worker and waits for an account reset', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-profiles-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const homes = [path.join(dir, 'first'), path.join(dir, 'second')];
  writeFileSync(path.join(dir, 'codex-accounts.json'), JSON.stringify({ workers: { pixel: homes } }));
  assert.deepEqual(codexProfiles(dir, 'pixel'), homes);
  assert.equal(codexProfiles(dir, 'byte'), undefined);
  assert.equal(availableProfile(0, [2000, 0], 1000), 1);
  assert.equal(availableProfile(1, [2000, 3000], 1000), undefined);
  assert.equal(availableProfile(1, [2000, 3000], 2000), 0);
});
