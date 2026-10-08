import test from 'node:test';
import assert from 'node:assert/strict';
import { Race, TRACK, emptyControls, raceTime } from '../src/client/features/racing/model';

const throttle = { ...emptyControls(), throttle: true };
function drive(r: Race, seconds: number, input = throttle) {
  for (let i = 0; i < Math.round(seconds * 120); i++) r.update(1 / 120, input);
}

test('acceleration, braking and steering change car motion; stationary steering does not', () => {
  const r = new Race();
  r.update(.1, { ...emptyControls(), right: true });
  assert.equal(r.yaw, 0);
  drive(r, 2);
  assert.ok(r.speed > 20);
  assert.ok(r.x > 20);
  const before = r.speed;
  drive(r, .5, { ...emptyControls(), brake: true, right: true });
  assert.ok(r.speed < before);
  assert.ok(r.yaw > 0);
  assert.equal(r.lap, 1);
});

test('grass slows the car, pause freezes time and invalid deltas are ignored', () => {
  const road = new Race(); const grass = new Race();
  road.vx = grass.vx = 30; grass.y = -200;
  drive(road, .5, emptyControls()); drive(grass, .5, emptyControls());
  assert.ok(grass.speed < road.speed);
  assert.ok(grass.offroad);
  road.paused = true;
  const snapshot = [road.x, road.y, road.elapsed];
  drive(road, 2);
  assert.deepEqual([road.x, road.y, road.elapsed], snapshot);
  road.paused = false;
  road.update(NaN, throttle); road.update(-1, throttle);
  assert.deepEqual([road.x, road.y, road.elapsed], snapshot);
});

test('three clockwise circuits finish; reversing and cutting the infield do not count', () => {
  // Move through closely spaced positions to isolate checkpoint validation from driving skill.
  const circuit = (r: Race, direction: number, radius = 1) => {
    for (let i = 1; i <= 720; i++) {
      const angle = -Math.PI / 2 + direction * i * Math.PI * 2 / 720;
      r.x = Math.cos(angle) * TRACK.x * radius;
      r.y = Math.sin(angle) * TRACK.y * radius;
      r.update(1 / 120, emptyControls());
    }
  };
  const r = new Race();
  circuit(r, 1); assert.equal(r.lap, 2);
  circuit(r, 1); assert.equal(r.lap, 3);
  circuit(r, 1); assert.ok(r.finished); assert.ok(r.bestLap > 0);
  const elapsed = r.elapsed; drive(r, 1); assert.equal(r.elapsed, elapsed);
  const backwards = new Race(); circuit(backwards, -1); assert.equal(backwards.lap, 1);
  const cut = new Race(); circuit(cut, 1, .3); assert.equal(cut.lap, 1);
});

test('race times include minutes and hundredths', () => {
  assert.equal(raceTime(Infinity), '—');
  assert.equal(raceTime(65.23), '1:05.23');
});
