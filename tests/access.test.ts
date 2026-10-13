import test from 'node:test';
import assert from 'node:assert/strict';
import { councilAccess } from '../src/shared/access.js';

test('maps existing account model to friendly council roles and capabilities', () => {
  assert.deepEqual(councilAccess({ admin: true, account: { role: 'admin' } }), { role: 'Owner', manage: true, research: true, execute: true });
  assert.deepEqual(councilAccess({ admin: false, account: { role: 'member' } }), { role: 'Research Partner', manage: false, research: true, execute: true });
  assert.deepEqual(councilAccess({ admin: false }), { role: 'Guest', manage: false, research: false, execute: false });
});
