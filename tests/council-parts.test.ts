import test from 'node:test';
import assert from 'node:assert/strict';
import { councilParts } from '../src/server/council-parts.js';
import type { Meeting } from '../src/shared/protocol.js';

const meeting = {
  title: 'Alpha review', prompt: 'Review WLD', output: 'decision.md', notes: 'notes', rounds: 3,
  seats: [
    { role: 'Council chair', deskId: 'a' },
    { role: 'Whale watcher', deskId: 'b' },
    { role: 'Risk warden', deskId: 'c' },
  ],
} as Meeting;
const say = (id: string) => id;

test('council briefs, challenges, then chair writes final decision', () => {
  const first = councilParts(meeting, 1, 1, '/tmp/council', 'notes', say as never)!;
  assert.deepEqual(first.map((p) => p.seat), [1, 2]);
  assert.ok(first.every((p) => p.doing === 'briefing their mandate'));

  const middle = councilParts(meeting, 2, 1, '/tmp/council', 'notes', say as never)!;
  assert.deepEqual(middle.map((p) => p.seat), [0, 1, 2]);
  assert.ok(middle.every((p) => p.file !== meeting.output));

  const last = councilParts(meeting, 3, 1, '/tmp/council', 'notes', say as never)!;
  assert.deepEqual(last.map((p) => [p.seat, p.file]), [[0, meeting.output]]);
});
