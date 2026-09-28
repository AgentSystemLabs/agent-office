import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDroidModelCatalogue, readDroidModels } from '../src/server/droid-models.js';

function settingsFile(t: { after(fn: () => void): void }, body: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-droid-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

test('Droid catalogue lists custom models with their display names and efforts', (t) => {
  const file = settingsFile(t, {
    customModels: [
      { id: 'custom:droidproxy:gpt-6-sol', displayName: 'DroidProxy: GPT 6 Sol', defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: ['low', 'xhigh', 'bogus'] },
      { id: 'custom:droidproxy:gpt-6-sol', displayName: 'duplicate' },
      { id: 'has a space', displayName: 'bad' },
      { id: '', displayName: 'empty' },
      { nope: true },
    ],
    sessionDefaultSettings: { model: 'custom:droidproxy:muse-spark-1.3-contributor', reasoningEffort: 'max' },
    modelFavorites: ['glm-5.3-flash', 'custom:droidproxy:gpt-6-sol'],
  });
  const catalogue = readDroidModels(file);
  assert.deepEqual(catalogue.models, [
    { id: 'custom:droidproxy:gpt-6-sol', displayName: 'DroidProxy: GPT 6 Sol', defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: ['low', 'xhigh'] },
    { id: 'custom:droidproxy:muse-spark-1.3-contributor', displayName: 'custom:droidproxy:muse-spark-1.3-contributor' },
    { id: 'glm-5.3-flash', displayName: 'glm-5.3-flash' },
  ]);
  assert.equal(catalogue.defaultModel, 'custom:droidproxy:muse-spark-1.3-contributor');
  assert.equal(catalogue.defaultReasoningEffort, 'max');
});

test('Droid catalogue tolerates missing, corrupt, or model-less settings', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-droid-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readDroidModels(path.join(dir, 'nope.json')), { models: [] });
  assert.deepEqual(readDroidModels(settingsFile(t, 'not json{{')), { models: [] });
  assert.deepEqual(readDroidModels(settingsFile(t, { theme: 'factory-dark' })), { models: [] });
  const badDefault = readDroidModels(settingsFile(t, { customModels: [], sessionDefaultSettings: { model: 'has a space', reasoningEffort: 'overdrive' } }));
  assert.deepEqual(badDefault, { models: [] });
});

test('Droid catalogue caches briefly', async (t) => {
  const file = settingsFile(t, { customModels: [{ id: 'custom:a', displayName: 'A' }] });
  let now = 1000;
  const catalogue = createDroidModelCatalogue(file, () => now);
  assert.deepEqual((await catalogue.get()).models.map((m) => m.id), ['custom:a']);
  writeFileSync(file, JSON.stringify({ customModels: [{ id: 'custom:b', displayName: 'B' }] }));
  now += 59_999;
  assert.deepEqual((await catalogue.get()).models.map((m) => m.id), ['custom:a']);
  now += 2;
  assert.deepEqual((await catalogue.get()).models.map((m) => m.id), ['custom:b']);
});
