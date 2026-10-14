import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST } from '../src/client/features/ambient-office/cast.js';
import { DAY_MS, SLOT_MS, sampleOffice } from '../src/client/features/ambient-office/simulation.js';
import { scrantonRoutines } from '../src/client/features/scranton/routines.js';
import { SCRANTON, SCRANTON_ENTRY, SCRANTON_DOOR, HOMES, WORKSTATIONS, PARTITIONS, ROOMS, scrantonNav, inScranton, partitionRect, deskRect, point } from '../src/shared/scranton.js';
import { OFFICE_OPENINGS } from '../src/shared/office-openings.js';
import { OFFICE_FOOTPRINTS, reservedOfficeSpace } from '../src/shared/office-footprints.js';

const nav = scrantonNav();
const space = scrantonRoutines(nav);
const contains = (r: number[], x: number, z: number) => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3];

test('the Scranton suite is additional space with a registered doorway in the original east wall', () => {
  assert.ok(SCRANTON.maxZ < -13);
  assert.ok(OFFICE_OPENINGS.includes(SCRANTON_DOOR));
  assert.equal(SCRANTON_DOOR.wall, 'east');
  assert.ok(inScranton(...SCRANTON_ENTRY));
  assert.equal(inScranton(0, 0), false);
});

test('the replica clears neighboring buildings and reserves space against trees growing through it', async () => {
  const { neighbourBoxes } = await import('../src/client/world/outside.js');
  for (const r of OFFICE_FOOTPRINTS) for (const b of neighbourBoxes()) {
    assert.ok(b.maxX <= r[0] || b.minX >= r[1] || b.maxZ <= r[2] || b.minZ >= r[3], 'an exterior building intrudes into the room');
  }
  assert.ok(reservedOfficeSpace(-12, -22, 3));
  assert.ok(reservedOfficeSpace(4, -24, 2.5));
  assert.equal(reservedOfficeSpace(-34, 22, 3), false);
});

test('every cast member has a reachable home within the suite, outside desk and wall footprints', () => {
  assert.equal(Object.keys(HOMES).length, CAST.length);
  for (const p of CAST) {
    const home = HOMES[p.id];
    assert.ok(home, p.id);
    assert.ok(home[0] > SCRANTON.minX && home[0] < SCRANTON.maxX && home[1] > SCRANTON.minZ && home[1] < SCRANTON.maxZ);
    assert.ok(nav.walkable(...home), p.id);
    assert.ok(PARTITIONS.every((wall) => !contains(partitionRect(wall), ...home)), p.id);
    assert.ok(WORKSTATIONS.every((desk) => !contains(deskRect(desk), ...home)), p.id);
    const path = nav.route(SCRANTON_ENTRY, home);
    assert.deepEqual(path.at(-1), home);
    for (let i = 1; i < path.length; i++) assert.ok(nav.clearLine(path[i - 1], path[i]), `${p.id}: route cannot cross partitions`);
  }
});

test('the main office links through the corridor to reception, Michael, conference, kitchen and annex', () => {
  for (const id of ['reception', 'michael', 'conference', 'kitchen', 'annex', 'breakroom', 'ryan'] as const) {
    const goal = nav.nearestWalkable(ROOMS[id].at);
    const path = nav.route(SCRANTON_ENTRY, goal);
    for (let i = 1; i < path.length; i++) assert.ok(nav.clearLine(path[i - 1], path[i]), `${id}: unreachable room`);
  }
});

test('the era-correct desks put Erin at reception, Pam in sales/admin, and HR/customer service in the annex', () => {
  assert.ok(HOMES.erin[0] < HOMES.jim[0]);
  assert.ok(HOMES.jim[0] === HOMES.dwight[0]);
  assert.ok(HOMES.jim[1] < HOMES.dwight[1]);
  assert.ok(HOMES.pam[0] > HOMES.jim[0]);
  assert.ok(HOMES.toby[0] > point(22.4, 0)[0]);
  assert.ok(HOMES.kelly[0] > point(22.4, 0)[0]);
});

test('quiet work seats the cast at their own workstations without changing the independent schedule', () => {
  const original = sampleOffice(20 * DAY_MS + 4 * SLOT_MS + 95000, 'scranton');
  const adapted = space.adapt(original);
  assert.equal(adapted.clock, original.clock);
  assert.deepEqual(adapted.memories, original.memories);
  for (const state of adapted.people) {
    assert.deepEqual(state.target, HOMES[state.person.id]);
    if (WORKSTATIONS.some((s) => s.id === state.person.id) || state.person.id === 'erin') assert.ok(state.seat);
  }
  assert.equal(original.people[0].seat, undefined);
});

test('all autonomous scenes and lunch breaks move through the replica rather than the coding floor', () => {
  for (let day = 20; day < 25; day++) for (let slot = 2; slot < 18; slot++) {
    const snapshot = space.adapt(sampleOffice(day * DAY_MS + slot * SLOT_MS + 36000, 'scranton'));
    for (const state of snapshot.people) {
      assert.ok(inScranton(...state.target));
      assert.ok(nav.walkable(...state.target));
      const path = nav.route(HOMES[state.person.id], state.target);
      for (let i = 1; i < path.length; i++) assert.ok(nav.clearLine(path[i - 1], path[i]), `${snapshot.scene?.id ?? snapshot.phase}/${state.person.id} has a blocked route`);
    }
  }
});
