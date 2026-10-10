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
