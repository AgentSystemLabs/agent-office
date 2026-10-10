import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, fillPrompt } from '../src/shared/prompts.js';
import { STATION_ACTIONS } from '../src/client/ui/station-actions.js';

test('reconciliation is an editable Issues-only action with evidence and human-test handoff', () => {
  const action = STATION_ACTIONS.issues?.[0];
  assert.equal(action?.prompt, 'issues.reconcile');
  assert.equal(STATION_ACTIONS.pulls, undefined);
  assert.equal(STATION_ACTIONS.queue, undefined);
  const text = fillPrompt(PROMPTS['issues.reconcile'].text, {});
  for (const phrase of ['merged pull requests', 'current workers', 'avoid duplicates', 'office-playtests', 'no queued/running task', 'Only the person', 'never claim they were saved', 'Do not edit code']) assert.ok(text.includes(phrase), phrase);
  assert.ok(!text.includes('#70'), 'not tied to one repository or issue');
});

test('new board-agent briefs and issue tasks send human checks to the checklist', () => {
  for (const id of ['station.issues', 'station.pulls', 'station.queue', 'issue.work'] as const) {
    assert.ok(PROMPTS[id].text.includes('office-playtests add'), id);
    assert.ok(PROMPTS[id].text.includes('Do not queue human checks'), id);
  }
});
