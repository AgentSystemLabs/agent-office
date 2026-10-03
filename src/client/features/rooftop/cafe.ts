import * as THREE from 'three';
import { DRINKS, FOODS, type MenuItem } from '../../../shared/rooftop';
import { FLOOR, ROOF_BAR } from '../../../shared/layout';
import { Worker } from '../../world/character';
import { bulb } from '../../world/outside';
import { canvasTexture } from '../../world/texture';
import { mesh, toon } from '../../world/toon';
import { BRASS, PLASTER, TIMBER, TIMBER_DARK, fitFont, unpickable, type RoofSite } from './kit';

// The café along the east edge (ROOF_BAR is its counter): a plaster counter fluted with timber, an
// espresso machine and a grinder on it, a glass case of pastries, shelves of jars and cups behind it
// with a chalkboard menu, a barista, and a whitewashed pergola over it all hung with warm string lights
// and pendant lamps. Where it's lit by lamps, they're all the one warm white.

/** What the café does each frame (see update) and what ordering at it does. */
export interface Cafe {
  /** Where drinks are made, for the sound of one. */
  pourAt: { x: number; y: number; z: number };
  /** Someone ordered, standing (or sitting) at `z` along the counter: the barista comes over. */
  serve(z: number): void;
  /** `dark` is 0 by day to 1 at night: the lamps show up more. */
  update(t: number, dt: number, dark: number): void;
}

/** The chalkboard: both halves of the menu in chalk on slate. */
function menuBoard(): THREE.CanvasTexture {
  return canvasTexture(1408, 512, (g) => {
    g.fillStyle = '#2f3b36';
    g.fillRect(0, 0, 1408, 512);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 6;
    g.strokeRect(14, 14, 1380, 484);
    g.fillStyle = '#f4efe6';
    g.textBaseline = 'middle';
    const column = (title: string, items: readonly MenuItem[], x: number) => {
      g.textAlign = 'left';
      fitFont(g, title, 54, 520);
      g.fillStyle = '#ffd9a0';
      g.fillText(title, x, 62);
      g.fillStyle = '#f4efe6';
      items.forEach((it, i) => {
        fitFont(g, it.name, 36, 560);
        g.fillText(it.name, x, 134 + i * 42);
      });
    };
    column('Drinks', DRINKS, 70);
    column('Food', FOODS, 770);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(704, 50, 4, 410);
  });
}

