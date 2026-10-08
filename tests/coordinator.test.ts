import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localDay, parseChecklist, parseMasterplan, parsePhase, parseTimeline } from '../src/shared/coordinator.js';
import { readPlan } from '../src/server/coordinator.js';

test('reads the phase the pointer names, and nothing when it names none', () => {
  assert.equal(parsePhase('Current phase: 03 — checkout\n'), '03 — checkout');
  assert.equal(parsePhase('# nothing here'), null);
});

test('reads a master plan: the goal up to the next heading, and the chapters with their question', () => {
  const md = [
    '# Phase 1',
    '',
    '## Goal',
    'Move the boards to the coordinator.',
    'More than one line.',
    '',
    '## Files to read',
    'src/x.ts',
    '',
    '## Chapters',
    '',
    '### 01 — Read the plan',
    '- Core question: What does the coordinator keep?',
    '',
    '#### 01.1-read-it',
    '- Outcome: a parser',
    '',
    '### 02 — Show it',
    '- Core question: How does the wall show it?',
  ].join('\n');
  const { goal, chapters } = parseMasterplan(md);
  assert.equal(goal, 'Move the boards to the coordinator.\nMore than one line.');
  assert.deepEqual(chapters, [
    { n: '01', title: 'Read the plan', question: 'What does the coordinator keep?' },
    { n: '02', title: 'Show it', question: 'How does the wall show it?' },
  ]);
  assert.equal(parseMasterplan('## Goal\n\n## Chapters\n').goal, null);
});

test('reads the board: the header, the cards by chapter, where each stands, and who is on it', () => {
  const md = [
    '# Checklist — Phase 1',
    '',
    'In flight: 01.1 (owner: Ada)',
    'Planned: 01.2',
    'Ready: 01.3',
    'Resume: dispatch 01.3',
    '',
    '## 01 — Read the plan',
    '- [ ] 01.1-read-it — In flight (owner: Ada)',
    '- [ ] 01.2-show-it — Planned',
    '- [ ] 01.3-ask — Blocked (awaiting user: which icon?)',
    '- [x] 01.4-finished — Done',
    '- [ ] 01.5-odd — Making tea',
  ].join('\n');
  const { summary, cards } = parseChecklist(md);
  assert.deepEqual(summary, { inFlight: '01.1 (owner: Ada)', planned: '01.2', ready: '01.3', resume: 'dispatch 01.3' });
  assert.deepEqual(cards, [
    { id: '01.1', name: 'read-it', chapter: '01', status: 'In flight', statusText: 'In flight', owner: 'Ada' },
    { id: '01.2', name: 'show-it', chapter: '01', status: 'Planned', statusText: 'Planned' },
    { id: '01.3', name: 'ask', chapter: '01', status: 'Blocked', statusText: 'Blocked', note: 'which icon?' },
    { id: '01.4', name: 'finished', chapter: '01', status: 'Done', statusText: 'Done' },
    { id: '01.5', name: 'odd', chapter: '01', status: 'Pending', statusText: 'Making tea' },
  ]);
});

test('reads the timeline, oldest first, and knows which day it is', () => {
  const md = [
    '# Timeline',
    '',
    '- 2026-10-07 09:00 — dispatched 01.1',
    '- 2026-10-08 14:20 — integrated 01.1 (PR #12)',
    '- not a line',
    '- 2026-10-08T15:05 — carried on',
  ].join('\n');
  assert.deepEqual(parseTimeline(md), [
    { date: '2026-10-07', time: '09:00', text: 'dispatched 01.1' },
    { date: '2026-10-08', time: '14:20', text: 'integrated 01.1 (PR #12)' },
    { date: '2026-10-08', time: '15:05', text: 'carried on' },
  ]);
  assert.equal(localDay(new Date(2026, 9, 8, 1, 2)), '2026-10-08');
});

test("reads a floor's plan off disk, and says why when there is none", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'coordinator-'));
  const nothing = readPlan(dir);
  assert.equal(nothing.phase, null);
  assert.equal(nothing.cards.length, 0);
  assert.equal(nothing.error, undefined);

  const phase = '02 — show it';
  const at = path.join(dir, 'plans', phase);
  mkdirSync(at, { recursive: true });
  writeFileSync(path.join(dir, 'plans', 'current.md'), `Current phase: ${phase}\n`);
  writeFileSync(path.join(at, 'masterplan.md'), '# Phase 2\n\n## Goal\nShow the plan.\n');
  writeFileSync(path.join(at, 'checklist.md'), '# Checklist\n\nReady: 01.1\n\n## 01 — x\n- [ ] 01.1-a — Ready\n');
  writeFileSync(path.join(at, 'timeline.md'), '- 2026-10-08 10:00 — started\n');
  const state = readPlan(dir);
  assert.equal(state.phase, phase);
  assert.equal(state.goal, 'Show the plan.');
  assert.equal(state.cards.length, 1);
  assert.deepEqual(state.timeline, [{ date: '2026-10-08', time: '10:00', text: 'started' }]);

  // A pointer with no phase on it is the one thing it can't work around: it says so.
  writeFileSync(path.join(dir, 'plans', 'current.md'), 'nothing to see\n');
  assert.match(readPlan(dir).error ?? '', /Current phase/);
});
