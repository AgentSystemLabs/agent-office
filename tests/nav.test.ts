import test from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_DOOR, EXIT_STAIRS, FLOOR, ROAD, SEATS, STATIONS } from '../src/shared/layout.js';
import { walkable, wayHome } from '../src/shared/nav.js';

test('a worker sent home walks round the furniture, out the exit door and off along the sidewalk', () => {
  for (const seat of [...SEATS, ...STATIONS]) {
    const way = wayHome(seat);
    // It hops down right beside where it sat.
    assert.ok(Math.hypot(way[0][0] - seat.x, way[0][1] - seat.z) < 1.2, `${seat.id} hops down beside its seat`);
    const out = way.findIndex(([x]) => x < FLOOR.minX);
    assert.ok(out > 1, `${seat.id} leaves by the exit`);
    // From the aisle to the door, every step is on open floor.
    for (let i = 2; i < out; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(walkable(x, z), `${seat.id} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    // Through the doorway, not the wall beside it.
    for (const [, z] of [way[out - 1], way[out]]) assert.ok(Math.abs(z - EXIT_DOOR.u) < EXIT_DOOR.width / 2 - 0.2, `${seat.id} goes through the door`);
    // Down the steps outside, then away along the sidewalk.
    assert.ok(way.slice(out).every(([x, z]) => x < EXIT_STAIRS.minX + 1 || z > ROAD.minZ - 2.1), `${seat.id} stays off the building`);
    const [ex, ez] = way[way.length - 1];
    assert.ok(ez > ROAD.minZ - 2 && ez < ROAD.minZ && ex < EXIT_STAIRS.minX - 10, `${seat.id} ends up down the sidewalk`);
  }
});
