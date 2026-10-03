import test from 'node:test';
import assert from 'node:assert/strict';
import { modelTiers, pickModel } from '../src/server/model-tiers.js';

test('a tier maps to its router tier, AGENT_OFFICE_MODEL_TIERS renames them, and Opus is refused', () => {
  assert.deepEqual(pickModel('low', undefined, {}), { model: 'tier-low', tier: 'low' });
  assert.equal(modelTiers({ AGENT_OFFICE_MODEL_TIERS: 'high=tier-high, medium=tier-medium' }).high, 'tier-high');
  assert.equal(modelTiers({ AGENT_OFFICE_MODEL_TIERS: 'high=claude-opus-5' }).high, 'tier-high');
  assert.equal(typeof pickModel(undefined, 'claude-opus-5'), 'string');
  assert.equal(modelTiers({ AGENT_OFFICE_MODEL_TIERS: 'low=rm -rf /' }).low, 'tier-low');
});

test('a named model must be one word, and a tier or a model is needed', () => {
  assert.deepEqual(pickModel(undefined, 'sonnet'), { model: 'sonnet' });
  assert.equal(typeof pickModel(undefined, 'a b; c'), 'string');
  assert.equal(typeof pickModel('huge', undefined), 'string');
});
