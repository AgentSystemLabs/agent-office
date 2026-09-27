import * as THREE from 'three';
import { BALCONY, BALCONY_DOOR, EXIT_DOOR, FLOOR, SLAB, STOREY, WALL_HEIGHT, WALL_T, WINDOWS, type Opening, type Side } from '../../shared/layout';
import type { Collider } from './office';
import type { NightParts } from './outside';
import { mergeByMaterial, mesh, toon, toonUnique } from './toon';

// The rest of the building, from outside: a floor per project, stacked into a tower. Only the floor
// you're on is really there; the others are its outside (walls, windows, a balcony off each and a
// cornice round the top), rebuilt whenever floors come and go or you change floors.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** The outside's planes stand this far off the walls, so they never fight the floor you're on for a pixel. */
const OFF = 0.01;

export interface Tower {
  group: THREE.Group;
  /** Builds the outside of every floor but `index`, of `count` stacked from the bottom one (0). */
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
    crown(parts, (count - 1 - index) * STOREY + WALL_HEIGHT);
    // None of it casts a shadow (the sun lights the office through where its roof would be), and none
    // takes one from the floor you're on, which would fall on it as though nothing were in between.
    const merged = mergeByMaterial(parts);
    merged.traverse((o) => (o.receiveShadow = false));
    group.add(merged);
    built.push(merged);

    // Below you, the outside walls down to the garage, which you can't walk into from the steps
    // outside the bottom floor's door, and the bottom floor's slab, which is the garage's ceiling.
    if (index > 0) {
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
