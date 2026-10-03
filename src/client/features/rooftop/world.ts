import * as THREE from 'three';
import { AXE_LANE } from '../../../shared/bargames';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, SEATING_BY_ID, WALL_HEIGHT, WALL_T } from '../../../shared/layout';
import { buildBarGames, type BarGamesView } from '../bargames/world';
import { buildCity, type City } from '../../world/city';
import { buildElevator, type Elevator } from '../../world/elevator';
import type { Collider, Interactable } from '../../world/types';
import { bulb, type NightParts } from '../../world/outside';
import { canvasTexture } from '../../world/texture';
import { mergeByMaterial, mesh, toon } from '../../world/toon';
import { THINK_SPOT } from '../../../shared/garden';
import { buildCafe } from './cafe';
import { buildCafeSeating } from './cafe-seating';
import { buildChessCorner } from '../chess/world';
import { buildGarden } from './garden';
import { seatable } from './kit';

// The rooftop café, on top of the building (see shared/rooftop.ts): a deck with a glass railing round
// it and the city all around, the elevator's housing where you arrive, a café along the east edge
// (cafe.ts) with tables and chairs to sit at (cafe-seating.ts), sun loungers along the south edge, and
// an axe-throwing lane and a dart board in the north-west corner (features/bargames/world.ts). Two
// parts of the roof are kept free for others (ROOF_CLEAR in shared/layout.ts).

/** The building, walls included: the roof's edge. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

export interface RoofEnv {
  /** How dark it is, 0 by day to 1 at night: lights show up more. */
  dark: number;
  /** Things may spin (off when the system asks for less motion). */
  motion: boolean;
}

export interface Rooftop {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  elevator: Elevator;
  city: City;
  /**
   * The building has `floors` floors under the roof: the street is as far down as that is tall (see
   * City). `wings` is how far each one's back office is built out.
   */
  setFloors(floors: number, wings?: readonly number[]): void;
  /** What looking or clicking can land on: everything but the city far below. */
  pickables: THREE.Object3D[];
  /** Where drinks are made, for the sound of one. */
  pourAt: { x: number; y: number; z: number };
  /** The axe lane and the dart board, and what's thrown at them. */
  games: BarGamesView;
  /** Someone ordered at the counter, standing (or sitting) at `z` along it: the barista comes over. */
  serve(z: number): void;
  /** Moves what moves: the city, the lamps as it gets dark, the barista, the fans. */
  update(t: number, dt: number, env: RoofEnv): void;
}

/** Teak decking, the boards running east–west. */
function deckTexture(): THREE.CanvasTexture {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const px = 24;
  return canvasTexture(Math.round(w * px), Math.round(d * px), (g) => {
    g.fillStyle = '#b98457';
    g.fillRect(0, 0, w * px, d * px);
    const board = 0.14 * px;
    for (let y = 0, row = 0; y < d * px; y += board, row++) {
      // Each row of boards a slightly different tone, with joints staggered along it.
      const tone = 0.9 + ((row * 37) % 11) / 55;
      g.fillStyle = `rgb(${Math.round(185 * tone)}, ${Math.round(132 * tone)}, ${Math.round(87 * tone)})`;
      g.fillRect(0, y, w * px, board - 1.5);
      g.fillStyle = 'rgba(70, 40, 20, 0.35)';
      for (let x = ((row * 53) % 7) * px * 0.4; x < w * px; x += 2.4 * px) g.fillRect(x, y, 1.5, board);
    }
  });
}

// ---- The rooftop --------------------------------------------------------------------------------

