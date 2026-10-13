import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlertCard } from '../src/shared/protocol/alerts.js';
import { filterAlerts } from '../src/client/ui/alerts.js';

const card = (topic: AlertCard['topic'], title: string): AlertCard => ({
  id: title,
  kind: topic === 'general' ? 'accumulation' : topic,
  topic,
  title,
  severity: 'watch',
  createdAt: 1,
  layers: { whyNow: 'why', evidence: [], freshness: 'now', coverage: 'GMGN', invalidation: 'none' },
  links: [],
});

const cards = [card('general', 'A'), card('convergence', 'B'), card('insider', 'C')];

test('filterAlerts returns all cards or one LokiDewa topic', () => {
  assert.deepEqual(filterAlerts(cards, 'all').map((c) => c.title), ['A', 'B', 'C']);
  assert.deepEqual(filterAlerts(cards, 'convergence').map((c) => c.title), ['B']);
});
