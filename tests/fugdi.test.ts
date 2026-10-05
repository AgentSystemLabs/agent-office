import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT, FUGDI, FUGDI_SECONDS, MAX_RINGS, RING_GAP, RING_RADIUS, fugdiPlan, fugdiPose } from '../src/shared/fugdi.js';
import { FUGDI_HOME } from '../src/shared/layout.js';

test('the rings are balanced, in a row, and every dancer has a place', () => {
  for (let n = 1; n <= 27; n++) {
    const { rings, spots } = fugdiPlan(n, FUGDI_HOME);
    assert.equal(spots.length, n, `${n} dancers are all placed`);
    assert.ok(rings.length >= 1 && rings.length <= MAX_RINGS, `${n} dancers take ${rings.length} rings`);
    assert.equal(
      rings.reduce((sum, r) => sum + r.count, 0),
      n,
    );
    const sizes = rings.map((r) => r.count);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `rings balanced for ${n}: ${sizes}`);
    // A row across the middle, one RING_GAP apart.
    rings.forEach((ring, i) => {
      assert.equal(ring.z, FUGDI_HOME.z);
      assert.equal(+ring.x.toFixed(6), +(FUGDI_HOME.x + (i - (rings.length - 1) / 2) * RING_GAP).toFixed(6));
    });
    for (const spot of spots) {
      assert.ok(spot.ring >= 0 && spot.ring < rings.length);
      assert.ok(spot.member >= 0 && spot.member < rings[spot.ring].count);
      assert.equal(spot.count, rings[spot.ring].count);
    }
  }
  assert.deepEqual(fugdiPlan(0, FUGDI_HOME), { rings: [], spots: [] });
});

test('every dancer claps, bounces and turns with the others, on the beat', () => {
  const count = 6;
  for (let t = 0; t <= FUGDI_SECONDS; t += 0.05) {
    const first = fugdiPose(t, 0, count);
    for (let member = 1; member < count; member++) {
      const p = fugdiPose(t, member, count);
      assert.equal(p.clap, first.clap, `clap in step at ${t}`);
      assert.equal(p.lift, first.lift, `bounce in step at ${t}`);
      assert.equal(p.step, first.step, `step in step at ${t}`);
      assert.equal(p.armsUp, first.armsUp, `arms in step at ${t}`);
    }
  }
  // Hands meet on each beat and come apart in between.
  assert.ok(fugdiPose(0, 0, count).clap > 0.99);
  assert.ok(fugdiPose(BEAT * 0.5, 0, count).clap < 0.01);
  assert.ok(fugdiPose(BEAT * 2, 0, count).clap > 0.99);
});

test('dancers keep to the ring, facing its middle, and never crowd each other', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 12, 19, 27]) {
    const { rings, spots } = fugdiPlan(n, FUGDI_HOME);
    for (let t = 0; t < FUGDI_SECONDS; t += 0.37) {
      const at = spots.map((spot) => {
        const p = fugdiPose(t, spot.member, spot.count, spot.ring);
        assert.ok(Number.isFinite(p.dx) && Number.isFinite(p.dz) && Number.isFinite(p.yaw));
        // The pose's facing points back at the ring it belongs to.
        const ring = rings[spot.ring];
        const radial = Math.atan2(p.dx, p.dz);
        assert.ok(Math.abs(Math.atan2(Math.sin(p.yaw - (radial + Math.PI)), Math.cos(p.yaw - (radial + Math.PI)))) < 1e-9, 'faces the middle');
        return { x: ring.x + p.dx, z: ring.z + p.dz };
      });
      for (let i = 0; i < at.length; i++) {
        for (let j = i + 1; j < at.length; j++) {
          const gap = Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z);
          assert.ok(gap > 0.85, `${n} dancers crowd at ${t.toFixed(2)}s: ${gap.toFixed(2)}m apart`);
        }
      }
    }
  }
});

test('every dancer takes a turn whirling through the middle, and the finale ends hands up', () => {
  for (const count of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const centre = new Set<number>();
    for (let t = FUGDI.circle * BEAT; t < (FUGDI.circle + FUGDI.centre) * BEAT; t += 0.05) {
      for (let member = 0; member < count; member++) if (fugdiPose(t, member, count).centre > 0.5) centre.add(member);
    }
    assert.equal(centre.size, count, `everyone in a ring of ${count} whirls through the middle`);
  }
  const end = fugdiPose(FUGDI_SECONDS, 0, 6);
  assert.ok(end.armsUp > 0.99, 'hands up at the end');
  assert.equal(Math.round(end.spin / (Math.PI * 2)), 1, 'one whole turn to finish');
  // Nonsense members are harmless (no NaN in a model's pose).
  const none = fugdiPose(1, 0, 0);
  assert.deepEqual(none, { dx: 0, dz: 0, yaw: 0, spin: 0, lift: 0, clap: 0, armsUp: 0, sway: 0, step: 0, centre: 0 });
});

test('the rings stand on the open floor south of the desks', () => {
  for (const ring of fugdiPlan(27, FUGDI_HOME).rings) {
    assert.ok(ring.x - RING_RADIUS > -9.2 && ring.x + RING_RADIUS < 2.2, `ring at x ${ring.x} clear of the kitchen and the stairs`);
    assert.ok(ring.z - RING_RADIUS > 6.4 && ring.z + RING_RADIUS < 12.9, `ring at z ${ring.z} clear of the desk rugs and the south wall`);
  }
});
