import * as THREE from 'three';
import { FARM } from '../../../shared/scenic';
import { bulb } from '../outside';
import { tilingCanvasTexture } from '../texture';
import { mergeByColor, mesh, toon } from '../toon';
import { G, box, flat, flatMesh, type ScenicKit } from './kit';

/** The farm on the way out of town: its fields, the hay, the cows in their pasture, the barn and the silo, and the windmill. Returns the windmill's sails, to turn. */
export function buildFarm(kit: ScenicKit): { sails: THREE.Group } {
  const { root, rand, parts, colliders, night, cullable, around, trunk, taken, silo, mill } = kit;
  {
    const f = parts.farm;
    // Fields of crops in rows, and a fence round the pasture.
    const rows = (a: string, b: string) =>
      tilingCanvasTexture(64, 64, (g) => {
        g.fillStyle = a;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = b;
        for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 64);
      });
    const crops = [rows('#e9c46a', '#d4a340'), rows('#80b918', '#55a630')];
    FARM.fields.forEach((b, k) => {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const t = crops[k];
      t.repeat.set(w / 2.4, 1);
      const m = flatMesh(new THREE.PlaneGeometry(w, d), flat('#ffffff', 1, t));
      m.rotation.x = -Math.PI / 2;
      m.position.set((b.minX + b.maxX) / 2, G - 0.02, (b.minZ + b.maxZ) / 2);
      root.add(m);
      cullable(m, b.minX, b.maxX, b.minZ, b.maxZ);
      taken.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, r: Math.hypot(w, d) / 2 });
    });
    // Hay bales rolled up in the wheat.
    const hay = toon('#e9c46a');
    const wheat = FARM.fields[0];
    for (let k = 0; k < 14; k++) {
      const x = wheat.minX + 4 + rand() * (wheat.maxX - wheat.minX - 8);
      const z = wheat.minZ + 4 + rand() * (wheat.maxZ - wheat.minZ - 8);
      const b = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12).rotateZ(Math.PI / 2), hay, x, G + 0.85, z);
      b.rotation.y = rand() * Math.PI;
      f.add(b);
      trunk(x, z, 0.8, 1.7);
    }
    const P = FARM.pasture;
    const rail = toon('#a47148');
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3);
      for (let k = 0; k <= n; k++) f.add(mesh(box(0.14, 1.2, 0.14), rail, x0 + ((x1 - x0) * k) / n, G + 0.6, z0 + ((z1 - z0) * k) / n));
      for (const y of [0.55, 1.0]) {
        const r = mesh(box(0.06, 0.1, len), rail, (x0 + x1) / 2, G + y, (z0 + z1) / 2);
        r.rotation.y = Math.atan2(x1 - x0, z1 - z0);
        f.add(r);
      }
      colliders.push({ minX: Math.min(x0, x1) - 0.1, maxX: Math.max(x0, x1) + 0.1, minZ: Math.min(z0, z1) - 0.1, maxZ: Math.max(z0, z1) + 0.1, bottom: G, top: G + 1.2, fence: true });
    };
    fence(P.minX, P.minZ, P.maxX, P.minZ);
    fence(P.maxX, P.minZ, P.maxX, P.maxZ);
    fence(P.maxX, P.maxZ, P.minX, P.maxZ);
    fence(P.minX, P.maxZ, P.minX, P.minZ + 5);
    taken.push({ x: (P.minX + P.maxX) / 2, z: (P.minZ + P.maxZ) / 2, r: 22 });
    // Cows, grazing.
    const white = toon('#f8f9fa');
    const black = toon('#22223b');
    const pink = toon('#ffb4a2');
    for (let k = 0; k < 6; k++) {
      const cow = new THREE.Group();
      cow.add(mesh(box(1.0, 0.85, 1.9), white, 0, 1.15, 0));
      cow.add(mesh(box(1.02, 0.5, 0.6), black, 0, 1.25, 0.25));
      cow.add(mesh(box(0.6, 0.4, 0.5), black, 0.22, 1.35, -0.55));
      const head = new THREE.Group();
      head.position.set(0, 1.25, 1.05);
      head.rotation.x = k % 2 ? 0.7 : 0.1;
      head.add(mesh(box(0.55, 0.55, 0.65), white, 0, 0, 0.25));
      head.add(mesh(box(0.5, 0.3, 0.2), pink, 0, -0.12, 0.62));
      for (const sx of [-1, 1]) head.add(mesh(box(0.08, 0.2, 0.08), toon('#fefae0'), sx * 0.2, 0.36, 0.1));
      cow.add(head);
      for (const [lx, lz] of [
        [0.35, 0.7],
        [-0.35, 0.7],
        [0.35, -0.7],
        [-0.35, -0.7],
      ])
        cow.add(mesh(box(0.2, 0.75, 0.2), white, lx, 0.37, lz));
      const x = P.minX + 5 + rand() * (P.maxX - P.minX - 10);
      const z = P.minZ + 4 + rand() * (P.maxZ - P.minZ - 8);
      cow.position.set(x, G, z);
      cow.rotation.y = rand() * Math.PI * 2;
      f.add(cow);
      colliders.push({ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1, bottom: G, top: G + 1.6 });
    }
    // The barn: red, a gable roof, white trim and a big X-braced door facing the road.
    const barn = new THREE.Group();
    barn.add(mesh(box(10, 5.5, 14), toon('#b23a48'), 0, 2.75, 0));
    const gable = new THREE.Shape();
    gable.moveTo(-5.7, 0);
    gable.lineTo(5.7, 0);
    gable.lineTo(0, 3.8);
    gable.closePath();
    barn.add(mesh(new THREE.ExtrudeGeometry(gable, { depth: 14, bevelEnabled: false }).translate(0, 5.5, -7), toon('#fefae0'), 0, 0, 0));
    const roof = toon('#5c4d4d');
    for (const sx of [-1, 1]) {
      const r = mesh(box(6.9, 0.25, 15), roof, sx * 2.85, 7.45, 0);
      r.rotation.z = -sx * Math.atan2(3.8, 5.7);
      barn.add(r);
    }
    const trim = toon('#fefae0');
    barn.add(mesh(box(4.2, 4.3, 0.12), toon('#8d2b35'), 0, 2.15, -7.02));
    for (const s of [-1, 1]) {
      const brace = mesh(box(0.22, 5.8, 0.1), trim, 0, 2.15, -7.1);
      brace.rotation.z = s * Math.atan2(4.2, 4.3);
      barn.add(brace);
    }
    barn.add(mesh(box(4.6, 0.25, 0.14), trim, 0, 4.4, -7.08));
    barn.add(mesh(box(1.8, 1.4, 0.12), trim, 0, 6.4, -7.05));
    barn.add(mesh(box(1.3, 0.95, 0.14), toon('#3d2b1f'), 0, 6.4, -7.1));
    barn.position.set(FARM.barn.x, G, FARM.barn.z);
    barn.rotation.y = FARM.barn.rotY;
    f.add(barn);
    const lamp = bulb(night, '#ffd89a', 0.1);
    const lampAt = new THREE.Vector3(0, 4.9, -7.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), FARM.barn.rotY).add(new THREE.Vector3(FARM.barn.x, G, FARM.barn.z));
    f.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), lamp, lampAt.x, lampAt.y, lampAt.z, false));
    night.halos.push({ at: lampAt, size: 1.4, color: '#ffd89a', ground: true });
    colliders.push({ minX: FARM.barn.x - 7, maxX: FARM.barn.x + 7, minZ: FARM.barn.z - 7, maxZ: FARM.barn.z + 7, bottom: G, top: G + 9 });
    taken.push({ x: FARM.barn.x, z: FARM.barn.z, r: 11 });
    // The silo beside it.
    const S = FARM.silo;
    silo.add(mesh(new THREE.CylinderGeometry(3, 3, 13, 16), toon('#cfd2d6'), S.x, G + 6.5, S.z));
    for (const y of [3, 6.5, 10]) silo.add(mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.25, 16), toon('#8d99ae'), S.x, G + y, S.z, false));
    silo.add(mesh(new THREE.SphereGeometry(3.05, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon('#8d99ae'), S.x, G + 13, S.z));
    colliders.push({ minX: S.x - 3, maxX: S.x + 3, minZ: S.z - 3, maxZ: S.z + 3, bottom: G, top: G + 16 });
    taken.push({ x: S.x, z: S.z, r: 6 });
  }
  // The windmill, north of the street, its sails turning (see update).
  let sails = new THREE.Group();
  {
    const W = FARM.windmill;
    const f = mill;
    f.add(mesh(new THREE.CylinderGeometry(2.2, 3.4, 12, 8), toon('#f1e9da'), W.x, G + 6, W.z));
    f.add(mesh(new THREE.ConeGeometry(2.7, 2.8, 8), toon('#8d5b4c'), W.x, G + 13.4, W.z));
    f.add(mesh(box(1.2, 2, 0.12), toon('#6f4e37'), W.x, G + 1, W.z + 3.1));
    f.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8).rotateX(Math.PI / 2), toon('#5c4033'), W.x, G + 12, W.z + 2.6));
    const cloth = toon('#fefae0');
    const frame = toon('#6f4e37');
    const blades = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      arm.add(mesh(box(0.22, 8.5, 0.18), frame, 0, 4.4, 0));
      arm.add(mesh(box(1.5, 6.4, 0.08), cloth, 0.85, 5.2, -0.05));
      blades.add(arm);
    }
    sails = mergeByColor(blades);
    sails.position.set(W.x, G + 12, W.z + 3.35);
    root.add(sails);
    around(sails, W.x, W.z, 10, 17);
    colliders.push({ minX: W.x - 3, maxX: W.x + 3, minZ: W.z - 3, maxZ: W.z + 3, bottom: G, top: G + 14 });
    taken.push({ x: W.x, z: W.z, r: 7 });
  }

  return { sails };
}
