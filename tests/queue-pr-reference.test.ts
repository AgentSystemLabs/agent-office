import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referencesQueueIssue } from '../src/server/queue-pr-reference.js';

test('partial work explicitly links its task without claiming to close it', () => {
  const pull = { body: 'The ammo crate remains deferred.\n\nRefs #70\n', closes: [] };
  assert.equal(referencesQueueIssue(pull, 70), true);
  assert.deepEqual(pull.closes, []);
  assert.equal(referencesQueueIssue({ body: 'References #90.', closes: [] }, 90), true);
  assert.equal(referencesQueueIssue({ body: '', closes: [188] }, 188), true);
});

test('incidental mentions and number prefixes cannot attach an unrelated PR', () => {
  for (const body of ['Unlike #70 this does something else.', 'Refs #700', 'This is not Refs #70', 'Refs #70 was discussed, not implemented.']) {
    assert.equal(referencesQueueIssue({ body, closes: [] }, 70), false, body);
  }
});

test('explicit partial references retain their explanatory suffix without completing the issue', () => {
  for (const body of [
    'Refs #285 (part 1: the shove. The visible knockdown follows as part 2, so this PR does not close the issue).',
    'Refs #286 (not Closes: it is not confirmed on hardware that this was the reported offset).',
    '- References #285: follow-up implementation is still pending',
    'Refs #285 — part 1 only',
  ]) {
    const issue = body.includes('#286') ? 286 : 285;
    const pull = { body, closes: [] };
    assert.equal(referencesQueueIssue(pull, issue), true, body);
    assert.equal(referencesQueueIssue(pull, issue + 1), false, body);
    assert.deepEqual(pull.closes, []);
  }
  assert.equal(referencesQueueIssue({ body: 'Refs #285\n(See unrelated #286)', closes: [] }, 286), false);
});
