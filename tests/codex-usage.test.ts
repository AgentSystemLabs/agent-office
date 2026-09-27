import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexUsageReader, codexTokenUsage } from '../src/server/codex-usage.js';

const totals = (input = 120, output = 30) => ({ input_tokens: input, cached_input_tokens: 20, cache_write_input_tokens: 5, output_tokens: output, reasoning_output_tokens: 10, total_tokens: input + output });
const event = (value = totals()) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: value } } });
const header = (id = 'thread-1') => JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n';

function fixture(t: { after(fn: () => void): void }) {
  const home = mkdtempSync(path.join(tmpdir(), 'office-codex-metrics-'));
  const dir = path.join(home, 'sessions', '2026', '09', '26');
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, file: path.join(dir, 'rollout-2026-09-26-thread-1.jsonl') };
}

test('normalizes overlapping Codex token buckets without inventing cost or API calls', () => {
  const usage = codexTokenUsage(totals())!;
  assert.deepEqual(usage, { input: 100, output: 20, reasoning: 10, cacheRead: 20, cacheWrite: 5, totalTokens: 150, cost: 0, costKnown: false, calls: 0, callsKnown: false });
  assert.equal(usage.totalTokens, 150);
  assert.equal(codexTokenUsage({ ...totals(), total_tokens: 200000 })?.totalTokens, 200000);
  assert.equal(codexTokenUsage({ ...totals(), total_tokens: 200000 })?.incomplete, true);
  assert.equal(codexTokenUsage({ ...totals(), cache_write_input_tokens: undefined })?.cacheWrite, 0);
  for (const bad of [null, { ...totals(), input_tokens: -1 }, { ...totals(), cached_input_tokens: 121 }, { ...totals(), reasoning_output_tokens: 31 }, { ...totals(), total_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...totals(), output_tokens: Infinity }]) assert.equal(codexTokenUsage(bad), undefined);
});

test('replaces cumulative snapshots, ignores replays, and waits for complete appended lines', t => {
  const { home, file } = fixture(t);
  const reader = new CodexUsageReader();
  writeFileSync(file, header() + event() + '\n' + event() + '\n');
  assert.deepEqual(reader.read(file, 'thread-1', home), codexTokenUsage(totals()));
  assert.equal(reader.read(file, 'thread-1', home), undefined);
  appendFileSync(file, event(totals(240, 60)));
  assert.deepEqual(reader.read(file, 'thread-1', home), codexTokenUsage(totals()));
  appendFileSync(file, '\n');
  assert.deepEqual(reader.read(file, 'thread-1', home), codexTokenUsage(totals(240, 60)));
  writeFileSync(file, header() + event(totals(140, 40)) + '\n');
  assert.deepEqual(reader.read(file, 'thread-1', home), codexTokenUsage(totals(140, 40)));
});

test('rejects foreign session metadata, outside paths and symlink escapes', t => {
  const { home, file } = fixture(t);
  const reader = new CodexUsageReader();
  writeFileSync(file, header('foreign-thread') + event() + '\n');
  assert.equal(reader.read(file, 'thread-1', home), undefined);
  assert.equal(reader.read(file, '../thread-1', home), undefined);
  const outside = path.join(home, 'rollout-other-thread-1.jsonl');
  writeFileSync(outside, header() + event() + '\n');
  assert.equal(reader.read(outside, 'thread-1', home), undefined);
  const link = path.join(home, 'sessions', 'rollout-link-thread-1.jsonl');
  symlinkSync(outside, link);
  assert.equal(reader.read(link, 'thread-1', home), undefined);
});

test('bounded tail recovers cumulative usage after large non-metric records', t => {
  const { home, file } = fixture(t);
  writeFileSync(file, header() + JSON.stringify({ type: 'response_item', payload: 'x'.repeat(5 * 1024 * 1024) }) + '\n' + event() + '\n');
  assert.deepEqual(new CodexUsageReader().read(file, 'thread-1', home), codexTokenUsage(totals()));
});
