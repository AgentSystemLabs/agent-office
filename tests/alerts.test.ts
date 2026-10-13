import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertBoard, topicForAlert, type AlertInput } from '../src/server/alerts.js';

const input: AlertInput = {
  title: 'WLD whale accumulation',
  token: 'WLD',
  chain: 'ethereum',
  severity: 'info',
  whyNow: 'Fresh whale buy + GMGN convergence',
  evidence: ['wallet 0xabc bought 120k WLD', 'GMGN trader score confirmed'],
  freshness: 'seen 2m ago',
  coverage: 'Arkham + GMGN',
  invalidation: 'transfer-only, no fresh balance increase',
  links: [{ label: 'gmgn', url: 'https://gmgn.ai/eth/token/0xabc' }],
};

test('topicForAlert maps LokiDewa alert cards to Telegram-style topics', () => {
  assert.equal(topicForAlert({ ...input, kind: 'accumulation' }), 'general');
  assert.equal(topicForAlert({ ...input, kind: 'convergence' }), 'convergence');
  assert.equal(topicForAlert({ ...input, kind: 'insider' }), 'insider');
  assert.equal(topicForAlert({ ...input, kind: 'entry-watch' }), 'entry-watch');
});

test('AlertBoard keeps newest WHY NOW cards first and trims old cards', () => {
  const board = new AlertBoard(2);
  const first = board.add({ ...input, kind: 'accumulation', title: 'first' }, 1000);
  const second = board.add({ ...input, kind: 'convergence', title: 'second' }, 2000);
  const third = board.add({ ...input, kind: 'entry-watch', title: 'third' }, 3000);

  assert.equal(first.topic, 'general');
  assert.equal(second.topic, 'convergence');
  assert.deepEqual(board.state().cards.map((c) => c.title), ['third', 'second']);
  assert.equal(third.layers.whyNow, input.whyNow);
  assert.deepEqual(third.layers.evidence, input.evidence);
});
