import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { executivePeople, validateExecutivePopulation, type ExecutivePerson } from '../src/shared/executive-world.js';
import { managementPlacements } from '../src/client/executive/population.js';

test('Stage 1 has the approved leadership and manager counts', () => {
  const count = (role: ExecutivePerson['role']) => executivePeople.filter(person => person.role === role).length;
  assert.equal(count('director'), 1);
  assert.equal(count('operations-manager'), 1);
  assert.equal(count('district-manager'), 3);
  assert.equal(count('room-manager'), 5);
  assert.equal(count('worker'), 0);
});

test('all visible managers have one placement and valid assignments', () => {
  const visible = executivePeople.filter(person => person.visible);
  assert.equal(Object.keys(managementPlacements).length, visible.length);
  assert.deepEqual(visible.map(person => person.id).sort(), Object.keys(managementPlacements).sort());
  assert.deepEqual(validateExecutivePopulation(), []);
});

test('population validation rejects duplicate and invalid assignments', () => {
  const duplicate = { ...executivePeople[1], districtId: 'missing-district', roomId: 'missing-room' };
  const errors = validateExecutivePopulation([...executivePeople, duplicate]);
  assert.ok(errors.some(error => error.includes('Duplicate person id')));
  assert.ok(errors.some(error => error.includes('unknown district')));
  assert.ok(errors.some(error => error.includes('invalid room assignment')));
});
