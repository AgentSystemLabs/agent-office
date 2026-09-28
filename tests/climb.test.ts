import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Climber, type Arrival, type Grip, type Way } from '../src/client/climb.js';
import { PlayerController } from '../src/client/player.js';
import type { Collider } from '../src/client/world/office.js';
import { FLOOR, LADDER, POLES, SLAB } from '../src/shared/layout.js';

/** The office floor: upstairs, over the garage, so off it you'd drop to the street. */
const officeFloor: Collider = { ...FLOOR, bottom: -SLAB, top: 0 };

/** A player + climber on stub DOM (the player.test.ts pattern), with the climb hooks recorded. */
function rig(t: TestContext, floors: { up?: string; down?: string }) {
  const win = new EventTarget();
  const doc = new EventTarget();
  for (const [name, value] of [['window', win], ['document', doc]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, [officeFloor]);
  const sounds: string[] = [];
  const travels: { way: Way; how: Grip; at: Arrival }[] = [];
  const dones: { how: Grip; landed: boolean }[] = [];
  const climber = new Climber(player, {
    floorThere: (way) => (way === 1 ? floors.up : floors.down),
    travel: (way, how, at) => void travels.push({ way, how, at }),
    sound: (kind) => void sounds.push(kind),
    done: (how, landed) => void dones.push({ how, landed }),
  });
  function frames(count: number, dt = 1 / 60) {
    for (let i = 0; i < count; i++) player.update(dt);
  }
  return { player, climber, sounds, travels, dones, frames };
}

test('VR stick climbs the ladder through climbInput; E drops, gravity lands', (t) => {
  const { player, climber, dones, frames } = rig(t, {});
  player.pos.set(LADDER.x + 0.4, 0, LADDER.z);
  climber.grabLadder();
  assert.equal(climber.grip, 'ladder');
  // The headset has no W key: the XR session drives the rungs through climbInput.
  player.climbInput = 1;
  frames(90);
  assert.ok(player.pos.y > 2, `climbed to y=${player.pos.y}`);
  // E above the floor: let go and drop (the session clears climbInput once released).
  player.climbInput = 0;
  climber.letGo();
  assert.equal(climber.active, false);
  assert.equal(player.rig, null);
  assert.deepEqual(dones, [{ how: 'ladder', landed: false }]);
  // ...and down you go, onto the floor.
  frames(180);
  assert.equal(player.pos.y, 0);
  assert.equal(player.grounded, true);
});

test('climbing back down to the floor steps off onto it', (t) => {
  const { player, climber, dones, frames } = rig(t, {});
  player.pos.set(LADDER.x + 0.4, 0, LADDER.z);
  climber.grabLadder();
  player.climbInput = -1;
  frames(90);
  assert.equal(climber.active, false);
  assert.equal(player.pos.y, 0);
  assert.ok(Math.abs(player.pos.x - (LADDER.hatch.maxX + 0.4)) < 0.05, `stepped off to x=${player.pos.x}`);
  assert.deepEqual(dones, [{ how: 'ladder', landed: true }]);
});

test('the ladder carries you through the hatch to the floor above', (t) => {
  const { player, climber, travels, frames } = rig(t, { up: 'upstairs' });
  player.pos.set(LADDER.x + 0.4, 0, LADDER.z);
  climber.grabLadder();
  player.climbInput = 1;
  for (let i = 0; i < 400 && travels.length === 0; i++) player.update(1 / 60);
  assert.equal(travels.length, 1);
  assert.equal(travels[0].way, 1);
  assert.equal(travels[0].how, 'ladder');
  // Between floors E does nothing (nothing to land on yet).
  climber.letGo();
  assert.equal(climber.active, true);
  // The far side arrives: up through its hatch, then off onto its floor.
  player.climbInput = 0;
  climber.arrived();
  frames(300);
  assert.equal(climber.active, false);
  assert.equal(player.pos.y, 0);
});

test('a twirl round a pole that goes nowhere ends by itself', (t) => {
  const { player, climber, dones, frames } = rig(t, {});
  const spot = POLES[0];
  player.pos.set(spot.x + 1, 0, spot.z);
  climber.twirl(spot);
  assert.equal(climber.grip, 'pole');
  assert.equal(climber.sliding, 'twirl');
  frames(35);
  assert.ok(player.pos.y > 0.3, `mid-twirl lift y=${player.pos.y}`);
  frames(120);
  assert.equal(climber.active, false);
  assert.equal(player.rig, null);
  assert.equal(player.pos.y, 0);
  assert.deepEqual(dones, [{ how: 'pole', landed: false }]);
});

test('down a pole, through the ceiling, onto the mat below', (t) => {
  const { player, climber, travels, sounds, frames } = rig(t, {});
  const spot = POLES[0];
  player.pos.set(spot.x + 1, 0, spot.z);
  climber.slide(spot);
  assert.equal(climber.sliding, 'slide');
  // E mid-slide does nothing (poles only let go at the bottom).
  frames(20);
  climber.letGo();
  assert.equal(climber.active, true);
  for (let i = 0; i < 200 && travels.length === 0; i++) player.update(1 / 60);
  assert.equal(travels.length, 1);
  assert.equal(travels[0].way, -1);
  assert.equal(travels[0].how, 'pole');
  // Through the ceiling onto the floor below, and down onto the mat.
  climber.arrived();
  frames(400);
  assert.equal(climber.active, false);
  assert.equal(player.pos.y, 0);
  assert.ok(sounds.includes('land'), `sounds: ${sounds.join(',')}`);
});
