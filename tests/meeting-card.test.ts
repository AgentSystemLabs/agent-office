import test from 'node:test';
import assert from 'node:assert/strict';
import { endedMeetingTask, meetingTaskStatus } from '../src/client/features/meeting/card.js';
import { bubbleFor } from '../src/client/world/character/worker-badges.js';
import type { Meeting } from '../src/shared/protocol.js';

test('meeting badge stays stopped even if a participant terminal is active or asleep', () => {
  const m = { status: 'stopped', pattern: 'debate', reason: 'Nibble exited' } as Meeting;
  for (const status of ['working', 'offline', 'idle', 'needs_input'] as const) {
    const task = endedMeetingTask(m, 'Chair', status);
    assert.equal(meetingTaskStatus(task), 'stopped');
    assert.match(bubbleFor(status, false, task, undefined, false).key, /^meeting\|stopped/);
    assert.match(task.summary, /Nibble exited/);
    if (status === 'working') assert.match(task.summary, /Terminal still active/);
  }
  assert.equal(meetingTaskStatus({ name: 'Normal task', summary: '' }), undefined);
});