export function buildRooftop(night: NightParts, floors: number): Rooftop {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const statics = new THREE.Group();
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;
  const city = buildCity(night);
  city.setFloors(floors);
  group.add(city.group);

  // The deck, and the slab it's laid on (the top of the building).
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture() });
  deckMat.userData.outlineParameters = { visible: false };
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), deckMat);
  deck.position.set(cx, 0.002, cz);
  deck.receiveShadow = true;
  group.add(deck);
  statics.add(mesh(new THREE.BoxGeometry(w, 0.3, d), toon('#c9c4bb'), cx, -0.15, cz, false));
  colliders.push({ minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, bottom: -0.3, top: 0 });

  // Round the edge: a concrete curb with glass panels on it and a steel rail on top. Nobody goes over it.
  const curb = toon('#d8d3ca');
  const steel = toon('#aeb6bf');
  const glassMat = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
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
    statics.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.45, z1 - z0), curb, ex, 0.225, ez));
    const len = alongX ? x1 - x0 : z1 - z0;
    const pane = mesh(new THREE.PlaneGeometry(len, 0.72), glassMat, ex, 0.81, ez, false);
    if (!alongX) pane.rotation.y = Math.PI / 2;
    group.add(pane);
    const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), steel, ex, 1.19, ez, false);
    rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    statics.add(rail);
    for (let a = 0; a <= len + 0.01; a += 2.4) {
      const px = alongX ? x0 + a : ex;
      const pz = alongX ? ez : z0 + a;
      statics.add(mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), steel, px, 0.8, pz, false));
    }
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 99 });
  }

  // The elevator, in its housing: a back wall and a roof over the shaft (as tall as a floor), with a light on top.
  const elevator = buildElevator();
  elevator.setSign('☕ Rooftop café');
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  const hw = ELEVATOR.width / 2;
  const housing = toon('#b8c1cc');
  statics.add(mesh(new THREE.BoxGeometry(ELEVATOR.width, WALL_HEIGHT + 0.3, WALL_T), housing, ELEVATOR.x, (WALL_HEIGHT + 0.3) / 2, FLOOR.minZ - WALL_T / 2));
  statics.add(mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.3, 0.3, ELEVATOR_FRONT - B.minZ + 0.2), toon('#8d99ae'), ELEVATOR.x, WALL_HEIGHT + 0.15, (B.minZ + ELEVATOR_FRONT) / 2 + 0.05));
  const beacon = bulb(night, '#ff5d5d', 0.6);
  statics.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), beacon, ELEVATOR.x, WALL_HEIGHT + 0.4, (B.minZ + ELEVATOR_FRONT) / 2, false));
  colliders.push({ minX: ELEVATOR.x - hw, maxX: ELEVATOR.x + hw, minZ: B.minZ, maxZ: FLOOR.minZ, top: 99 });

  // The café, and its tables and chairs.
  const site = { group, statics, colliders, interactables, night };
  const cafe = buildCafe(site);
  buildCafeSeating(site);

  // Sun loungers along the south edge, a parasol between each pair, facing out over the street.
  const frame = toon('#f4f1ea');
  for (let i = 1; i <= 3; i++) {
    const s = SEATING_BY_ID.get(`roof-lounger-${i}`)!;
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.28, 1.9), frame, 0, 0.14, 0.15));
    g.add(mesh(new THREE.BoxGeometry(0.66, 0.08, 1.3), toon('#e8c9a0'), 0, 0.32, 0.45));
    const backrest = mesh(new THREE.BoxGeometry(0.66, 0.08, 0.8), toon('#e8c9a0'), 0, 0.55, -0.5);
    backrest.rotation.x = 0.75;
    g.add(backrest);
    g.position.set(s.x, 0, s.z);
    seatable(g, s.id, 1.1, interactables);
    group.add(g);
    colliders.push({ minX: s.x - 0.36, maxX: s.x + 0.36, minZ: s.z - 0.8, maxZ: s.z + 1.1, top: 0.36 });
  }
  for (const x of [-0.8, 2]) {
    const z = FLOOR.maxZ - 1.1;
    statics.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), frame, x, 1.3, z, false));
    statics.add(mesh(new THREE.ConeGeometry(1.5, 0.5, 12, 1, true), toon('#e9b872'), x, 2.6, z, true));
    statics.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 12), frame, x, 0.225, z, false));
    statics.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), frame, x, 0.47, z, false));
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, top: 0.49 });
  }

  // Planters along the edges, and the air conditioning behind a screen in the north-east corner.
  const planter = toon('#6d6875');
  const leaf = toon('#5fb760');
  const leafDark = toon('#3f8f45');
  const planterRow = (x0: number, x1: number, z0: number, z1: number) => {
    statics.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), planter, (x0 + x1) / 2, 0.3, (z0 + z1) / 2));
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let a = 0.4; a < len - 0.2; a += 0.7) {
      const px = alongX ? x0 + a : (x0 + x1) / 2;
      const pz = alongX ? (z0 + z1) / 2 : z0 + a;
      statics.add(mesh(new THREE.SphereGeometry(0.38 + ((a * 13) % 3) * 0.06, 10, 8), a % 1.4 < 0.7 ? leaf : leafDark, px, 0.8, pz, false));
    }
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 0.6 });
  };
  // Down the west edge from the axe lane's booth, which has the corner.
  planterRow(FLOOR.minX, FLOOR.minX + 0.7, FLOOR.minZ + AXE_LANE.depth + 0.3, 3.2);
  planterRow(5.2, FLOOR.maxX - 0.4, FLOOR.maxZ - 0.7, FLOOR.maxZ);
  const screenX = 10.9;
  const screenZ = -8.2;
  const slat = toon('#8d99ae');
  for (let z = FLOOR.minZ; z < screenZ; z += 0.3) statics.add(mesh(new THREE.BoxGeometry(0.06, 2.2, 0.14), slat, screenX, 1.1, z, false));
  for (let x = screenX; x < FLOOR.maxX; x += 0.3) statics.add(mesh(new THREE.BoxGeometry(0.14, 2.2, 0.06), slat, x, 1.1, screenZ, false));
  colliders.push({ minX: screenX - 0.1, maxX: screenX + 0.1, minZ: FLOOR.minZ, maxZ: screenZ, top: 99 });
  colliders.push({ minX: screenX, maxX: FLOOR.maxX, minZ: screenZ - 0.1, maxZ: screenZ + 0.1, top: 99 });
  const fans: THREE.Group[] = [];
  for (const [x, z] of [
    [13.2, -11],
    [16.2, -11],
  ]) {
    statics.add(mesh(new THREE.BoxGeometry(2.2, 1.3, 2.4), toon('#dfe3e8'), x, 0.65, z));
    statics.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20), toon('#565a75'), x, 1.31, z, false));
    const fan = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const blade = mesh(new THREE.BoxGeometry(1.2, 0.02, 0.22), toon('#2b2d42'), 0, 0, 0, false);
      blade.rotation.y = (b / 3) * Math.PI;
      fan.add(blade);
    }
    fan.position.set(x, 1.36, z);
    group.add(fan);
    fans.push(fan);
  }

  group.add(mergeByMaterial(statics));

  // The games corner: the axe lane and the dart board.
  const games = buildBarGames(night);
  group.add(games.group);
  colliders.push(...games.colliders);
  interactables.push(...games.interactables);

  // The Merge Conflict games corner: chess tables where the stage was (features/chess).
  const chess = buildChessCorner();
  group.add(chess.group);
  colliders.push(...chess.colliders);
  interactables.push(...chess.interactables);

  // The thinking garden, with a stone at its heart that opens the ambient sounds (features/ambience).
  const garden = buildGarden();
  group.add(garden.group);
  colliders.push(...garden.colliders);
  interactables.push(...garden.interactables);
  const soundSpot: Interactable = { kind: 'ambience', x: THINK_SPOT.x, y: 0, z: THINK_SPOT.z, radius: 2.2 };
  interactables.push(soundSpot);
  garden.soundStone.userData.interact = soundSpot;

  return {
    group,
    colliders,
    interactables,
    elevator,
    city,
    setFloors: (n, wings) => city.setFloors(n, wings),
    pickables: [...group.children.filter((c) => c !== city.group && c !== garden.group && c !== chess.group), ...garden.pickables, ...chess.pickables],
    pourAt: cafe.pourAt,
    games,
    serve: cafe.serve,
    update(t, dt, env) {
      city.update(t, dt, env.dark);
      elevator.update(dt);
      games.update(dt, env.dark);
      cafe.update(t, dt, env.dark);
      garden.update(t, dt, env.motion);
      garden.setDark(env.dark);
      if (env.motion) for (const fan of fans) fan.rotation.y += dt * 9;
    },
  };
}
