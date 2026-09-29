import * as THREE from 'three';
import { BALCONY, BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, ROOF_BAR, SLAB, STAGE, STOREY, WALL_HEIGHT, WALL_T, WINDOWS, type Opening, type Side } from '../../shared/layout';
import type { Collider } from './office';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, toon, toonUnique } from './toon';

// The rest of the building, from outside: a floor per project, stacked into a tower. Only the floor
// you're on is really there; the others are its outside (walls, windows, a balcony off each, a
// cornice round the top and the rooftop bar over it, roughly), rebuilt whenever floors come and go or
// you change floors. Up on the roof it's every floor, under your feet.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** The outside's planes stand this far off the walls, so they never fight the floor you're on for a pixel. */
const OFF = 0.01;

export interface Tower {
  group: THREE.Group;
  /**
   * Builds the outside of every floor but `index`, of `count` stacked from the bottom one (0). An
   * `index` of `count` is the roof: every floor, below it, and no top (the roof is its own).
   */
  set(index: number, count: number): void;
}

/** Each side of the building: where along it things are (u, from corner to corner, where it meets the next side's plane), and its plane. */
const FACES: Record<Side, { u0: number; u1: number; at: (u: number, y: number) => THREE.Vector3; rotY: number }> = {
  north: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u, y) => new THREE.Vector3(u, y, B.minZ - OFF), rotY: Math.PI },
  south: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u, y) => new THREE.Vector3(u, y, B.maxZ + OFF), rotY: 0 },
  west: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u, y) => new THREE.Vector3(B.minX - OFF, y, u), rotY: -Math.PI / 2 },
  east: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u, y) => new THREE.Vector3(B.maxX + OFF, y, u), rotY: Math.PI / 2 },
};

/** A wall-built group (along x, outdoors toward +z) turned onto `side`, `u` along it. */
function onFace(g: THREE.Object3D, side: Side, u: number): THREE.Object3D {
  const f = FACES[side];
  g.position.copy(f.at(u, 0));
  g.rotation.y = f.rotY;
  return g;
}

