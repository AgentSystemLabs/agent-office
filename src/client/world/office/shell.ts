import * as THREE from 'three';
import { BALCONY_DOOR, EXIT_DOOR, FLOOR, WALL_HEIGHT, WALL_T, WINDOWS, WING, type Opening, type Side } from '../../../shared/layout';
import type { NightParts } from '../outside';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import type { Collider } from '../types';
import type { Fixture } from './fixture';
import { GLASS, PALETTE, box, glassPane, onWall, type Looks } from './materials';

// The office's shell: its outside walls, the windows in them, and the doors out (the exit and the
// balcony's), which open by themselves.

/** A door that opens by itself when someone comes up to it, and closes behind them. */
export interface Door {
  x: number;
  y: number;
  z: number;
  /** 0 shut, 1 wide open. */
  open: number;
  show(open: number): void;
  /** Stays shut: the exit door, seen from a floor above it. */
  locked?: boolean;
}

/** A window filling its hole in an outside wall: a frame lining the hole, a mullion, sills and real glass. */
export function windowIn(o: Opening): THREE.Group {
  const g = new THREE.Group();
  const frame = toon('#ffffff');
  const w = o.width;
  const h = o.y1 - o.y0;
  const F = 0.09;
  const D = WALL_T + 0.04;
  // Built along x with the outside toward +z, then turned onto its wall.
  g.add(mesh(box(w, F, D), frame, 0, o.y1 - F / 2, 0, false));
  g.add(mesh(box(w, F, D), frame, 0, o.y0 + F / 2, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(F, h, D), frame, sx * (w / 2 - F / 2), (o.y0 + o.y1) / 2, 0, false));
  g.add(mesh(box(F * 0.8, h - 2 * F, 0.08), frame, 0, (o.y0 + o.y1) / 2, 0, false));
  const pane = glassPane(w - 2 * F, h - 2 * F);
  pane.position.y = (o.y0 + o.y1) / 2;
  g.add(pane);
  g.add(mesh(box(w + 0.2, 0.06, 0.2), frame, 0, o.y0 - 0.03, -(WALL_T / 2 + 0.08)));
  g.add(mesh(box(w + 0.2, 0.06, 0.16), frame, 0, o.y0 - 0.03, WALL_T / 2 + 0.06));
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** Rain on the outside of a window's glass (see sky.ts), kept out of the merged glazing so it keeps its UVs. */
export function wetPane(o: Opening, mat: THREE.Material): THREE.Group {
  const F = 0.09;
  const w = o.width - 2 * F;
  const h = o.y1 - o.y0 - 2 * F;
  const geo = new THREE.PlaneGeometry(w, h);
  // The drops are the same size on every window, whatever its size.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.9, (uv.getY(i) * h) / 0.9 + o.u * 0.37);
  const pane = new THREE.Mesh(geo, mat);
  pane.position.set(0, (o.y0 + o.y1) / 2, 0.05);
  const g = new THREE.Group();
  g.add(pane);
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** A door's frame and threshold, lining its hole in the wall (built like windowIn: along x, outdoors toward +z). */
function doorFrame(o: Opening): THREE.Group {
  const g = new THREE.Group();
  const frame = toon('#ffffff');
  const F = 0.08;
  const D = WALL_T + 0.04;
  g.add(mesh(box(o.width, F, D), frame, 0, o.y1 - F / 2, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(F, o.y1, D), frame, sx * (o.width / 2 - F / 2), o.y1 / 2, 0, false));
  g.add(mesh(box(o.width, 0.03, D), toon('#8d99ae'), 0, 0.015, 0, false));
  return g;
}

/** Stands a wall-built group (along x, outdoors toward +z) in its wall. */
function mount(g: THREE.Group, o: Opening): THREE.Group {
  const at = onWall(o.wall, o.u);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/** The way out: a teal door with a porthole in the west wall. It swings outward, onto the landing. */
export function exitDoor(night: NightParts): { group: THREE.Group; door: Door } {
  const o = EXIT_DOOR;
  const g = doorFrame(o);
  const F = 0.08;
  const leafW = o.width - 2 * F - 0.02;
  const leafH = o.y1 - F - 0.02;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(leafW, 0);
  shape.lineTo(leafW, leafH);
  shape.lineTo(0, leafH);
  shape.closePath();
  const port = { x: leafW / 2, y: leafH - 0.55, r: 0.2 };
  const hole = new THREE.Path();
  hole.absarc(port.x, port.y, port.r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const leafGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 16 });
  leafGeo.translate(0, 0, -0.03);
  const leaf = new THREE.Group();
  leaf.add(mesh(leafGeo, toon('#2a9d8f'), 0, 0.01, 0));
  leaf.add(mesh(new THREE.CircleGeometry(port.r, 20), GLASS, port.x, port.y + 0.01, 0, false));
  leaf.add(mesh(new THREE.TorusGeometry(port.r, 0.035, 8, 24), toon('#ffffff'), port.x, port.y + 0.01, 0, false));
  // A push bar inside, a pull handle outside.
  leaf.add(mesh(box(leafW * 0.7, 0.05, 0.05), toon('#adb5bd'), leafW * 0.5, 1.0, -0.07));
  leaf.add(mesh(box(0.05, 0.3, 0.05), toon('#adb5bd'), leafW - 0.15, 1.0, 0.07));
  // Hinged on the outer face, so it opens out of the building.
  const hinge = new THREE.Group();
  hinge.position.set(-o.width / 2 + F + 0.01, 0, WALL_T / 2 - 0.05);
  hinge.add(leaf);
  g.add(hinge);

  const exit = textPlane('EXIT', { bg: '#2a9d4b', color: '#ffffff', size: 64, border: '#ffffff' });
  exit.scale.multiplyScalar(0.7);
  exit.position.set(0, o.y1 + 0.35, -(WALL_T / 2 + 0.03));
  exit.rotation.y = Math.PI;
  g.add(exit);
  // A lamp over it outside.
  g.add(mesh(box(0.32, 0.1, 0.18), toon(PALETTE.ink), 0, o.y1 + 0.42, WALL_T / 2 + 0.09));
  g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, o.y1 + 0.33, WALL_T / 2 + 0.12, false));

  const at = onWall(o.wall, o.u);
  // Over the landing, where it lights the way down at night.
  const lampAt = new THREE.Vector3(at.x - WALL_T / 2 - 0.14, o.y1 + 0.33, at.z);
  night.halos.push({ at: lampAt, size: 0.9, color: '#ffe08a', ground: true });
  night.lamps.push({ x: lampAt.x - 0.6, y: lampAt.y, z: lampAt.z, reach: 5, color: '#ffe3a3', power: 2.2, ground: true });
  const door: Door = {
    x: at.x,
    y: 0,
    z: at.z,
    open: 0,
    show: (k) => (hinge.rotation.y = -1.8 * k * k * (3 - 2 * k)),
  };
  return { group: mount(g, o), door };
}

