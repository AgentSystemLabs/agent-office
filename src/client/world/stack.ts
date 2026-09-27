import * as THREE from 'three';
import { FLOOR, LADDER, POLE, POLES, SLAB, WALL_HEIGHT, WALL_T, WINDOWS, type PoleSpot } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { mesh, textPlane, toon } from './toon';

// The floors above and below this one: the ceiling (and the hatches and holes in it and in the floor),
// the ladder up the west wall, and the fire poles. Every floor is built from the same office, so
// what's here depends on which floor of the building you're on (see Stack.set).

/** The top of the windows either side of the ladder, where the sign to the floor above hangs over. */
const LADDER_WINDOW_HEAD = Math.max(...WINDOWS.filter((w) => w.wall === 'west').map((w) => w.y1));

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** `r` less the `holes` in it, as a few rectangles: rows of the grid the holes' edges make, stacked where they line up. */
export function cutRect(r: Rect, holes: Rect[]): Rect[] {
  const hs = holes
    .map((h) => ({ minX: Math.max(r.minX, h.minX), maxX: Math.min(r.maxX, h.maxX), minZ: Math.max(r.minZ, h.minZ), maxZ: Math.min(r.maxZ, h.maxZ) }))
    .filter((h) => h.maxX > h.minX && h.maxZ > h.minZ);
  const edges = (lo: number, hi: number, more: number[]) => [...new Set([lo, hi, ...more])].sort((a, b) => a - b);
  const xs = edges(r.minX, r.maxX, hs.flatMap((h) => [h.minX, h.maxX]));
  const zs = edges(r.minZ, r.maxZ, hs.flatMap((h) => [h.minZ, h.maxZ]));
  const out: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const zm = (zs[j] + zs[j + 1]) / 2;
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2;
      if (hs.some((h) => xm > h.minX && xm < h.maxX && zm > h.minZ && zm < h.maxZ)) {
        if (run) out.push(run);
        run = null;
      } else if (run) run.maxX = xs[i + 1];
      else run = { minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] };
    }
    if (run) out.push(run);
  }
  // Rows with the same span, one on top of the other, become one.
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.minX === b.minX && a.maxX === b.maxX && a.maxZ === b.minZ) {
        a.maxZ = b.maxZ;
        out.splice(j--, 1);
      }
    }
  }
  return out;
}

/** The square round a pole's hole. */
function around(p: { x: number; z: number }, half: number): Rect {
  return { minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half };
}

/** A hole in a flat shape: a rectangle, or a circle round (x, z). `flip` is the shape's y for world z. */
type Hole = Rect | { x: number; z: number; r: number };
function holePath(h: Hole, flip: 1 | -1): THREE.Path {
  const p = new THREE.Path();
  if ('r' in h) p.absarc(h.x, flip * h.z, h.r, 0, Math.PI * 2, true);
  else {
    p.moveTo(h.minX, flip * h.minZ);
    p.lineTo(h.minX, flip * h.maxZ);
    p.lineTo(h.maxX, flip * h.maxZ);
    p.lineTo(h.maxX, flip * h.minZ);
    p.closePath();
  }
  return p;
}

/**
 * A flat surface with holes in it, facing up (the floor, flip -1) or down (the ceiling, flip 1).
 * Its uvs span `uv` once, like a PlaneGeometry that size would.
 */
function surface(outline: [number, number][], holes: Hole[], flip: 1 | -1, uv?: Rect): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, flip * z)));
  shape.holes = holes.map((h) => holePath(h, flip));
  const geo = new THREE.ShapeGeometry(shape, 24);
  if (uv) {
    const pos = geo.getAttribute('position');
    const uvs = geo.getAttribute('uv');
    const w = uv.maxX - uv.minX;
    const d = uv.maxZ - uv.minZ;
    for (let i = 0; i < pos.count; i++) uvs.setXY(i, (pos.getX(i) - uv.minX) / w, (uv.maxZ - flip * pos.getY(i)) / d);
  }
  geo.rotateX(flip * (Math.PI / 2));
  return geo;
}

