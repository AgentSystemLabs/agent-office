import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { issueBoardLimits } from '../src/server/issue-board-limits.js';

test('issue boards keep the existing defaults unless a floor configures larger lists', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-issue-limits-'));
  try {
    assert.deepEqual(issueBoardLimits(root), { open: 300, closed: 40 });
    mkdirSync(path.join(root, '.agent-office'));
    writeFileSync(path.join(root, '.agent-office/issue-board-limits.json'), JSON.stringify({ open: 1000 }));
    assert.deepEqual(issueBoardLimits(root), { open: 1000, closed: 40 });
    writeFileSync(path.join(root, '.agent-office/issue-board-limits.json'), JSON.stringify({ open: 100000 }));
    assert.throws(() => issueBoardLimits(root), /Invalid open/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
