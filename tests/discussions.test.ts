import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Discussions } from '../src/server/discussions.js';

test('discussion alternates, caps replies, and restores an undelivered handoff after restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-discussion-'));
  try {
    let store = new Discussions(dir);
    const start = store.start('pixel', 'byte', 'Review the sync design', 4);
    assert.equal(typeof start, 'object');
    if (typeof start === 'string') return;
    assert.equal(store.pending()?.to, 'pixel');
    assert.equal(store.post(start.id, 'pixel', 'Too early'), 'Your turn has not been delivered yet');
    store.delivered();
    const first = store.post(start.id, 'pixel', 'Use a transaction; check concurrent writes');
    assert.equal(typeof first, 'object');
    assert.equal(store.pending()?.to, 'byte');
    store = new Discussions(dir);
    assert.equal(store.pending()?.to, 'byte');
    assert.equal(store.post(start.id, 'pixel', 'Wrong turn'), 'Wait for your turn');
    store.delivered();
    store.post(start.id, 'byte', 'Add a unique constraint');
    store.delivered();
    store.post(start.id, 'pixel', 'I added it and tested contention');
    store.delivered();
    const last = store.post(start.id, 'byte', 'Approved; monitor lock waits');
    assert.equal(typeof last, 'object');
    if (typeof last === 'string') return;
    assert.equal(last.finished, true);
    assert.equal(last.messages.length, 4);
    assert.equal(store.pending(), undefined);
    assert.equal(store.post(start.id, 'pixel', 'One more'), 'This discussion is complete');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a new discussion supersedes the previous one', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-discussion-'));
  try {
    const store = new Discussions(dir);
    const first = store.start('pixel', 'byte', 'First', 6);
    const next = store.start('pixel', 'byte', 'Second', 6);
    assert.equal(typeof first, 'object');
    assert.equal(typeof next, 'object');
    if (typeof first === 'string' || typeof next === 'string') return;
    assert.notEqual(first.id, next.id);
    assert.equal(store.post(first.id, 'pixel', 'stale'), 'No such discussion');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