/** Glass doors out to the balcony that slide apart, into the wall on either side, when someone comes up. */
export function balconyDoor(): { group: THREE.Group; door: Door } {
  const o = BALCONY_DOOR;
  const g = doorFrame(o);
  const F = 0.08;
  const half = (o.width - 2 * F) / 2;
  const h = o.y1 - F;
  const alu = toon('#aab4be');
  const panels: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Group();
    const pw = half + 0.02;
    for (const y of [0.04, h - 0.04]) p.add(mesh(box(pw, 0.08, 0.05), alu, 0, y, 0, false));
    for (const x of [-pw / 2 + 0.035, pw / 2 - 0.035]) p.add(mesh(box(0.07, h, 0.05), alu, x, h / 2, 0, false));
    const pane = glassPane(pw - 0.14, h - 0.16);
    pane.position.y = h / 2;
    p.add(pane);
    p.add(mesh(box(0.03, 0.45, 0.08), toon(PALETTE.ink), -side * (pw / 2 - 0.12), 1.05, 0, false));
    const x0 = (side * half) / 2;
    p.position.x = x0;
    g.add(p);
    panels.push([p, x0]);
  }
  const at = onWall(o.wall, o.u);
  const door: Door = {
    x: at.x,
    y: 0,
    z: at.z,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [p, x0] of panels) p.position.x = x0 + Math.sign(x0) * e * (half + 0.04);
    },
  };
  return { group: mount(g, o), door };
}

/** Walls throw shade only this far up: any higher and a low sun's shadow would fill the room. */
const SHADE_HEIGHT = 4.2;

/**
 * The four outside walls, built in pieces around their windows and doors. Each is painted inside in
 * the floor's colors and outside in the building's.
 */
