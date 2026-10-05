import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSms, clearThreads, loadThreads, logRecent, MAX_KEYS, MAX_RECENTS, MAX_SMS_TEXT, MAX_THREAD, pruneThreadKeys, saveThread, threadKey } from '../src/shared/smartphone.js';
import type { SmsMsg } from '../src/shared/smartphone.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
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
  saveThread('f1/w1', [{ dir: 'out', text: 'hi', at: 0 }]);
  clearThreads();
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
  g.localStorage = {
    get length() {
      return kept.size;
    },
    key: (i: number) => [...kept.keys()][i] ?? null,
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  };
  try {
    run(kept);
  } finally {
    if (had === undefined) delete g.localStorage;
    else g.localStorage = had;
  }
}

test('loading keeps only well-formed lines, capped in length and count', () => {
  withStorage((kept) => {
    const put = (k: string, v: string) => kept.set(`agent-office.smartphone.thread:${k}`, v);
    put('f1/good', JSON.stringify([{ dir: 'out', text: 'hi', at: 1 }]));
    put('f1/shapes', JSON.stringify([null, 'text', 7, { dir: 'in', text: 'x', at: 3 }, { dir: 'out', at: 5 }]));
    put('f1/long', JSON.stringify([{ dir: 'out', text: 'x'.repeat(MAX_SMS_TEXT + 10), at: 1000 }]));
    put('f1/notarray', '"nope"');
    put('f1/broken', '{oops');
    put('__proto__', JSON.stringify([{ dir: 'out', text: 'evil', at: 7 }]));
    kept.set('other.key', '"hi"');
    for (let i = 0; i < MAX_KEYS + 3; i++) put(`f9/old${i}`, JSON.stringify([{ dir: 'out', text: 'old', at: 100 + i }]));
    const threads = loadThreads();
    // Malformed and unsafe keys are dropped; the cap then evicts the quietest (good, old0-3).
    assert.ok(!('f1/shapes' in threads) && !('f1/notarray' in threads) && !('f1/broken' in threads));
    assert.ok(!('f1/good' in threads));
    assert.ok('f1/long' in threads);
    assert.equal(threads['f1/long'][0].text.length, MAX_SMS_TEXT);
    assert.ok(`f9/old${MAX_KEYS + 2}` in threads);
    assert.equal(Object.keys(threads).length, MAX_KEYS);
    // Forgotten from storage too (malformed, unsafe, over cap); other keys untouched.
    const left = [...kept.keys()];
    assert.ok(!left.some((k) => k.endsWith('shapes') || k.endsWith('notarray') || k.endsWith('broken') || k.endsWith('__proto__')));
    assert.ok(!left.some((k) => k.endsWith('/good') || k.endsWith('old0') || k.endsWith('old1') || k.endsWith('old2') || k.endsWith('old3')));
    assert.ok(kept.has('other.key'));
    assert.deepEqual(({}).hasOwnProperty.call(threads, 'toString'), false);
  });
});

test('saving writes one key; empties remove theirs; clearing forgets threads only', () => {
  withStorage((kept) => {
    saveThread('f1/w1', [{ dir: 'out', text: 'hi', at: 1 }]);
    assert.equal(kept.get('agent-office.smartphone.thread:f1/w1'), JSON.stringify([{ dir: 'out', text: 'hi', at: 1 }]));
    saveThread('f1/w1', []);
    assert.ok(!kept.has('agent-office.smartphone.thread:f1/w1'));
    saveThread('__proto__', [{ dir: 'out', text: 'evil', at: 2 }]);
    assert.ok(![...kept.keys()].some((k) => k.endsWith('__proto__')));
    kept.set('other.key', '1');
    saveThread('f1/w2', [{ dir: 'out', text: 'x', at: 2 }]);
    clearThreads();
    assert.deepEqual([...kept.keys()], ['other.key']);
  });
});

test('the in-memory map is kept to the same cap, quietest first', () => {
  const threads: Record<string, SmsMsg[]> = {};
  for (let i = 0; i < MAX_KEYS + 5; i++) threads[`f1/w${i}`] = [{ dir: 'out', text: `m${i}`, at: i }];
  const pruned = pruneThreadKeys(threads);
  assert.equal(Object.keys(pruned).length, MAX_KEYS);
  assert.ok(!('f1/w0' in pruned) && !('f1/w4' in pruned) && 'f1/w5' in pruned);
  const few: Record<string, SmsMsg[]> = { a: [{ dir: 'out', text: 'x', at: 1 }] };
  assert.equal(pruneThreadKeys(few), few);
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

test('an unknown future status gets a neutral line, not a sleep lecture', () => {
  const future = { name: 'Byte', status: 'mystery' } as unknown as Pick<WorkerInfo, 'name' | 'status'>;
  assert.equal(statusNote(future), '📩 Byte · mystery');
});