export function buildTower(colliders: Collider[], night: NightParts): Tower {
  const group = new THREE.Group();
  // Big flat walls get no cartoon outline (the frames round the windows give it its ink lines).
  const flat = (color: string) => {
    const m = toonUnique(color);
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  const paint = flat('#e07a5f');
  const band = flat('#e8a87c');
  const frame = toon('#ffffff');
  const alu = toon('#aab4be');
  const ink = toon('#3d405b');
  const wood = toon('#c98b5a');
  const deck = toon('#e8a87c');
  const cornice = toon('#fffaf3');
  const behind = flat('#2b2d42');
  // Glass you can't see into; at night some of it glows, as though someone upstairs is still at it.
  const dark = toon('#a9d8f5');
  const lit = ['#ffd27a', '#ffe6b0', '#9ec9ff'].map((glow) => {
    const m = toonUnique('#a9d8f5');
    m.emissive.set(glow);
    m.emissiveIntensity = 0;
    night.windows.push(m);
    return m;
  });
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  const railGlass = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });

  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  let seed = 1;
  /** The same windows light up each time a floor's outside is rebuilt. */
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  /** One floor's outside on `side`, `y0` up from the floor you're on: the band of its slab, then its wall round its windows and doors. */
  const facade = (parts: THREE.Group, side: Side, y0: number, holes: Opening[]) => {
    const f = FACES[side];
    const piece = (u0: number, u1: number, y1: number, y2: number, mat: THREE.Material) => {
      if (u1 - u0 < 0.001 || y2 - y1 < 0.001) return;
      const m = mesh(new THREE.PlaneGeometry(u1 - u0, y2 - y1), mat, 0, 0, 0, false);
      m.position.copy(f.at((u0 + u1) / 2, (y1 + y2) / 2));
      m.rotation.y = f.rotY;
      parts.add(m);
    };
    piece(f.u0, f.u1, y0 - SLAB, y0, band);
    let u = f.u0;
    for (const o of [...holes].sort((a, b) => a.u - b.u)) {
      const h0 = o.u - o.width / 2;
      const h1 = o.u + o.width / 2;
      piece(u, h0, y0, y0 + WALL_HEIGHT, paint);
      piece(h0, h1, y0, y0 + o.y0, paint);
      piece(h0, h1, y0 + o.y1, y0 + WALL_HEIGHT, paint);
      u = h1;
    }
    piece(u, f.u1, y0, y0 + WALL_HEIGHT, paint);
  };

  /** Glass in a hole: set back a little, with a frame round it, a bar down the middle and a sill. */
  const glazing = (parts: THREE.Group, o: Opening, y0: number, door: boolean) => {
    const g = new THREE.Group();
    const w = o.width;
    const h = o.y1 - o.y0;
    const F = door ? 0.08 : 0.09;
    const edge = door ? alu : frame;
    const glass = random() < 0.4 ? lit[Math.floor(random() * lit.length)] : dark;
    const mid = y0 + (o.y0 + o.y1) / 2;
    g.add(mesh(new THREE.PlaneGeometry(w - 2 * F, h - 2 * F), glass, 0, mid, -0.06, false));
    const s = mesh(new THREE.PlaneGeometry(0.16, h * 0.55), glint, -w * 0.18, mid + h * 0.05, -0.05, false);
    s.rotation.z = -0.5;
    g.add(s);
    g.add(mesh(new THREE.BoxGeometry(w, F, 0.14), edge, 0, y0 + o.y1 - F / 2, -0.05, false));
    g.add(mesh(new THREE.BoxGeometry(w, F, 0.14), edge, 0, y0 + o.y0 + F / 2, -0.05, false));
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(F, h, 0.14), edge, sx * (w / 2 - F / 2), mid, -0.05, false));
    g.add(mesh(new THREE.BoxGeometry(F * (door ? 1 : 0.8), h - 2 * F, 0.08), edge, 0, mid, -0.05, false));
    if (!door) g.add(mesh(new THREE.BoxGeometry(w + 0.2, 0.06, 0.16), frame, 0, y0 + o.y0 - 0.03, 0.06, false));
    parts.add(onFace(g, o.wall, o.u));
  };

  /** The balcony off a floor `y0` up: its deck, and a railing with glass in it round the three open sides. */
  const balcony = (parts: THREE.Group, y0: number) => {
    const { minX, maxX, minZ, maxZ } = BALCONY;
    const w = maxX - minX;
    const d = maxZ - minZ;
    parts.add(mesh(new THREE.BoxGeometry(w, SLAB - 0.01, d), deck, (minX + maxX) / 2, y0 - SLAB / 2 - 0.005, (minZ + maxZ) / 2, false));
    const railH = 1.05;
    const inset = 0.06;
    const sides: [number, number, number, number][] = [
      [minX + inset, maxZ - inset, maxX - inset, maxZ - inset],
      [minX + inset, minZ, minX + inset, maxZ - inset],
      [maxX - inset, minZ, maxX - inset, maxZ - inset],
    ];
    for (const [x0, z0, x1, z1] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = z0 === z1;
      const n = Math.ceil(len / 1.6);
      for (let i = 0; i <= n; i++) parts.add(mesh(new THREE.BoxGeometry(0.06, railH, 0.06), ink, x0 + ((x1 - x0) * i) / n, y0 + railH / 2, z0 + ((z1 - z0) * i) / n, false));
      parts.add(mesh(alongX ? new THREE.BoxGeometry(len + 0.1, 0.07, 0.12) : new THREE.BoxGeometry(0.12, 0.07, len + 0.1), wood, (x0 + x1) / 2, y0 + railH + 0.02, (z0 + z1) / 2, false));
      const pane = mesh(new THREE.PlaneGeometry(len - 0.1, railH - 0.2), railGlass, (x0 + x1) / 2, y0 + (railH - 0.2) / 2 + 0.08, (z0 + z1) / 2, false);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
  };

  /** A cornice round the top of the building, `top` up: along each wall, and out past it at both corners so the four meet. */
  const crown = (parts: THREE.Group, top: number) => {
    const H = 0.45;
    const out = 0.22;
    for (const side of Object.keys(FACES) as Side[]) {
      const f = FACES[side];
      const g = new THREE.Group();
      const len = f.u1 - f.u0 + 2 * out;
      g.add(mesh(new THREE.BoxGeometry(len, H, WALL_T + out), cornice, 0, top + H / 2, out / 2 - WALL_T / 2 - OFF, false));
      g.add(mesh(new THREE.BoxGeometry(len, 0.08, 0.06), band, 0, top + 0.1, out - OFF + 0.03, false));
      parts.add(onFace(g, side, (f.u0 + f.u1) / 2));
    }
  };

  // The rooftop bar, as it looks from down below (world/rooftop.ts has the real one).
  const curb = toon('#d8d3ca');
  const steel = toon('#b8c1cc');
  const steelDark = toon('#8d99ae');
  const beacon = bulb(night, '#ff5d5d', 0.6);
  const stage = toon('#2b2d42');
  const black = toon('#1d1d1d');
  const led = bulb(night, '#7b2ff7', 0.35);
  const truss = toon('#c9d1d9');
  const barWood = toon('#6b3f2a');
  const counter = toon('#f4f1ea');
  const shelf = toon('#4a2c1d');
  const pergola = toon('#8a5a3b');
  const parasol = toon('#ef476f');

  /**
   * The rooftop bar on the roof, `y` up, roughly: a curb round the edge with glass on it and a steel
   * rail along the top, the elevator's housing, the DJ's stage with the LED wall behind it and the
   * rig over it, the bar and its back bar under a pergola, and the parasols along the south edge.
   */
  const roofTop = (parts: THREE.Group, y: number) => {
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y0: number, z: number) => parts.add(mesh(new THREE.BoxGeometry(w, h, d), mat, x, y0 + h / 2, z, false));
    const edges: [number, number, number, number][] = [
      [B.minX, B.maxX, B.minZ, FLOOR.minZ],
      [B.minX, B.maxX, FLOOR.maxZ, B.maxZ],
      [B.minX, FLOOR.minX, B.minZ, B.maxZ],
      [FLOOR.maxX, B.maxX, B.minZ, B.maxZ],
    ];
    for (const [x0, x1, z0, z1] of edges) {
      const ex = (x0 + x1) / 2;
      const ez = (z0 + z1) / 2;
      const alongX = x1 - x0 > z1 - z0;
      const len = alongX ? x1 - x0 : z1 - z0;
      box(x1 - x0, 0.45, z1 - z0, curb, ex, y, ez);
      const pane = mesh(new THREE.PlaneGeometry(len, 0.72), railGlass, ex, y + 0.81, ez, false);
      if (!alongX) pane.rotation.y = Math.PI / 2;
      parts.add(pane);
      box(alongX ? len : 0.07, 0.07, alongX ? 0.07 : len, steel, ex, y + 1.155, ez);
      for (let a = 0; a <= len + 0.01; a += 2.4) box(0.06, 0.75, 0.06, steel, alongX ? x0 + a : ex, y + 0.425, alongX ? ez : z0 + a);
    }

    // The elevator's housing, as tall as a floor, with a light on top.
    const hz = (B.minZ + ELEVATOR_FRONT) / 2;
    box(ELEVATOR.width, WALL_HEIGHT, ELEVATOR_FRONT - B.minZ, steel, ELEVATOR.x, y, hz);
    box(ELEVATOR.width + 0.3, 0.3, ELEVATOR_FRONT - B.minZ + 0.2, steelDark, ELEVATOR.x, y + WALL_HEIGHT, hz + 0.05);
    parts.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), beacon, ELEVATOR.x, y + WALL_HEIGHT + 0.4, hz, false));

    // The stage, the LED wall behind the DJ, and the rig: a truss tower either side and a beam across.
    const sw = STAGE.maxX - STAGE.minX;
    const scx = (STAGE.minX + STAGE.maxX) / 2;
    box(sw, STAGE.height, STAGE.maxZ - STAGE.minZ, stage, scx, y, (STAGE.minZ + STAGE.maxZ) / 2);
    box(8.3, 4.3, 0.25, black, scx, y + STAGE.height + 0.2, STAGE.minZ + 0.06);
    parts.add(mesh(new THREE.PlaneGeometry(8, 4), led, scx, y + STAGE.height + 2.35, STAGE.minZ + 0.2, false));
    const rigZ = STAGE.maxZ - 0.15;
    const rigTop = 5.6;
    for (const x of [STAGE.minX + 0.2, STAGE.maxX - 0.2]) box(0.34, rigTop - STAGE.height, 0.34, truss, x, y + STAGE.height, rigZ);
    box(sw - 0.4, 0.34, 0.34, truss, scx, y + rigTop - 0.34, rigZ);

    // The bar along the east side, the shelves of bottles behind it, and the pergola over both.
    const blen = ROOF_BAR.maxZ - ROOF_BAR.minZ;
    const bz = (ROOF_BAR.minZ + ROOF_BAR.maxZ) / 2;
    const front = ROOF_BAR.x - ROOF_BAR.depth / 2;
    box(ROOF_BAR.depth, ROOF_BAR.height - 0.06, blen, barWood, ROOF_BAR.x, y, bz);
    box(ROOF_BAR.depth + 0.2, 0.06, blen + 0.2, counter, ROOF_BAR.x - 0.05, y + ROOF_BAR.height - 0.06, bz);
    box(0.6, 2.4, blen - 0.6, shelf, FLOOR.maxX - 0.35, y, bz);
    const p0 = { x: front - 0.9, z: ROOF_BAR.minZ - 0.8 };
    const p1 = { x: FLOOR.maxX - 0.1, z: ROOF_BAR.maxZ + 0.8 };
    const roofY = 3.3;
    for (const x of [p0.x, p1.x]) {
      for (const z of [p0.z, p1.z]) box(0.16, roofY, 0.16, pergola, x, y, z);
      box(0.16, 0.22, p1.z - p0.z + 0.3, pergola, x, y + roofY - 0.11, (p0.z + p1.z) / 2);
    }
    for (let z = p0.z; z <= p1.z + 0.01; z += 0.55) box(p1.x - p0.x + 0.4, 0.08, 0.1, pergola, (p0.x + p1.x) / 2, y + roofY + 0.11, z);

    // Parasols along the south edge, over the sun loungers.
    for (const x of [-0.8, 2]) {
      const z = FLOOR.maxZ - 1.1;
      box(0.08, 2.6, 0.08, counter, x, y, z);
      parts.add(mesh(new THREE.ConeGeometry(1.5, 0.5, 12), parasol, x, y + 2.6, z, false));
    }
  };

  const set = (index: number, count: number) => {
    for (const o of built) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    built = [];
    for (const c of mine) {
      const i = colliders.indexOf(c);
      if (i >= 0) colliders.splice(i, 1);
    }
    mine = [];
    seed = 20260927;

    const parts = new THREE.Group();
    for (let k = 0; k < count; k++) {
      const r = k - index;
      if (r === 0) continue;
      const y0 = r * STOREY;
      for (const side of Object.keys(FACES) as Side[]) {
        const holes: Opening[] = WINDOWS.filter((o) => o.wall === side);
        if (side === 'south') holes.push(BALCONY_DOOR);
        // Only the bottom floor has a way out on the west side; its door stands in the hole (see office.ts).
        if (side === 'west' && k === 0) holes.push(EXIT_DOOR);
        facade(parts, side, y0, holes);
      }
      for (const o of WINDOWS) glazing(parts, o, y0, false);
      glazing(parts, BALCONY_DOOR, y0, true);
      balcony(parts, y0);
      if (k === 0) {
        // Dark behind the exit door, through its porthole.
        const back = mesh(new THREE.PlaneGeometry(EXIT_DOOR.width, EXIT_DOOR.y1), behind, FLOOR.minX - 0.02, y0 + EXIT_DOOR.y1 / 2, EXIT_DOOR.u, false);
        back.rotation.y = -Math.PI / 2;
        parts.add(back);
      }
    }
    // On top, a cornice, and the rooftop bar over it; but up on the roof, it's the roof's own.
    if (index < count) {
      const top = (count - 1 - index) * STOREY + WALL_HEIGHT;
      crown(parts, top);
      roofTop(parts, top + SLAB);
    }
    // None of it casts a shadow (the sun lights the office through where its roof would be), and none
    // takes one from the floor you're on, which would fall on it as though nothing were in between.
    const merged = mergeByMaterial(parts);
    merged.traverse((o) => (o.receiveShadow = false));
    group.add(merged);
    built.push(merged);

    // Below you, the outside walls down to the garage, which you can't walk into from the steps
    // outside the bottom floor's door, and the bottom floor's slab, which is the garage's ceiling.
    if (index > 0 && index < count) {
      const bottom = -index * STOREY - SLAB;
      const T = WALL_T;
      mine.push(
        { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.minZ + T, bottom, top: -SLAB },
        { minX: B.minX, maxX: B.maxX, minZ: B.maxZ - T, maxZ: B.maxZ, bottom, top: -SLAB },
        { minX: B.minX, maxX: B.minX + T, minZ: B.minZ, maxZ: B.maxZ, bottom, top: -SLAB },
        { minX: B.maxX - T, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, bottom, top: -SLAB },
        { ...B, bottom, top: bottom + SLAB },
      );
      colliders.push(...mine);
    }
  };

  return { group, set };
}
