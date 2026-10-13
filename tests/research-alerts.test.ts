import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AlertBoard } from '../src/server/alerts.js';
import { loadResearchAlerts } from '../src/server/research-feed.js';

const REPORT = [
  '<b>LAPORAN RISET WHALE</b> — 2026-10-12 01:19 UTC',
  'shortlist 09623f420004ff34 · protokol v1 1f71d9ce9db21ad5',
  '<b>A. Entitas shortlist (protokol v1)</b>',
  '• 2en1JiW9d8er: n=1 (1 token), median net -9.9% [biaya 0/3/6%: -6.9% / -9.9% / -12.9%], menang ≥0% (Wilson, n=1) — INSUFFICIENT',
].join('\n');

test('loadResearchAlerts reads a report file and fills the board read-only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dewa-research-'));
  const file = path.join(dir, 'report.txt');
  writeFileSync(file, REPORT);
  const board = new AlertBoard();
  const added = loadResearchAlerts(board, file);
  assert.equal(added, 1);
  const state = board.state();
  assert.equal(state.cards.length, 1);
  assert.equal(state.cards[0].kind, 'insider');
  assert.match(state.cards[0].layers.invalidation, /INSUFFICIENT/);
});

test('loadResearchAlerts leaves the board empty when the report is missing', () => {
  const board = new AlertBoard();
  const added = loadResearchAlerts(board, path.join(tmpdir(), 'nope', 'report.txt'));
  assert.equal(added, 0);
  assert.equal(board.state().cards.length, 0);
});
