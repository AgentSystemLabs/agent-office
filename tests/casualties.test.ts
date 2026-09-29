import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BLEED_TIME, Casualties, FADE_TIME, FALL_TIME, LOAD_TIME, POOL_R, type CasualtyLaptop, type CasualtyModel, type Medic } from '../src/client/world/casualties.js';

class Model implements CasualtyModel {
  readonly root = new THREE.Group();
  dead = false;
  disposed = false;
  updates = 0;
  update(_dt: number, _t: number) {
    this.updates++;
  }
  die() {
    this.dead = true;
  }
  revive() {
    this.dead = false;
  }
  dispose() {
    this.disposed = true;
  }
}

class MedicStub implements Medic {
  readonly root = new THREE.Group();
  disposed = false;
  moved = 0;
  update(_dt: number, _t: number, moving: boolean, _airborne: boolean) {
    if (moving) this.moved++;
  }
  dispose() {
    this.disposed = true;
  }
}

class LaptopStub implements CasualtyLaptop {
  readonly root = new THREE.Group();
  shuts = 0;
  disposed = false;
  shut(_dt: number) {
    return ++this.shuts > 3;
  }
  dispose() {
    this.disposed = true;
  }
}

function rig() {
  const parent = new THREE.Group();
  const seat = new THREE.Group();
  seat.position.set(0, 0.4, 5);
  seat.rotation.y = Math.PI;
  parent.add(seat);
  const medics: MedicStub[] = [];
  const lands: THREE.Vector3[] = [];
  const sirens: THREE.Vector3[] = [];
  const casualties = new Casualties(parent, () => 0, {
    spawnMedic: () => {
      const m = new MedicStub();
      medics.push(m);
      return m;
    },
    onLand: (at) => void lands.push(at.clone()),
    onSiren: (at) => void sirens.push(at.clone()),
  });
  const model = new Model();
  seat.add(model.root);
  const frames = (n: number, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) casualties.update(dt, i * dt);
  };
  return { parent, seat, medics, lands, sirens, casualties, model, frames };
}

test('one shot drops it out of its chair with a thud, and it bleeds out where it lands', () => {
  const { seat, lands, casualties, model, frames } = rig();
  assert.equal(casualties.shoot('w1', model, seat), true);
  assert.equal(casualties.shoot('w1', model, seat), false, 'no second scene for the same worker');
  assert.equal(casualties.phaseOf('w1'), 'fall');
  assert.equal(casualties.dying('w1'), true);
  assert.equal(model.dead, true);
  frames(Math.ceil(FALL_TIME * 60) + 2);
  assert.equal(casualties.phaseOf('w1'), 'bled');
  assert.equal(lands.length, 1, 'one thud as it lands');
  // Out of the chair toward where it faced, down on the floorboards, tipped over.
  assert.ok(Math.abs(model.root.position.x - 0) < 0.01);
  assert.ok(Math.abs(model.root.position.z - (5 - 0.65)) < 0.01);
  assert.ok(Math.abs(model.root.position.y - -0.07) < 0.01);
  assert.ok(Math.abs(model.root.rotation.x) > 1, 'flat on the floor');
  assert.ok(model.root.parent !== seat, 'out of its seat');
});

test('revive stands it back up in its seat with nothing disposed', () => {
  const { seat, casualties, model, frames } = rig();
  assert.equal(casualties.revive('nobody'), false);
  casualties.shoot('w1', model, seat);
  frames(10);
  assert.equal(casualties.revive('w1'), true, 'mid-fall too');
  assert.equal(casualties.revive('w1'), false, 'nothing left to revive');
  assert.equal(model.dead, false);
  assert.equal(model.disposed, false);
  assert.equal(model.root.parent, seat);
  assert.deepEqual(model.root.position.toArray(), [0, 0, 0]);
  assert.deepEqual([model.root.rotation.x, model.root.rotation.y, model.root.rotation.z], [0, 0, 0]);
});

