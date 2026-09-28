import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Devices, bearerToken } from '../src/server/devices.js';

function dir(t: { after(fn: () => void): void }) {
  const d = mkdtempSync(path.join(tmpdir(), 'agent-office-devices-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('codes are short, human-readable and expire in 10 minutes', (t) => {
  const d = new Devices(dir(t));
  const before = Date.now();
  const { code, expiresAt } = d.start();
  assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  assert.ok(expiresAt - before > 9 * 60_000 && expiresAt - before <= 10 * 60_000 + 5000);
});

test('claiming consumes the code: single use', (t) => {
  const d = new Devices(dir(t));
  const { code } = d.start();
  const first = d.claim(code, ' Quest 3 ');
  assert.ok(first);
  assert.equal(first.device.name, 'Quest 3');
  assert.ok(first.token.length >= 43, '32 random bytes in base64url');
  assert.equal(d.claim(code, 'Quest 3'), undefined);
});

test('wrong codes claim nothing', (t) => {
  const d = new Devices(dir(t));
  d.start();
  assert.equal(d.claim('ZZZZZZZZ', 'Quest 3'), undefined);
  assert.equal(d.claim('', 'Quest 3'), undefined);
});

test('starting a new code voids the old one', (t) => {
  const d = new Devices(dir(t));
  const old = d.start();
  d.start();
  assert.equal(d.claim(old.code, 'Quest 3'), undefined);
});

test('tokens verify, and only the hash is ever stored', (t) => {
  const home = dir(t);
  const d = new Devices(home);
  const { code } = d.start();
  const claimed = d.claim(code, 'Quest 3')!;
  const seen = d.verify(claimed.token);
  assert.equal(seen?.name, 'Quest 3');
  assert.ok(seen?.lastSeenAt);
  assert.equal(d.verify('bogus'), undefined);
  assert.equal(d.verify(undefined), undefined);
  const saved = readFileSync(path.join(home, 'devices.json'), 'utf8');
  assert.ok(!saved.includes(claimed.token), 'the raw token must never hit the disk');
  assert.ok(saved.includes(claimed.device.id));
  // ...and they survive a restart.
  const again = new Devices(home);
  assert.equal(again.verify(claimed.token)?.id, claimed.device.id);
});

test('revoke deletes the device and its token stops working', (t) => {
  const d = new Devices(dir(t));
  const { code } = d.start();
  const claimed = d.claim(code, 'Quest 3')!;
  assert.equal(d.list().length, 1);
  assert.ok(!('tokenHash' in d.list()[0]), 'listings never leak the hash');
  assert.equal(d.revoke('nope'), undefined);
  assert.ok(d.revoke(claimed.device.id));
  assert.deepEqual(d.list(), []);
  assert.equal(d.verify(claimed.token), undefined);
});

test('bearerToken reads Authorization headers', () => {
  assert.equal(bearerToken('Bearer abc123'), 'abc123');
  assert.equal(bearerToken('bearer abc123'), 'abc123');
  assert.equal(bearerToken('Basic abc123'), undefined);
  assert.equal(bearerToken('Bearer'), undefined);
  assert.equal(bearerToken(undefined), undefined);
});

test('an unreadable devices file is never written over', (t) => {
  const home = dir(t);
  writeFileSync(path.join(home, 'devices.json'), '{broken');
  const errors: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  try {
    const d = new Devices(home);
    const { code } = d.start();
    d.claim(code, 'Quest 3');
    assert.equal(readFileSync(path.join(home, 'devices.json'), 'utf8'), '{broken');
    assert.ok(errors.some((e) => e.includes("couldn't read")));
  } finally {
    console.error = error;
  }
});
