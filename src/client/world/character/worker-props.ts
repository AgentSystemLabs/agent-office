import * as THREE from 'three';
import { mesh, toon } from '../toon';

// What a worker acts out its tool calls with: papers to read, and a globe for the web.

/** A stack of papers held up to read, bound at the top; its top sheet flips over. The sheets face -z. */
export function papers(): { group: THREE.Group; page: THREE.Group } {
  const group = new THREE.Group();
  const W = 0.34;
  const H = 0.44;
  const paper = toon('#fffaf3');
  const ink = toon('#8d99ae');
  ['#f1ece2', '#f7f3ea', '#fffaf3'].forEach((c, i) => {
    const sheet = mesh(new THREE.BoxGeometry(W, H, 0.008), toon(c), (i - 1) * 0.012, -H / 2 - i * 0.006, 0.02 - i * 0.012, false);
    sheet.rotation.z = (i - 1) * 0.04;
    group.add(sheet);
  });
  const lines = (on: THREE.Object3D, z: number) => {
    for (let i = 0; i < 6; i++) {
      const short = i % 3 === 2;
      on.add(mesh(new THREE.BoxGeometry(W * (short ? 0.45 : 0.72), 0.018, 0.004), ink, short ? -W * 0.135 : 0, -0.07 - i * 0.055, z, false));
    }
  };
  lines(group, -0.01);
  // The top sheet hangs from the binding, so it flips up over the top.
  const page = new THREE.Group();
  page.add(mesh(new THREE.BoxGeometry(W, H, 0.008), paper, 0, -H / 2, -0.016, false));
  lines(page, -0.022);
  group.add(page);
  group.add(mesh(new THREE.BoxGeometry(W * 0.5, 0.05, 0.05), toon('#adb5bd'), 0, 0, 0, false));
  return { group, page };
}

/** A little globe: blue sea, green blobs of land and a gold ring round its middle. */
export function globe(): { group: THREE.Group; ball: THREE.Group; ring: THREE.Mesh } {
  const group = new THREE.Group();
  const ball = new THREE.Group();
  const r = 0.26;
  ball.add(mesh(new THREE.SphereGeometry(r, 20, 14), toon('#4cc9f0'), 0, 0, 0, false));
  const land = toon('#6fcf6a');
  for (const [lat, lon, size] of [
    [0.5, 0.2, 0.5],
    [0.1, 0.9, 0.4],
    [-0.4, 0.5, 0.45],
    [0.3, 2.4, 0.6],
    [-0.2, 3.3, 0.4],
    [0.6, 4.4, 0.45],
    [-0.5, 5.2, 0.35],
  ]) {
    const blob = mesh(new THREE.SphereGeometry(size * r, 10, 8), land, Math.cos(lat) * Math.sin(lon) * r * 0.86, Math.sin(lat) * r * 0.86, Math.cos(lat) * Math.cos(lon) * r * 0.86, false);
    blob.scale.set(1.2, 0.8, 1.2);
    ball.add(blob);
  }
  ball.rotation.z = 0.41;
  group.add(ball);
  const ring = mesh(new THREE.TorusGeometry(r * 1.35, 0.016, 6, 32), toon('#ffd166', { emissive: '#7a5b00' }), 0, 0, 0, false);
  ring.rotation.x = Math.PI / 2 - 0.2;
  group.add(ring);
  return { group, ball, ring };
}
