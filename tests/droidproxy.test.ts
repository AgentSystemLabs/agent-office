import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DroidProxyUsage, parseClaude, parseCodex, parseGrok, readCredentials, type Fetcher } from '../src/server/droidproxy.js';

const CLAUDE = {
  five_hour: { utilization: 24.0, resets_at: '2026-09-28T18:20:00.422294+00:00' },
  seven_day: { utilization: 71.0, resets_at: '2026-10-01T23:00:00.422317+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 4359.0, utilization: 87.18, spend_limit_reached: false },
  limits: [
    { kind: 'session', percent: 24, resets_at: '2026-09-28T18:20:00.422294+00:00', scope: null },
    { kind: 'weekly_all', percent: 71, resets_at: '2026-10-01T23:00:00.422317+00:00', scope: null },
    { kind: 'weekly_scoped', percent: 43, resets_at: '2026-10-01T23:00:00.422551+00:00', scope: { model: { id: null, display_name: 'Fable' } } },
  ],
};

const CODEX_PLUS = {
  plan_type: 'plus',
  rate_limit: {
    allowed: false,
    limit_reached: true,
    primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 12905, reset_at: 1790623713 },
    secondary_window: { used_percent: 16, limit_window_seconds: 604800, reset_after_seconds: 599705, reset_at: 1791210513 },
  },
};

const GROK = {
  config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-27T05:44:46.220789+00:00', end: '2026-10-04T05:44:46.220789+00:00' },
    creditUsagePercent: 38.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
  },
};

test('Claude: session, week, per-model weeks, and extra usage when it is on', () => {
  const r = parseClaude(CLAUDE);
  assert.deepEqual(
    r.windows.map((w) => [w.label, w.pct]),
    [
      ['5h', 24],
      ['Week', 71],
      ['Fable wk', 43],
      ['Extra', 87.18],
    ],
  );
  assert.equal(r.windows[0].resetsAt, Date.parse('2026-09-28T18:20:00.422294+00:00'));
  assert.equal(r.windows[3].resetsAt, undefined);
  assert.equal(r.limited, undefined);
  assert.equal(parseClaude({ ...CLAUDE, five_hour: { utilization: 100 } }).limited, true);
  // Extra usage switched off, and no per-model list: the old per-model buckets.
  const old = parseClaude({ five_hour: { utilization: 5 }, seven_day_opus: { utilization: 12 }, extra_usage: { is_enabled: false, utilization: 50 } });
  assert.deepEqual(
    old.windows.map((w) => w.label),
    ['5h', 'Opus wk'],
  );
  assert.deepEqual(parseClaude(null).windows, []);
});

test('Codex: windows named by their length, the plan, and a used-up limit', () => {
  const r = parseCodex(CODEX_PLUS);
  assert.deepEqual(
    r.windows.map((w) => [w.label, w.pct, w.resetsAt]),
    [
      ['5h', 100, 1790623713000],
      ['Week', 16, 1791210513000],
    ],
  );
  assert.equal(r.plan, 'plus');
  assert.equal(r.limited, true);
  // A plan with only a monthly limit reports it as the primary window.
  const monthly = parseCodex({ rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 30 * 86400 } } });
  assert.deepEqual(
    monthly.windows.map((w) => w.label),
    ['Month'],
  );
  assert.deepEqual(parseCodex({}).windows, []);
});

test('Grok: one credit window for the billing period', () => {
  const r = parseGrok(GROK);
  assert.deepEqual(r.windows, [{ label: 'Week', pct: 38, resetsAt: Date.parse('2026-10-04T05:44:46.220789+00:00') }]);
  const capped = parseGrok({ config: { onDemandCap: { val: 200 }, onDemandUsed: { val: 50 } } });
  assert.deepEqual(
    capped.windows.map((w) => [w.label, w.pct]),
    [['Credits', 25]],
  );
  assert.deepEqual(parseGrok({ config: {} }).windows, []);
});

