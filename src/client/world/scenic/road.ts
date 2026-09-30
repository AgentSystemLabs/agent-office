import * as THREE from 'three';
import { CREEK, LOOP, LOOP_HALF, LOOP_LENGTH, LOOP_PAVED, PLACES, STREET_END, STREET_Z, type Place } from '../../../shared/scenic';
import { roadTexture } from '../outside';
import { tilingCanvasTexture } from '../texture';
import { mesh, textPlane, toon } from '../toon';
import { G, beside, box, distToLine, flat, flatMesh, indexAt, smooth, stretch, strip, type ScenicKit } from './kit';

/** What the rest of the loop takes from the road: its asphalt, and where the creek crosses it. */
export interface Road {
  asphalt: THREE.CanvasTexture;
  /** How far along the asphalt's picture `d` meters round the loop is, so the dashes line up. */
  roadU(d: number): number;
  /** The creek's line, and how far round the loop the bridge over it is. */
  creekLine: { x: number; z: number }[];
  bridge: number;
}

/** The road round the loop: its asphalt and verges, the start line, the posts along it and the guardrail through the pass. */
export function buildRoad(kit: ScenicKit): Road {
  const { root, parts, taken } = kit;
  // The street's asphalt, lines and all, carried on round the loop; the dashes line up where they
  // meet, and it starts a few meters back over the street's ends so there's no seam.
  const dashes = Math.round(LOOP_LENGTH / 8 + 0.5);
  const asphalt = roadTexture();
  const lead = [6, 4, 2].map((b) => ({ x: STREET_END - b, z: STREET_Z, d: -b, tx: 1, tz: 0 }));
  const tail = [2, 4, 6].map((b) => ({ x: -STREET_END + b, z: STREET_Z, d: LOOP_LENGTH + b, tx: 1, tz: 0 }));
  const way = [...lead, ...LOOP, ...tail];
  const roadU = (d: number) => 0.5 + (d / LOOP_LENGTH) * (dashes - 0.5);
  root.add(flatMesh(strip(way, -LOOP_HALF, LOOP_HALF, G - 0.008, (i) => roadU(way[i].d)), flat('#ffffff', 4, asphalt)));
  // The gravel either side starts under the asphalt's first few meters, not right at its edge.
  const verge = [lead[2], ...LOOP, tail[0]];
  root.add(flatMesh(strip(verge, -LOOP_HALF - 1.2, LOOP_HALF + 1.2, G - 0.012, () => 0), flat('#b5a98f', 3)));

  // The start line across the street, right in front of the office: where a lap starts and ends.
  const checks = tilingCanvasTexture(64, 256, (g) => {
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 4; c++) {
        g.fillStyle = (r + c) % 2 ? '#1d1d24' : '#f8f8f2';
        g.fillRect(c * 16, r * 16, 16, 16);
      }
    }
  });
  const line = flatMesh(new THREE.PlaneGeometry(1.6, 7.6), flat('#ffffff', 6, checks));
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, G - 0.006, STREET_Z);
  root.add(line);

  const tunnel = { from: 0, to: 0 };
  for (const s of stretch('tunnel')) Object.assign(tunnel, s);
  // Where the road crosses the creek: the bridge.
  const creekLine = smooth(CREEK, 8);
  let bridge = 0;
  let bridgeOff = Infinity;
  LOOP.forEach((p) => {
    const d = distToLine(creekLine, p.x, p.z);
    if (d < bridgeOff) {
      bridgeOff = d;
      bridge = p.d;
    }
  });
  const onBridge = (d: number) => Math.abs(d - bridge) < 9;

  // White posts with reflectors down both sides, and a guardrail on the mountain side of the pass.
  const post = toon('#f1f1ee');
  const reflector = toon('#ff9f1c', { emissive: '#8a4b00' });
  for (let d = 12; d < LOOP_LENGTH - 6; d += 22) {
    if ((d > tunnel.from - 6 && d < tunnel.to + 6) || onBridge(d)) continue;
    const i = indexAt(d);
    for (const side of [-1, 1]) {
      const at = beside(i, side * (LOOP_HALF + 1.7));
      parts.road.add(mesh(box(0.14, 0.95, 0.14), post, at.x, G + 0.47, at.z));
      parts.road.add(mesh(box(0.15, 0.13, 0.15), reflector, at.x, G + 0.8, at.z, false));
    }
  }
  const steel = toon('#c3c7cf');
  for (const s of stretch('mountains')) {
    for (let d = s.from + 4; d < s.to - 2; d += 4) {
      if (d > tunnel.from - 3 && d < tunnel.to + 3) continue;
      const i = indexAt(d);
      const a = beside(i, LOOP_HALF + 1.3);
      const b = beside(indexAt(d + 4), LOOP_HALF + 1.3);
      parts.mountains.add(mesh(box(0.14, 0.75, 0.14), steel, a.x, G + 0.37, a.z));
      const rail = mesh(box(0.08, 0.32, Math.hypot(b.x - a.x, b.z - a.z) + 0.1), steel, (a.x + b.x) / 2, G + 0.62, (a.z + b.z) / 2);
      rail.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      parts.mountains.add(rail);
    }
  }
  // Nothing grows on the road or its verges.
  for (let i = 0; i < LOOP.length; i += 3) taken.push({ x: LOOP[i].x, z: LOOP[i].z, r: LOOP_PAVED + 2.2 });

  return { asphalt, roadU, creekLine, bridge };
}

