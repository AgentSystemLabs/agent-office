import test from 'node:test';
import assert from 'node:assert/strict';
import { codexPlanLimits } from '../src/server/codex-limits.js';

test('normalizes Codex short and weekly allowance windows for the usage clocks', () => {
  const limits = codexPlanLimits({
    planType: 'plus',
    rateLimits: { limitId: 'codex', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 62.7, windowDurationMins: 10_080, resetsAt: 1_800_600_000 } },
  }, 1234);

  assert.deepEqual(limits, {
    plan: 'plus',
    windows: [
      { label: '5-hour', pct: 10, resetsAt: 1_800_000_000_000 },
      { label: 'Weekly', pct: 62.7, resetsAt: 1_800_600_000_000 },
    ],
    at: 1234,
    checkedAt: 1234,
    status: 'ready',
  });
});

test('prefers the Codex bucket from multi-bucket snapshots and bounds bad percentages', () => {
  const limits = codexPlanLimits({
    rateLimits: { primary: { usedPercent: 2 } },
    rateLimitsByLimitId: { codex: { planType: 'plus', primary: { usedPercent: 140, windowDurationMins: 30 }, secondary: { usedPercent: -4 } } },
  }, 100);

  assert.equal(limits.status, 'ready');
  assert.equal(limits.windows[0]?.label, '30m');
  assert.equal(limits.windows[0]?.pct, 100);
  assert.equal(limits.windows[1]?.pct, 0);
});

test('reports unavailable state when the signed-in account has no plan limit snapshot', () => {
  const limits = codexPlanLimits({}, 321);
  assert.deepEqual(limits, {
    windows: [],
    at: 0,
    checkedAt: 321,
    status: 'unavailable',
    message: 'No Codex plan usage is available for this sign-in.',
  });
});