export function buildWalls(group: THREE.Group, colliders: Collider[], openings: Opening[], looks: Looks) {
  const inside = looks.wall;
  const outside = toon(PALETTE.exterior);
  const trimMat = looks.trim;
  const T = WALL_T;
  const walls: { side: Side; at: number; spans: [number, number, number][] }[] = [
    // The north wall stops at the back office, whose own bit of wall (buildWing's plug) comes down for it.
    { side: 'north', at: FLOOR.minZ - T / 2, spans: [[FLOOR.minX - T, WING.minX, WALL_HEIGHT]] },
    { side: 'south', at: FLOOR.maxZ + T / 2, spans: [[FLOOR.minX - T, FLOOR.maxX + T, WALL_HEIGHT]] },
    { side: 'west', at: FLOOR.minX - T / 2, spans: [[FLOOR.minZ, FLOOR.maxZ, WALL_HEIGHT]] },
    { side: 'east', at: FLOOR.maxX + T / 2, spans: [[FLOOR.minZ, FLOOR.maxZ, WALL_HEIGHT]] },
  ];
  for (const w of walls) {
    const alongX = w.side === 'north' || w.side === 'south';
    // A box's faces go +x, -x, +y, -y, +z, -z; the one facing outdoors gets the outside paint, and so
    // do the ends of the north and south walls, which run on past the east and west ones to the corners.
    const out = { east: 0, west: 1, south: 4, north: 5 }[w.side];
    const at = (u: number, y: number) => (alongX ? new THREE.Vector3(u, y, w.at) : new THREE.Vector3(w.at, y, u));
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
      // Up high the sun shines through, as it does through the ceiling and the loft's roof.
      if (y0 < SHADE_HEIGHT && y1 > SHADE_HEIGHT) {
        piece(u0, u1, y0, SHADE_HEIGHT);
        piece(u0, u1, SHADE_HEIGHT, y1);
        return;
      }
      const ends = alongX ? [u0 <= FLOOR.minX - T + 0.001 ? 1 : -1, u1 >= FLOOR.maxX + T - 0.001 ? 0 : -1] : [];
      const mats = Array.from({ length: 6 }, (_, i) => (i === out || ends.includes(i) ? outside : inside));
      const m = new THREE.Mesh(alongX ? box(u1 - u0, y1 - y0, T) : box(T, y1 - y0, u1 - u0), mats);
      m.position.copy(at((u0 + u1) / 2, (y0 + y1) / 2));
      m.castShadow = y1 <= SHADE_HEIGHT;
      m.receiveShadow = true;
      // Indoors, walls stop taking shadows (see features/lamplight): the lamps overhead would cast them down the wall from whatever hangs there.
      m.userData.wall = true;
      group.add(m);
    };
    // Baseboard and collider run between the doors.
    const run = (u0: number, u1: number) => {
      if (u1 - u0 < 0.001) return;
      const p = at((u0 + u1) / 2, 0.125);
      group.add(mesh(alongX ? box(u1 - u0, 0.25, T + 0.04) : box(T + 0.04, 0.25, u1 - u0), trimMat, p.x, p.y, p.z, false));
      block(u0, u1);
    };
    const block = (u0: number, u1: number, bottom?: number) =>
      colliders.push(alongX ? { minX: u0, maxX: u1, minZ: w.at - T / 2, maxZ: w.at + T / 2, top: 99, bottom } : { minX: w.at - T / 2, maxX: w.at + T / 2, minZ: u0, maxZ: u1, top: 99, bottom });
    const holes = openings.filter((o) => o.wall === w.side).sort((a, b) => a.u - b.u);
    for (const [a, b, top] of w.spans) {
      let u = a;
      let floorU = a;
      for (const o of holes) {
        const h0 = o.u - o.width / 2;
        const h1 = o.u + o.width / 2;
        if (h0 < a || h1 > b) continue;
        piece(u, h0, 0, top);
        piece(h0, h1, 0, o.y0);
        piece(h0, h1, o.y1, top);
        u = h1;
        if (o.y0 > 0) continue;
        // A door: walk through it, under the wall above.
        run(floorU, h0);
        block(h0, h1, o.y1);
        floorU = h1;
      }
      piece(u, b, 0, top);
      run(floorU, b);
    }
  }
}

/** Wall where the exit door is, for the floors above the bottom one: painted like the rest of the wall, inside and out, with its baseboard. */
export function exitPlug(looks: Looks): { group: THREE.Group; collider: Collider } {
  const o = EXIT_DOOR;
  const at = onWall(o.wall, o.u);
  const group = new THREE.Group();
  // A box's faces go +x, -x, +y, -y, +z, -z; on the west wall, -x is outdoors.
  const mats = Array.from({ length: 6 }, (_, i) => (i === 1 ? toon(PALETTE.exterior) : looks.wall));
  const wall = new THREE.Mesh(box(WALL_T, o.y1 - o.y0, o.width), mats);
  wall.position.set(at.x, (o.y0 + o.y1) / 2, at.z);
  wall.receiveShadow = true;
  wall.userData.wall = true;
  group.add(wall);
  group.add(mesh(box(WALL_T + 0.04, 0.25, o.width), looks.trim, at.x, 0.125, at.z, false));
  group.visible = false;
  return { group, collider: { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: o.u - o.width / 2, maxZ: o.u + o.width / 2, top: 99 } };
}

