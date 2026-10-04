import * as THREE from 'three';
import { GARDEN, GARDEN_POND, GARDEN_SEATS, THINK_SPOT } from '../../../shared/garden';
import type { SeatDef } from '../../../shared/layout';
import type { Collider, Interactable } from '../../world/types';
import { boulder, moss, pond, steppingStones } from './garden/ground';
import { hash3, rng } from './garden/leaves';
import { VoxBatch } from './garden/voxkit';
import { Blocks } from './garden/voxscene';
import * as P from './garden/plants';
import { bench, lounge } from './garden/seats';
import { SOIL, lantern, pergola, planterBed, soundStone } from './garden/structures';

// The thinking garden (see shared/garden.ts): a quiet clearing in the south-west of the roof, woven round
// with timber planter beds of tree ferns, palms, banana plants, monstera, bamboo and tall grass, a
// stepping-stone path from the east side, a small pond with benches and lounge chairs round it, and a
// pergola hung with ivy over them. It's merged into a handful of meshes: the leaves (which sway), the
// solids, the lantern glass. Whatever you can use (the seats, the sound stone) is a group of its own.

export interface Garden {
  group: THREE.Group;
  colliders: Collider[];
  /** The seats (kind 'seat'). The sound stone is for the caller to make usable: it's `soundStone`. */
  interactables: Interactable[];
  /** What the crosshair can land on: the seats and the sound stone. The plants don't get in its way. */
  pickables: THREE.Object3D[];
  /** Stands at THINK_SPOT: set its `userData.interact` to make it the ambient-sound control. */
  soundStone: THREE.Object3D;
  /** How dark it is, 0 by day to 1 at night: the lanterns glow brighter. */
  setDark(dark: number): void;
  update(t: number, dt: number, motion: boolean): void;
}

/** Smooth value noise, 0..1: soft patches where hash3 alone would be speckle. */
function smooth(x: number, z: number): number {
  const [ix, iz] = [Math.floor(x), Math.floor(z)];
  const [fx, fz] = [x - ix, z - iz].map((v) => v * v * (3 - 2 * v));
  const h = (a: number, b: number) => hash3(ix + a, 7, iz + b);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(0, 0), h(1, 0), fx), THREE.MathUtils.lerp(h(0, 1), h(1, 1), fx), fz);
}

const PERGOLA = { minX: -14, maxX: -7.4, minZ: 4.6, maxZ: 11.4, top: 2.5 } as const;

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[], seat: SeatDef) {
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

/** A collider round a `w` x `d` footprint at the seat, turned like it is. */
function seatCollider(s: SeatDef, w: number, d: number, dz: number, top: number): Collider {
  const [c, n] = [Math.abs(Math.cos(s.rotY)), Math.abs(Math.sin(s.rotY))];
  const hw = (c * w + n * d) / 2;
  const hd = (n * w + c * d) / 2;
  const x = s.x + Math.sin(s.rotY) * dz;
  const z = s.z + Math.cos(s.rotY) * dz;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, top };
}

