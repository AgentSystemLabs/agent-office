import * as THREE from 'three';
import type { PropConfig } from '../../../shared/maps';
import { STATION_SIZE, type StationPropKind } from '../../../shared/maps/station-props';
import { buildGong } from '../../features/gong/world';
import type { Interactable } from '../types';
import { canvasTexture } from '../texture';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { MAX_LIGHTS, TABLE_TOP, box, collide, lit, placed, type Kit } from './kit';
import { telemetry } from './textures';

// The props a station-style map places (see shared/maps/station-props.ts): the hull's ribs, light
// pods and the strips in the deck, displays, the holo-table, planters, cargo, the gong and the
// drinks dispenser, each put up by its entry in PROPS. (A viewport is cut by the shell: shell.ts.)

/** A group at a prop's spot, turned its way: `y` up, or on whatever's underfoot there (the bridge). */
const at = (kit: Kit, p: PropConfig, y = kit.floorAt(p.x, p.z)) => placed(p.x, y, p.z, p.rotY ?? 0);

/** A rib of the hull across the hall at `z`: a column up each long wall, a beam across the ceiling, a brace in each corner. */
function rib(kit: Kit, p: PropConfig) {
  const b = kit.plan.bounds;
  const H = kit.height;
  const W = b.maxX - b.minX;
  const cx = (b.minX + b.maxX) / 2;
  const { metal, metalDark, accent } = kit.mats;
  const g = placed(cx, 0, p.z);
  g.add(mesh(box(W, 0.36, 0.5), metal, 0, H - 0.18, 0, false));
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.2);
    g.add(mesh(box(0.4, H, 0.5), metal, x, H / 2, 0));
    g.add(mesh(box(0.5, 0.5, 0.62), metalDark, sx * (W / 2 - 0.25), 0.25, 0));
    const brace = mesh(box(0.3, 2.6, 0.42), metalDark, sx * (W / 2 - 1.1), H - 1.1, 0, false);
    brace.rotation.z = (sx * Math.PI) / 4;
    g.add(brace);
    g.add(mesh(box(0.03, H - 3.2, 0.1), accent, sx * (W / 2 - 0.41), (H - 2) / 2, 0, false));
    collide(kit, cx + x, p.z, 0.5, 0.62, 0, 99);
  }
  kit.still.add(g);
}

/** A light pod hanging from the ceiling; a few of them light the deck for real. */
function lamp(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const y = p.y ?? kit.height - 0.9;
  const g = placed(p.x, y, p.z);
  const r = STATION_SIZE.lamp * s;
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, kit.height - y, 6), kit.mats.metalDark, 0, (kit.height - y) / 2, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.16, 20), kit.mats.metalDark, 0, 0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.04, 20), kit.mats.lamp, 0, -0.09, 0, false));
  kit.still.add(g);
  if (!p.light || kit.lights.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight('#e6f2ff', 22, 22, 1.6);
  light.position.set(p.x, y - 0.5, p.z);
  kit.group.add(light);
  kit.lights.push(light);
}

/** A strip of light let into the deck, in the floor's color. */
function strip(kit: Kit, p: PropConfig) {
  const g = at(kit, p);
  g.add(mesh(box((p.width ?? 0.3) + 0.14, 0.012, (p.length ?? 6) + 0.14), kit.mats.black, 0, 0.006, 0, false));
  g.add(mesh(box(p.width ?? 0.3, 0.014, p.length ?? 6), kit.mats.accent, 0, 0.012, 0, false));
  kit.still.add(g);
}

/** A display on a wall: its frame, and telemetry of its own. */
function screen(kit: Kit, p: PropConfig) {
  const w = p.width ?? 2.4;
  const h = p.height ?? 1.4;
  const g = placed(p.x, p.y ?? 2.6, p.z, p.rotY ?? 0);
  g.add(mesh(box(w + 0.2, h + 0.2, 0.1), kit.mats.black, 0, 0, 0.05, false));
  const px = 512;
  const py = Math.max(64, Math.round((px * h) / w));
  const ink = `#${kit.mats.glow.color.getHexString()}`;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTexture(px, py, telemetry(Math.round(p.x * 7 + p.z * 13), px, py, ink)), toneMapped: false }));
  face.position.z = 0.105;
  g.add(face);
  kit.group.add(g);
}

