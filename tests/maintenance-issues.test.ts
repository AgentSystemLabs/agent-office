import test from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceIssueColumns } from '../src/shared/maintenance-issues.js';
import type { GhIssue } from '../src/shared/protocol.js';

test('both Maintenance views classify the same GitHub issues, with closed state taking precedence over queue labels', () => {
  const issue = (number: number, state = 'OPEN', labels: string[] = [], assignees: string[] = []) => ({ number, state, labels: labels.map(name => ({ name })), assignees }) as GhIssue;
  const columns = maintenanceIssueColumns([issue(1), issue(2, 'OPEN', ['maintenance:queued']), issue(3, 'OPEN', [], ['Alex']), issue(4, 'CLOSED', ['maintenance:queued'])]);
  assert.deepEqual(columns.map(c => c.items.map(i => i.number)), [[1], [2], [3], [4]]);
});
