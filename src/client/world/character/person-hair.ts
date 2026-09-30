import * as THREE from 'three';
import { HAIR_STYLES } from '../../../shared/avatar';
import { mesh } from '../toon';

/** Hair is a set of shapes on the head (whose center is 0,0,0; the face looks down +z), in `style` (of HAIR_STYLES). */
export function styleHair(hair: THREE.Group, m: THREE.MeshToonMaterial, style: number) {
  for (const o of hair.children) (o as THREE.Mesh).geometry.dispose();
  hair.clear();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const part = mesh(geo, m, x, y, z);
    part.rotation.set(rx, 0, rz);
    hair.add(part);
    return part;
  };
  const cap = () => add(new THREE.SphereGeometry(0.355, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 0.02, -0.02, -0.25);
  switch (HAIR_STYLES[style]) {
    case 'Short':
      cap();
      break;
    case 'Long': {
      cap();
      // A curtain down the back, open at the front so the face shows.
      // Around the head from ear to ear the back way, leaving the face open (phi = π/2 is the face).
      const back = add(new THREE.SphereGeometry(0.37, 20, 14, Math.PI * 0.93, Math.PI * 1.14, Math.PI * 0.3, Math.PI * 0.5), 0, -0.06, -0.03);
      back.scale.set(1.02, 1.35, 1);
      break;
    }
    case 'Bun':
      cap();
      add(new THREE.SphereGeometry(0.14, 14, 12), 0, 0.3, -0.2);
      break;
    case 'Spiky':
      cap();
      // Two rows of spikes fanned out over the crown.
      for (const [row, n, z, tilt] of [
        [0, 5, 0.08, 0.35],
        [1, 4, -0.12, -0.3],
      ] as const) {
        for (let i = 0; i < n; i++) {
          const a = -0.85 + (i / (n - 1)) * 1.7;
          const spike = add(new THREE.ConeGeometry(0.1, 0.3, 8), Math.sin(a) * 0.24, 0.33 - Math.abs(a) * 0.08 - row * 0.02, z);
          spike.rotation.set(tilt, 0, -a * 0.9);
        }
      }
      break;
    case 'Curly': {
      // Little puffs spread over the top and back of the head, leaving the face clear.
      const n = 70;
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = i * 2.39996;
        const px = Math.cos(th) * r;
        const pz = Math.sin(th) * r;
        if (y < -0.15 || (pz > 0.35 && y < 0.55)) continue;
        add(new THREE.SphereGeometry(0.1, 8, 6), px * 0.36, y * 0.36 + 0.04, pz * 0.36 - 0.02);
      }
      break;
    }
    case 'Ponytail': {
      cap();
      add(new THREE.SphereGeometry(0.075, 10, 8), 0, 0.12, -0.34);
      const tail = add(new THREE.CapsuleGeometry(0.085, 0.3, 6, 10), 0, -0.1, -0.42, 0.35);
      tail.scale.set(1, 1, 0.8);
      break;
    }
    case 'Bald':
      break;
  }
  hair.traverse((o) => ((o as THREE.Mesh).castShadow = true));
}
