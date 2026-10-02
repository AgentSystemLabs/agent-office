import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLOOR, WING, wingMinZ } from '../src/shared/layout.js';
import { buildWalls, exitPlug, wallRun } from '../src/client/world/office/shell.js';

// Indoors the walls take no shadows (features/lamplight), which goes by `userData.wall`: every piece of
// outside wall has to carry it, the back office's and the wall where the exit door would be too, or the
// light from overhead speckles the ones left out.

const looks = { wall: new THREE.MeshBasicMaterial(), trim: new THREE.MeshBasicMaterial() } as never;

/** The pieces of wall in `g` (taller than a baseboard), and how many of them are tagged. */
function wallPieces(g: THREE.Object3D): { all: number; tagged: number } {
  let all = 0;
  let tagged = 0;
  g.traverse((o) => {
    const size = ((o as THREE.Mesh).geometry as THREE.BoxGeometry | undefined)?.parameters;
    if (!size || size.height <= 0.25) return;
    all++;
    if (o.userData.wall) tagged++;
  });
  return { all, tagged };
}

test('every piece of outside wall is tagged for the indoor light, the back office’s too', () => {
  const room = new THREE.Group();
  buildWalls(room, [], [], looks);
  const wing = new THREE.Group();
  wallRun(wing, [], 'z', FLOOR.maxX, wingMinZ(WING.rows), FLOOR.minZ, 1, [{ wall: 'east', u: -16, width: 2, y0: 1, y1: 2.6 }], looks, [false, false]);
  wallRun(wing, [], 'x', wingMinZ(WING.rows), WING.minX, FLOOR.maxX, -1, [], looks, [true, true]);
  for (const [name, g] of [['room', room], ['back office', wing], ['exit plug', exitPlug(looks).group]] as const) {
    const { all, tagged } = wallPieces(g);
    assert.ok(all > 0, `${name}: no walls built`);
    assert.equal(tagged, all, `${name}: ${all - tagged} of ${all} pieces of wall untagged`);
  }
});
