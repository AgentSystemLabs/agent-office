import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR, CARS, DRIVE, PAVEMENT, carFits, carPoint, drive, onPavement, overlaps, parked, paved, steerLimit, type CarPose, type Pedals } from '../src/shared/garage.js';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, ROAD } from '../src/shared/layout.js';
import { Garage } from '../src/server/garage.js';

const GAS: Pedals = { gas: 1, turn: 0, brake: false };
const COAST: Pedals = { gas: 0, turn: 0, brake: false };

/** `seconds` of these pedals, a 60th of a second at a time. */
function run(p: CarPose, pedals: Pedals, seconds: number): CarPose {
  for (let t = 0; t < seconds; t += 1 / 60) p = drive(p, pedals, 1 / 60);
  return p;
}

const still = (x = 0, z = 0, rotY = 0): CarPose => ({ x, z, rotY, speed: 0, steer: 0 });

test('every car is parked on the pavement, clear of the others and of the elevator', () => {
  const lift = { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT };
  const boxes = CARS.map((c) => {
    const a = carPoint(c, -CAR.width / 2, -CAR.length / 2);
    const b = carPoint(c, CAR.width / 2, CAR.length / 2);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  });
  CARS.forEach((c, i) => {
    assert.ok(onPavement(c), `${c.name} is on the pavement`);
    assert.ok(!overlaps(c, lift), `${c.name} is out of the elevator`);
    boxes.forEach((b, j) => assert.ok(i === j || !overlaps(c, b), `${c.name} is clear of ${CARS[j].name}`));
  });
  assert.equal(new Set(CARS.map((c) => c.name)).size, CARS.length, 'no two cars go by the same name');
});

test('a car on the gas gets up to top speed and no faster, and rolls to a dead stop off it', () => {
  let p = run(still(), GAS, 2);
  assert.ok(p.speed > 12 && p.speed < DRIVE.top, `quick off the line (${p.speed.toFixed(1)} m/s after 2 s)`);
  p = run(p, GAS, 10);
  assert.equal(p.speed, DRIVE.top);
  assert.ok(Math.abs(p.x) < 1e-9 && p.z > 100, 'straight ahead, along its nose');
  p = run(p, COAST, 20);
  assert.equal(p.speed, 0, 'stopped, not creeping');
  const z = p.z;
  assert.equal(run(p, COAST, 1).z, z);
});

test('the brake stops it quickly, and S brakes before it reverses', () => {
  const fast = { ...still(), speed: DRIVE.top };
  assert.equal(run(fast, { ...GAS, brake: true }, 1.1).speed, 0, 'the brake beats the gas');
  const back = { gas: -1, turn: 0, brake: false };
  const braking = run(fast, back, 0.5);
  assert.ok(braking.speed > 0 && braking.speed < fast.speed, 'still going forward, slower');
  const reversing = run(fast, back, 6);
  assert.equal(reversing.speed, -DRIVE.reverse, 'then backs up, only so fast');
});

test('A turns left and D right, going forward; backing up swings the other way', () => {
  const left = run({ ...still(), speed: 5 }, { gas: 0.4, turn: 1, brake: false }, 0.5);
  assert.ok(left.rotY > 0.1 && left.x > 0, 'left of +z is +x');
  const right = run({ ...still(), speed: 5 }, { gas: 0.4, turn: -1, brake: false }, 0.5);
  assert.ok(right.rotY < -0.1 && right.x < 0);
  const back = run({ ...still(), speed: -4 }, { gas: -1, turn: 1, brake: false }, 0.5);
  assert.ok(back.rotY < -0.1, 'reversing with the wheel left, the nose swings right');
});

test('it turns tighter slowly than flat out, so it never spins at speed', () => {
  const radius = (speed: number) => DRIVE.wheelbase / Math.tan(steerLimit(speed));
  assert.ok(radius(3) < 7, `a tight turn at a crawl (${radius(3).toFixed(1)} m)`);
  assert.ok(radius(DRIVE.top) > 2 * radius(3), `a wide one flat out (${radius(DRIVE.top).toFixed(1)} m)`);
  // The wheel takes a moment to turn all the way, and then holds there.
  const p = run({ ...still(), speed: 10 }, { gas: 0, turn: 1, brake: false }, 0.05);
  assert.ok(p.steer > 0 && p.steer < steerLimit(10));
  assert.ok(Math.abs(run(p, { gas: 1, turn: 1, brake: false }, 1).steer - steerLimit(DRIVE.top)) < 0.05);
});