function authDir(files: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-droidproxy-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

test('reads only enabled Claude, Codex and Grok sign-ins, Claude first', (t) => {
  const dir = authDir({
    'codex-a.json': { type: 'codex', access_token: 'c1', account_id: 'acct', expired: '2099-01-01T00:00:00Z', disabled: false },
    'claude-a.json': { type: 'claude', access_token: 'k1', expired: '2099-01-01T00:00:00Z' },
    'codex-off.json': { type: 'codex', access_token: 'c2', disabled: true },
    'grok-cli.json': { type: 'grok-cli', access: 'g1', expires: 4_000_000_000_000 },
    'antigravity-a.json': { type: 'antigravity', access_token: 'x' },
    'broken.json': '{',
    'merged-config.yaml': 'port: 8318',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const creds = readCredentials(dir)!;
  assert.deepEqual(
    creds.map((c) => [c.provider, c.file]),
    [
      ['claude', 'claude-a.json'],
      ['codex', 'codex-a.json'],
      ['grok', 'grok-cli.json'],
    ],
  );
  assert.equal(creds[1].accountId, 'acct');
  assert.equal(creds[2].expires, 4_000_000_000_000);
  assert.equal(readCredentials(path.join(dir, 'missing')), null);
});

test('asks each provider, never passes on emails or tokens, and says why an account has no numbers', async (t) => {
  const dir = authDir({
    'claude-me@example.com.json': { type: 'claude', email: 'me@example.com', access_token: 'k1', expired: '2099-01-01T00:00:00Z' },
    'codex-1-me@example.com-plus.json': { type: 'codex', email: 'me@example.com', access_token: 'c1', account_id: 'acct', expired: '2099-01-01T00:00:00Z' },
    'codex-2-me@example.com-plus.json': { type: 'codex', email: 'me@example.com', access_token: 'c2', expired: '2000-01-01T00:00:00Z' },
    'grok-cli.json': { type: 'grok-cli', email: 'me@example.com', access: 'g1', expires: 4_000_000_000_000 },
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const asked: [string, Record<string, string>][] = [];
  const fetcher: Fetcher = async (url, init) => {
    asked.push([url, init.headers]);
    const body = url.includes('anthropic') ? CLAUDE : url.includes('chatgpt') ? CODEX_PLUS : url.includes('grok') ? GROK : {};
    return { status: url.includes('grok') ? 401 : 200, json: async () => body };
  };
  const reader = new DroidProxyUsage(
    dir,
    () => true,
    () => {},
    fetcher,
    'http://health',
  );
  const s = await reader.read();
  assert.equal(s.running, true);
  assert.deepEqual(
    s.accounts.map((a) => a.label),
    ['Claude', 'Codex 1', 'Codex 2', 'Grok'],
  );
  assert.equal(s.accounts[1].plan, 'plus');
  assert.equal(s.accounts[1].limited, true);
  assert.match(s.accounts[2].error ?? '', /expired/);
  assert.match(s.accounts[3].error ?? '', /Signed out/);
  assert.doesNotMatch(JSON.stringify(s), /example\.com|k1|c1|g1|acct/);
  // The expired Codex sign-in isn't sent anywhere; the others go with DroidProxy's own headers.
  const codex = asked.find(([u]) => u.includes('chatgpt'))!;
  assert.equal(codex[1].Authorization, 'Bearer c1');
  assert.equal(codex[1]['ChatGPT-Account-Id'], 'acct');
  assert.equal(asked.find(([u]) => u.includes('anthropic'))![1]['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(asked.find(([u]) => u.includes('grok'))![1]['x-xai-token-auth'], 'xai-grok-cli');
  assert.equal(asked.filter(([u]) => u.includes('chatgpt')).length, 1);
});

test('no DroidProxy folder: no accounts, and nothing is fetched', async () => {
  let fetched = 0;
  const reader = new DroidProxyUsage(
    path.join(tmpdir(), 'no-such-droidproxy'),
    () => true,
    () => {},
    async () => {
      fetched++;
      return { status: 200, json: async () => ({}) };
    },
  );
  const s = await reader.read();
  assert.deepEqual(s.accounts, []);
  assert.equal(s.running, undefined);
  assert.equal(fetched, 0);
});
