import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorApproval, observeCursorApproval } from '../src/server/providers/cursor-approval.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

const menu = `Run this command?
Not in allowlist: git status
→ Run (once) (y)
Add Shell(git status) to allowlist? (tab)
Run Everything (shift+tab)
Skip & tell the agent what to do instead (esc or n)`;

test('recognizes approval footer, including wrapped rows, but not stale transcript', () => {
  assert.equal(cursorApproval(menu), true);
  assert.equal(cursorApproval(menu.replace('instead (esc', 'instead\n(esc')), true);
  assert.equal(cursorApproval('git status Waiting for approval...'), false);
  assert.equal(cursorApproval(menu + '\noutput'.repeat(13)), false);
});

test('alerts once, resumes when answered, and preserves unrelated hook status', () => {
  const transitions: string[] = [];
  const h = { running: true, info: { status: 'working' }, setStatus(s: string) {
    this.info.status = s; transitions.push(s);
  } } as unknown as WorkerHandle;
  observeCursorApproval(h, menu);
  observeCursorApproval(h, menu);
  assert.deepEqual(transitions, ['needs_input']);
  observeCursorApproval(h, 'Running git status');
  assert.deepEqual(transitions, ['needs_input', 'working']);
  observeCursorApproval(h, menu);
  h.info.status = 'done';
  observeCursorApproval(h, 'Finished');
  assert.equal(h.info.status, 'done');
});
