import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCards } from '../src/server/research-feed.js';

const REPORT = [
  '<b>LAPORAN RISET WHALE</b> — 2026-10-13 02:00 UTC',
  'shortlist 09623f420004ff34 · protokol v1 abc123',
  '<b>A. Entitas shortlist (protokol v1)</b>',
  '• TESTWALLET1: n=3 (3 token), median net +12.5% — INSUFFICIENT',
  '<b>B. Hipotesis konteks masuk (protokol v2)</b>',
  '• H1 konvergensi: INSUFFICIENT (ya n=0, tidak n=1)',
].join('\n');

test('researchCards extracts wallet, verdict, and freshness from a valid report', () => {
  const cards = researchCards(REPORT);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'insider');
  assert.match(cards[0].title, /TESTWALLET1/);
  assert.match(cards[0].whyNow, /median net/);
  assert.equal(cards[0].freshness, '2026-10-13');
});

test('researchCards returns empty array when report has SUPPORTED claim', () => {
  const bad = REPORT + '\n• fakewallet: n=50, SUPPORTED — follower menang 95%';
  assert.deepEqual(researchCards(bad), []);
});

test('researchCards returns empty array for malformed header', () => {
  assert.deepEqual(researchCards('not a whale report'), []);
});