/** A round holo-table: a globe of light turning over it, a little station going round the globe. */
function hologram(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = at(kit, p);
  g.scale.setScalar(s);
  const { metalDark, metal, glow, black } = kit.mats;
  const R = STATION_SIZE.hologram;
  g.add(mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.7, 0.62, 24), metalDark, 0, 0.31, 0));
  g.add(mesh(new THREE.CylinderGeometry(R, R, 0.14, 32), metal, 0, 0.69, 0));
  g.add(mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.02, 32), black, 0, 0.77, 0, false));
  g.add(mesh(new THREE.TorusGeometry(R * 0.72, 0.03, 6, 40).rotateX(Math.PI / 2), glow, 0, 0.78, 0, false));
  g.add(mesh(new THREE.TorusGeometry(R, 0.025, 6, 48).rotateX(Math.PI / 2), kit.mats.accent, 0, 0.69, 0, false));
  // The beam it's thrown up in, and the globe: lines of light round a faint ball.
  const hue = glow.color;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.66, 1.9, 28, 1, true), lit(hue, { opacity: 0.07, additive: true, side: THREE.DoubleSide }));
  beam.position.y = 1.74;
  g.add(beam);
  const globe = new THREE.Group();
  globe.position.y = 1.85;
  globe.rotation.z = 0.41;
  const wire = lit(hue, { opacity: 0.75, additive: true });
  wire.wireframe = true;
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 9), wire));
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), lit(hue, { opacity: 0.12, additive: true })));
  const spin = new THREE.Group();
  spin.add(globe);
  g.add(spin);
  // You are here.
  const orbit = new THREE.Group();
  orbit.position.y = 1.85;
  orbit.rotation.x = 0.5;
  orbit.add(mesh(new THREE.TorusGeometry(1.0, 0.008, 4, 48).rotateX(Math.PI / 2), lit(hue, { opacity: 0.5, additive: true }), 0, 0, 0, false));
  orbit.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), lit('#ffb347'), 1.0, 0, 0, false));
  const round = new THREE.Group();
  round.add(orbit);
  g.add(round);
  kit.spinners.push({ obj: spin, speed: 0.25 }, { obj: round, speed: -0.9 });
  kit.group.add(g);
  const r = R * s * Math.SQRT1_2;
  kit.colliders.push({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, top: g.position.y + 0.78 * s });
}

const LEAVES = ['#3f9b4d', '#57b85a', '#2f7d45', '#7ccf6a'];

/** A hydroponics planter: a trough of something green, with a grow-light's glow along its rim. */
function planter(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = p.width ?? STATION_SIZE.planter.width;
  const d = STATION_SIZE.planter.depth;
  const g = at(kit, p);
  g.scale.setScalar(s);
  g.add(mesh(roundedBox(w, 0.5, d, 0.08), kit.mats.white, 0, 0.25, 0));
  g.add(mesh(box(w - 0.16, 0.04, d - 0.16), toon('#3a2a20'), 0, 0.5, 0, false));
  g.add(mesh(box(w - 0.1, 0.03, 0.03), lit('#ff7ad9'), 0, 0.42, d / 2 + 0.005, false));
  const n = Math.max(3, Math.round(w / 0.4));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.25 + (i * (w - 0.5)) / (n - 1);
    const tall = 0.28 + ((i * 37) % 5) * 0.045;
    const leaf = toon(LEAVES[i % LEAVES.length]);
    g.add(mesh(new THREE.ConeGeometry(0.13, tall, 6), leaf, x, 0.52 + tall / 2, (i % 2 ? 0.08 : -0.08)));
    g.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), toon(LEAVES[(i + 2) % LEAVES.length]), x + 0.14, 0.58, i % 2 ? -0.1 : 0.1, false));
  }
  kit.still.add(g);
  collide(kit, p.x, p.z, w * s, d * s, p.rotY ?? 0, 0.9 * s);
}

