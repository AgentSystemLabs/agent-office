import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexUsageReader, CodexPlanSnapshot, codexTokenUsage, codexPlanLimits } from '../src/server/codex-usage.js';

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


test('reads account limits separately from cumulative tokens and preserves their report time', t => {
  const { home, file } = fixture(t);
  const reader = new CodexUsageReader();
  const timestamp = '2026-10-01T12:00:00Z';
  const rate_limits = { primary: { used_percent: 42, window_minutes: 300, resets_at: 1790859600 }, secondary: { used_percent: 18, window_minutes: 10080 } };
  const row = JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits } });
  writeFileSync(file, header() + event() + '\n' + row + '\n');
  const expected = codexPlanLimits(rate_limits, Date.parse(timestamp));
  assert.deepEqual(reader.read(file, 'thread-1', home)?.planLimits, expected);
  assert.deepEqual(expected?.windows, [{ label: '5h session', pct: 42, resetsAt: 1790859600000 }, { label: 'Week', pct: 18 }]);
  appendFileSync(file, event(totals(240, 60)) + '\n');
  assert.deepEqual(reader.read(file, 'thread-1', home)?.planLimits, expected);
  appendFileSync(file, JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', rate_limits: null } }) + '\n');
  assert.equal(reader.read(file, 'thread-1', home)?.planLimits, undefined);
});

test('rejects malformed Codex limits and clamps percentages', () => {
  assert.equal(codexPlanLimits(null, Date.now()), undefined);
  assert.equal(codexPlanLimits({ primary: { used_percent: NaN, window_minutes: 300 } }, Date.now()), undefined);
  assert.equal(codexPlanLimits({ primary: { used_percent: 50, window_minutes: -1 } }, Date.now()), undefined);
  assert.equal(codexPlanLimits({ primary: { used_percent: 50, window_minutes: 300 } }, NaN), undefined);
  assert.equal(codexPlanLimits({ primary: { used_percent: 120, window_minutes: 300 } }, Date.now())?.windows[0].pct, 100);
});

test('shared Codex plan snapshot uses the newest report without summing workers', () => {
  const shared = new CodexPlanSnapshot();
  const older = { windows: [{ label: 'Week', pct: 20 }], at: 1000 };
  const newer = { windows: [{ label: 'Week', pct: 35 }], at: 2000 };
  assert.equal(shared.update(older), true);
  assert.equal(shared.update(newer), true);
  assert.equal(shared.update(older), false);
  assert.equal(shared.update({ windows: [{ label: 'Week', pct: 99 }], at: 2000 }), false);
  assert.equal(shared.update(undefined), false);
  assert.equal(shared.update({ windows: [], at: 3000 }), false);
  assert.deepEqual(shared.state, newer);
});
