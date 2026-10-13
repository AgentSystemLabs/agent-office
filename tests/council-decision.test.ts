import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCouncilDecision } from '../src/shared/meetings.js';

test('parses evidence-first council decision sections', () => {
  const parsed = parseCouncilDecision(`# Decision\nAccumulate only after confirmation.\n## Why Now\nFresh wallet convergence.\n## Evidence For\n- Wallet A bought\n- Balance increased\n## Evidence Against\n- Thin liquidity\n## Confidence Band\nMedium\n## Invalidation\n- Wallet distributes\n## Owner\nWhale watcher\n## Next Review\n4 hours`)!;
  assert.equal(parsed.decision, 'Accumulate only after confirmation.');
  assert.equal(parsed.whyNow, 'Fresh wallet convergence.');
  assert.deepEqual(parsed.evidenceFor, ['Wallet A bought', 'Balance increased']);
  assert.deepEqual(parsed.evidenceAgainst, ['Thin liquidity']);
  assert.equal(parsed.confidenceBand, 'Medium');
  assert.deepEqual(parsed.invalidation, ['Wallet distributes']);
  assert.equal(parsed.owner, 'Whale watcher');
  assert.equal(parsed.nextReview, '4 hours');
});

test('does not invent a structured record without a Decision heading', () => {
  assert.equal(parseCouncilDecision('ordinary meeting notes'), undefined);
});