/** Cargo: a crate with banded edges, and a smaller one on top of it. */
function crate(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const size = STATION_SIZE.crate;
  const g = at(kit, p);
  g.scale.setScalar(s);
  const one = (w: number, y: number, color: string, turn: number, dx: number) => {
    const c = new THREE.Group();
    c.position.set(dx, y, 0);
    c.rotation.y = turn;
    c.add(mesh(box(w, w * 0.8, w), toon(color), 0, w * 0.4, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.add(mesh(box(0.09, w * 0.8 + 0.02, 0.09), kit.mats.metalDark, sx * (w / 2 - 0.03), w * 0.4, sz * (w / 2 - 0.03), false));
    for (const sy of [0.05, w * 0.8 - 0.05]) c.add(mesh(box(w + 0.03, 0.09, w + 0.03), kit.mats.metalDark, 0, sy, 0, false));
    c.add(mesh(box(w * 0.4, w * 0.22, 0.02), kit.mats.white, 0, w * 0.45, w / 2 + 0.01, false));
    g.add(c);
  };
  one(size * 0.92, 0, '#d0812f', 0, 0);
  one(size * 0.55, size * 0.92 * 0.8, '#5c7fa3', 0.5, 0.12);
  kit.still.add(g);
  collide(kit, p.x, p.z, size * s, size * s, p.rotY ?? 0, 99);
}

/** A drinks dispenser against a wall: a cup from it perks you up, like the office's coffee. */
function dispenser(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const { width: w, depth: d } = STATION_SIZE.dispenser;
  const g = at(kit, p);
  g.scale.setScalar(s);
  const { metalDark, black, white, glow, metal } = kit.mats;
  g.add(mesh(roundedBox(w, 2, d, 0.08), metalDark, 0, 1.0, 0));
  g.add(mesh(box(w - 0.24, 0.62, 0.04), black, 0, 1.45, d / 2 + 0.01, false));
  g.add(mesh(box(w - 0.4, 0.07, 0.02), glow, 0, 1.6, d / 2 + 0.035, false));
  g.add(mesh(box(w - 0.6, 0.07, 0.02), glow, -0.1, 1.45, d / 2 + 0.035, false));
  // The alcove a cup's filled in, a spout over it, and a cup waiting.
  g.add(mesh(box(w - 0.3, 0.46, 0.06), black, 0, 0.86, d / 2 - 0.02, false));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), metal, 0, 1.03, d / 2 + 0.06, false));
  g.add(mesh(box(w - 0.3, 0.05, 0.24), metal, 0, 0.64, d / 2 + 0.1, false));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 12), white, 0, 0.74, d / 2 + 0.1, false));
  const sign = textPlane('☕ Hot drinks', { bg: '#0f1a26', color: '#cfeeff', border: '#3a5a78', size: 48 });
  sign.scale.multiplyScalar(0.6);
  sign.position.set(0, 2.25, d / 2 - 0.1);
  g.add(sign);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, w * s, d * s, r, 99);
  const it: Interactable = { kind: 'coffee', label: '☕ Drinks dispenser', x: p.x + Math.sin(r) * 1.1, y: g.position.y, z: p.z + Math.cos(r) * 1.1, radius: 1.5 };
  g.userData.interact = it;
  return it;
}

/** A console table with nothing to sit at. */
function plainTable(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 3;
  const g = at(kit, p);
  g.add(mesh(roundedBox(w, 0.08, l, 0.06), kit.mats.white, 0, TABLE_TOP - 0.04, 0));
  for (const sz of [-1, 1]) g.add(mesh(box(Math.max(0.3, w - 0.5), TABLE_TOP - 0.08, 0.24), kit.mats.metalDark, 0, (TABLE_TOP - 0.08) / 2, sz * (l / 2 - 0.4)));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, l, p.rotY ?? 0, g.position.y + TABLE_TOP);
}

/** Each kind of prop, put up (every kind there is has one: see STATION_PROP_KINDS). */
export const PROPS: Record<StationPropKind, (kit: Kit, p: PropConfig) => void> = {
  rib,
  // Cut through its wall by the shell, frame and glass and all.
  viewport: () => {},
  lamp,
  strip,
  screen,
  hologram,
  planter,
  crate,
  gong: (kit, p) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  dispenser: (kit, p) => kit.interactables.push(dispenser(kit, p)),
  table: plainTable,
};