test('you can drive out of the garage, across the lot and down the street, but not onto the grass', () => {
  // A Ferrari backed in facing the street drives straight out onto the road.
  const ferrari = CARS.find((c) => c.kind === 'ferrari')!;
  for (let z = ferrari.z; z <= (ROAD.minZ + ROAD.maxZ) / 2; z += 0.5) assert.ok(onPavement({ ...ferrari, z }), `z ${z}`);
  // Turned along the road, both ways, and on past either end of the street onto the scenic loop.
  const road = (ROAD.minZ + ROAD.maxZ) / 2;
  for (const x of [80, 105, 115, 130]) {
    assert.ok(onPavement({ x, z: road, rotY: Math.PI / 2 }), `east, x ${x}`);
    assert.ok(onPavement({ x: -x, z: road, rotY: -Math.PI / 2 }), `west, x ${-x}`);
  }
  assert.ok(!onPavement({ x: 125, z: road + 8, rotY: Math.PI / 2 }), 'not off the side of the loop');
  assert.ok(!onPavement({ x: -40, z: 18, rotY: 0 }), 'the lawn beside the lot');
  assert.ok(!onPavement({ x: 0, z: FLOOR.minZ - 1, rotY: Math.PI / 2 }), 'through the back wall');
  assert.ok(!paved(0, ROAD.maxZ + 1.5), 'the far sidewalk');
  // Nothing sticks out of a paved patch where two meet a corner the car could cut.
  assert.ok(PAVEMENT.every((b) => b.minX < b.maxX && b.minZ < b.maxZ));
});

test("a car's turned footprint only overlaps what it really touches", () => {
  const diag = { x: 0, z: 0, rotY: Math.PI / 4 };
  // Inside the square round it, but past its corner: clear.
  const corner = carPoint(diag, CAR.width / 2, CAR.length / 2);
  assert.ok(!overlaps(diag, { minX: corner.x + 0.3, maxX: corner.x + 0.8, minZ: corner.z - 0.2, maxZ: corner.z + 0.2 }));
  const r = Math.hypot(CAR.width, CAR.length) / 2;
  assert.ok(!overlaps(diag, { minX: r - 0.4, maxX: r, minZ: r - 0.4, maxZ: r }), 'the empty corner of its bounding square');
  // Right by its side: hit.
  const side = carPoint(diag, CAR.width / 2 + 0.05, 0);
  assert.ok(overlaps(diag, { minX: side.x - 0.2, maxX: side.x + 0.2, minZ: side.z - 0.2, maxZ: side.z + 0.2 }));
  assert.ok(!carFits(still(CARS[0].x, 0), [{ minX: CARS[0].x - 0.25, maxX: CARS[0].x + 0.25, minZ: -0.25, maxZ: 0.25 }]), 'a column in the way');
  assert.ok(carFits(still(CARS[0].x, 0), []), 'the aisle, with nothing there');
});

test('the garage: one driver and one passenger a car, and only the driver moves it', () => {
  const g = new Garage();
  assert.deepEqual(g.state(), parked(), 'everything in its spot to start with');
  assert.ok(g.enter('ann', 1, 'driver'));
  assert.ok(!g.enter('bob', 1, 'driver'), "Ann's driving");
  assert.ok(g.enter('bob', 1, 'passenger'));
  assert.ok(!g.enter('cat', 1, 'passenger'), 'full');
  assert.deepEqual(g.seatOf('bob'), { car: 1, seat: 'passenger' });
  const pose = { x: 0, z: 18, rotY: 1, speed: 12, steer: 0.1 };
  assert.ok(!g.drive('bob', 1, pose), "the passenger doesn't steer");
  assert.deepEqual(g.drive('ann', 1, pose), pose);
  assert.deepEqual({ ...g.state()[1], driver: undefined, passenger: undefined }, { ...pose, driver: undefined, passenger: undefined });
  assert.ok(!g.drive('ann', 1, { ...pose, x: -60 }), 'not off onto the grass');
  assert.ok(!g.drive('ann', 1, { ...pose, speed: Number.NaN }), 'nor any nonsense');
  assert.equal(g.drive('ann', 1, { ...pose, speed: 999 })?.speed, DRIVE.top, 'no faster than a car goes');
  assert.ok(!g.enter('ann', 1, 'bogus' as never));
  // Ann gets out: it stops where she left it, with Bob still in it.
  assert.ok(g.leave('ann'));
  assert.ok(!g.leave('ann'), 'already out');
  const left = g.state()[1];
  assert.equal(left.driver, undefined);
  assert.equal(left.passenger, 'bob');
  assert.deepEqual([left.x, left.z, left.speed, left.steer], [0, 18, 0, 0]);
  // Bob slides over behind the wheel (out of the passenger seat into it), then leaves for good.
  assert.ok(g.enter('bob', 1, 'driver'));
  assert.equal(g.state()[1].passenger, undefined);
  assert.ok(g.leave('bob'));
  assert.ok(!g.enter('ann', 99, 'driver'), 'no such car');
});

test("the garage: a horn only from inside a car, and not faster than a person can press it", () => {
  let now = 1_000_000;
  const g = new Garage(() => now);
  assert.equal(g.honk('ann'), undefined, 'not in a car');
  g.enter('ann', 3, 'passenger');
  assert.equal(g.honk('ann'), 3);
  assert.equal(g.honk('ann'), undefined, 'leaning on it');
  now += 300;
  assert.equal(g.honk('ann'), 3);
});
