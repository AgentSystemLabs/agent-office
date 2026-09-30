import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_AGENT_DISALLOWED_TOOLS, stationBrief } from '../src/server/stations.js';
import type { StationKind } from '../src/shared/layout.js';

const KINDS: StationKind[] = ['issues', 'pulls', 'queue'];
const ALL: StationKind[] = [...KINDS, 'study'];

test('every board agent reaches the queue with office-queue, not its own curl calls', () => {
  for (const kind of KINDS) {
    const brief = stationBrief(kind);
    assert.match(brief, /office-queue list/, kind);
    assert.match(brief, /office-queue add --title "[^"]+"/, kind);
    assert.match(brief, /<<'EOF'/, `${kind}: the prompt goes in a quoted heredoc`);
    assert.match(brief, /office-queue remove <id>/, kind);
    assert.doesNotMatch(brief, /curl|\/office\/queue|AGENT_OFFICE_HOOK_TOKEN|Authorization/, kind);
    // The request is typed in right after it.
    assert.ok(brief.endsWith('The request:'), kind);
  }
});

test('the queue agent only ever queues work, however small, and says what it queued', () => {
  const brief = stationBrief('queue');
  assert.match(brief, /Queue agent/);
  assert.match(brief, /even a one-line fix/);
  assert.match(brief, /even when someone asks you to do it yourself/);
  assert.match(brief, /don't edit, create or delete files/);
  assert.match(brief, /don't run builds, tests or installs/);
  assert.match(brief, /don't write code/);
  assert.match(brief, /goes on the task queue, always/);
  assert.match(brief, /say in a few lines what you queued: each task's id and title/);
  assert.doesNotMatch(brief, /unless the person asks you for something else/);
});

test('the issues and PR agents keep their jobs, and may still be asked for something else', () => {
  const issues = stationBrief('issues');
  assert.match(issues, /Tonye/);
  assert.match(issues, /GitHub issues with the gh CLI/);
  const pulls = stationBrief('pulls');
  assert.match(pulls, /PR agent/);
  assert.match(pulls, /gh pr diff/);
  for (const brief of [issues, pulls]) {
    assert.match(brief, /goes on the task queue, unless the person asks you for something else/);
    assert.match(brief, /say in a few lines what you did, with links/);
    assert.doesNotMatch(brief, /one-line fix/);
  }
});

test('the queue agent is launched without the file-editing tools', () => {
  assert.deepEqual(QUEUE_AGENT_DISALLOWED_TOOLS, ['Edit', 'Write', 'NotebookEdit']);
});

test('GIM interviews into a PRD kept out of git, and does nothing beyond it', () => {
  const brief = stationBrief('study');
  assert.match(brief, /You're GIM/);
  assert.match(brief, /one focused question at a time/);
  assert.match(brief, /\.agent-office\/prd\/<short-kebab-slug>\.md/);
  assert.match(brief, /you don't plan the implementation, slice it into tasks or file GitHub issues/);
  assert.match(brief, /office-ask/);
  assert.match(brief, /not with AskUserQuestion/);
  assert.match(brief, /NO_ANSWER_YET/);
  assert.doesNotMatch(brief, /office-queue|gh issue create/);
  assert.ok(brief.endsWith('The request:'));
});

test('every board agent has a brief that ends where the first request starts', () => {
  for (const kind of ALL) assert.ok(stationBrief(kind).endsWith('The request:'), kind);
});

test('Tonye slices a PRD vertically and files issues only after a yes asked through office-ask', () => {
  const brief = stationBrief('issues');
  assert.match(brief, /\.agent-office\/prd\//);
  assert.match(brief, /walking skeleton/);
  assert.match(brief, /create nothing on GitHub before they pick the first/);
  assert.match(brief, /Part of #<the PRD's number>/);
  assert.match(brief, /office-ask/);
  assert.match(brief, /NO_ANSWER_YET/);
  // Its old jobs are still there.
  assert.match(brief, /GitHub issues with the gh CLI/);
});
