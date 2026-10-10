import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorAtFollowup, reconcileCursorScreen, resetCursorScreen } from '../src/server/providers/cursor-screen.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

const screen = 'Round 1 note is written.\n\n → Add a follow-up\n\n Grok 4.7 256K Medium Fast · 13% · 1 file editedRun Everything\n ~/office/project ·\n office/meeting-demo';
function fixture() {
  let writes = 0;
  const h = { info: { status: 'working', sessionId: 'chat-1', workingSince: 1 }, running: true,
    setStatus(s: string) { this.info.status = s; }, emit() {}, persist() { writes++; },
  } as unknown as WorkerHandle;
  return { h, writes: () => writes };
}

test('only an empty Cursor follow-up composer with its trailing footer is idle', () => {
  assert.equal(cursorAtFollowup(screen), true);
  for (const bad of ['→ Add a follow-up', screen.replace('→ Add a follow-up', '→ Add a follow-up and do more'),
    screen + '\nRunning command… esc to stop', screen.replace('Run Everything', 'Approve command'),
    'The agent said "→ Add a follow-up" in its answer', screen.replace('~/office/project', 'Tool output follows'),
  ]) assert.equal(cursorAtFollowup(bad), false, bad);
});

test('a missed Stop is repaired once, after a stable screen', () => {
  const f = fixture();
  reconcileCursorScreen(f.h, screen, 100);
  reconcileCursorScreen(f.h, screen, 6099);
  assert.equal(f.h.info.status, 'working');
  reconcileCursorScreen(f.h, screen, 6100);
  assert.equal(f.h.info.status, 'done');
  reconcileCursorScreen(f.h, screen, 20000);
  assert.equal(f.writes(), 1);
});

test('new hooks, input, sessions and screen output restart the quiet interval', () => {
  for (const change of ['hook', 'input', 'session', 'output']) {
    const f = fixture();
    reconcileCursorScreen(f.h, screen, 100);
    let next = screen;
    if (change === 'hook') resetCursorScreen(f.h);
    if (change === 'input') f.h.info.lastInput = { by: 'Kajo', at: 5000 };
    if (change === 'session') f.h.info.sessionId = 'chat-2';
    if (change === 'output') next = screen.replace('note', 'proposal');
    reconcileCursorScreen(f.h, next, 7000);
    assert.equal(f.h.info.status, 'working', change);
    reconcileCursorScreen(f.h, next, 13000);
    assert.equal(f.h.info.status, 'done', change);
  }
});

test('permission, startup, stopped and disconnected workers are never marked done', () => {
  for (const status of ['needs_input', 'starting', 'exited', 'idle']) {
    const f = fixture();
    f.h.info.status = status as typeof f.h.info.status;
    reconcileCursorScreen(f.h, screen, 0);
    reconcileCursorScreen(f.h, screen, 10000);
    assert.equal(f.h.info.status, status);
  }
  const f = fixture();
  Object.defineProperty(f.h, 'running', { value: false });
  reconcileCursorScreen(f.h, screen, 0);
  reconcileCursorScreen(f.h, screen, 10000);
  assert.equal(f.h.info.status, 'working');
});
