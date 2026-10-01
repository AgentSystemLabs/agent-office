import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Auth } from '../src/server/auth.js';
import type { Accounts } from '../src/server/accounts.js';

const auth = () => new Auth(randomBytes(32), randomBytes(16), 'secret', {} as Accounts);

test('a sign-in link works once', () => {
  const a = auth();
  const key = a.linkKey();
  assert.match(key, /^[\w-]{32}$/);
  assert.equal(a.useLinkKey(key), true);
  assert.equal(a.useLinkKey(key), false);
});

test("a made-up or empty key isn't a sign-in link, and another office's isn't either", () => {
  const a = auth();
  a.linkKey();
  assert.equal(a.useLinkKey(''), false);
  assert.equal(a.useLinkKey('x'.repeat(32)), false);
  assert.equal(a.useLinkKey(auth().linkKey()), false);
});

test('only the newest sign-in links are kept', () => {
  const a = auth();
  const first = a.linkKey();
  const later = Array.from({ length: 8 }, () => a.linkKey());
  assert.equal(a.useLinkKey(first), false);
  for (const key of later) assert.equal(a.useLinkKey(key), true);
});
