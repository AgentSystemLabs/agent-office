import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionAvailable, type DeskKey, type InteractionState } from '../src/client/interaction.js';
import type { Interactable } from '../src/client/world/office.js';

const state = (overrides: Partial<InteractionState> = {}): InteractionState => ({ room: false, note: null, carrying: false, ...overrides });
const interaction = (kind: Interactable['kind'], extra: Partial<Interactable> = {}): Interactable => ({ kind, x: 0, z: 0, radius: 1, ...extra });

test('unused desk keys are not handled without an interaction target', () => {
  for (const key of ['E', 'P', 'R', 'X', 'B', 'C', 'O'] satisfies DeskKey[]) {
    assert.equal(interactionAvailable(null, key, state()), false, `${key} should remain available to movement/input handling`);
  }
});

test('E remains handled by representative nearby interactions', () => {
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'desk-1' }), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('elevator'), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('dog'), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('ladder'), 'E', state()), true);
});

test('desk-specific keys are handled only when their action is available', () => {
  const desk = interaction('desk', { deskId: 'desk-1' });
  assert.equal(interactionAvailable(desk, 'B', state()), true);
  assert.equal(interactionAvailable(desk, 'C', state()), false);

  const worker = { id: 'worker-1', status: 'working' } as InteractionState['worker'];
  assert.equal(interactionAvailable(desk, 'B', state({ worker })), false);
  assert.equal(interactionAvailable(desk, 'C', state({ worker })), true);
  assert.equal(interactionAvailable(desk, 'X', state({ worker })), true);
});

test('carried issue actions still consume E at their valid destinations', () => {
  for (const target of [interaction('issues'), interaction('queue'), interaction('meeting'), interaction('desk', { deskId: 'desk-1' })]) {
    assert.equal(interactionAvailable(target, 'E', state({ carrying: true })), true);
  }
});

test('L hangs a sign over any desk, empty or not, but not over a bean bag or a meeting chair', () => {
  const worker = { id: 'worker-1', status: 'working' } as InteractionState['worker'];
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'desk-1' }), 'L', state()), true);
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'desk-1' }), 'L', state({ worker })), true);
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'beanbag-1' }), 'L', state()), false);
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'meeting-1' }), 'L', state({ room: true })), false);
  assert.equal(interactionAvailable(interaction('expand'), 'E', state()), true);
  assert.equal(interactionAvailable(null, 'L', state()), false);
});
