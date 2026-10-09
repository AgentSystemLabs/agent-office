import test from 'node:test';
import assert from 'node:assert/strict';
import { partyCommand, partyView } from '../src/server/ws/handlers/party.js';

/** Just enough of the office for the party: one floor, and what it was told. */
function office(floorId = 'f1') {
  const told: { until: number; by: string }[] = [];
  const floor = { id: floorId };
  const ctx = { floorOf: () => floor, toFloor: (_f: unknown, m: { until: number; by: string }) => told.push(m) } as never;
  const c = { peer: { name: 'Sam' } } as never;
  return { told, floor, ctx, c };
}

test('/party starts one, /party stop ends it, and words after /party are not a stop', () => {
  const { told, floor, ctx, c } = office('a');
  assert.equal(partyCommand(ctx, c, 'hello'), false);
  assert.equal(partyCommand(ctx, c, '/party for the offsite, don’t stop now'), true);
  assert.equal(told.length, 1);
  assert.ok(told[0].until > Date.now());
  // Whoever arrives now is sent it.
  assert.equal(partyView(ctx, floor as never)?.by, 'Sam');
  assert.equal(partyCommand(ctx, c, '/party stop'), true);
  assert.equal(told[1].until, 0);
  assert.equal(partyView(ctx, floor as never), null);
});

test('a party can’t be started again straight away', () => {
  const { told, ctx, c } = office('b');
  partyCommand(ctx, c, '/party');
  partyCommand(ctx, c, '/party');
  partyCommand(ctx, c, '/party');
  assert.equal(told.length, 1);
});
