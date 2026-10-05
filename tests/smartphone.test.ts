import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSms, loadThreads, logRecent, MAX_RECENTS, MAX_THREAD, saveThreads, threadKey } from '../src/shared/smartphone.js';
import { contactSub, kindIcon, statusNote } from '../src/client/features/smartphone/logic.js';

test('threads are keyed by floor and worker, and capped', () => {
  assert.equal(threadKey('f1', 'w1'), 'f1/w1');
  assert.equal(threadKey(null, 'w1'), 'lobby/w1');
  let thread = appendSms(undefined, 'hello');
  assert.deepEqual(thread.map((m) => [m.dir, m.text]), [['out', 'hello']]);
  for (let i = 0; i < MAX_THREAD + 5; i++) thread = appendSms(thread, `m${i}`, i % 2 ? 'note' : 'out');
  assert.equal(thread.length, MAX_THREAD);
  assert.equal(thread[0].text, 'm5');
});

test('recents put the latest first, one line per worker and kind, and are capped', () => {
  const at = Date.now();
  let recents = logRecent([], { kind: 'sms', workerId: 'a', name: 'A', at });
  recents = logRecent(recents, { kind: 'call', workerId: 'a', name: 'A', at });
  recents = logRecent(recents, { kind: 'sms', workerId: 'b', name: 'B', at });
  assert.deepEqual(
    recents.map((r) => [r.kind, r.workerId]),
    [
      ['sms', 'b'],
      ['call', 'a'],
      ['sms', 'a'],
    ],
  );
  // Texting A again moves only its SMS line to the top.
  recents = logRecent(recents, { kind: 'sms', workerId: 'a', name: 'A', at });
  assert.deepEqual(
    recents.map((r) => [r.kind, r.workerId]),
    [
      ['sms', 'a'],
      ['sms', 'b'],
      ['call', 'a'],
    ],
  );
  for (let i = 0; i < MAX_RECENTS + 5; i++) recents = logRecent(recents, { kind: 'sms', workerId: `w${i}`, name: `W${i}`, at });
  assert.equal(recents.length, MAX_RECENTS);
});

test('without a browser there are no kept threads, and keeping them never throws', () => {
  assert.deepEqual(loadThreads(), {});
  saveThreads({ 'f1/w1': [{ dir: 'out', text: 'hi', at: 0 }] });
});

test("a contact row names what it's on, and a lost worktree says how to fix it", () => {
  assert.equal(kindIcon({ kind: 'agent' }), '🤖');
  assert.equal(kindIcon({ kind: 'shell' }), '🐚');
  assert.equal(contactSub({ activity: 'Wants permission: npm test' }), 'Wants permission: npm test');
  assert.equal(contactSub({ pr: { number: 12, url: 'https://x' } }), '🔀 PR #12');
  assert.equal(contactSub({}), undefined);
  assert.equal(contactSub({ lost: { branch: 'here' } }), '🌿 worktree deleted — tap to fix it');
});

test('the SMS view promises only what the status allows', () => {
  assert.equal(statusNote({ name: 'Byte', status: 'needs_input' }), '💬 Byte might have answered — call to read it');
  assert.equal(statusNote({ name: 'Byte', status: 'working' }), '📩 delivered — working on it');
  assert.equal(statusNote({ name: 'Byte', status: 'starting' }), '📩 delivered — working on it');
  assert.equal(statusNote({ name: 'Byte', status: 'done' }), '📩 delivered — done, call to follow up');
  assert.equal(statusNote({ name: 'Byte', status: 'idle' }), '📩 delivered — ready when you are');
  assert.equal(statusNote({ name: 'Byte', status: 'exited' }), '💤 Byte is asleep — wake it (R at its desk, or call) before texting');
  assert.equal(statusNote({ name: 'Byte', status: 'offline' }), '💤 Byte is asleep — wake it (R at its desk, or call) before texting');
});
