import * as THREE from 'three';
import { Vox } from './vox';
import { Build, line } from './vanvox';
import { canvasTexture } from './texture';
import { leafyGeometry, pineGeometry, treeMaterial } from './voxtrees';
import { STANLEY } from './vanzones';

/** The forest floor, seawall, totem poles and the lighthouse of Stanley Park (local coordinates, 0, 0 its centre). */
export function stanleyGround(rnd: () => number): Build {
  const b = new Build(rnd);
  const R = STANLEY.r;
  for (let i = -R; i <= R; i++)
    for (let k = -R; k <= R; k++) {
      const e = Math.hypot(i / R, (k / R) * 1.15) + (Math.sin(i * 0.23) + Math.cos(k * 0.19)) * 0.025;
      if (e > 1) continue;
      const seawall = e > 0.93;
      b.v.put(i, 0, k, seawall ? ((i + k) % 2 ? '#c9c4b6' : '#d4cfc2') : ['#2f7a3c', '#2a6e37', '#357f42', '#3a8a47'][Math.abs(i * 5 + k * 3) % 4], 0.06);
      if (e > 0.985) b.v.put(i, -1, k, '#6f6a60');
      // A looping path through the middle.
      if (!seawall && Math.abs(Math.hypot(i, k) - R * 0.55) < 1.2) b.v.put(i, 0, k, '#cbb98f', 0.04);
    }
  // Totem poles at Brockton Point.
  const faces = ['#b3342c', '#1f1f23', '#f1ead8', '#2f8a6b', '#e0a537'];
  for (let p = 0; p < 5; p++) {
    const x = 22 + p * 4, z = 40;
    for (let j = 1; j <= 15; j++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) b.v.put(x + dx, j, z + dz, faces[(Math.floor(j / 3) + p) % faces.length], 0.05);
    b.slab(x - 1, 8, z + 1, x + 3, 9, z + 2, faces[p % faces.length]);
  }
  // Brockton Point lighthouse: white, red band, a lantern.
  b.slab(-30, 1, 44, -26, 13, 48, '#f5f5f0');
  b.slab(-30, 8, 44, -26, 10, 48, '#cc3b30');
  b.slab(-29, 13, 45, -27, 16, 47, '#ffd36b');
  b.slab(-30, 16, 44, -26, 17, 48, '#cc3b30');
  b.lit.put(-28, 14, 46, '#ffffff');
  return b;
}

/** The forest: instanced pines and broadleaf trees, big and dark, thick across the park. */
export function stanleyForest(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const kinds = [
    pineGeometry('#1d5a35', 0),
    pineGeometry('#256b3d', 1),
    pineGeometry('#174d2d', 2),
    leafyGeometry('#3f8a3e', 0),
    leafyGeometry('#c9742a', 1),
  ];
  const spots: THREE.Matrix4[][] = kinds.map(() => []);
  const R = STANLEY.r * 0.88;
  for (let n = 0; n < 520; n++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.88;
    if (Math.abs(Math.hypot(x, z) - STANLEY.r * 0.55) < 3) continue;
    if (x > 18 && x < 44 && z > 34 && z < 46) continue;
    const k = rnd() < 0.7 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 2);
    const s = (k < 3 ? 2.4 : 1.8) + rnd() * 1.4;
    spots[k].push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(rnd() * 4) * 1.5708), new THREE.Vector3(s, s * (0.9 + rnd() * 0.5), s)));
  }
  kinds.forEach((geo, i) => {
    const m = new THREE.InstancedMesh(geo, treeMaterial, spots[i].length);
    spots[i].forEach((mat, n) => m.setMatrixAt(n, mat));
    m.castShadow = true;
    m.frustumCulled = false;
    g.add(m);
  });
  return g;
}

/** The Lions Gate Bridge: two green towers, a long deck and swooping cables, from the park out over the inlet. */
export function lionsGate(rnd: () => number): Build {
  const b = new Build(rnd);
  const x0 = 0, x1 = 150, y = 22, towers = [40, 110], top = 62;
  b.slab(x0, y, -3, x1, y + 1, 3, '#b9c4bc');
  b.slab(x0, y + 1, -3, x1, y + 2, -2, '#7d8a82');
  b.slab(x0, y + 1, 2, x1, y + 2, 3, '#7d8a82');
  b.slab(x0, y - 1, -1, x1, y, 1, '#8b958d');
  const cable = '#9fb2a8';
  for (const tx of towers) {
    for (const tz of [-4, 3]) b.slab(tx - 1, 0, tz, tx + 1, top, tz + 1, '#2f7d5a');
    for (const j of [30, 46, 60]) b.slab(tx - 1, j, -4, tx + 1, j + 2, 4, '#2f7d5a');
    b.lit.put(tx, top, -4, '#ffffff');
    b.lit.put(tx, top, 3, '#ffffff');
  }
  for (const tz of [-4, 3]) {
    // The side spans run from each tower top to the ends of the deck, the main span sags between them.
    line(b.v, [towers[0], top, tz], [x0, y + 2, tz], cable);
    line(b.v, [towers[1], top, tz], [x1, y + 2, tz], cable);
    let prev: [number, number, number] = [towers[0], top, tz];
    for (let x = towers[0] + 2; x <= towers[1]; x += 2) {
      const t = (x - towers[0]) / (towers[1] - towers[0]);
      const cy = Math.round(y + 4 + (top - y - 4) * (2 * t - 1) ** 2);
      const cur: [number, number, number] = [x, cy, tz];
      line(b.v, prev, cur, cable);
      if (x % 6 === 0) line(b.v, cur, [x, y + 2, tz], '#aebbb3');
      prev = cur;
    }
  }
  for (let x = x0 + 4; x < x1; x += 10) b.lit.put(x, y + 3, -3, '#ffffff');
  return b;
}

/** A range of North Shore mountains in blocks: forest at the foot, grey rock, snow on the peaks. */
export function mountains(seed: number, width: number): THREE.BufferGeometry {
  const s = 5;
  const v = new Vox(s, 0.05);
  const n = Math.round(width / s);
  const ph = [seed * 1.7, seed * 2.9, seed * 0.6];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const hgt = 10 + 16 * Math.abs(Math.sin(t * 5 + ph[0])) + 9 * Math.sin(t * 11 + ph[1]) ** 2 + 6 * Math.sin(t * 23 + ph[2]) ** 2;
    const H = Math.round(hgt * (0.55 + 0.45 * Math.sin(t * Math.PI)));
    for (let k = 0; k < 6; k++) {
      const hk = Math.round(H * (1 - k * 0.12));
      for (let j = 0; j < hk; j++) v.put(i, j, k, j > H * 0.74 ? '#f3f7fb' : j > H * 0.42 ? '#7b8fa3' : '#3b6a50', 0.07);
    }
  }
  return v.build();
}

/** Water in blocks: a plane of blue squares. */
export function waterPlane(w: number, d: number): THREE.Mesh {
  const tones = ['#2f78a8', '#3585b6', '#2b6f9c', '#3b8fc0'];
  let seed = 7;
  const tex = canvasTexture(128, 128, (g) => {
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        g.fillStyle = tones[(seed >> 8) % tones.length];
        g.fillRect(x * 4, y * 4, 4, 4);
      }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.repeat.set(w / 32, d / 32);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1 }));
  m.position.y = 0.12;
  return m;
}
