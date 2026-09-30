import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { buildFridge } from '../src/client/world/fridge.js';

// The kitchen's fridge (world/fridge.ts): code-built rather than modelled, so its doors can open. These
// are what the rest of the office counts on: that it stands on the spot and inside the footprint the
// .glb's fridge had (the office's collider, its hum and the wall's fixture are unchanged), and that E
// swings the doors and steps back to how they were.

/**
 * What world/fridge.ts needs of a browser to build: a canvas for the Diet Coke's painted labels. The
 * office has a real one; there's no need for the test to.
 */
function withCanvas() {
  const context = {
    fillRect() {},
    beginPath() {},
    moveTo() {},
    bezierCurveTo() {},
    stroke() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => context };
  (globalThis as { document?: unknown }).document = { createElement: () => canvas };
}

const OFFICE = { x: -11.3, z: 12.2, rotY: Math.PI };
const box = (f: ReturnType<typeof buildFridge>) => new Box3().setFromObject(f.group);
const size = (f: ReturnType<typeof buildFridge>) => box(f).getSize(new Vector3());
const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

test('it stands on the .glb fridge\'s spot, inside the office\'s collider, its doors facing the room', () => {
  withCanvas();
  const fridge = buildFridge(OFFICE);
  const b = box(fridge);
  // Against the south wall (z 12.7), its back to it, as the collider { minX -11.85, maxX -10.75,
  // minZ 11.7, maxZ 12.7 } has it.
  assert.ok(near(b.min.x, -11.85) && near(b.max.x, -10.75), `runs ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)} across`);
  assert.ok(near(b.max.z, 12.7), `its back is on the wall, at ${b.max.z.toFixed(3)}`);
  // The handles reach a little past the front of the shell, into the room, as the old one's did.
  assert.ok(b.min.z > 11.6 && b.min.z < 11.7, `the front reaches ${b.min.z.toFixed(3)}`);
  assert.ok(b.min.y < 0.005 && near(b.max.y, 2.2), `it stands on the floor, ${b.max.y.toFixed(3)} m tall`);
  assert.ok(near(b.max.y - b.min.y, 2.2), 'the shell over its feet is the old one\'s height');
});

test('the door is in front of it, in the room, within reach of someone stood in the kitchen', () => {
  withCanvas();
  const fridge = buildFridge(OFFICE);
  assert.ok(near(fridge.interactable.x, -11.3) && near(fridge.interactable.z, 11.3), 'the door is out in the room, in front of the fridge');
  assert.ok(fridge.interactable.y === undefined, 'it is on the office floor');
  assert.ok(fridge.interactable.radius >= 1.2, `its reach is ${fridge.interactable.radius} m`);
});

test('E opens the doors: they swing out into the room, and shut again', () => {
  withCanvas();
  const fridge = buildFridge(OFFICE);
  const shut = size(fridge);
  assert.equal(fridge.open, false, 'it starts shut');

  assert.equal(fridge.toggle(), true);
  assert.equal(fridge.open, true, 'the state follows straight away, so the hint can say so');
  fridge.update(2);
  const open = box(fridge);
  // Both doors have swung out into the room (toward world -z here), well past where they hung.
  assert.ok(open.min.z < 11.6, `the doors reach ${open.min.z.toFixed(3)} out into the room`);
  assert.ok(size(fridge).z > shut.z + 0.5, 'the whole fridge is that much deeper with the doors open');

  assert.equal(fridge.toggle(), false);
  fridge.update(2);
  assert.ok(box(fridge).min.z > 11.6, 'the doors are back in front of it');
  assert.ok(near(size(fridge).z, shut.z), 'and it is the size it was');
});

test('a swing takes a moment; an instant one is there at once, for less motion and for the lab', () => {
  withCanvas();
  const swing = buildFridge(OFFICE);
  swing.toggle();
  swing.update(1 / 60);
  assert.ok(size(swing).z < size(buildFridge(OFFICE)).z + 0.5, 'one frame in, the doors have only started');
  // The instant one doesn't need a frame at all.
  const cut = buildFridge(OFFICE);
  assert.equal(cut.toggle(true), true);
  assert.ok(size(cut).z > size(buildFridge(OFFICE)).z + 0.5, 'open the moment it is asked');
  assert.equal(cut.toggle(true), false);
  assert.ok(near(size(cut).z, size(buildFridge(OFFICE)).z), 'and shut the moment it is asked');
});
