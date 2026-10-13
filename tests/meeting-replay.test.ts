import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingRecord } from '../src/shared/meetings.js';
import type { Meeting } from '../src/shared/protocol.js';

test('meeting archive retains enough data for council replay', () => {
  const meeting = {
    id: 'c1', pattern: 'council', title: 'WLD review', prompt: 'Review WLD now', output: 'decision.md',
    seats: [{ role: 'Council chair', deskId: 'a', workerName: 'Chair' }], rounds: 4, round: 3, step: 1,
    turns: [], tokens: 10, cost: 0, costKnown: false, status: 'done', calledBy: 'LO', startedAt: 100,
    finishedAt: 200, notes: '.meeting', preview: '# Decision\nWait.\n## Why Now\nFlow changed.\n## Evidence For\n- A\n## Evidence Against\n- B\n## Confidence Band\nMedium\n## Invalidation\n- C\n## Owner\nWhale watcher\n## Next Review\n4h',
  } as Meeting;
  const record = meetingRecord(meeting);
  assert.equal(record.prompt, meeting.prompt);
  assert.equal(record.startedAt, 100);
  assert.equal(record.rounds, 4);
  assert.equal(record.seats[0].role, 'Council chair');
  assert.equal(record.preview, meeting.preview);
  assert.equal(record.decision?.owner, 'Whale watcher');
});
