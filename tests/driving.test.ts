import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player/index.js';
import { Driver } from '../src/client/features/cars/controller.js';
import { Fleet } from '../src/client/features/cars/world.js';
import type { Collider, Interactable } from '../src/client/world/types.js';
import { CAR, SEATS, carPoint, onPavement, type CarPose } from '../src/shared/garage.js';
import { ROAD, STREET_Y } from '../src/shared/layout.js';
import { LOOP_LENGTH, STREET_END, nearLoop } from '../src/shared/scenic.js';
import { LapTimer } from '../src/client/features/cars/laps.js';

const G = STREET_Y;
const ROAD_Z = (ROAD.minZ + ROAD.maxZ) / 2;
/** The Blue Lambo, moved out onto the road for these. */
const BLUE = 8;

/** The street to stand and drive on, whatever else is there, and a driver in a car on it heading east. */
function street(t: TestContext, solids: Collider[] = []) {
  const win = new EventTarget();
  for (const [name, value] of [['window', win], ['document', new EventTarget()]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const colliders: Collider[] = [{ minX: -200, maxX: 200, minZ: -200, maxZ: 200, bottom: G - 1, top: G }, ...solids];
  const fleet = new Fleet(colliders, [] as Interactable[]);
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, colliders);
  player.view = 'third';
  const sent: CarPose[] = [];
  const bumps: number[] = [];
  const driver = new Driver(player, fleet, { moved: (_car, p) => sent.push({ ...p }), bump: (_at, speed) => bumps.push(speed) });
  fleet.place(BLUE, { x: 0, z: ROAD_Z, rotY: Math.PI / 2, speed: 0, steer: 0 });
  const keys = (...codes: string[]) => {
    player.clearKeys();
    for (const code of codes) {
      const e = new Event('keydown');
      Object.defineProperty(e, 'code', { value: code });
      win.dispatchEvent(e);
    }
  };
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) player.update(1 / 60);
  };
  return { fleet, player, driver, sent, bumps, keys, frames, car: () => fleet.cars[BLUE].pose };
}

const box = (x: number, z: number, w: number, d: number): Collider => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom: G, top: G + 3 });

test('behind the wheel, W drives off down the road, with you in your seat and the office told where', (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(90);
  const car = s.car();
  assert.ok(car.x > 5 && Math.abs(car.z - ROAD_Z) < 1e-6, `east along the road (x ${car.x.toFixed(1)})`);
  const seat = carPoint(car, SEATS.driver.x, SEATS.driver.z);
  assert.ok(Math.hypot(s.player.pos.x - seat.x, s.player.pos.z - seat.z) < 1e-6 && s.player.pos.y === G, 'sitting in it');
  assert.ok(s.sent.length > 5 && s.sent.length < 30, `a few times a second, not every frame (${s.sent.length} in 1.5 s)`);
});

test('a column in the way stops the car short with a crunch, and it backs away from it', (t) => {
  const s = street(t, [box(12, ROAD_Z, 0.5, 0.5)]);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(240);
  assert.ok(s.car().x + CAR.length / 2 <= 11.75 + 1e-6, `stopped at the column (nose at ${(s.car().x + CAR.length / 2).toFixed(2)})`);
  assert.ok(s.bumps.length >= 1 && s.bumps[0] > 5, `a crunch at ${s.bumps[0]?.toFixed(1)} m/s`);
  s.keys('KeyS');
  s.frames(60);
  assert.ok(s.car().x < 8, 'reversing out of it');
});

test('at an angle into a wall, the car slides along it rather than stopping dead', (t) => {
  // A wall along the road's north edge; the car heads east, veering into it.
  const wall = { minX: -80, maxX: 80, minZ: ROAD.minZ - 1, maxZ: ROAD.minZ + 0.3, bottom: G, top: G + 3 };
  const s = street(t, [wall]);
  s.fleet.place(BLUE, { x: 0, z: ROAD.minZ + 2.5, rotY: Math.PI / 2 + 0.35, speed: 12, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(60);
  const car = s.car();
  assert.ok(car.x > 10 && car.speed > 10, `on along the wall (x ${car.x.toFixed(1)}, ${car.speed.toFixed(1)} m/s)`);
  assert.ok(Math.abs(car.rotY - Math.PI / 2) < 0.05, 'turned to run along it');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const c = carPoint(car, (sx * CAR.width) / 2, (sz * CAR.length) / 2);
    assert.ok(c.z >= wall.maxZ - 1e-6, 'not into it');
  }
});

test('E gets you out by your door, the car stopped; with no room anywhere round it, you stay in', (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  s.frames(30);
  s.keys();
  assert.ok(s.driver.leave());
  assert.equal(s.driver.active, false);
  assert.equal(s.player.rig, null);
  assert.equal(s.sent.at(-1)?.speed, 0, 'parked where you left it');
  // The driver's side is the car's left: north, heading east.
  assert.ok(s.player.pos.z < s.car().z - CAR.width / 2 - 0.3, 'out on the driver’s side');
  // Hemmed in on every side.
  const c = s.car();
  const walls = [box(c.x, c.z - 1.85, 8, 0.6), box(c.x, c.z + 1.85, 8, 0.6), box(c.x - 3, c.z, 0.6, 4), box(c.x + 3, c.z, 0.6, 4)];
  s.player.colliders.push(...walls);
  s.driver.enter(BLUE, 'driver');
  assert.equal(s.driver.leave(), false, 'no room to open a door');
  assert.ok(s.driver.active);
  assert.ok(s.driver.leave(true), 'unless you have to (another floor, a desk)');
});

test("beside the driver, you ride along but don't drive", (t) => {
  const s = street(t);
  s.driver.enter(BLUE, 'passenger');
  s.keys('KeyW', 'KeyA');
  s.frames(60);
  assert.equal(s.car().x, 0);
  assert.equal(s.sent.length, 0);
  // Someone else drives it on: you go with it.
  s.fleet.place(BLUE, { ...s.car(), x: 10 });
  s.frames(1);
  const seat = carPoint(s.car(), SEATS.passenger.x, SEATS.passenger.z);
  assert.ok(Math.hypot(s.player.pos.x - seat.x, s.player.pos.z - seat.z) < 1e-6);
});

test("flat out with no hands, the car rides the scenic loop's edges all the way round, and the lap is timed", (t) => {
  const s = street(t);
  s.fleet.place(BLUE, { x: -20, z: ROAD_Z, rotY: Math.PI / 2, speed: 0, steer: 0 });
  s.driver.enter(BLUE, 'driver');
  s.keys('KeyW');
  const laps = new LapTimer();
  let lap: number | null = null;
  let furthest = 0;
  let slowest = Infinity;
  for (let frame = 0; frame < 60 * 110 && lap === null; frame++) {
    s.frames(1);
    const car = s.car();
    assert.ok(onPavement(car), `on the road at (${car.x.toFixed(1)}, ${car.z.toFixed(1)})`);
    lap = laps.update(car.x, car.z, frame / 60);
    const at = nearLoop(car.x, car.z);
    if (at && Math.abs(car.x) > STREET_END) furthest = Math.max(furthest, at.d);
    if (frame > 60 * 5) slowest = Math.min(slowest, car.speed);
  }
  assert.ok(furthest > LOOP_LENGTH - 20, `all the way round (${furthest.toFixed(0)} of ${LOOP_LENGTH.toFixed(0)} m)`);
  assert.ok(lap !== null && lap > 60 && lap < 100, `a lap in ${lap?.toFixed(1)} s`);
  assert.ok(slowest > 10, `bumping round the bends, never stopped (slowest ${slowest.toFixed(1)} m/s)`);
});
