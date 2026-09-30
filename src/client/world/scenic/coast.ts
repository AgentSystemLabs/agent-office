import * as THREE from 'three';
import { LIGHTHOUSE, LOOP, LOOP_HALF, PIER, shoreX } from '../../../shared/scenic';
import { bulb } from '../outside';
import { tilingCanvasTexture } from '../texture';
import { mergeByColor, mesh, textPlane, toon } from '../toon';
import { boulder } from './flora';
import { G, beside, box, indexAt, stretch, type ScenicKit } from './kit';

/** A sailboat out on the water, and where it bobs. */
export interface Boat {
  g: THREE.Group;
  x: number;
  z: number;
  phase: number;
}

/** The beach, the pier and the boats, and the lighthouse out on its point. Returns the boats, to bob, and the lighthouse's beam, to turn. */
export function buildCoast(kit: ScenicKit): { boats: Boat[]; beam: THREE.Group } {
  const { root, labels, rand, parts, colliders, night, around, taken, light } = kit;
  const boats: { g: THREE.Group; x: number; z: number; phase: number }[] = [];
  {
    const b = parts.beach;
    const colors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#9b5de5'];
    // Umbrellas and towels on the sand.
    for (const s of stretch('beach')) {
      for (let d = s.from + 10; d < s.to - 6; d += 9 + rand() * 7) {
        const p = LOOP[indexAt(d)];
        const x = shoreX(p.z) + 9 + rand() * 12;
        const z = p.z + (rand() - 0.5) * 6;
        if (Math.abs(z - PIER.z) < 6) continue;
        const color = colors[Math.floor(rand() * colors.length)];
        b.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), toon('#f1f1ee'), x, G + 1.25, z));
        const top = mesh(new THREE.ConeGeometry(1.5, 0.6, 8), toon(color), x, G + 2.45, z);
        top.rotation.z = (rand() - 0.5) * 0.3;
        b.add(top);
        const towel = mesh(box(0.9, 0.03, 1.9), toon(colors[Math.floor(rand() * colors.length)]), x + 1.1, G + 0.02, z + 0.4, false);
        towel.rotation.y = rand() * 0.6;
        b.add(towel);
        taken.push({ x, z, r: 2.5 });
      }
    }
    // A lifeguard's tower.
    {
      const p = LOOP[indexAt(stretch('beach')[0].from + 95)];
      const x = shoreX(p.z) + 12;
      const z = p.z;
      const wood = toon('#f1f1ee');
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        b.add(mesh(box(0.2, 2.6, 0.2), wood, x + dx, G + 1.3, z + dz));
      b.add(mesh(box(2.6, 0.2, 2.6), wood, x, G + 2.7, z));
      b.add(mesh(box(2.2, 1.6, 2.2), toon('#e63946'), x, G + 3.6, z));
      b.add(mesh(box(2.3, 0.1, 1.5), toon('#bde0fe'), x - 1.15, G + 3.8, z));
      b.add(mesh(new THREE.ConeGeometry(2, 0.9, 4).rotateY(Math.PI / 4), toon('#fefae0'), x, G + 4.85, z));
      b.add(mesh(box(0.1, 0.9, 0.6), toon('#fefae0'), x - 1.12, G + 3.9, z - 0.2));
      b.add(mesh(box(0.06, 3, 0.06), toon('#3d405b'), x + 1, G + 5.6, z + 1));
      b.add(mesh(box(0.05, 0.6, 0.9), toon('#ffd166'), x + 1, G + 6.7, z + 1.45));
      colliders.push({ minX: x - 1.3, maxX: x + 1.3, minZ: z - 1.3, maxZ: z + 1.3, bottom: G, top: G + 5 });
      taken.push({ x, z, r: 3 });
    }
    // A beach volleyball net, and the snack shack by the road.
    {
      const p = LOOP[indexAt(stretch('beach')[0].from + 175)];
      const x = shoreX(p.z) + 14;
      const z = p.z;
      for (const dz of [-4.5, 4.5]) b.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), toon('#f1f1ee'), x, G + 1.3, z + dz));
      b.add(mesh(box(0.04, 0.9, 9), toon('#22223b'), x, G + 2.1, z));
      b.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), toon('#ffd166'), x + 3, G + 0.22, z - 1));
      taken.push({ x, z, r: 6 });
    }
    {
      const q = stretch('beach')[0].from + 130;
      const i = indexAt(q);
      const p = LOOP[i];
      const at = beside(i, LOOP_HALF + 7);
      const shack = new THREE.Group();
      shack.add(mesh(box(4.4, 2.6, 3.2), toon('#ffcad4'), 0, 1.3, 0));
      shack.add(mesh(box(5, 0.2, 3.8), toon('#fefae0'), 0, 2.7, 0));
      for (let k = 0; k < 5; k++) {
        const stripe = mesh(box(1, 0.08, 1.4), toon(k % 2 ? '#fefae0' : '#ef476f'), -2 + k, 2.2, -2.2);
        stripe.rotation.x = -0.35;
        shack.add(stripe);
      }
      shack.add(mesh(box(4.4, 0.9, 0.2), toon('#fefae0'), 0, 1.1, -1.7));
      shack.position.set(at.x, G, at.z);
      // Its counter toward the road.
      shack.rotation.y = Math.atan2(p.tz, -p.tx);
      b.add(shack);
      const sign = textPlane('🍦 Snacks', { color: '#3d2b1f', bg: '#fefae0', size: 56 });
      sign.scale.setScalar(1.1);
      sign.position.copy(new THREE.Vector3(0, 3.35, -1.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), shack.rotation.y).add(shack.position));
      sign.rotation.y = shack.rotation.y + Math.PI;
      labels.add(sign);
      colliders.push({ minX: at.x - 2.6, maxX: at.x + 2.6, minZ: at.z - 2.6, maxZ: at.z + 2.6, bottom: G, top: G + 2.8 });
      taken.push({ x: at.x, z: at.z, r: 5 });
    }
    // The pier, out into the sea on posts, with a rail along each side.
    {
      const x0 = shoreX(PIER.z) + 8;
      const x1 = shoreX(PIER.z) - PIER.length;
      const wood = toon('#b08968');
      const deck = 0.28;
      b.add(mesh(box(x0 - x1, 0.2, PIER.width), wood, (x0 + x1) / 2, G + deck - 0.1, PIER.z));
      for (let x = x1 + 1; x < x0; x += 4) {
        for (const s of [-1, 1]) {
          b.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6), toon('#7f5539'), x, G - 0.5, PIER.z + s * (PIER.width / 2 - 0.2)));
          b.add(mesh(box(0.12, 1, 0.12), wood, x, G + deck + 0.5, PIER.z + s * (PIER.width / 2 - 0.1)));
        }
      }
      for (const s of [-1, 1]) b.add(mesh(box(x0 - x1 - 4, 0.12, 0.12), wood, (x0 + x1) / 2 - 2, G + deck + 0.95, PIER.z + s * (PIER.width / 2 - 0.1)));
      colliders.push({ minX: x1, maxX: x0, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G - 1, top: G + deck });
      for (const s of [-1, 1]) colliders.push({ minX: x1, maxX: x0 - 4, minZ: PIER.z + s * (PIER.width / 2) - 0.1, maxZ: PIER.z + s * (PIER.width / 2) + 0.1, bottom: G + deck, top: G + deck + 1, fence: true });
      colliders.push({ minX: x1 - 0.2, maxX: x1, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G + deck, top: G + deck + 1, fence: true });
      taken.push({ x: x0 - 4, z: PIER.z, r: 6 });
      night.halos.push({ at: new THREE.Vector3(x1 + 1, G + 2.4, PIER.z), size: 1.6, color: '#ffe8a3', ground: true });
      b.add(mesh(box(0.12, 2.2, 0.12), toon('#3d405b'), x1 + 1, G + 1.3, PIER.z + 1.7));
      b.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), bulb(night, '#ffe8a3', 0.1), x1 + 1, G + 2.4, PIER.z + 1.7, false));
    }
    // Sailboats out on the water, bobbing.
    for (const [x, z] of [
      [-300, 170],
      [-335, 262],
      [-290, 330],
      [-320, 80],
    ]) {
      const g = new THREE.Group();
      const hull = new THREE.Shape();
      hull.moveTo(-2.6, 0.9);
      hull.lineTo(2.9, 0.9);
      hull.lineTo(2.2, 0);
      hull.lineTo(-2.2, 0);
      hull.closePath();
      g.add(mesh(new THREE.ExtrudeGeometry(hull, { depth: 1.8, bevelEnabled: false }).translate(0, 0, -0.9), toon('#fefae0')));
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.5, 6), toon('#6f4e37'), 0.3, 4, 0));
      const sail = new THREE.Shape();
      sail.moveTo(0, 0);
      sail.lineTo(0, 5.6);
      sail.lineTo(-2.8, 0);
      sail.closePath();
      g.add(mesh(new THREE.ShapeGeometry(sail), toon(colors[boats.length % colors.length]), 0.2, 1.2, 0));
      const boat = mergeByColor(g);
      boat.position.set(x, G - 0.3, z);
      boat.rotation.y = rand() * Math.PI * 2;
      root.add(boat);
      around(boat, x, z, 5);
      boats.push({ g: boat, x, z, phase: rand() * 6 });
    }
  }
  // The lighthouse out on its point, rocks to walk out along, and its beam going round at night.
  const beam = new THREE.Group();
  {
    const c = light;
    const L = LIGHTHOUSE;
    const land = shoreX(L.z);
    for (let x = land + 2; x > L.x; x -= 3.2) boulder(c, x, L.z + (rand() - 0.5) * 3, 1.8 + rand() * 1.4, rand() * 6, '#8d8a99');
    boulder(c, L.x, L.z, 7.5, 0.4, '#8d8a99');
    boulder(c, L.x - 3, L.z + 4, 4.5, 1.7, '#77738a');
    const white = toon('#f8f9fa');
    const red = toon('#d62828');
    const base = G + 2.4;
    c.add(mesh(new THREE.CylinderGeometry(3.4, 3.8, 2, 12), toon('#cdc5b4'), L.x, base - 0.9, L.z));
    const H = 18;
    for (let k = 0; k < 6; k++) {
      const r0 = 2.6 - (k / 6) * 0.8;
      const r1 = 2.6 - ((k + 1) / 6) * 0.8;
      c.add(mesh(new THREE.CylinderGeometry(r1, r0, H / 6, 14), k % 2 ? red : white, L.x, base + (k + 0.5) * (H / 6), L.z));
    }
    c.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 14), toon('#3d405b'), L.x, base + H + 0.15, L.z));
    const glass = bulb(night, '#fff3b0', 0.35);
    c.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 12), glass, L.x, base + H + 1.3, L.z, false));
    c.add(mesh(new THREE.ConeGeometry(1.8, 1.6, 12), red, L.x, base + H + 3.1, L.z));
    c.add(mesh(new THREE.SphereGeometry(0.25, 8, 6), toon('#3d405b'), L.x, base + H + 4.05, L.z));
    night.halos.push({ at: new THREE.Vector3(L.x, base + H + 1.3, L.z), size: 9, color: '#fff3b0', ground: true });
    colliders.push({ minX: L.x - 3.8, maxX: L.x + 3.8, minZ: L.z - 3.8, maxZ: L.z + 3.8, bottom: G - 1, top: G + 30 });
    // Two long cones of light, going round, brightest at the lamp and fading out along their length.
    const fade = tilingCanvasTexture(4, 64, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 64);
    });
    // Not wrapping round, or the faded end picks up the bright one.
    fade.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshBasicMaterial({ color: '#fff3b8', map: fade, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.userData.outlineParameters = { visible: false };
    night.glows.push({ mat, max: 0.4 });
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, 70, 16, 1, true).translate(0, -35, 0), mat);
      cone.rotation.z = (s * Math.PI) / 2;
      beam.add(cone);
    }
    beam.position.set(L.x, base + H + 1.3, L.z);
    root.add(beam);
    around(beam, L.x, L.z, 70, H + 8);
  }

  return { boats, beam };
}