test('a confirmed kill walks the medics in, loads the body over ~1.5s and carries it out', () => {
  const { seat, medics, sirens, casualties, model, frames } = rig();
  assert.equal(casualties.confirm('nobody', new LaptopStub()), false);
  casualties.shoot('w1', model, seat);
  frames(Math.ceil((FALL_TIME + BLEED_TIME) * 60), 1 / 60);
  const laptop = new LaptopStub();
  assert.equal(casualties.confirm('w1', laptop), true);
  assert.equal(casualties.confirm('w1', laptop), false, 'one team per body');
  assert.equal(casualties.dying('w1'), false, 'no longer waiting on the dialog');
  assert.equal(casualties.revive('w1'), false, 'too late to revive');
  assert.equal(medics.length, 2);
  assert.equal(sirens.length, 1);
  assert.equal(casualties.phaseOf('w1'), 'fetch');
  assert.deepEqual(casualties.positions().length, 1, 'the team is out for the doors to open');

  // They walk in from the elevator...
  let guard = 0;
  while (casualties.phaseOf('w1') === 'fetch' && guard++ < 3000) frames(1);
  assert.equal(casualties.phaseOf('w1'), 'load');
  assert.ok(
    medics.every((m) => m.moved > 0),
    'both medics walked in',
  );
  // ...load the body for ~1.5s, the pool draining as it lifts...
  frames(Math.ceil(1.4 * 60));
  assert.equal(casualties.phaseOf('w1'), 'load', 'still loading at 1.4s');
  frames(Math.ceil(0.3 * 60));
  assert.equal(casualties.phaseOf('w1'), 'carry');
  assert.equal(model.root.parent?.type, 'Group', 'the body rides the stretcher');
  // ...carry it back to the elevator and fade, laptop and all.
  guard = 0;
  while (casualties.phaseOf('w1') !== null && guard++ < 6000) frames(1);
  assert.equal(casualties.phaseOf('w1'), null);
  assert.equal(model.disposed, true);
  assert.ok(
    medics.every((m) => m.disposed),
    'the medics go with the body',
  );
  assert.ok(laptop.shuts > 3 && laptop.disposed, 'the laptop shut and shrank');
  assert.deepEqual(casualties.positions(), []);
});

test('the fade only takes FADE_TIME once the team is back', () => {
  const { seat, casualties, model, frames } = rig();
  casualties.shoot('w1', model, seat);
  casualties.confirm('w1', new LaptopStub());
  let guard = 0;
  while (casualties.phaseOf('w1') !== 'fade' && guard++ < 6000) frames(1);
  assert.equal(casualties.phaseOf('w1'), 'fade');
  frames(Math.ceil(FADE_TIME * 60) + 2);
  assert.equal(casualties.phaseOf('w1'), null, 'gone with the body, no stain left');
});

test('clear ends every scene: the dying go back in their seats, the collected are disposed', () => {
  const { seat, medics, casualties, model } = rig();
  const seat2 = new THREE.Group();
  seat2.position.set(2, 0.4, 5);
  seat.parent!.add(seat2);
  const model2 = new Model();
  seat2.add(model2.root);
  casualties.shoot('w1', model, seat);
  casualties.shoot('w2', model2, seat2);
  casualties.confirm('w2', new LaptopStub());
  casualties.clear();
  assert.equal(casualties.phaseOf('w1'), null);
  assert.equal(casualties.phaseOf('w2'), null);
  assert.equal(model.root.parent, seat, 'still the office’s to dispose');
  assert.equal(model.disposed, false);
  assert.equal(model2.disposed, true, 'collected bodies go with the floor');
  assert.ok(medics.every((m) => m.disposed));
  assert.equal(casualties.dying('w1'), false);
});

test('the blood pool geometry is shared and the constants sanity-check', () => {
  assert.ok(FALL_TIME > 0 && FALL_TIME < 2);
  assert.ok(Math.abs(LOAD_TIME - 1.5) < 1e-9, 'loading takes ~1.5s');
  assert.ok(BLEED_TIME > LOAD_TIME, 'still spreading when the medics arrive');
  assert.ok(POOL_R > 0.5 && POOL_R < 1.5);
  assert.ok(FADE_TIME > 0 && FADE_TIME < 2);
});
