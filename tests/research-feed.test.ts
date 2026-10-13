import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCards } from '../src/server/research-feed.js';

const REPORT = [
  '<b>LAPORAN RISET WHALE</b> — 2026-10-12 01:19 UTC',
  'shortlist 09623f420004ff34 · protokol v1 1f71d9ce9db21ad5',
  '<b>A. Entitas shortlist (protokol v1)</b>',
  'Baseline (wallet lain): menang 50% [Wilson 9%–91%], n=2',
  '• 2en1JiW9d8er: n=1 (1 token), median net -9.9% [biaya 0/3/6%: -6.9% / -9.9% / -12.9%], menang ≥0% (Wilson, n=1) — INSUFFICIENT',
  '• 7wePDgzTECQQ: n=6 (6 token), median net -28.9%, menang ≥0% (Wilson, n=6) — INSUFFICIENT',
  '',
  '<b>B. Hipotesis konteks masuk (protokol v2)</b>',
  '• H1 konvergensi ≥2 entitas: INSUFFICIENT (ya n=0/0 token, tidak n=1/1 token)',
  '',
  '<b>C. Return horizon tetap (protokol v3)</b>',
  'Horizon 1h sejak live: OBSERVED 0 (shortlist 0, baseline 0), INSUFFICIENT_SAMPLES 0 tidak dihitung.',
].join('\n');

test('research feed turns shortlist entity lines into WHY NOW cards', () => {
  const cards = researchCards(REPORT);
  assert.equal(cards.length, 2);
  const first = cards[0];
  assert.equal(first.kind, 'insider');
  assert.equal(first.severity, 'info');
  assert.match(first.title, /2en1JiW9d8er/);
  assert.match(first.whyNow, /median net -9\.9%/);
  assert.match(first.coverage, /n=1/);
  assert.match(first.invalidation, /INSUFFICIENT/);
  assert.equal(first.freshness.slice(0, 10), '2026-10-12');
  assert.deepEqual(first.links, []);
});

test('research feed never claims SUPPORTED or probability', () => {
  const synthetic = ['<b>LAPORAN RISET WHALE</b> — 2026-10-12 01:19 UTC',
    '• bestwallet: n=40, SUPPORTED — follower menang minimal 90%'].join('\n');
  assert.deepEqual(researchCards(synthetic), []);
});

test('research feed reports horizon coverage honestly', () => {
  const horizon = ['<b>LAPORAN RISET WHALE</b> — 2026-10-12 01:19 UTC',
    'Horizon 1h sejak live: OBSERVED 0 (shortlist 0, baseline 0), INSUFFICIENT_SAMPLES 0 tidak dihitung.'].join('\n');
  const cards = researchCards(horizon);
  assert.equal(cards.length, 0);
});
