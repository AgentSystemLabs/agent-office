import * as THREE from 'three';
import { mergeByMaterial, mesh, toon } from './toon';

export type CarKind = 'lambo' | 'ferrari';

/** A car's footprint, and how high its body and its roof come up. */
export const CAR = { length: 4.6, width: 2, body: 0.82, roof: 1.12 } as const;

const WIDTH = 1.9;
const WHEEL_R = 0.36;
const WHEEL_Y = 0.37;

/** Wheel arches cut up into the bottom of a side profile, rear to front. */
function sill(s: THREE.Shape, rearX: number, frontX: number, axles: [number, number], bottom = 0.2) {
  const r = 0.46;
  const dx = Math.sqrt(r * r - (WHEEL_Y - bottom) ** 2);
  const a0 = Math.PI + Math.atan2(WHEEL_Y - bottom, dx);
  const a1 = -Math.atan2(WHEEL_Y - bottom, dx);
  s.moveTo(rearX, bottom);
  for (const ax of axles) {
    s.lineTo(ax - dx, bottom);
    s.absarc(ax, WHEEL_Y, r, a0, a1, true);
  }
  s.lineTo(frontX, bottom);
}

/** Side profiles (x runs rear to front along the car, y up): the painted body and the glass cabin on top. */
function profiles(kind: CarKind): { body: THREE.Shape; cabin: THREE.Shape; axle: number } {
  const body = new THREE.Shape();
  const cabin = new THREE.Shape();
  if (kind === 'lambo') {
    // All wedge: a knife-edge nose, a flat hood running straight up into the windshield.
    const axle = 1.42;
    sill(body, -2.22, 2.15, [-axle, axle]);
    body.lineTo(2.32, 0.3);
    body.lineTo(2.3, 0.44);
    body.lineTo(0.95, 0.74);
    body.lineTo(-1.75, 0.86);
    body.lineTo(-2.3, 0.82);
    body.lineTo(-2.32, 0.38);
    body.closePath();
    cabin.moveTo(1.05, 0.66);
    cabin.lineTo(-0.05, 1.1);
    cabin.lineTo(-0.85, 1.1);
    cabin.lineTo(-2.05, 0.8);
    cabin.lineTo(-2.05, 0.66);
    cabin.closePath();
    return { body, cabin, axle };
  }
  // Curves: a rounded nose, a long hood and big rear haunches.
  const axle = 1.36;
  sill(body, -2.2, 2.12, [-axle, axle]);
  body.quadraticCurveTo(2.3, 0.22, 2.28, 0.42);
  body.quadraticCurveTo(1.7, 0.64, 0.55, 0.76);
  body.lineTo(-1.1, 0.84);
  body.quadraticCurveTo(-2.05, 0.96, -2.25, 0.72);
  body.lineTo(-2.26, 0.3);
  body.closePath();
  cabin.moveTo(0.65, 0.68);
  cabin.quadraticCurveTo(0.05, 1.16, -0.55, 1.13);
  cabin.quadraticCurveTo(-1.35, 1.1, -1.85, 0.78);
  cabin.lineTo(-1.85, 0.68);
  cabin.closePath();
  return { body, cabin, axle };
}

/** Extrudes a side profile `width` across, centered, and turns it so the front points to +z. */
function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/**
 * A cartoon supercar, nose toward +z, wheels on y = 0. A Lambo is a lime, orange or yellow wedge
 * with a wing; a Ferrari is curvy, round taillights and a yellow badge.
 */
export function supercar(kind: CarKind, color: string): THREE.Group {
  const g = new THREE.Group();
  const paint = toon(color);
  const glass = toon('#233347');
  const tire = toon('#1f1f26');
  const rim = toon(kind === 'lambo' ? '#e9b949' : '#d9dbe3');
  const lamp = toon('#fff6c9', { emissive: '#b8a960' });
  const tail = toon('#ff2d3f', { emissive: '#a3001a' });
  const dark = toon('#2b2d42');
  const { body, cabin, axle } = profiles(kind);
  g.add(mesh(extrude(body, WIDTH, 0.05), paint));
  g.add(mesh(extrude(cabin, 1.42, 0.03), glass));
  // A painted roof over the glass.
  g.add(mesh(new THREE.BoxGeometry(1.3, 0.05, kind === 'lambo' ? 0.8 : 0.7), paint, 0, kind === 'lambo' ? 1.11 : 1.13, kind === 'lambo' ? -0.45 : -0.3));
  for (const z of [-axle, axle]) {
    for (const sx of [-1, 1]) {
      const x = sx * (WIDTH / 2 - 0.16);
      g.add(mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 18).rotateZ(Math.PI / 2), tire, x, WHEEL_Y, z));
      g.add(mesh(new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.3, 10).rotateZ(Math.PI / 2), rim, x, WHEEL_Y, z));
    }
  }
  const L = CAR.length / 2;
  if (kind === 'lambo') {
    for (const sx of [-1, 1]) {
      const head = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.26), lamp, sx * 0.62, 0.46, L - 0.14);
      head.rotation.set(-0.25, sx * 0.25, 0);
      g.add(head);
      // Air intakes behind the doors.
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.26, 0.7), dark, sx * (WIDTH / 2 + 0.03), 0.56, -1.0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), dark, sx * 0.7, 0.98, -2.0));
    }
    g.add(mesh(new THREE.BoxGeometry(1.7, 0.08, 0.05), tail, 0, 0.7, -L - 0.03));
    // The rear wing, on two struts.
    g.add(mesh(new THREE.BoxGeometry(1.9, 0.05, 0.36), dark, 0, 1.12, -2.02));
  } else {
    for (const sx of [-1, 1]) {
      const head = mesh(new THREE.BoxGeometry(0.42, 0.08, 0.3), lamp, sx * 0.64, 0.5, L - 0.3);
      head.rotation.set(-0.35, sx * 0.3, 0);
      g.add(head);
      for (const off of [0.28, 0.62]) g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12).rotateX(Math.PI / 2), tail, sx * off, 0.62, -L + 0.18));
      // The badge on each flank.
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.09), toon('#ffd400'), sx * (WIDTH / 2 + 0.03), 0.6, 0.9));
    }
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), toon('#ffd400'), 0, 0.46, L - 0.04));
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.05), dark, 0, 0.3, L - 0.06));
  }
  return mergeByMaterial(g);
}
