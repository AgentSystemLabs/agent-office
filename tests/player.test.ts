import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player.js';
import type { Collider } from '../src/client/world/office.js';
import { BALCONY, FLOOR, LOFT, SEATING_BY_ID, SLAB, STAIRS, seatAt, seatPlace } from '../src/shared/layout.js';

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

/** Whether a player standing at (x, z) overlaps the collider's footprint. */
function overlaps(c: Collider, x: number, z: number) {
  return Math.hypot(x - THREE.MathUtils.clamp(x, c.minX, c.maxX), z - THREE.MathUtils.clamp(z, c.minZ, c.maxZ)) < 0.32;
}

test('sits on the lounge couch until you walk off, then gets up clear of it', (t) => {
  const couch: Collider = { minX: 10, maxX: 11, minZ: -2.2, maxZ: 2.2, top: 0.47 };
  const table: Collider = { minX: 12.2, maxX: 13.8, minZ: -0.8, maxZ: 0.8, top: 0.46 };
  const { player, keys, frames } = controller(t, [officeFloor, couch, table]);
  let gotUp = 0;
  player.onStand = () => gotUp++;
  const place = seatPlace(SEATING_BY_ID.get('couch')!, 2);
  player.sit(place);
  keys();
  frames(30);
  assert.deepEqual(player.pos.toArray(), [place.x, 0, place.z]);
  assert.equal(player.facing, place.rotY);
  assert.equal(player.moving, false);
  keys('KeyW');
  frames(1);
  assert.equal(player.seat, null);
  assert.equal(gotUp, 1);
  assert.ok(!overlaps(couch, player.pos.x, player.pos.z), `still on the couch at ${player.pos.toArray()}`);
  frames(10);
  assert.ok(player.pos.x > 11.8, `walked toward the TV: x=${player.pos.x}`);
  assert.equal(player.pos.y, 0);
});

test("gets up from the boss's chair behind it, away from the desk", (t) => {
  const floor: Collider = { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ, bottom: 2.75, top: 3 };
  const desk: Collider = { minX: 12.7, maxX: 15.3, minZ: 9.6, maxZ: 10.8, bottom: 3, top: 3.8 };
  const { player, keys, frames } = controller(t, [floor, desk]);
  player.sit(seatPlace(SEATING_BY_ID.get('boss-chair')!, 0));
  keys('Space');
  frames(1);
  assert.equal(player.seat, null);
  assert.ok(player.pos.z > 11.9, `got up into the desk at ${player.pos.toArray()}`);
  keys();
  frames(60);
  assert.equal(player.pos.y, 3);
});

test('gets up off a beanbag to the side when something stands in front of it', (t) => {
  const bag = SEATING_BY_ID.get('lounge-beanbag-1')!;
  const bean: Collider = { minX: bag.x - 0.5, maxX: bag.x + 0.5, minZ: bag.z - 0.5, maxZ: bag.z + 0.5, top: 0.42 };
  const place = seatPlace(bag, 0);
  const ax = place.x + Math.sin(bag.rotY) * bag.out;
  const az = place.z + Math.cos(bag.rotY) * bag.out;
  const crate: Collider = { minX: ax - 0.4, maxX: ax + 0.4, minZ: az - 0.4, maxZ: az + 0.4, top: 1 };
  const { player } = controller(t, [officeFloor, bean, crate]);
  player.sit(place);
  player.stand();
  for (const c of [bean, crate]) assert.ok(!overlaps(c, player.pos.x, player.pos.z), `stood inside something at ${player.pos.toArray()}`);
});

test('gets up off the balcony bench onto the deck, clear of the bench', (t) => {
  const deck: Collider = { ...BALCONY, bottom: -SLAB, top: 0 };
  const bench: Collider = { minX: -10, maxX: -8, minZ: BALCONY.minZ, maxZ: BALCONY.minZ + 0.55, top: 0.49 };
  const { player, keys, frames } = controller(t, [deck, bench]);
  for (const i of [0, 1]) {
    player.sit(seatPlace(SEATING_BY_ID.get('bench')!, i));
    keys('KeyS');
    frames(1);
    assert.equal(player.seat, null);
    assert.ok(!overlaps(bench, player.pos.x, player.pos.z), `stood inside the bench at ${player.pos.toArray()}`);
    keys();
    frames(30);
    assert.equal(player.pos.y, 0, 'still on the balcony');
  }
});

test('seat places are only the ones the office has', () => {
  assert.equal(seatAt('couch:2')?.seatId, 'couch');
  assert.equal(seatAt('loft-couch:1')?.y, LOFT.y);
  for (const bad of ['couch:3', 'couch:', 'couch', 'sofa:0', 'couch:-1', 'couch:1.5', '']) assert.equal(seatAt(bad), undefined, bad);
});
