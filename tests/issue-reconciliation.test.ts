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
  for (const phrase of ['merged pull requests', 'current workers', 'avoid duplicates', 'office-playtests', 'Never call office-queue add/remove', 'Only the person', 'never claim they were saved', 'Do not edit code']) assert.ok(text.includes(phrase), phrase);
  assert.ok(!text.includes('#70'), 'not tied to one repository or issue');
});

test('new board-agent briefs and issue tasks send human checks to the checklist', () => {
  for (const id of ['station.issues', 'station.pulls', 'station.queue', 'issue.work'] as const) {
    assert.ok(PROMPTS[id].text.includes('office-playtests add'), id);
    assert.ok(PROMPTS[id].text.includes('Do not queue human checks'), id);
  }
});

test('reconciliation prioritizes stale statuses and verifies their actual board classification', () => {
  const text = PROMPTS['issues.reconcile'].text;
  for (const phrase of ['First perform a fast cleanup pass', 'Office assigns the signed-in GitHub account automatically', 'completion uncertainty does not justify leaving a stale assignment', 'close as not planned', 'read it back from GitHub', 'any assignee', 'Do not claim cleanup complete without this verification']) assert.ok(text.includes(phrase), phrase);
});

test('reconciliation forbids automatic queue selection and checks direct handoffs', () => {
  const text = PROMPTS['issues.reconcile'].text;
  assert.match(text, /Only the human owner decides/);
  assert.match(text, /Direct issue handoffs/);
  assert.match(text, /active without any queue entry/);
  assert.ok(!text.includes('add exactly one complete'));
  assert.match(PROMPTS['station.issues'].text, /write API is unavailable/);
});
