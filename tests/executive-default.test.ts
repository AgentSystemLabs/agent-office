import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EXECUTIVE_MAP, OFFICE_MAP } from '../src/shared/maps/index.js';

test('the staged default identifier is Executive World while Office remains a valid fallback choice', () => {
  assert.equal(EXECUTIVE_MAP, 'executive');
  assert.notEqual(EXECUTIVE_MAP, OFFICE_MAP);
});