/**
 * A straight run of outside wall `at` (z for one along x, x for one along z) from `u0` to `u1`, with
 * its outdoor side toward `out` (-1 or +1): painted inside in the floor's colors and outside in the
 * building's, and the ends in `endsOut` outside too. It has holes for `holes` (windows), a baseboard
 * and a collider. The back office's walls, and the bit of north wall that comes down for it.
 */
export function wallRun(into: THREE.Group, cols: Collider[], axis: 'x' | 'z', at: number, u0: number, u1: number, out: 1 | -1, holes: Opening[], looks: Looks, endsOut: [boolean, boolean]) {
  const T = WALL_T;
  const outside = toon(PALETTE.exterior);
  // A box's faces go +x, -x, +y, -y, +z, -z.
  const outFace = axis === 'x' ? (out > 0 ? 4 : 5) : out > 0 ? 0 : 1;
  const endFaces = axis === 'x' ? [1, 0] : [5, 4];
  const paint = Array.from({ length: 6 }, (_, i) => (i === outFace || endFaces.some((f, k) => f === i && endsOut[k]) ? outside : looks.wall));
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.001 || y1 - y0 < 0.001) return;
    if (y0 < SHADE_HEIGHT && y1 > SHADE_HEIGHT) {
      piece(a, b, y0, SHADE_HEIGHT);
      piece(a, b, SHADE_HEIGHT, y1);
      return;
    }
    const m = new THREE.Mesh(axis === 'x' ? box(b - a, y1 - y0, T) : box(T, y1 - y0, b - a), paint);
    const u = (a + b) / 2;
    m.position.set(axis === 'x' ? u : at, (y0 + y1) / 2, axis === 'x' ? at : u);
    m.castShadow = y1 <= SHADE_HEIGHT;
    m.receiveShadow = true;
    m.userData.wall = true;
    into.add(m);
  };
  let u = u0;
  for (const o of [...holes].sort((a, b) => a.u - b.u)) {
    piece(u, o.u - o.width / 2, 0, WALL_HEIGHT);
    piece(o.u - o.width / 2, o.u + o.width / 2, 0, o.y0);
    piece(o.u - o.width / 2, o.u + o.width / 2, o.y1, WALL_HEIGHT);
    u = o.u + o.width / 2;
  }
  piece(u, u1, 0, WALL_HEIGHT);
  const len = u1 - u0;
  const mid = (u0 + u1) / 2;
  into.add(mesh(axis === 'x' ? box(len, 0.25, T + 0.04) : box(T + 0.04, 0.25, len), looks.trim, axis === 'x' ? mid : at, 0.125, axis === 'x' ? at : mid, false));
  cols.push(axis === 'x' ? { minX: u0, maxX: u1, minZ: at - T / 2, maxZ: at + T / 2, top: 99 } : { minX: at - T / 2, maxX: at + T / 2, minZ: u0, maxZ: u1, top: 99 });
}

/** Outside walls, with real windows you see out of and a door out, and the glass doors out to the balcony. */
export const walls: Fixture = (site) => {
  const night = site.get('night');
  const openings = [...WINDOWS, EXIT_DOOR, BALCONY_DOOR];
  buildWalls(site.group, site.colliders, openings, site.looks);
  const glazing = new THREE.Group();
  for (const o of WINDOWS) {
    glazing.add(windowIn(o));
    site.wall(o.wall, o.u, (o.y0 + o.y1) / 2 - 0.03, o.width + 0.2, o.y1 - o.y0 + 0.12);
    site.group.add(wetPane(o, night.wetGlass));
  }
  site.group.add(mergeByMaterial(glazing));
  // Out the glass doors on the south wall: the balcony.
  const slider = balconyDoor();
  site.group.add(slider.group);
  site.doors.push(slider.door);
  site.wall(BALCONY_DOOR.wall, BALCONY_DOOR.u, (BALCONY_DOOR.y1 + 0.1) / 2, BALCONY_DOOR.width + 0.2, BALCONY_DOOR.y1 + 0.1);
  return {};
};

/** Upstairs there's no way out on the west side: the doorway is wall like the rest of it. */
export const plug: Fixture = (site) => {
  const built = exitPlug(site.looks);
  return {
    group: built.group,
    setLevel: (index) => {
      built.group.visible = index > 0;
      const i = site.colliders.indexOf(built.collider);
      if (index > 0 && i < 0) site.colliders.push(built.collider);
      else if (index === 0 && i >= 0) site.colliders.splice(i, 1);
    },
  };
};