/** A wooden sign on two posts, `text` on its face, facing `rotY` (its face toward +z turned by that). */
function signpost(into: THREE.Group, labels: THREE.Group, x: number, z: number, rotY: number, text: string, width = 5) {
  const g = new THREE.Group();
  const wood = toon('#7f5539');
  for (const sx of [-1, 1]) g.add(mesh(box(0.16, 3, 0.16), wood, sx * (width / 2 - 0.4), 1.5, 0));
  g.add(mesh(box(width, 1.4, 0.16), toon('#dda15e'), 0, 2.45, 0));
  g.position.set(x, G, z);
  g.rotation.y = rotY;
  into.add(g);
  const face = textPlane(text, { color: '#3d2b1f', size: 64 });
  const w = (face.geometry.parameters as { width: number }).width;
  face.scale.setScalar(Math.min(1.9, (width - 0.4) / w));
  face.position.set(x + Math.sin(rotY) * 0.09, G + 2.45, z + Math.cos(rotY) * 0.09);
  face.rotation.y = rotY;
  labels.add(face);
}

/** The signs to the loop at the town's ends, and one at the start of each stretch. */
export function buildSigns(kit: ScenicKit) {
  const { parts, labels, colliders, taken } = kit;
  // A billboard across the street from the garage, and a sign at each end of the street.
  {
    const g = new THREE.Group();
    const wood = toon('#5c4033');
    for (const sx of [-1, 1]) g.add(mesh(box(0.3, 5.6, 0.3), wood, sx * 3.2, 2.8, 0));
    g.add(mesh(box(8.4, 3.2, 0.25), toon('#264653'), 0, 4.1, 0));
    g.position.set(24, G, 37);
    g.rotation.y = Math.PI;
    parts.meadow.add(g);
    colliders.push({ minX: 20.6, maxX: 27.4, minZ: 36.8, maxZ: 37.2, bottom: G, top: G + 5.6 });
    const title = textPlane('🏎️ SCENIC LOOP', { color: '#ffd166', size: 72 });
    title.scale.setScalar(1.35);
    title.position.set(24, G + 4.75, 36.85);
    title.rotation.y = Math.PI;
    const sub = textPlane('🌾 farm · 🌲 pines · 🏔️ mountains · 🏖️ beach — 1.4 km, either way ⟷', { color: '#f1faee', size: 44 });
    const w = (sub.geometry.parameters as { width: number }).width;
    sub.scale.setScalar(7.8 / w);
    sub.position.set(24, G + 3.55, 36.85);
    sub.rotation.y = Math.PI;
    labels.add(title, sub);
  }
  signpost(parts.meadow, labels, STREET_END - 14, 20.2, -Math.PI / 2, '🏔️ Scenic Loop ⟶', 4.6);
  signpost(parts.meadow, labels, -STREET_END + 14, 20.2, Math.PI / 2, '⟵ Scenic Loop 🏖️', 4.6);

  // At the start of each stretch, a sign on the right (going round clockwise), facing the traffic.
  for (const place of ['farm', 'forest', 'mountains', 'beach', 'coast'] as Place[]) {
    const s = stretch(place)[0];
    if (!s) continue;
    const i = indexAt(s.from + 6);
    const p = LOOP[i];
    const at = beside(i, -(LOOP_HALF + 3.4));
    signpost(parts.road, labels, at.x, at.z, Math.atan2(-p.tx, -p.tz) - 0.3, `${PLACES[place].icon} ${PLACES[place].name}`);
    taken.push({ x: at.x, z: at.z, r: 3 });
  }
}
