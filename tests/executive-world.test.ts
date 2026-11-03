import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decideDemonstrationReview, executiveDistricts, executivePeople, validateExecutivePopulation } from '../src/shared/executive-world.js';

test('slice has three demonstration districts and an unbroken reporting chain', () => {
  assert.equal(executiveDistricts.length, 3);
  const byId = new Map(executivePeople.map(person => [person.id, person]));
  let person = byId.get('build-workshop-manager');
  const chain: string[] = [];
  while (person) { chain.push(person.role); person = person.reportsTo ? byId.get(person.reportsTo) : undefined; }
  assert.deepEqual(chain, ['room-manager', 'district-manager', 'operations-manager', 'director']);
  assert.deepEqual(validateExecutivePopulation(), []);
});

test('director decisions apply only once to a simulated pending review', () => {
  const pending = { id: 'demo-1', description: 'Review a sample assignment', status: 'awaiting-director-review' as const, simulation: true as const };
  const approved = decideDemonstrationReview(pending, 'approved');
  assert.equal(approved.decisionBy, 'director');
  assert.throws(() => decideDemonstrationReview(approved, 'rejected'));
});
