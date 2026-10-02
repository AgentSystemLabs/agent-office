import * as THREE from 'three';
import { AIRLOCK, HULL, type AirlockPlan } from '../../../shared/maps';
import { canvasTexture } from '../texture';
import { mesh, textPlane } from '../toon';
import { box, placed, type Kit } from './kit';
import { wallFrame } from './shell';

/*
 * A station's airlock (see shared/maps/airlock.ts): an inner door in the hull with a porthole in it,
 * a chamber sticking out of the hull beyond, and an outer hatch whose two halves part, up and down,
 * onto space. Whoever's blown out of it is the workers' to act out (features/workers/eject.ts), and
 * whoever's adrift out there afterwards is theirs to show (features/workers/adrift.ts).
 */

export interface AirlockView {
  plan: AirlockPlan;
  /** Slides the inner door up into the hull: 0 shut, 1 open. */
  inner(open: number): void;
  /** Parts the outer hatch: 0 shut, 1 open. */
  outer(open: number): void;
  /** Its warning lights, flashing while someone's about to go. */
  alarm(on: boolean): void;
  /** Where its inner door and its outer hatch are, to hear them. */
  doorAt: THREE.Vector3;
  hatchAt: THREE.Vector3;
  /** Out in space: whoever's adrift goes in here. */
  outside: THREE.Group;
}

/** How high the chamber is inside. */
const ROOF = 3.1;
const SKIN = 0.25;

