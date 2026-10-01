import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionAvailable, type DeskKey, type InteractionState } from '../src/client/interaction.js';
import type { Interactable } from '../src/client/world/office.js';

const state = (overrides: Partial<InteractionState> = {}): InteractionState => ({ room: false, note: null, carrying: false, ...overrides });
const interaction = (kind: Interactable['kind'], extra: Partial<Interactable> = {}): Interactable => ({ kind, x: 0, z: 0, radius: 1, ...extra });

test('unused desk keys are not handled without an interaction target', () => {
  for (const key of ['E', 'P', 'R', 'X', 'B', 'C', 'O', 'U'] satisfies DeskKey[]) {
    assert.equal(interactionAvailable(null, key, state()), false, `${key} should remain available to movement/input handling`);
  }
});

test('E remains handled by representative nearby interactions', () => {
  assert.equal(interactionAvailable(interaction('desk', { deskId: 'desk-1' }), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('elevator'), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('dog'), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('ladder'), 'E', state()), true);
  assert.equal(interactionAvailable(interaction('fridge'), 'E', state()), true);
});

test('the TV takes E alone — its window is where the link goes, and no other key belongs to it', () => {
  const tv = interaction('tv');
  assert.equal(interactionAvailable(tv, 'E', state()), true);
  assert.equal(interactionAvailable(tv, 'E', state({ carrying: true })), true, 'an issue card can’t be put down on the TV');
  for (const key of ['P', 'R', 'X', 'B', 'C', 'O', 'L'] as DeskKey[]) assert.equal(interactionAvailable(tv, key, state()), false, key);
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

test('U brings a helper only to a worker that could have one', () => {
  const desk = interaction('desk', { deskId: 'desk-1' });
  const base = { id: 'w', kind: 'agent', status: 'working', worktree: { path: '.agent-office/worktrees/x', branch: 'office/x', base: 'abc' } } as NonNullable<InteractionState['worker']>;
  // A worker in a worktree of its own is the only one a helper can read without disturbing the floor.
  assert.equal(interactionAvailable(desk, 'U', state({ worker: base })), true);
  // Nobody at the desk, or a shell: there is no agent to send.
  assert.equal(interactionAvailable(desk, 'U', state()), false);
  assert.equal(interactionAvailable(desk, 'U', state({ worker: { ...base, kind: 'shell' } as typeof base })), false);
  // Working in the floor's own checkout, a helper would have it reading what everyone shares.
  assert.equal(interactionAvailable(desk, 'U', state({ worker: { ...base, worktree: undefined } as typeof base })), false);
  // A helper cannot help a helper, and a lost worktree has to be rebuilt first.
  assert.equal(interactionAvailable(desk, 'U', state({ worker: { ...base, helper: { hostId: 'h', hostName: 'Widget' } } as typeof base })), false);
  assert.equal(interactionAvailable(desk, 'U', state({ worker: { ...base, lost: { branch: 'origin' } } as typeof base })), false);
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
