import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingPresence } from '../src/shared/presence.js';
import type { Meeting } from '../src/shared/protocol.js';

const meeting = (status: Meeting['status'], pattern: Meeting['pattern'] = 'council') => ({ title: 'WLD review', status, pattern }) as Meeting;

test('meeting presence describes council, decision reading, and replay', () => {
  assert.equal(meetingPresence(meeting('running')), '🏛️ observing council: WLD review');
  assert.equal(meetingPresence(meeting('done')), '📜 reading council decision: WLD review');
  assert.equal(meetingPresence(null, 'Old meeting'), '⏪ replaying meeting: Old meeting');
  assert.equal(meetingPresence(null), '🏛️ preparing a council');
});
