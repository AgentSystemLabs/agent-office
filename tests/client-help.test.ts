import test from 'node:test';
import assert from 'node:assert/strict';
import { HELP_ROWS } from '../src/client/ui/help.js';

test('every row of the controls help has a key and what it does, and no key is listed twice', () => {
  for (const [key, text] of HELP_ROWS) {
    assert.ok(key.trim(), `a row with no key: ${text}`);
    assert.ok(text.trim(), `${key} says nothing`);
  }
  const keys = HELP_ROWS.map(([k]) => k);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});
