import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { MAX_LABEL, SIGN_COLORS, cleanLabel, cleanPlan } from '../src/shared/floorplan.js';
import { BEANBAGS, DESKS, WING, WING_DESKS, beanbagsOut, builtDesks, nextFreeSeat } from '../src/shared/layout.js';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-floorplan-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('signs go up over desks, get changed and come down, and stay across restarts', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    const hung = plan.label('desk-3', '  Code   cleanup ', SIGN_COLORS[4].color, 'Ada');
    assert.ok(typeof hung !== 'string' && hung.label && !hung.old);
    assert.deepEqual({ ...plan.state().labels['desk-3'], at: 0 }, { text: 'Code cleanup', color: SIGN_COLORS[4].color, by: 'Ada', at: 0 });
    // A color that isn't one of the signs' is the first one.
    const changed = plan.label('desk-3', 'Operations', '#123456', 'Bo');
    assert.ok(typeof changed !== 'string' && changed.old?.text === 'Code cleanup');
    assert.equal(plan.state().labels['desk-3'].color, SIGN_COLORS[0].color);
    // Across a restart.
    assert.equal(new FloorPlanStore(dir).state().labels['desk-3'].text, 'Operations');
    const down = plan.label('desk-3', '', undefined, 'Bo');
    assert.ok(typeof down !== 'string' && !down.label && down.old?.text === 'Operations');
    assert.deepEqual(new FloorPlanStore(dir).state().labels, {});
    // Taking down a sign that isn't there does nothing.
    assert.deepEqual(plan.label('desk-3', ' ', undefined, 'Bo'), {});
  });
});

test('only desks get signs: not bean bags, kiosks or the meeting table', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    for (const id of ['beanbag-1', 'station-queue', 'meeting-1', 'nope']) assert.equal(typeof plan.label(id, 'Ops', undefined, 'Ada'), 'string', id);
    // The back office's desks can have one before they're built, ready for when they are.
    assert.equal(typeof plan.label(WING_DESKS[0].id, 'Ops', undefined, 'Ada'), 'object');
  });
});

test("a sign's text is one tidy line, no longer than a sign", () => {
  assert.equal(cleanLabel('a\nb\tc\u0007d'), 'a b c d');
  assert.equal([...cleanLabel('🚀'.repeat(40))].length, MAX_LABEL);
  assert.equal(cleanLabel(42), '');
});

test('the back office goes back a row at a time, as far as it can, and walls up only when nobody is there', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    assert.equal(plan.wing, 0);
    assert.equal(typeof plan.shrink(() => false), 'string', 'nothing to wall up yet');
    for (let row = 1; row <= WING.rows; row++) {
      const came = plan.expand();
      assert.deepEqual(came, WING_DESKS.filter((d) => d.wing === row).map((d) => d.id));
    }
    assert.equal(typeof plan.expand(), 'string', "it can't go back any further");
    assert.equal(new FloorPlanStore(dir).wing, WING.rows, 'it stays built across a restart');
    const last = WING_DESKS.filter((d) => d.wing === WING.rows);
    assert.match(plan.shrink((id) => id === last[1].id) as string, new RegExp(last[1].label));
    assert.equal(plan.wing, WING.rows);
    assert.deepEqual(plan.shrink(() => false), last.map((d) => d.id));
    assert.equal(plan.wing, WING.rows - 1);
  });
});

test('a broken or tampered plan file comes back as what is valid of it', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'floorplan.json'), JSON.stringify({ wing: 99, labels: { 'desk-1': { text: 'Ops', color: 'red' }, 'beanbag-2': { text: 'x' }, 'desk-2': { text: '   ' } } }));
    const plan = new FloorPlanStore(dir).state();
    assert.equal(plan.wing, WING.rows);
    assert.deepEqual(Object.keys(plan.labels), ['desk-1']);
    assert.equal(plan.labels['desk-1'].color, SIGN_COLORS[0].color);
    writeFileSync(path.join(dir, 'floorplan.json'), '{nope');
    assert.deepEqual(new FloorPlanStore(dir).state(), cleanPlan(undefined));
    assert.ok(readFileSync(path.join(dir, 'floorplan.json'), 'utf8'));
  });
});

test('new workers take the back office desks once it is built, before any bean bag', () => {
  const taken = new Set(DESKS.map((d) => d.id));
  assert.equal(nextFreeSeat((id) => taken.has(id))?.id, BEANBAGS[0].id, 'with no back office, the bean bags come out');
  assert.equal(nextFreeSeat((id) => taken.has(id), 1)?.id, WING_DESKS[0].id);
  // Bean bags only come out once the back office's desks are taken too.
  assert.equal(beanbagsOut((id) => taken.has(id)).size, 1);
  assert.equal(beanbagsOut((id) => taken.has(id), 1).size, 0);
  for (const d of builtDesks(1)) taken.add(d.id);
  assert.equal(beanbagsOut((id) => taken.has(id), 1).size, 1);
  assert.equal(nextFreeSeat((id) => taken.has(id), 1)?.id, BEANBAGS[0].id);
});
