import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST, CAST_BY_ID } from '../src/client/features/ambient-office/cast.js';
import { SCENES } from '../src/client/features/ambient-office/scenes.js';
import { DAY_MS, SLOT_MS, sampleOffice, sceneFor } from '../src/client/features/ambient-office/simulation.js';
import { checklist, workBrief } from '../src/client/features/ambient-office/notes.js';
import { nearestWalkable, route, walkable } from '../src/shared/nav.js';

const atMinute = (minute: number, day = 20) => day * DAY_MS + (minute - 510) / 540 * DAY_MS;

test('the ensemble has distinct identities, era-correct jobs and no fabricated canon birthdays', () => {
  assert.equal(CAST.length, 19);
  assert.equal(CAST_BY_ID.size, CAST.length);
  assert.match(CAST_BY_ID.get('erin')!.job, /Receptionist/);
  assert.match(CAST_BY_ID.get('pam')!.job, /administration/);
  assert.match(CAST_BY_ID.get('holly')!.job, /Nashua/);
  assert.equal(CAST_BY_ID.get('stanley')!.dessert, 'Cheesecake');
  for (const p of CAST) {
    assert.equal(p.birthday, null);
    assert.ok(p.routine.length >= 3);
    assert.ok(p.personality && p.utility && p.greeting);
  }
});

test('the floor schedule is deterministic, observer-independent and progresses without input', () => {
  const timestamp = atMinute(600);
  assert.deepEqual(sampleOffice(timestamp, 'a'), sampleOffice(timestamp, 'a'));
  const first = sampleOffice(timestamp, 'a');
  const later = sampleOffice(timestamp + SLOT_MS * 3, 'a');
  assert.notEqual(first.clock, later.clock);
  assert.notDeepEqual(first.people, later.people);
  const reloaded = sampleOffice(timestamp + SLOT_MS * 3, 'a');
  assert.deepEqual(reloaded.memories, later.memories);
  assert.equal(later.memories.length, 3);
  assert.notEqual(sceneFor(20, 4, 'a').id, sceneFor(20, 4, 'b').id);
});

test('arrivals, staggered lunches, Stanley’s prompt departure and after-hours absence', () => {
  assert.ok(sampleOffice(atMinute(510), 'a').people.filter((p) => p.present).length < 5);
  const noon = sampleOffice(atMinute(12 * 60 + 20), 'a');
  assert.equal(noon.phase, 'lunch');
  const afternoon = sampleOffice(atMinute(15 * 60), 'a');
  assert.ok(afternoon.people.find((p) => p.person.id === 'stanley')!.present);
  const five = sampleOffice(atMinute(17 * 60 + 0.1), 'a');
  assert.equal(five.people.find((p) => p.person.id === 'stanley')!.present, false);
  const evening = sampleOffice(atMinute(17 * 60 + 20), 'a');
  assert.equal(evening.phase, 'after-hours');
  assert.ok(evening.people.every((p) => !p.present));
});

test('group scenes have valid participants and speak in turns, with quiet recovery intervals', () => {
  for (const scene of SCENES) {
    assert.ok(new Set(scene.beats.map((b) => b.who)).size >= 2);
    for (const beat of scene.beats) assert.ok(CAST_BY_ID.has(beat.who), beat.who);
  }
  const slot = 4;
  const timestamp = 20 * DAY_MS + slot * SLOT_MS;
  assert.ok(sampleOffice(timestamp + 36000, 'a').scene);
  assert.equal(sampleOffice(timestamp + 36000, 'a').people.filter((p) => p.line).length, 1);
  assert.equal(sampleOffice(timestamp + 95000, 'a').scene, undefined);
  assert.equal(sampleOffice(timestamp + 95000, 'a').people.filter((p) => p.line).length, 0);
  assert.ok(sampleOffice(timestamp + 95000, 'a').memories.includes(sceneFor(20, slot, 'a').aftermath));
});

test('visitors are present for their own scenes and away during ordinary routines', () => {
  let visitorScenes = 0;
  for (let day = 20; day < 25; day++) for (let slot = 2; slot < 18; slot++) {
    const snapshot = sampleOffice(day * DAY_MS + slot * SLOT_MS + 36000, 'a');
    if (!snapshot.scene) continue;
    for (const id of ['holly', 'david']) {
      const state = snapshot.people.find((p) => p.person.id === id)!;
      const participates = snapshot.scene.beats.some((b) => b.who === id);
      assert.equal(state.present, participates);
      if (participates) visitorScenes++;
    }
  }
  assert.ok(visitorScenes > 0);
});

test('rituals are infrequent and recent outcomes carry over from yesterday without observation', () => {
  let count = 0;
  for (let day = 20; day < 25; day++) for (let slot = 0; slot < 20; slot++) if (sceneFor(day, slot, 'a').ritual) count++;
  assert.equal(count, 2);
  assert.equal(sceneFor(20, 11, 'a').id, 'pretzels');
  assert.equal(sceneFor(23, 11, 'a').id, 'dundies');
  assert.equal(sampleOffice(atMinute(511), 'a').memories.length, 3);
});

test('home and gathering destinations are reachable through furniture-safe navigation', () => {
  const positions = new Map<string, [number, number]>();
  for (const p of CAST) positions.set(p.id, nearestWalkable(p.home));
  for (let slot = 2; slot < 18; slot++) {
    const snapshot = sampleOffice(20 * DAY_MS + slot * SLOT_MS + 36000, 'a');
    for (const state of snapshot.people.filter((p) => p.present)) {
      const from = positions.get(state.person.id)!;
      const goal = nearestWalkable(state.target);
      assert.ok(walkable(...goal));
      const path = route(from, goal);
      assert.ok(path.length > 0, `${state.person.id}: ${from} to ${goal}`);
      for (const point of path) assert.ok(walkable(...point), `${state.person.id}: ${point}`);
      positions.set(state.person.id, goal);
    }
  }
});

test('Pam organizes actual user tasks and briefs clearly describe unperformed external work', () => {
  assert.equal(checklist('  - Call Sam\n\n2. Review draft\n• Send notes'), '☐ Call Sam\n☐ Review draft\n☐ Send notes');
  assert.equal(checklist(' \n '), '');
  const brief = workBrief(CAST_BY_ID.get('dwight')!, 'Audit the shipment list');
  assert.match(brief, /Audit the shipment list/);
  assert.match(brief, /prerequisites/);
  assert.match(brief, /has not sent messages, scheduled events/);
  assert.match(workBrief(CAST_BY_ID.get('ryan')!, 'Pitch'), /Verify factual claims/);
  assert.match(workBrief(CAST_BY_ID.get('kevin')!, 'Explain'), /low-stakes/);
});
