import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSms, loadThreads, logRecent, MAX_KEYS, MAX_RECENTS, MAX_SMS_TEXT, MAX_THREAD, saveThreads, threadKey } from '../src/shared/smartphone.js';
import { contactSub, dotColor, kindIcon, statusNote } from '../src/client/features/smartphone/logic.js';

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

test('only plain hex colors reach the stylesheet, anything else falls back', () => {
  assert.equal(dotColor({ color: '#4f86f7' }), '#4f86f7');
  assert.equal(dotColor({ color: '#ABCDEF' }), '#ABCDEF');
  for (const bad of ['', 'red', '#fff', '#gggggg', '#1234567', 'a;#x{background:url(//evil)}', '#4f86f7;foo:bar']) assert.equal(dotColor({ color: bad }), '#888888', bad);
});

function withStorage(run: (kept: Map<string, string>) => void) {
  const kept = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  const had = g.localStorage;
  g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  try {
    run(kept);
  } finally {
    if (had === undefined) delete g.localStorage;
    else g.localStorage = had;
  }
}

test('loading keeps only well-formed lines, capped in length and count', () => {
  withStorage((kept) => {
    kept.set(
      'agent-office.smartphone.threads',
      JSON.stringify({
        good: [
          { dir: 'out', text: 'hi', at: 1 },
          { dir: 'note', text: 'n', at: 2 },
          null,
          'text',
          7,
          { dir: 'in', text: 'wrong dir', at: 3 },
          { dir: 'out', text: 'x'.repeat(MAX_SMS_TEXT + 10), at: 4 },
          { dir: 'out', at: 5 },
        ],
        empty: [{ dir: 'out', text: 'x', at: 1 }].slice(1),
        nothread: 'nope',
      }),
    );
    const threads = loadThreads();
    assert.deepEqual(Object.keys(threads), ['good']);
    assert.deepEqual(
      threads.good.map((m) => [m.dir, m.text.length]),
      [
        ['out', 2],
        ['note', 1],
        ['out', MAX_SMS_TEXT],
      ],
    );
  });
});

test('saving caps the thread count, quietest threads go first', () => {
  withStorage((kept) => {
    const threads: Record<string, { dir: 'out'; text: string; at: number }[]> = {};
    for (let i = 0; i < MAX_KEYS + 5; i++) threads[`f1/w${i}`] = [{ dir: 'out', text: `m${i}`, at: i }];
    threads.empty = [];
    saveThreads(threads);
    const saved = JSON.parse(kept.get('agent-office.smartphone.threads')!) as Record<string, unknown[]>;
    assert.equal(Object.keys(saved).length, MAX_KEYS);
    assert.ok(!('empty' in saved));
    assert.ok(!('f1/w0' in saved) && !('f1/w4' in saved) && 'f1/w5' in saved && `f1/w${MAX_KEYS + 4}` in saved);
  });
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