export function buildGarden(): Garden {
  const group = new THREE.Group();
  const interactables: Interactable[] = [];
  const limit = new THREE.Box3(new THREE.Vector3(GARDEN.minX - 0.4, 0, GARDEN.minZ - 0.5), new THREE.Vector3(GARDEN.maxX + 0.4, 0, GARDEN.maxZ + 0.4));
  const g: P.Grow = { v: new VoxBatch(limit), b: new Blocks(0.05), fine: new Blocks(0.025), glowB: new Blocks(0.025, 0), r: rng(20261003), colliders: [] };
  const { r } = g;
  const jit = (v: number) => (r() - 0.5) * v;

  // The ground: earth and moss in soft patches, a layer of blocks just under the deck's top, fading into the deck on the east.
  const turf = new Blocks(0.05, 0.06);
  const [earth, mossy, lush, c] = [new THREE.Color('#4a3b2c'), new THREE.Color('#4a7a38'), new THREE.Color('#5f8f45'), new THREE.Color()];
  const [gx0, gx1, gz0, gz1] = [(GARDEN.minX - 5) / 2 - 6.25, (GARDEN.minX - 5) / 2 + 6.25, (GARDEN.minZ + GARDEN.maxZ) / 2 - 4.5, (GARDEN.minZ + GARDEN.maxZ) / 2 + 4.5];
  for (let i = Math.floor(gx0 / 0.05); i < gx1 / 0.05; i++)
    for (let k = Math.floor(gz0 / 0.05); k < gz1 / 0.05; k++) {
      const [x, z] = [(i + 0.5) * 0.05, (k + 0.5) * 0.05];
      if (hash3(i, 3, k) < THREE.MathUtils.smoothstep(x + 0.8 * smooth(z * 1.3, 4), -6.4, -5.1)) continue;
      const n = smooth(x / 1.8, z / 1.8) * 0.65 + smooth(x / 0.7 + 9, z / 0.7) * 0.35;
      c.copy(earth).lerp(mossy, THREE.MathUtils.smoothstep(n, 0.35, 0.6)).lerp(lush, THREE.MathUtils.smoothstep(n, 0.65, 0.85));
      turf.v.put(i, -1, k, '#' + c.getHexString(), 0.1);
    }
  const dirt = turf.mesh();
  dirt.position.y = 0.012;
  group.add(dirt);

  // ---- Beds along the north, west and south sides, and a pair flanking the way in from the east --------
  const beds: [number, number, number, number][] = [
    [-17.4, -6.0, 3.55, 4.4],
    [-17.4, -16.5, 4.4, 12.45],
    [-16.5, -8.5, 11.6, 12.45],
    [-5.6, -4.6, 3.6, 5.0],
    [-5.6, -4.6, 11.2, 12.45],
  ];
  for (const b of beds) planterBed(g, ...b);
  const y = SOIL;
  // Which way plants at each edge fan their leaves: into the garden (yaw 0 is south).
  const [S, N, E, W] = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

  /** A few flowers of one colour, bunched together. */
  const bunch = (x: number, z: number, color: string, n: number, kind: 'head' | 'spike' = 'head', yy = y) => {
    for (let i = 0; i < n; i++) P.flower(g, x + jit(0.35), yy, z + jit(0.3), 0.25 + 0.2 * r() + (kind === 'spike' ? 0.15 : 0), color, kind);
  };

  // North bed, west to east.
  P.bamboo(g, -16.3, y, 3.95, 9, 3.4);
  P.banana(g, -14.4, y, 3.95, 3.3, S, true);
  P.treeFern(g, -12.5, y, 4.0, 2.1, S);
  P.monstera(g, -10.5, y, 4.0, 1.25, S);
  P.palm(g, -8.7, y, 3.95, 3.3, S);
  P.treeFern(g, -7.0, y, 4.05, 1.6, S);
  for (const x of [-15.4, -13.4, -11.6, -9.6, -7.9]) P.broadleaf(g, x, y, 4.2, 7, 0.55);
  P.grass(g, -15.4, y, 3.8, 22, 1.5);
  P.grass(g, -9.5, y, 3.75, 20, 1.3);
  for (const [x, c] of [
    [-13.4, P.PETALS.red],
    [-11.7, P.PETALS.orange],
    [-8.0, P.PETALS.purple],
    [-15.5, P.PETALS.white],
  ] as const)
    bunch(x, 4.2, c, 4);

  // West bed, south from the corner.
  P.banana(g, -16.95, y, 6.3, 2.8, E);
  P.grass(g, -16.95, y, 7.6, 24, 1.4);
  P.palm(g, -16.95, y, 9.0, 3.1, E);
  P.monstera(g, -16.95, y, 10.3, 1.0, E);
  P.treeFern(g, -16.95, y, 11.5, 2.2, E);
  for (const z of [5.4, 7.0, 8.2, 9.8, 11.0]) P.groundFern(g, -16.75, y, z, 1);
  bunch(-16.8, 5.2, P.PETALS.orange, 4);
  bunch(-16.8, 8.3, P.PETALS.purple, 4, 'spike');
  bunch(-16.8, 10.0, P.PETALS.red, 4);

  // South bed, west to east.
  P.treeFern(g, -15.7, y, 12.0, 2.5, N);
  P.grass(g, -14.5, y, 12.0, 22, 1.6);
  P.bamboo(g, -12.8, y, 12.0, 8, 3.0);
  P.monstera(g, -11.2, y, 12.0, 1.1, N);
  P.palm(g, -9.2, y, 12.0, 3.0, N);
  for (const x of [-15.1, -13.6, -11.9, -10.3, -9.0]) P.broadleaf(g, x, y, 11.85, 6, 0.5);
  for (const [x, c] of [
    [-15.0, P.PETALS.white],
    [-13.4, P.PETALS.red],
    [-10.0, P.PETALS.orange],
  ] as const)
    bunch(x, 11.85, c, 4);
  bunch(-11.6, 11.8, P.PETALS.purple, 4, 'spike');

  // The two beds either side of the way in.
  P.palm(g, -5.1, y, 4.2, 3.0, W);
  P.grass(g, -5.1, y, 4.7, 16, 1.2);
  bunch(-5.1, 3.9, P.PETALS.orange, 3);
  P.banana(g, -5.1, y, 11.9, 2.6, W);
  P.groundFern(g, -5.1, y, 11.35, 1);
  bunch(-5.1, 12.2, P.PETALS.red, 3);

  // ---- On the ground: boulders, ferns and flowers in the corners, the pond and its path --------------
  for (const [x, z, rr, h] of [
    [-15.4, 6.5, 0.55, 0.5],
    [-14.7, 7.0, 0.38, 0.35],
    [-15.9, 7.1, 0.3, 0.3],
    [-14.6, 10.3, 0.45, 0.4],
    [-13.9, 10.7, 0.28, 0.26],
  ] as const)
    boulder(g, x, z, rr, h);
  P.treeFern(g, -15.0, 0, 8.9, 1.9);
  for (const [x, z] of [
    [-14.9, 5.6],
    [-16.0, 6.3],
    [-14.2, 7.7],
    [-15.7, 8.0],
    [-14.2, 9.6],
    [-15.3, 11.0],
    [-13.2, 11.0],
  ])
    P.groundFern(g, x, 0, z, 1.1);
  P.grass(g, -15.4, 0, 9.9, 18, 1.2);
  P.grass(g, -14.9, 0, 5.2, 16, 1.0);
  bunch(-14.2, 8.4, P.PETALS.purple, 3, 'spike', 0);
  bunch(-14.1, 6.0, P.PETALS.white, 3, 'head', 0);
  bunch(-13.0, 10.9, P.PETALS.orange, 3, 'head', 0);

  const spot = GARDEN_POND;
  pond(g, spot.x, spot.z, spot.r);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(spot.r * 1.8, spot.r * 1.8).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2f5b5a', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9, envMapIntensity: 1.6 }),
  );
  water.position.set(spot.x, 0.095, spot.z);
  water.receiveShadow = true;
  P.flower(g, spot.x - 0.2, 0.1, spot.z + 0.12, 0.1, P.PETALS.pink, 'head');
  P.flower(g, spot.x + 0.18, 0.1, spot.z - 0.2, 0.08, P.PETALS.white, 'head');
  g.colliders.push({ minX: spot.x - 0.85, maxX: spot.x + 0.85, minZ: spot.z - 0.85, maxZ: spot.z + 0.85, top: 99 });
  for (let i = 0; i < 6; i++) {
    const a = 3.6 + i * 0.5;
    P.groundFern(g, spot.x + Math.cos(a) * 1.25, 0, spot.z + Math.sin(a) * 1.25 + (Math.sin(a) > 0.4 ? 0.1 : -0.1), 0.8);
  }
  steppingStones(g, [
    [-4.6, 9.0],
    [-6.0, 8.5],
    [-7.4, 9.0],
    [-8.9, 9.1],
    [-10.5, 9.4],
    [-12.0, 9.0],
    [-12.5, 8.3],
  ]);
  steppingStones(g, [
    [-7.6, 8.7],
    [-8.2, 7.5],
    [-9.0, 6.8],
    [-10.0, 6.4],
  ]);
  for (let i = 0; i < 16; i++) moss(g, -16 + r() * 11, 4.8 + r() * 6.4, 0.18 + 0.2 * r());
  for (let i = 0; i < 12; i++) P.clover(g, -16.2 + r() * 11, 0, 4.6 + r() * 6.6, 0.3 + 0.2 * r(), 26);

  // ---- The seats, under a pergola hung with ivy and lanterns, and the sound stone -----------------------
  pergola(g, PERGOLA.minX, PERGOLA.maxX, PERGOLA.minZ, PERGOLA.maxZ, PERGOLA.top);
  for (const [x, z] of [
    [-12.3, PERGOLA.minZ],
    [-9.2, PERGOLA.minZ],
    [-8.9, PERGOLA.maxZ],
    [-12.4, PERGOLA.maxZ],
  ])
    lantern(g, x, z, PERGOLA.top);
  for (const [x, z] of [
    [-5.7, 9.9],
    [-8.0, 10.2],
    [-12.2, 10.0],
    [-12.4, 6.5],
    [-7.2, 5.2],
  ])
    lantern(g, x, z);

  const seats: THREE.Object3D[] = [];
  for (const s of GARDEN_SEATS) {
    const isBench = s.places.length > 1;
    const obj = isBench ? bench() : lounge();
    obj.position.set(s.x, 0, s.z);
    obj.rotation.y = s.rotY;
    seatable(obj, s.id, isBench ? 1.5 : 1.1, interactables, s);
    g.colliders.push(isBench ? seatCollider(s, 1.7, 0.6, -0.08, 0.5) : seatCollider(s, 0.85, 1.25, -0.14, 0.5));
    group.add(obj);
    seats.push(obj);
  }
  const stone = soundStone(g, THINK_SPOT.x, THINK_SPOT.z);
  group.add(stone);

  // ---- Merge it all --------------------------------------------------------------------------------------
  const wind = { value: 0 };
  group.add(g.b.mesh(), g.fine.mesh(), g.v.build(wind), water);
  const glowMat = new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ff9f45', emissiveIntensity: 0.9, roughness: 0.35 });
  const glow = new THREE.Mesh(g.glowB.v.build(), glowMat);
  group.add(glow);
  const light = new THREE.PointLight('#ffb36b', 0, 9, 1.4);
  light.position.set(-10.6, 2.1, 8);
  group.add(light);

  return {
    group,
    colliders: g.colliders,
    interactables,
    pickables: [...seats, stone],
    soundStone: stone,
    setDark(dark) {
      glowMat.emissiveIntensity = 0.9 + 1.6 * dark;
      light.intensity = 0.15 + 1.9 * dark;
    },
    update(t, _dt, motion) {
      if (motion) wind.value = t;
    },
  };
}
