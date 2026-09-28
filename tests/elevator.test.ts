import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildElevator } from '../src/client/world/elevator.js';
import { redrawText } from '../src/client/world/toon.js';
import { ELEVATOR_CAR } from '../src/shared/layout.js';
import { MAX_FLOORS } from '../src/shared/floors.js';
import { ROOF } from '../src/shared/rooftop.js';

function rig(t: TestContext) {
  const labels: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        font: '',
        fillStyle: '',
        textAlign: '',
        textBaseline: '',
        measureText: (text: string) => ({ width: text.length * 26 }),
        clearRect() {},
        fillText(text: string) {
          labels.push(text);
        },
      }),
    }),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const elevator = buildElevator();
  t.after(() => elevator.setFloors([], null));
  const panel = elevator.group.getObjectByName('elevator-floor-buttons')!;
  const button = (id: string) => panel.getObjectByName(`elevator-floor:${id}`)!;
  const tip = (id: string) => button(id).localToWorld(new THREE.Vector3(0, 0, 0.02));
  return { elevator, panel, button, tip, labels };
}

const floors = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
];

test('VR has a labeled, ray-pickable and touchable button for every floor and the roof', (t) => {
  const { elevator, panel, button, tip, labels } = rig(t);
  const all = Array.from({ length: MAX_FLOORS }, (_, i) => ({ id: `f${i}`, name: `Project ${i}` }));
  elevator.setFloors(all, 'f0');
  assert.equal(panel.visible, false, 'desktop keeps its decorative panel');
  elevator.setVR(true);
  assert.equal(panel.visible, true);
  assert.equal(panel.children.length, MAX_FLOORS + 2, 'all floors, the roof, and a backplate');
  assert.deepEqual(labels, [...all.map((f, i) => `${i + 1} · ${f.name}`), 'R · Rooftop bar']);
  elevator.group.updateMatrixWorld(true);
  for (const id of [...all.map((f) => f.id), ROOF]) {
    const point = tip(id);
    assert.ok(point.y > 1 && point.y < 2.1, 'above the rail, within reach');
    assert.ok(point.x > ELEVATOR_CAR.minX && point.x < ELEVATOR_CAR.maxX);
    assert.ok(point.z > ELEVATOR_CAR.minZ && point.z < ELEVATOR_CAR.maxZ);
    assert.equal(elevator.touchTarget(point)?.floorId, id);
    const ray = new THREE.Raycaster(point.clone().add(new THREE.Vector3(0.5, 0, 0)), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(elevator.group, true).find((hit) => {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible) return false;
      return true;
    });
    assert.ok(hit, `ray reaches ${id}`);
    assert.equal(hit.object.parent, button(id), 'the label/keycap wins over the cab wall');
    assert.equal(hit.object.parent.userData.interact.floorId, id);
  }
});

test('live floor changes replace labels and targets, dispose old resources, and skip stats-only updates', (t) => {
  const { elevator, panel, button, labels } = rig(t);
  elevator.setVR(true);
  elevator.setFloors(floors, 'alpha');
  const old = button('beta');
  const cap = old.children[0] as THREE.Mesh;
  const label = old.children[1] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  let disposed = 0;
  cap.geometry.addEventListener('dispose', () => disposed++);
  (cap.material as THREE.Material).addEventListener('dispose', () => disposed++);
  label.material.map!.addEventListener('dispose', () => disposed++);
  elevator.setFloors(
    floors.map((f) => ({ ...f })),
    'beta',
  );
  assert.equal(button('beta'), old, 'same list does not rebuild meshes on a stats broadcast');
  assert.equal(elevator.pressFloor('beta'), false, 'current floor is inactive');
  elevator.setFloors(
    [
      { id: 'alpha', name: 'Renamed' },
      { id: 'gamma', name: 'Gamma', cloning: true },
    ],
    'alpha',
  );
  assert.equal(panel.getObjectByName('elevator-floor:beta'), undefined);
  assert.equal(elevator.pressFloor('beta'), false, 'cached rays cannot activate removed destinations');
  assert.equal(disposed, 3);
  assert.ok(labels.includes('1 · Renamed'));
  assert.equal(elevator.pressFloor('gamma'), false, 'cloning floors are visible but inactive');
  labels.length = 0;
  redrawText();
  assert.ok(!labels.includes('2 · Beta'), 'disposed labels leave the font-redraw registry');
  elevator.setFloors([{ id: 'gamma', name: 'Gamma' }], 'alpha');
  assert.equal(elevator.pressFloor('gamma'), true, 'clone completion enables its button');
  elevator.setFloors([], null);
  assert.equal(panel.children.length, 0, 'an empty building has no stale buttons or roof');
});

test('a valid press depresses and releases the key, and desktop disables physical input', (t) => {
  const { elevator, button, tip, panel } = rig(t);
  elevator.setFloors(floors, 'alpha');
  assert.equal(elevator.pressFloor('beta'), false);
  assert.equal(elevator.touchTarget(tip('beta')), null);
  elevator.setVR(true);
  const rest = button('beta').position.z;
  assert.equal(elevator.pressFloor('alpha'), false);
  assert.equal(elevator.pressFloor('beta'), true);
  assert.ok(button('beta').position.z < rest);
  elevator.update(0.12);
  assert.ok(button('beta').position.z < rest);
  elevator.update(0.2);
  assert.equal(button('beta').position.z, rest);
  elevator.pressFloor('beta');
  elevator.setVR(false);
  assert.equal(panel.visible, false);
  assert.equal(button('beta').position.z, rest);
  assert.equal(elevator.touchTarget(tip('beta')), null);
});

test('touch tests the button front in world space, not the wall or a hidden cab', (t) => {
  const { elevator, tip } = rig(t);
  elevator.setFloors(floors, 'alpha');
  elevator.setVR(true);
  elevator.group.position.set(3, 2, -1);
  elevator.group.rotation.y = Math.PI / 2;
  const point = tip('beta');
  assert.equal(elevator.touchTarget(point)?.floorId, 'beta');
  assert.equal(elevator.touchTarget(point.clone().add(new THREE.Vector3(0, 0.13, 0))), null);
  assert.equal(elevator.touchTarget(point.clone().add(new THREE.Vector3(0, 0, 0.1))), null, 'behind the key');
  assert.equal(elevator.touchTarget(point.clone().add(new THREE.Vector3(0, 0, -0.1))), null, 'too far in front');
  elevator.group.visible = false;
  assert.equal(elevator.touchTarget(point), null);
});