export function buildCafe({ group, statics, colliders, interactables, night }: RoofSite): Cafe {
  const bar = new THREE.Group();
  const bx = ROOF_BAR.x;
  const blen = ROOF_BAR.maxZ - ROOF_BAR.minZ;
  const bz = (ROOF_BAR.minZ + ROOF_BAR.maxZ) / 2;
  const front = bx - ROOF_BAR.depth / 2;
  const top = ROOF_BAR.height;
  const timber = toon(TIMBER);
  const plaster = toon(PLASTER);
  const chrome = toon('#cfd6dc');
  const dark = toon('#2f3640');
  const china = toon('#fffaf3');

  // The counter: plaster with timber battens up the front, a pale oak top, and a brass foot rail.
  bar.add(mesh(new THREE.BoxGeometry(ROOF_BAR.depth, top - 0.06, blen), plaster, bx, (top - 0.06) / 2, bz));
  for (let z = ROOF_BAR.minZ + 0.15; z < ROOF_BAR.maxZ; z += 0.3) bar.add(mesh(new THREE.BoxGeometry(0.03, top - 0.2, 0.12), timber, front - 0.012, top / 2, z, false));
  bar.add(mesh(new THREE.BoxGeometry(ROOF_BAR.depth + 0.2, 0.06, blen + 0.2), toon('#dcb888'), bx - 0.05, top - 0.03, bz));
  const footRail = mesh(new THREE.CylinderGeometry(0.03, 0.03, blen, 8), toon(BRASS), front - 0.2, 0.22, bz, false);
  footRail.rotation.x = Math.PI / 2;
  bar.add(footRail);
  const underGlow = new THREE.MeshBasicMaterial({ color: '#ffb870' });
  underGlow.toneMapped = false;
  group.add(mesh(new THREE.BoxGeometry(0.02, 0.04, blen), underGlow, front - 0.02, 0.07, bz, false));
  colliders.push({ minX: front, maxX: bx + ROOF_BAR.depth / 2, minZ: ROOF_BAR.minZ, maxZ: ROOF_BAR.maxZ, top });
  const barIts = [-3.6, -0.6, 2.4].map((z) => ({ kind: 'bar' as const, x: front - 0.7, z, radius: 1.7 }));
  interactables.push(...barIts);
  bar.userData.interact = barIts[1];

  // On the counter. The espresso machine, group heads and portafilters toward the barista…
  const mz = -2.6;
  bar.add(mesh(new THREE.BoxGeometry(0.5, 0.4, 0.8), chrome, bx, top + 0.2, mz));
  bar.add(mesh(new THREE.BoxGeometry(0.52, 0.04, 0.82), dark, bx, top + 0.42, mz, false));
  bar.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.7), toon('#c9772e'), bx - 0.26, top + 0.22, mz, false));
  bar.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14).rotateZ(Math.PI / 2), dark, bx - 0.26, top + 0.32, mz, false));
  bar.add(mesh(new THREE.BoxGeometry(0.2, 0.025, 0.7), dark, bx + 0.34, top + 0.015, mz, false));
  for (const dz of [-0.2, 0.2]) {
    bar.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), dark, bx + 0.22, top + 0.26, mz + dz, false));
    bar.add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), toon('#1d1d1d'), bx + 0.34, top + 0.26, mz + dz, false));
    bar.add(mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.06, 12), china, bx + 0.34, top + 0.07, mz + dz, false));
  }
  // …a grinder with a hopper of beans…
  bar.add(mesh(new THREE.BoxGeometry(0.22, 0.36, 0.26), dark, bx, top + 0.18, -3.6));
  bar.add(mesh(new THREE.CylinderGeometry(0.1, 0.05, 0.22, 14), toon('#6b4a2e'), bx, top + 0.47, -3.6, false));
  // …stacks of cups…
  for (const [z, n] of [
    [-4.5, 4],
    [-4.9, 3],
    [-5.3, 4],
  ] as const)
    for (let k = 0; k < n; k++) bar.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.045, 12), china, bx - 0.05, top + 0.0225 + k * 0.04, z, false));
  // …and a pot of herbs by the till.
  bar.add(mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.15, 12), toon('#c4703f'), bx - 0.1, top + 0.075, 3.4));
  for (const [x, y, z] of [
    [-0.06, 0.22, 0],
    [0.05, 0.25, 0.05],
    [0.02, 0.2, -0.07],
    [0.08, 0.2, -0.03],
  ])
    bar.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), toon('#5fb760'), bx - 0.1 + x, top + y, 3.4 + z, false));

  // The pastry case: a plaster base, glass all round, two shelves of croissants and pains au chocolat.
  const cz = 1.2;
  const caseLen = 1.8;
  bar.add(mesh(new THREE.BoxGeometry(0.62, 0.3, caseLen), plaster, bx - 0.05, top + 0.15, cz));
  const glass = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  glass.userData.outlineParameters = { visible: false };
  group.add(mesh(new THREE.BoxGeometry(0.6, 0.5, caseLen - 0.04), glass, bx - 0.05, top + 0.55, cz, false));
  bar.add(mesh(new THREE.BoxGeometry(0.64, 0.03, caseLen), timber, bx - 0.05, top + 0.815, cz, false));
  const golds = ['#d9953b', '#cf8a2e', '#e0a64a'];
  for (const [y, shelf] of [
    [0.3, 0],
    [0.55, 1],
  ] as const) {
    bar.add(mesh(new THREE.BoxGeometry(0.5, 0.015, caseLen - 0.1), toon('#f6f1e7'), bx - 0.05, top + y, cz, false));
    for (let i = 0; i < 5; i++) {
      const z = cz - caseLen / 2 + 0.25 + i * 0.33;
      const x = bx - 0.05 + (i % 2 ? 0.1 : -0.1);
      if ((i + shelf) % 3 === 2) {
        // A pain au chocolat.
        const p = mesh(new THREE.CapsuleGeometry(0.045, 0.1, 4, 8), toon(golds[1]), x, top + y + 0.06, z, false);
        p.rotation.x = Math.PI / 2;
        bar.add(p);
        bar.add(mesh(new THREE.BoxGeometry(0.012, 0.012, 0.13), toon('#3b2214'), x, top + y + 0.108, z, false));
      } else {
        // A croissant: a crescent of puffed segments.
        for (let k = -2; k <= 2; k++) {
          const r = 0.034 - Math.abs(k) * 0.006;
          const seg = mesh(new THREE.SphereGeometry(r, 8, 6), toon(golds[(i + k + 3) % 3]), x + k * 0.075 * 0.5, top + y + 0.012 + r, z + Math.abs(k) * 0.025, false);
          seg.scale.set(1.1, 0.9, 1);
          bar.add(seg);
        }
      }
    }
  }
  group.add(bar);

  // The back counter and its wall, in plaster, with the shelves behind the barista…
  const back = FLOOR.maxX - 0.35;
  const wall = FLOOR.maxX - 0.08;
  statics.add(mesh(new THREE.BoxGeometry(0.6, 1.0, blen - 0.6), timber, back, 0.5, bz));
  statics.add(mesh(new THREE.BoxGeometry(0.66, 0.05, blen - 0.5), toon('#dcb888'), back, 1.02, bz));
  statics.add(mesh(new THREE.BoxGeometry(0.12, 2.9, blen - 0.4), plaster, wall + 0.02, 1.45, bz));
  const bagColors = ['#c9a27a', '#b88a5f', '#e3cfae'];
  const jarColors = ['#f4efe6', '#a8c3a0', '#e1b04a', '#c4703f'];
  let k = 0;
  for (const y of [1.55, 2.05]) {
    statics.add(mesh(new THREE.BoxGeometry(0.34, 0.04, 3.4), timber, wall - 0.2, y, 1.9, false));
    for (let z = 0.4; z < 3.5; z += 0.28) {
      k++;
      if (k % 3 === 0) statics.add(mesh(new THREE.BoxGeometry(0.1, 0.24, 0.17), toon(bagColors[k % 3]), wall - 0.2, y + 0.14, z, false));
      else if (k % 3 === 1) statics.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2 + (k % 2) * 0.04, 10), toon(jarColors[k % 4]), wall - 0.2, y + 0.12, z, false));
      else statics.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 10), china, wall - 0.2, y + 0.055, z, false));
    }
  }
  colliders.push({ minX: back - 0.3, maxX: FLOOR.maxX, minZ: ROOF_BAR.minZ + 0.3, maxZ: ROOF_BAR.maxZ - 0.3, top: 99 });
  // …and the chalkboard menu over the other half, on a timber frame.
  const board = new THREE.MeshStandardMaterial({ map: menuBoard() });
  board.userData.outlineParameters = { visible: false };
  const boardX = wall - 0.1;
  statics.add(mesh(new THREE.BoxGeometry(0.08, 1.74, 4.84), timber, boardX + 0.03, 2.2, -2.9, false));
  group.add(mesh(new THREE.PlaneGeometry(4.4, 1.6).rotateY(-Math.PI / 2), board, boardX - 0.02, 2.2, -2.9, false));

  // The pergola: whitewashed posts, a timber frame and slats, and a painted sign facing the tables.
  const white = toon('#f1ebdf');
  const p0 = { x: front - 0.9, z: ROOF_BAR.minZ - 0.8 };
  const p1 = { x: FLOOR.maxX - 0.1, z: ROOF_BAR.maxZ + 0.8 };
  const roofY = 3.3;
  for (const x of [p0.x, p1.x]) {
    for (const z of [p0.z, p1.z]) {
      statics.add(mesh(new THREE.BoxGeometry(0.16, roofY, 0.16), white, x, roofY / 2, z));
      colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1, top: 99 });
    }
    statics.add(mesh(new THREE.BoxGeometry(0.16, 0.22, p1.z - p0.z + 0.3), white, x, roofY, (p0.z + p1.z) / 2));
  }
  for (let z = p0.z; z <= p1.z + 0.01; z += 0.55) statics.add(mesh(new THREE.BoxGeometry(p1.x - p0.x + 0.4, 0.08, 0.1), timber, (p0.x + p1.x) / 2, roofY + 0.15, z));
  const sign = canvasTexture(768, 192, (g) => {
    g.fillStyle = '#f1e6d3';
    g.fillRect(0, 0, 768, 192);
    g.strokeStyle = '#6b4428';
    g.lineWidth = 10;
    g.strokeRect(10, 10, 748, 172);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#6b4428';
    fitFont(g, '☕ ROOFTOP CAFÉ', 96, 680);
    g.fillText('☕ ROOFTOP CAFÉ', 384, 100);
  });
  const signMat = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 });
  signMat.userData.outlineParameters = { visible: false };
  group.add(mesh(new THREE.PlaneGeometry(3.2, 0.8).rotateY(-Math.PI / 2), signMat, p0.x - 0.1, roofY - 0.55, bz, false));
  for (const dz of [-1.4, 1.4]) statics.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), toon(TIMBER_DARK), p0.x - 0.08, roofY - 0.2, bz + dz, false));
  // Pendant lamps along the counter, and pots hanging from the front beam.
  const pendant = bulb(night, '#ffd9a0', 0.55);
  for (const z of [-4.6, -2.3, 0, 2.3, 3.8]) {
    statics.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.75, 4), dark, bx + 0.1, roofY - 0.35, z, false));
    statics.add(mesh(new THREE.ConeGeometry(0.17, 0.2, 14, 1, true), toon('#e9d3b0'), bx + 0.1, 2.5, z, true));
    statics.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), pendant, bx + 0.1, 2.46, z, false));
  }
  for (const z of [-4.2, -1.1, 2.0]) {
    statics.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), dark, p0.x + 0.05, roofY - 0.3, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.14, 10), toon('#c4703f'), p0.x + 0.05, 2.75, z));
    for (const [dx, dy, dz] of [
      [0, 0.1, 0],
      [0.1, 0, 0.08],
      [-0.1, -0.1, -0.06],
      [0.05, -0.2, 0.05],
    ])
      statics.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), toon('#5fb760'), p0.x + 0.05 + dx, 2.82 + dy, z + dz, false));
  }

  // String lights: over the pergola, and criss-crossing the tables from a pair of poles on their far side.
  const bulbMats = ['#ffd9a0', '#ffe9c4'].map((c) => bulb(night, c, 0.45));
  const glowAt: number[] = [];
  const wire = toon('#2b2d42');
  const festoon = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag * 2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    statics.add(mesh(new THREE.TubeGeometry(curve, 20, 0.012, 4), wire, 0, 0, 0, false));
    const n = Math.max(2, Math.round(curve.getLength() / 0.6));
    for (let i = 1; i < n; i++) {
      const p = curve.getPoint(i / n);
      statics.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), bulbMats[i % 2], p.x, p.y - 0.06, p.z, false));
      glowAt.push(p.x, p.y - 0.06, p.z);
    }
  };
  for (let z = p0.z + 0.6; z < p1.z; z += 2.9) festoon(new THREE.Vector3(p0.x, roofY - 0.1, z), new THREE.Vector3(p1.x, roofY - 0.1, z + 1.4), 0.25);
  const poles = [-7.2, 4.2].map((z) => new THREE.Vector3(2.6, 3.4, z));
  for (const p of poles) {
    statics.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8), toon(TIMBER_DARK), p.x, 1.7, p.z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.1, 12), dark, p.x, 0.05, p.z, false));
    colliders.push({ minX: p.x - 0.12, maxX: p.x + 0.12, minZ: p.z - 0.12, maxZ: p.z + 0.12, top: 99 });
  }
  const corner = (z: number) => new THREE.Vector3(p0.x, roofY - 0.1, z);
  festoon(poles[0], poles[1], 0.4);
  festoon(poles[0], corner(p0.z), 0.35);
  festoon(poles[1], corner(p1.z), 0.35);
  festoon(poles[0], corner(p1.z), 0.45);
  festoon(poles[1], corner(p0.z), 0.45);
  // Their glow at night.
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt, 3));
  const halo = canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  const glows = unpickable(new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 0.55, map: halo, color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
  group.add(glows);
  const counterLight = new THREE.PointLight('#ffc98a', 0, 11, 1.2);
  counterLight.position.set(bx + 1.2, 2.8, bz);
  group.add(counterLight);
  const tableLight = new THREE.PointLight('#ffd9a0', 0, 13, 1.2);
  tableLight.position.set(7, 3.2, -1);
  group.add(tableLight);

  // The barista, behind the counter, facing it, in an apron.
  const barista = new Worker('Barista', '#8ecae6');
  barista.setStatus('idle', false);
  barista.setTask({ name: '☕ Barista', summary: "What'll it be? E at the counter" });
  // (The worker's body is the first thing in it: the apron goes on that, so it moves with it.)
  const apron = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: '#b5651d', roughness: 0.8, side: THREE.DoubleSide });
  apron.add(mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.3, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84), cloth, 0, 0.53, 0, false));
  apron.add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.02), toon('#8f4e15'), 0, 0.5, 0.3, false));
  (barista.root.children[0] ?? barista.root).add(apron);
  barista.root.position.set(bx + ROOF_BAR.depth / 2 + 0.7, 0, bz);
  barista.root.rotation.y = -Math.PI / 2;
  group.add(barista.root);
  let tendZ = bz;
  let wander = 0;

  return {
    pourAt: { x: bx + 0.2, y: top + 0.2, z: bz },
    serve(z: number) {
      tendZ = THREE.MathUtils.clamp(z, ROOF_BAR.minZ + 0.6, ROOF_BAR.maxZ - 0.6);
      wander = 6;
      barista.cheer(1.2);
    },
    update(t, dt, dusk) {
      // The barista drifts along the counter between customers, and comes over when someone orders.
      wander -= dt;
      if (wander <= 0) {
        wander = 5 + Math.random() * 6;
        tendZ = ROOF_BAR.minZ + 1 + Math.random() * (ROOF_BAR.maxZ - ROOF_BAR.minZ - 2);
      }
      const bp = barista.root.position;
      bp.z += THREE.MathUtils.clamp(tendZ - bp.z, -dt * 1.6, dt * 1.6);
      barista.update(dt, t);
      counterLight.intensity = 0.6 + 2.2 * dusk;
      tableLight.intensity = 1.6 * dusk;
      glows.material.opacity = dusk * 0.85;
      glows.visible = dusk > 0.02;
    },
  };
}