function rectOutline(r: Rect): [number, number][] {
  return [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
}

/** Ceiling tiles: a light grid, one tile per repeat. */
function tileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf7ef';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e3dccf';
  g.fillRect(0, 0, 128, 5);
  g.fillRect(0, 0, 5, 128);
  // A few speckles, like the mineral fibre in real tiles.
  g.fillStyle = '#efe8dc';
  for (let i = 0; i < 40; i++) g.fillRect(8 + ((i * 53) % 116), 8 + ((i * 97) % 116), 3, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 1.2, 1 / 1.2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A shaft going on past the hole into the dark: its walls fade out the further they go. */
function shaft(shape: 'square' | 'round', half: number, from: number, to: number, center: { x: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  const h = Math.abs(to - from);
  const geo = shape === 'round' ? new THREE.CylinderGeometry(half, half, h, 24, 6, true) : new THREE.CylinderGeometry(half * Math.SQRT2, half * Math.SQRT2, h, 4, 6, true).rotateY(Math.PI / 4);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  const near = new THREE.Color('#8d7b6a');
  const far = new THREE.Color('#141320');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // 1 at the hole, 0 at the far end.
    const k = to > from ? 0.5 - pos.getY(i) / h : 0.5 + pos.getY(i) / h;
    c.copy(near).lerp(far, Math.min(1, Math.pow(1 - k, 0.7)));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const walls = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  walls.position.set(center.x, (from + to) / 2, center.z);
  g.add(walls);
  const end = new THREE.Mesh(shape === 'round' ? new THREE.CircleGeometry(half, 24) : new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshBasicMaterial({ color: far }));
  end.rotation.x = to < from ? -Math.PI / 2 : Math.PI / 2;
  end.position.set(center.x, from > to ? Math.min(from, to) + 0.01 : Math.max(from, to) - 0.01, center.z);
  g.add(end);
  return g;
}

/** A trapdoor on a hinge at its room-side edge: `open` swings it up out of the floor, or down out of the ceiling. */
interface Trapdoor {
  pivot: THREE.Group;
  /** 0 shut … 1 open. */
  open: number;
  down: boolean;
}

function trapdoor(down: boolean): Trapdoor {
  const { hatch, slot } = LADDER;
  const w = hatch.maxX - hatch.minX - slot;
  const d = hatch.maxZ - hatch.minZ;
  const pivot = new THREE.Group();
  pivot.position.set(hatch.maxX, down ? WALL_HEIGHT : 0, (hatch.minZ + hatch.maxZ) / 2);
  const lid = new THREE.Group();
  const t = 0.06;
  // Flush with the floor (a touch proud of it, so it reads as a hatch), or with the ceiling.
  lid.add(mesh(new THREE.BoxGeometry(w - 0.02, t, d - 0.02), toon(down ? '#f3eee4' : '#c98b5a'), -w / 2, down ? t / 2 : -t / 2 + 0.012, 0, false));
  // A frame round it, and a ring to pull it by, on the side you see.
  const rim = toon(down ? '#d9cfbe' : '#7a5236');
  const y = down ? -0.012 : 0.022;
  for (const s of [-1, 1]) {
    lid.add(mesh(new THREE.BoxGeometry(w - 0.02, 0.025, 0.05), rim, -w / 2, y, (s * (d - 0.07)) / 2, false));
    lid.add(mesh(new THREE.BoxGeometry(0.05, 0.025, d - 0.02), rim, -w / 2 + (s * (w - 0.07)) / 2, y, 0, false));
  }
  const ring = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), toon('#adb5bd'), -w + 0.16, down ? -0.02 : 0.03, 0, false);
  ring.rotation.x = Math.PI / 2;
  lid.add(ring);
  pivot.add(lid);
  return { pivot, open: 0, down };
}

/** One of the two spots a pole can be: what's there on this floor. */
interface PoleView {
  spot: PoleSpot;
  index: number;
  group: THREE.Group;
  /** The pole from the floor to the ceiling; through the hole or up into the ceiling there's more of it. */
  below: THREE.Object3D;
  above: THREE.Object3D;
  /** Going down: the hole's railing and its sign, and the dark under it. */
  down: THREE.Group;
  downShaft: THREE.Group;
  sign: THREE.Mesh | null;
  signText: string;
  /** On the top floor, where it's bolted to the ceiling. */
  flange: THREE.Object3D;
  /** On the bottom floor, the mat you land on. */
  landing: THREE.Group;
  /** Coming down from above: the collar round the hole in the ceiling, and the dark over it. */
  collar: THREE.Object3D;
  upShaft: THREE.Group;
  interactable: Interactable;
}

export interface StackState {
  /** Which floor of the building you're on (0 is the bottom one), and how many there are. */
  index: number;
  count: number;
  /** The floors above and below, by name, for the signs. */
  up?: string;
  down?: string;
}

export interface Stack {
  group: THREE.Group;
  interactables: Interactable[];
  /** The floor you're on: the ladder, the hatches and the poles go where there are floors to go to. */
  set(s: StackState): void;
  state: StackState;
  /** The poles on this floor, when there's another floor for them to go to. */
  poles(): readonly PoleSpot[];
  /** Whether the poles go on down through holes in this floor (there's a floor below). */
  polesGoDown(): boolean;
  /**
   * Opens the hatches for anyone passing through them (on the ladder, or down in its shaft), and hides
   * the shafts from anyone looking up from the garage or the street.
   */
  update(dt: number, people: Iterable<{ x: number; y: number; z: number; grip?: string | null }>, eye: THREE.Vector3): void;
  /** A hatch just started opening or banged shut. */
  onHatch: ((where: 'floor' | 'ceiling', open: boolean) => void) | null;
}

/**
 * The floor you walk on (planks from `planks`), the slab under it, the ceiling over it, the ladder
 * and the fire poles. Their colliders go in `colliders` and change as floors come and go.
 */
export function buildStack(colliders: Collider[], planks: THREE.Material): Stack {
  const group = new THREE.Group();
  const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T };
  const concrete = toon('#d3d6dd');
  const band = toon('#e8a87c');
  // Big flat surfaces get no cartoon outline, as the floor never has.
  planks.userData.outlineParameters = { visible: false };
  const tiles = toon('#ffffff').clone();
  tiles.userData.outlineParameters = { visible: false };
  tiles.map = tileTexture();
  // Lit from below by the room's lamps, not left in the shade the sun would give it.
  tiles.emissive = new THREE.Color('#6a655d');
  tiles.emissiveMap = tiles.map;
  const ceilingMat = tiles;
  const brass = toon('#f2c14e', { emissive: '#3a2a00' });
  const red = toon('#e63946');
  const steel = toon('#ffd166');
  const rungMat = toon('#e09f3e');

  /** What set() builds, to take down again next time. */
  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  const state: StackState = { index: 0, count: 1 };

  // The ladder: steel rails and rungs up the wall, from the floor to the ceiling, and on through the
  // hatches into the shafts when there's a floor there.
  const railX = FLOOR.minX + 0.16;
  const ladderPart = (y0: number, y1: number) => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.07, y1 - y0, 0.07), steel, railX, (y0 + y1) / 2, LADDER.z + (s * LADDER.width) / 2, false));
    for (let y = Math.ceil((y0 + 0.15) / 0.3) * 0.3; y < y1 - 0.05; y += 0.3) {
      const rung = mesh(new THREE.CylinderGeometry(0.03, 0.03, LADDER.width, 8), rungMat, railX, y, LADDER.z, false);
      rung.rotation.x = Math.PI / 2;
      g.add(rung);
    }
    return g;
  };
  const ladder = new THREE.Group();
  const ladderMain = ladderPart(0, WALL_HEIGHT);
  // Brackets holding it off the wall.
  for (let y = 0.9; y < WALL_HEIGHT - 0.4; y += 1.5) for (const s of [-1, 1]) ladderMain.add(mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), steel, FLOOR.minX + 0.08, y, LADDER.z + (s * LADDER.width) / 2, false));
  const ladderBelow = ladderPart(-2.2, 0);
  const ladderAbove = ladderPart(WALL_HEIGHT, WALL_HEIGHT + 2.2);
  ladder.add(ladderMain, ladderBelow, ladderAbove);
  // A stripe of hazard paint on the floor in front of it.
  const stripe = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const s = mesh(new THREE.PlaneGeometry(0.1, 0.34), toon(i % 2 ? '#2b2d42' : '#ffd166'), LADDER.hatch.maxX + 0.08, 0.006, LADDER.z - 0.4 + i * 0.2, false);
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = 0.6;
    stripe.add(s);
  }
  ladder.add(stripe);
  group.add(ladder);
  // Something to aim at: the gaps between the rungs count as the ladder too.
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  ladder.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_HEIGHT, LADDER.width + 0.1).translate(FLOOR.minX + 0.2, WALL_HEIGHT / 2, LADDER.z), hitMat));
  const ladderIt: Interactable = { kind: 'ladder', x: LADDER.hatch.maxX + 0.2, z: LADDER.z, radius: 1.3, off: true };
  ladder.userData.interact = ladderIt;
  const ladderCollider: Collider = { minX: FLOOR.minX, maxX: railX + 0.05, minZ: LADDER.z - LADDER.width / 2 - 0.05, maxZ: LADDER.z + LADDER.width / 2 + 0.05, top: 99 };
  // Where the ladder goes: a sign up by the hatch in the ceiling, and one down by the floor.
  let ladderSigns: ReturnType<typeof textPlane>[] = [];

  const floorHatch = trapdoor(false);
  const ceilingHatch = trapdoor(true);
  group.add(floorHatch.pivot, ceilingHatch.pivot);
  const hatchCenter = { x: (LADDER.hatch.minX + LADDER.hatch.maxX) / 2, z: (LADDER.hatch.minZ + LADDER.hatch.maxZ) / 2 };
  const hatchHalf = (LADDER.hatch.maxX - LADDER.hatch.minX) / 2;
  const ladderDownShaft = shaft('square', hatchHalf, 0, -2.3, hatchCenter);
  const ladderUpShaft = shaft('square', hatchHalf, WALL_HEIGHT, WALL_HEIGHT + 2.3, hatchCenter);
  group.add(ladderDownShaft, ladderUpShaft);

  // The poles: one at each spot, with what goes round it either way.
  const poles: PoleView[] = POLES.map((spot, index) => {
    const g = new THREE.Group();
    const r = POLE.radius;
    g.add(mesh(new THREE.CylinderGeometry(r, r, WALL_HEIGHT, 14), brass, spot.x, WALL_HEIGHT / 2, spot.z, false));
    const below = mesh(new THREE.CylinderGeometry(r, r, 2.3, 14), brass, spot.x, -1.15, spot.z, false);
    const above = mesh(new THREE.CylinderGeometry(r, r, 2.3, 14), brass, spot.x, WALL_HEIGHT + 1.15, spot.z, false);
    g.add(below, above);

    // Going down: a railing round three sides of the hole, red with brass caps, open on the fourth.
    const down = new THREE.Group();
    const half = POLE.rail;
    const railTop = 1.02;
    const post = (x: number, z: number) => {
      down.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, railTop, 10), red, x, railTop / 2, z, false));
      down.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), brass, x, railTop + 0.03, z, false));
    };
    // The sides, as [dx0, dz0, dx1, dz1] from the pole, turned so the open one faces `open`.
    const c = Math.round(Math.cos(spot.open));
    const s = Math.round(Math.sin(spot.open));
    const turn = (lx: number, lz: number): [number, number] => [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c];
    const sides: [number, number, number, number][] = [
      [-half, -half, half, -half],
      [-half, -half, -half, half],
      [half, -half, half, half],
    ];
    for (const [ax, az, bx, bz] of sides) {
      const [x0, z0] = turn(ax, az);
      const [x1, z1] = turn(bx, bz);
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (const y of [railTop, railTop * 0.55]) {
        const bar = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), y === railTop ? brass : red, (x0 + x1) / 2, y, (z0 + z1) / 2, false);
        bar.rotation.z = Math.PI / 2;
        bar.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        down.add(bar);
      }
      post(x0, z0);
      post(x1, z1);
    }
    // The rim of the hole.
    const rim = mesh(new THREE.TorusGeometry(POLE.hole, 0.035, 6, 32), toon('#2b2d42'), spot.x, 0.005, spot.z, false);
    rim.rotation.x = Math.PI / 2;
    down.add(rim);
    g.add(down);
    const downShaft = shaft('round', POLE.hole, 0, -2.3, spot);
    g.add(downShaft);
    // At the top, a brass flange where it's bolted to the ceiling.
    const flange = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 16), brass, spot.x, WALL_HEIGHT - 0.04, spot.z, false);
    g.add(flange);

    // At the bottom, a fat landing mat.
    const landing = new THREE.Group();
    landing.add(mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.07, 32), red, spot.x, 0.035, spot.z, false));
    const ring = mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), toon('#ffd166'), spot.x, 0.07, spot.z, false);
    ring.rotation.x = Math.PI / 2;
    landing.add(ring);
    g.add(landing);
    // Coming down from above: a brass collar round the hole it comes out of.
    const collar = mesh(new THREE.TorusGeometry(POLE.hole, 0.06, 8, 32), brass, spot.x, WALL_HEIGHT - 0.02, spot.z, false);
    collar.rotation.x = Math.PI / 2;
    g.add(collar);
    const upShaft = shaft('round', POLE.hole, WALL_HEIGHT, WALL_HEIGHT + 2.3, spot);
    g.add(upShaft);

    // A pole is thin: anywhere near it counts, when you aim at it.
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, WALL_HEIGHT, 8).translate(spot.x, WALL_HEIGHT / 2, spot.z), hitMat));
    group.add(g);
    const interactable: Interactable = { kind: 'pole', pole: index, x: spot.x, z: spot.z, radius: 1.7, off: true };
    g.userData.interact = interactable;
    return { spot, index, group: g, below, above, down, downShaft, sign: null, signText: '', flange, landing, collar, upShaft, interactable };
  });

  const interactables = [ladderIt, ...poles.map((p) => p.interactable)];

  const take = <T extends THREE.Object3D>(o: T): T => {
    built.push(o);
    group.add(o);
    return o;
  };

  const set = (s: StackState) => {
    Object.assign(state, s);
    delete state.up;
    delete state.down;
    if (s.up) state.up = s.up;
    if (s.down) state.down = s.down;
    const { index, count } = s;
    const others = count > 1;
    const below = others && index > 0;
    const above = others && index < count - 1;
    // Every pole goes the whole way down: through this floor if there's one below, and the ceiling if there's one above.
    const holes = below ? POLES : [];

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

    // The floor: planks, with the hatch and the pole's hole cut out when they go somewhere.
    const floorHoles: Hole[] = [];
    if (below) floorHoles.push(LADDER.hatch);
    for (const p of holes) floorHoles.push({ x: p.x, z: p.z, r: POLE.hole });
    const floor = take(new THREE.Mesh(surface(rectOutline(FLOOR), floorHoles, -1, FLOOR), planks));
    floor.receiveShadow = true;

    // The slab under it (the garage's ceiling): concrete underneath, a peach band between the floors
    // outside. Where a hole goes through, the garage sees a lid of concrete, not up into the office.
    const slabHoles: Hole[] = [...(below ? [LADDER.hatch] : []), ...holes.map((p) => ({ x: p.x, z: p.z, r: POLE.hole + 0.02 }))];
    const slabShape = new THREE.Shape(rectOutline(B).map(([x, z]) => new THREE.Vector2(x, -z)));
    slabShape.holes = slabHoles.map((h) => holePath(h, -1));
    const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: SLAB - 0.01, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2).translate(0, -SLAB, 0);
    // Its top and bottom are concrete (group 0); its edges are the band.
    take(mesh(slabGeo, concrete)).material = [concrete, band];
    for (const h of slabHoles.map((h) => ('r' in h ? around(h, h.r) : h))) {
      const lid = take(mesh(new THREE.PlaneGeometry(h.maxX - h.minX, h.maxZ - h.minZ), concrete, (h.minX + h.maxX) / 2, -SLAB - 0.002, (h.minZ + h.maxZ) / 2, false));
      lid.rotation.x = Math.PI / 2;
      lid.receiveShadow = false;
    }
    // You can walk over the ladder's hatch (its trapdoor), but not over a pole's hole: that's how you go down it.
    const floorCut = holes.map((p) => around(p, POLE.hole - 0.1));
    for (const r of cutRect(B, floorCut)) mine.push({ ...r, bottom: -SLAB, top: 0 });
    // Down the hole, the pole is right there to grab; this only catches anyone who somehow isn't sliding.
    for (const p of holes) mine.push({ ...around(p, POLE.hole), bottom: -1.4, top: -1.2 });

    // The ceiling: tiles, WALL_HEIGHT up, with the hatch and the poles' holes when they come from somewhere.
    const ceilingHoles: Hole[] = [];
    if (above) ceilingHoles.push(LADDER.hatch);
    if (above) for (const p of POLES) ceilingHoles.push({ x: p.x, z: p.z, r: POLE.hole });
    take(mesh(surface(rectOutline(FLOOR), ceilingHoles, 1), ceilingMat, 0, WALL_HEIGHT, 0, false)).receiveShadow = false;
    mine.push({ ...FLOOR, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB });

    // The ladder, when there's anywhere to climb to.
    ladder.visible = others;
    ladderIt.off = !others;
    ladderBelow.visible = below;
    ladderAbove.visible = above;
    floorHatch.pivot.visible = below;
    ceilingHatch.pivot.visible = above;
    ladderDownShaft.visible = below;
    ladderUpShaft.visible = above;
    if (others) mine.push(ladderCollider);
    for (const sign of ladderSigns) {
      sign.removeFromParent();
      sign.geometry.dispose();
      sign.material.map?.dispose();
      sign.material.dispose();
    }
    ladderSigns = [];
    // Above the window beside it and below its sill, so they cover neither.
    for (const [name, arrow, y] of [
      [s.up, '⬆', LADDER_WINDOW_HEAD + 0.48],
      [s.down, '⬇', 0.62],
    ] as const) {
      if (!others || !name) continue;
      const sign = textPlane(`🪜 ${arrow} ${name.length > 22 ? `${name.slice(0, 21)}…` : name}`, { bg: '#ffd166', size: 44 });
      sign.scale.multiplyScalar(0.7);
      sign.position.set(FLOOR.minX + 0.02, y, LADDER.z + LADDER.width / 2 + 0.15 + (sign.geometry.parameters.width * 0.7) / 2);
      sign.rotation.y = Math.PI / 2;
      group.add(sign);
      ladderSigns.push(sign);
    }

    for (const p of poles) {
      p.group.visible = others;
      p.interactable.off = !others;
      p.down.visible = p.downShaft.visible = p.below.visible = below;
      p.flange.visible = !above;
      p.landing.visible = !below;
      p.collar.visible = p.upShaft.visible = p.above.visible = above;
      if (below) {
        // The railing, three sides of the square round the hole.
        const c = Math.round(Math.cos(p.spot.open));
        const sn = Math.round(Math.sin(p.spot.open));
        const h = POLE.rail;
        const t = 0.06;
        const rails: Rect[] = [
          [-h - t, h + t, -h - t, -h + t],
          [-h - t, -h + t, -h - t, h],
          [h - t, h + t, -h - t, h],
        ].map(([x0, x1, z0, z1]) => {
          const xs = [x0 * c + z0 * sn, x1 * c + z1 * sn];
          const zs = [-x0 * sn + z0 * c, -x1 * sn + z1 * c];
          return { minX: p.spot.x + Math.min(...xs), maxX: p.spot.x + Math.max(...xs), minZ: p.spot.z + Math.min(...zs), maxZ: p.spot.z + Math.max(...zs) };
        });
        for (const r of rails) mine.push({ ...r, top: 1.05 });
      } else if (others) {
        mine.push({ ...around(p.spot, POLE.radius + 0.03), top: 99 });
      }
      const text = below && s.down ? `🚒 ⬇ ${s.down}` : '';
      if (text !== p.signText) {
        if (p.sign) {
          p.sign.removeFromParent();
          p.sign.geometry.dispose();
          (p.sign.material as THREE.MeshBasicMaterial).map?.dispose();
          (p.sign.material as THREE.MeshBasicMaterial).dispose();
          p.sign = null;
        }
        p.signText = text;
        if (text) {
          // Hung on the rail across from the way in, facing it, beside the pole rather than behind it.
          const sign = textPlane(text, { bg: '#e63946', color: '#ffffff', size: 40, border: '#ffffff' });
          sign.scale.multiplyScalar(0.6);
          const back = POLE.rail + 0.06;
          const side = POLE.rail * 0.5;
          const c = Math.cos(p.spot.open);
          const sn = Math.sin(p.spot.open);
          sign.position.set(p.spot.x - sn * back + c * side, 0.72, p.spot.z - c * back - sn * side);
          sign.rotation.y = p.spot.open;
          p.sign = sign;
          p.group.add(sign);
        }
      }
    }
    colliders.push(...mine);
  };

  const stack: Stack = {
    group,
    interactables,
    set,
    state,
    poles: () => (state.count > 1 ? POLES : []),
    polesGoDown: () => state.count > 1 && state.index > 0,
    onHatch: null,
    update(dt, people, eye) {
      const inHatch = (p: { x: number; z: number }) => p.x > LADDER.hatch.minX - 0.1 && p.x < LADDER.hatch.maxX && p.z > LADDER.hatch.minZ - 0.1 && p.z < LADDER.hatch.maxZ + 0.1;
      let floorWant = 0;
      let ceilingWant = 0;
      for (const p of people) {
        if (!inHatch(p)) continue;
        const onLadder = p.grip === 'ladder';
        if (p.y < -0.03 || (onLadder && p.y < 0.6)) floorWant = 1;
        if (p.y > WALL_HEIGHT - 1.75 || (onLadder && p.y > WALL_HEIGHT - 2.4)) ceilingWant = 1;
      }
      for (const [h, want, where] of [
        [floorHatch, floorWant, 'floor'],
        [ceilingHatch, ceilingWant, 'ceiling'],
      ] as const) {
        if (!h.pivot.visible || h.open === want) continue;
        if (want && h.open === 0) stack.onHatch?.(where, true);
        h.open = want > h.open ? Math.min(1, h.open + dt * 4) : Math.max(0, h.open - dt * 2.2);
        if (!want && h.open === 0) stack.onHatch?.(where, false);
        h.pivot.rotation.z = (h.down ? 1 : -1) * h.open * (Math.PI / 2 + 0.12);
      }
      // From the garage or the street (or anywhere outside), the shafts, and the ladder and poles in
      // them, would hang in mid-air under the building or stick up out of its roof.
      const inside = eye.x > FLOOR.minX && eye.x < FLOOR.maxX && eye.z > FLOOR.minZ && eye.z < FLOOR.maxZ && eye.y > -SLAB;
      ladderDownShaft.visible = ladderBelow.visible = inside && floorHatch.pivot.visible;
      ladderUpShaft.visible = ladderAbove.visible = inside && ceilingHatch.pivot.visible;
      for (const p of poles) {
        p.downShaft.visible = p.below.visible = inside && p.down.visible;
        p.upShaft.visible = p.above.visible = inside && p.collar.visible;
      }
    },
  };
  return stack;
}
