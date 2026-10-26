import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadWorkerProfiles, parseWorkerProfiles, profilePrompt } from '../src/server/worker-profiles.js';
import { workerSlug } from '../src/server/workers/identity.js';
import { execFileSync } from 'node:child_process';

const worker = { id: 'employee-1', name: 'Example Worker', description: 'Implementation role', provider: 'codex', model: 'gpt-6-luna', effort: 'max', enabled: true, holds: [] };
test('full names and punctuation produce actual git-valid worktree branches', () => {
  for (const name of ['Example Worker', 'Mehmet Yağız Maktav', 'Reviewer [QA] / ../', '🚀']) {
    const branch = 'office/' + workerSlug(name, 'abcd1234');
    assert.doesNotThrow(() => execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'pipe' }));
  }
  assert.equal(workerSlug('Pixel', 'abcd1234'), 'pixel-abcd');
});
test('a named profile keeps its exact model and effort', () => {
  const profile = parseWorkerProfiles([worker])[0];
  assert.equal(profile.name, worker.name); assert.equal(profile.model, 'gpt-6-luna'); assert.equal(profile.effort, 'max'); assert.equal(profile.enabled, true);
  assert.match(profilePrompt(profile, 'Prepare a report'), /Named worker: Example Worker/);
});
test('source holds and missing routes never fall back or enable a profile', () => {
  for (const change of [{ enabled: false }, { holds: ['free-only source hold'] }, { effort: null }, { model: null }, { provider: 'custom' }, { provider: 'opencode', model: 'invalid' }]) {
    const profile = parseWorkerProfiles([{ ...worker, ...change }])[0];
    assert.equal(profile.enabled, false, JSON.stringify(change)); assert.ok(profile.holds.length);
  }
});
test('duplicate identities and malformed records are rejected', () => {
  assert.throws(() => parseWorkerProfiles([worker, worker]), /unique/);
  assert.throws(() => parseWorkerProfiles([{ ...worker, name: 'bad\nname' }]), /nonempty/);
  assert.throws(() => parseWorkerProfiles({ profiles: [worker] }), /list/);
});
test('profile loading is optional and refuses symlinks', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-profiles-'));
  try {
    assert.deepEqual(loadWorkerProfiles(root), []);
    const data = path.join(root, 'source.json'); writeFileSync(data, JSON.stringify([worker]));
    symlinkSync(data, path.join(root, 'worker-profiles.json'));
    assert.throws(() => loadWorkerProfiles(root), /Invalid worker profiles/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
