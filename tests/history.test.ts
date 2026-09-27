import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { CHAT_KEEP, ChatLog, ScrollbackStore, searchTerminal, terminalTail } from '../src/server/history.js';
import { findLine, searchKey, snippet } from '../src/shared/search.js';
import type { ChatLine } from '../src/shared/protocol.js';

function dataDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function terminal(cols = 80, rows = 10) {
  const term = new headless.Terminal({ cols, rows, scrollback: 3000, allowProposedApi: true });
  const ser = new serialize.SerializeAddon();
  term.loadAddon(ser as any);
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, ser, write };
}

const line = (text: string, name = 'Sam', at = Date.now()): ChatLine => ({ from: 'x', name, color: '#ef476f', text, at });

test('chat survives a restart, trimmed to the newest lines, and skips a torn last line', (t) => {
  const dir = dataDir(t);
  const first = new ChatLog(dir);
  for (let i = 0; i < CHAT_KEEP + 5; i++) first.add(line(`message ${i}`));
  appendFileSync(path.join(dir, 'chat.jsonl'), '{"from":"x","name":"Sam","te');

  const again = new ChatLog(dir);
  const recent = again.recent(CHAT_KEEP + 10);
  assert.equal(recent.length, CHAT_KEEP);
  assert.equal(recent[0].text, 'message 5');
  assert.equal(recent.at(-1)!.text, `message ${CHAT_KEEP + 4}`);
  // The rewrite on load dropped the overflow and the torn line.
  assert.equal(readFileSync(path.join(dir, 'chat.jsonl'), 'utf8').trim().split('\n').length, CHAT_KEEP);
});

test('chat search matches text or sender, any case and spacing, newest first', (t) => {
  const log = new ChatLog(dataDir(t));
  log.add(line('the  deploy TIMED out'));
  log.add(line('lunch?', 'Robin'));
  log.add(line('deploy is green now'));
  assert.deepEqual(log.search(searchKey('Deploy'), 10).hits.map((l) => l.text), ['deploy is green now', 'the  deploy TIMED out']);
  assert.deepEqual(log.search(searchKey('deploy timed'), 10).hits.map((l) => l.text), ['the  deploy TIMED out']);
  assert.deepEqual(log.search(searchKey('robin: lunch'), 10).hits.map((l) => l.text), ['lunch?']);
  const capped = log.search(searchKey('deploy'), 1);
  assert.equal(capped.hits.length, 1);
  assert.equal(capped.more, true);
});

test('a terminal tail restores its lines, colors and wrapping into a new terminal of another width', async () => {
  const a = terminal(120);
  let out = '';
  for (let i = 1; i <= 50; i++) out += `\x1b[32mline ${i}\x1b[0m\r\n`;
  out += `wrapped ${'y'.repeat(150)} END\r\n`;
  // A TUI leaves the cursor above its last line; the tail still ends after it.
  await a.write(`${out}\x1b[5A`);
  const tail = terminalTail(a.term, a.ser, 20);
  assert.ok(tail.includes('\x1b[32m'), 'keeps colors');

  const b = terminal(100);
  await b.write(`${tail}\r\nNEXT\r\n`);
  const buf = b.term.buffer.normal;
  const text: string[] = [];
  for (let y = 0; y < buf.length; y++) text.push(buf.getLine(y)!.translateToString(true));
  assert.ok(!text.includes('line 30'), 'only the last 20 lines');
  assert.ok(text.includes('line 50'));
  const next = text.indexOf('NEXT');
  assert.ok(text[next - 1].endsWith(' END'), 'what follows comes right after the old last line');
  assert.equal(searchTerminal(b.term, searchKey('yyy end'), 5).hits.length, 1, 'a wrapped line is found as one line');
});

test('terminal search shows each distinct line once, newest first, and says where it is', async () => {
  const { term, write } = terminal();
  await write('status: building\r\nError: disk full\r\nstatus: building\r\nerror: DISK full again\r\n');
  const found = searchTerminal(term, searchKey('disk full'), 10);
  assert.deepEqual(found.hits.map((h) => h.text), ['error: DISK full again', 'Error: disk full']);
  assert.deepEqual(searchTerminal(term, searchKey('status'), 10).hits.map((h) => h.text), ['status: building']);
  // The row is where the browser's copy of the terminal looks for it again.
  const hit = found.hits[1];
  assert.equal(findLine(term.buffer.active, searchKey('disk full'), hit.rows - hit.row), hit.row);
});

test('snippets cut long lines down around the match', () => {
  const long = `${'a '.repeat(200)}NEEDLE${' b'.repeat(200)}`;
  const s = snippet(long, 'needle', 60);
  assert.ok(s.includes('NEEDLE'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.length <= 62);
});

test('scrollback files are per worker, and pruning keeps only workers still at a desk', (t) => {
  const store = new ScrollbackStore(dataDir(t));
  store.save('aaa', 'one');
  store.save('bbb', 'two');
  store.save('../evil', 'nope');
  store.prune(new Set(['aaa']));
  assert.equal(store.load('aaa'), 'one');
  assert.equal(store.load('bbb'), undefined);
  assert.equal(store.load('../evil'), undefined);
  store.remove('aaa');
  assert.equal(store.load('aaa'), undefined);
});