/** Red and white stripes: this door opens on nothing. */
function danger(g: CanvasRenderingContext2D) {
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#d7263d';
  for (let x = -32; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
}

/** Puts up the airlock in `kit.plan`, if it has one. */
export function buildAirlock(kit: Kit): AirlockView | undefined {
  const a = kit.plan.airlock;
  if (!a) return undefined;
  const { mats, group } = kit;
  const T = HULL;
  const f = wallFrame(kit.plan.bounds, a.wall);
  // Everything's built looking out through the wall: +z is out, x runs along it.
  const at = placed(a.door[0], 0, a.door[1], f.rotY);
  const w = AIRLOCK.door;
  const h = AIRLOCK.height;
  const stripes = new THREE.MeshBasicMaterial({ map: canvasTexture(256, 32, danger, [2, 1]) });

  // The inner door's frame, with its stripes and its sign over it, and a beacon either side.
  for (const sx of [-1, 1]) at.add(mesh(box(0.28, h + 0.28, T + 0.3), mats.metalDark, sx * (w / 2 + 0.1), (h + 0.28) / 2, T / 2));
  at.add(mesh(box(w + 0.56, 0.28, T + 0.3), mats.metalDark, 0, h + 0.1, T / 2));
  const band = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.56, 0.24), stripes);
  band.position.set(0, h + 0.14, -0.16);
  band.rotation.y = Math.PI;
  at.add(band);
  const sign = textPlane('⚠️ Airlock', { bg: '#2a0f12', color: '#ffd7d7', border: '#d7263d', size: 56 });
  sign.scale.multiplyScalar(0.85);
  sign.position.set(0, h + 0.72, -0.06);
  sign.rotation.y = Math.PI;
  at.add(sign);
  for (const sx of [-1, 1]) {
    at.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 12), mats.black, sx * (w / 2 + 0.55), h + 0.14, -0.1, false));
    at.add(mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), mats.warn, sx * (w / 2 + 0.55), h + 0.14, -0.14, false));
  }

  // The inner door: one slab with a porthole, sliding up into the hull.
  const slab = new THREE.Shape();
  slab.moveTo(-w / 2, 0);
  slab.lineTo(w / 2, 0);
  slab.lineTo(w / 2, h);
  slab.lineTo(-w / 2, h);
  slab.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 1.6, 0.48, 0, Math.PI * 2, true);
  slab.holes.push(hole);
  const inner = new THREE.Group();
  inner.add(mesh(new THREE.ExtrudeGeometry(slab, { depth: 0.16, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -0.08), mats.metal));
  inner.add(mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 28), mats.metalDark, 0, 1.6, -0.09, false));
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.48, 28), mats.glass);
  pane.position.set(0, 1.6, 0);
  inner.add(pane);
  inner.add(mesh(box(w - 0.3, 0.1, 0.2), mats.warn, 0, 0.5, 0, false));
  inner.position.z = T / 2;
  at.add(inner);

  // The chamber: a box out of the hull, lit red when it matters.
  const cw = AIRLOCK.width;
  const depth = AIRLOCK.depth;
  const zc = T + depth / 2;
  at.add(mesh(box(cw + 2 * SKIN, SKIN, depth), mats.metalDark, 0, -SKIN / 2, zc));
  at.add(mesh(box(cw + 2 * SKIN, SKIN, depth), mats.hullDark, 0, ROOF + SKIN / 2, zc));
  for (const sx of [-1, 1]) {
    at.add(mesh(box(SKIN, ROOF, depth), mats.hull, sx * (cw / 2 + SKIN / 2), ROOF / 2, zc));
    // A rail to hold on to, for all the good it does, and a strip of light down each side.
    at.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, depth - 1, 8).rotateX(Math.PI / 2), mats.metal, sx * (cw / 2 - 0.12), 1.05, zc, false));
    at.add(mesh(box(0.04, 0.08, depth - 0.6), mats.warn, sx * (cw / 2 - 0.02), ROOF - 0.25, zc, false));
  }
  // The wall round the inner door, on the chamber's side.
  at.add(mesh(box(cw, ROOF - h, 0.02), mats.hullDark, 0, (ROOF + h) / 2, T + 0.01, false));

  // The outer hatch: two halves that part, one up and one down, in a heavy frame with the stripes all round it.
  const zo = T + depth;
  for (const sx of [-1, 1]) at.add(mesh(box(0.3, ROOF + 2 * SKIN, 0.4), mats.metalDark, sx * (cw / 2 + SKIN / 2), ROOF / 2, zo));
  for (const y of [-SKIN / 2, ROOF + SKIN / 2]) at.add(mesh(box(cw + 2 * SKIN + 0.3, 0.3, 0.4), mats.metalDark, 0, y, zo));
  for (const y of [-0.42, ROOF + 0.42]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(cw + 0.8, 0.22), stripes);
    b.position.set(0, y, zo + 0.21);
    at.add(b);
  }
  const jaws: THREE.Group[] = [];
  for (const sy of [-1, 1]) {
    const jaw = new THREE.Group();
    jaw.add(mesh(box(cw, ROOF / 2, 0.18), mats.metal, 0, 0, 0));
    jaw.add(mesh(box(cw - 0.5, 0.08, 0.22), mats.warn, 0, -sy * (ROOF / 4 - 0.12), 0, false));
    jaw.position.set(0, ROOF / 2 + (sy * ROOF) / 4, zo);
    at.add(jaw);
    jaws.push(jaw);
  }
  group.add(at);

  // A red lamp over the inner door that floods the deck round it when the alarm's going.
  const lamp = new THREE.PointLight('#ff3b30', 0, 14, 1.6);
  lamp.position.set(0, h + 0.2, -1.2);
  at.add(lamp);
  const dark = new THREE.Color('#3a0d0d');
  const bright = new THREE.Color('#ff3b30');
  let alarm = false;
  kit.pulses.push({
    rate: 2.4,
    phase: 0,
    set(k) {
      mats.warn.color.copy(dark).lerp(bright, alarm ? 0.25 + 0.75 * k : 0);
      lamp.intensity = alarm ? 3 + 9 * k : 0;
    },
  });

  at.updateMatrixWorld(true);
  const outside = new THREE.Group();
  group.add(outside);
  return {
    plan: a,
    inner: (open) => (inner.position.y = open * (h + 0.1)),
    outer(open) {
      const e = open * open * (3 - 2 * open);
      jaws.forEach((jaw, i) => (jaw.position.y = ROOF / 2 + (i ? 1 : -1) * (ROOF / 4 + e * (ROOF / 2 + 0.05))));
    },
    alarm: (on) => (alarm = on),
    doorAt: at.localToWorld(new THREE.Vector3(0, 1.4, T / 2)),
    hatchAt: at.localToWorld(new THREE.Vector3(0, ROOF / 2, zo)),
    outside,
  };
}
