import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player.js';
import type { Collider } from '../src/client/world/office.js';
import { FLOOR, LOFT, SLAB, STAIRS } from '../src/shared/layout.js';

/** The office floor: upstairs, over the garage, so off it you'd drop to the street. */
const officeFloor: Collider = { ...FLOOR, bottom: -SLAB, top: 0 };

function controller(t: TestContext, colliders: Collider[]) {
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
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, [officeFloor, ...colliders]);
  player.camYaw = 0;
  function keys(...codes: string[]) {
    player.clearKeys();
    for (const code of codes) {
      const event = new Event('keydown');
      Object.defineProperty(event, 'code', { value: code });
      win.dispatchEvent(event);
    }
  }
  function frames(count: number, dt = 1 / 60) {
    for (let i = 0; i < count; i++) player.update(dt);
  }
  return { player, keys, frames };
}

const desk: Collider = { minX: -1.05, maxX: 1.05, minZ: -0.53, maxZ: 0.53, top: 0.78 };

test('can walk away from a loft post overlapping the randomized spawn area', (t) => {
  const post: Collider = { minX: 9.01, maxX: 9.29, minZ: 8.01, maxZ: 8.29, top: 2.75 };
  const { player, keys, frames } = controller(t, [post]);
  player.pos.set(9.15, 0, 7.98);
  keys('KeyW');
  frames(30);
  assert.ok(player.pos.z < 6, `stuck at z=${player.pos.z}`);
  assert.equal(player.pos.y, 0);
});

test('can escape a furniture overlap without first clearing it in a single frame', (t) => {
  const { player, keys, frames } = controller(t, [desk]);
  player.pos.set(0, 0, 0.2);
  keys('KeyS');
  frames(30);
  assert.ok(player.pos.z > 2, `stuck at z=${player.pos.z}`);
  assert.equal(player.pos.y, 0);
});

test('approaches a desk up to contact even with a slow frame and can then slide along it', (t) => {
  const { player, keys, frames } = controller(t, [desk]);
  player.pos.set(0, 0, 1);
  keys('KeyW', 'ShiftLeft');
  frames(1, 0.05);
  assert.ok(player.pos.z >= 0.85 - 1e-6 && player.pos.z < 0.86, `stopped short at z=${player.pos.z}`);
  keys('KeyW', 'KeyD');
  frames(12);
  assert.ok(player.pos.x > 0.6, `did not slide: x=${player.pos.x}`);
  assert.ok(player.pos.z >= 0.85 - 1e-6, 'must not enter the desk');
  keys('KeyS');
  frames(5);
  assert.ok(player.pos.z > 1.2, 'must be able to back away immediately');
});

test('escaping one collider cannot move deeper into an adjacent collider', (t) => {
  const wall: Collider = { minX: -3, maxX: 3, minZ: 0.9, maxZ: 1.1, top: 99 };
  const { player, keys, frames } = controller(t, [desk, wall]);
  player.pos.set(0, 0, 0.6);
  keys('KeyS');
  frames(20);
  assert.ok(player.pos.z <= 0.6 + 1e-6, 'must not tunnel into the wall to escape the desk');
});

test('walks up and down the office stairs without jumping', (t) => {
  const colliders: Collider[] = Array.from({ length: STAIRS.steps }, (_, i) => ({
    minX: STAIRS.fromX + i * 0.4, maxX: STAIRS.fromX + (i + 1) * 0.4,
    minZ: STAIRS.minZ, maxZ: STAIRS.maxZ, top: (i + 1) * 0.2,
  }));
  colliders.push({ minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ, bottom: 2.75, top: 3 });
  const { player, keys, frames } = controller(t, colliders);
  player.pos.set(2.6, 0, 12);
  keys('KeyD', 'ShiftLeft');
  frames(20, 0.05);
  assert.ok(player.pos.x > 9.5, `stuck climbing at ${player.pos.toArray()}`);
  assert.equal(player.pos.y, 3);
  keys('KeyA', 'ShiftLeft');
  frames(20, 0.05);
  assert.ok(player.pos.x < 3, `stuck descending at ${player.pos.toArray()}`);
  assert.equal(player.pos.y, 0);
});

test('can walk beneath the loft and land on a desk after jumping', (t) => {
  const slab: Collider = { minX: 3, maxX: 6, minZ: -2, maxZ: 2, bottom: 2.75, top: 3 };
  const { player, keys, frames } = controller(t, [desk, slab]);
  player.pos.set(4, 0, 0);
  keys('KeyD');
  frames(10);
  assert.ok(player.pos.x > 4.7);
  assert.equal(player.pos.y, 0);
  player.pos.set(0, 1, 0);
  player.grounded = false;
  player.vy = -2;
  keys();
  frames(30);
  assert.equal(player.pos.y, 0.78);
  assert.equal(player.grounded, true);
});

test('escaping overlap cannot cross through a thin stair rail on a slow sprint frame', (t) => {
  const rail: Collider = { minX: 3, maxX: 9, minZ: 11.1, maxZ: 11.2, top: 99 };
  const { player, keys, frames } = controller(t, [rail]);
  for (const z of [11, 11.149]) {
    player.pos.set(6, 0, z);
    keys('KeyS', 'ShiftLeft');
    frames(2, 0.05);
    assert.ok(player.pos.z <= z, `crossed the rail from ${z} to z=${player.pos.z}`);
    keys('KeyW');
    frames(10);
    assert.ok(player.pos.z < 10.4, 'can still retreat away from the rail');
  }
});
