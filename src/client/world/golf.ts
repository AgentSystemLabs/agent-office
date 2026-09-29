import * as THREE from 'three';
import { BALCONY, FLOOR, GOLF_HOLE, GOLF_TEE, ROAD, SLAB, STOREY, STREET_Y, WALL_HEIGHT, WALL_T } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { bulb, neighbourBoxes, streetLamp, tree, type NightParts } from './outside';
import { disposeSprite, mergeByMaterial, mesh, textPlane, textSprite, toon } from './toon';

// Golf off the balcony: the tee out there (a square of turf, a ball on a tee, a bag of clubs), the
// hole across the street it's hit at (a green with a flag on it, a fairway up to it, bunkers), and
// the balls on their way. A shot is only a heading, a loft and how hard it was hit; where it goes
// from there is worked out the same way on every screen (see fly), so everyone on the floor sees the
// same ball land in the same place.

/** A shot: its heading (0 is straight out, south, +z; it turns toward +x), how steeply it leaves the club, and how hard it's hit (0–1). */
export interface Shot {
  yaw: number;
  loft: number;
  power: number;
}

/** The lofts you can pick, in radians. Much under 30° and the ball won't clear the railing. */
export const LOFT_MIN = THREE.MathUtils.degToRad(20);
export const LOFT_MAX = THREE.MathUtils.degToRad(60);
/** How far either side of straight out you can aim. */
export const AIM_MAX = 1.2;
/** How fast the ball leaves the club at full power, in m/s. */
const SPEED = 30;
/** The ball's radius. A real one's is 2.1 cm; this one's bigger, so it can be seen from the tee. */
export const BALL_R = 0.05;
/** The turf mat, and the tee on it. */
const MAT_H = 0.03;
const TEE_H = 0.015;
/** The ball on the tee, ready to hit. */
export const TEE_BALL = new THREE.Vector3(GOLF_TEE.ball.x, MAT_H + TEE_H + BALL_R, GOLF_TEE.ball.z);
/** The golfer stands this far from the ball, square to the line. */
export const STANCE = 0.57;

/** Where the golfer stands for a shot heading `yaw`, and which way they face: across the line, with the hole on their left. */
export function stance(yaw: number): { x: number; z: number; facing: number } {
  return { x: GOLF_TEE.ball.x + Math.cos(yaw) * STANCE, z: GOLF_TEE.ball.z - Math.sin(yaw) * STANCE, facing: yaw - Math.PI / 2 };
}

/** Which way from the tee the pin is. */
export const PIN_YAW = Math.atan2(GOLF_HOLE.x - GOLF_TEE.ball.x, GOLF_HOLE.z - GOLF_TEE.ball.z);
/** From the tee to the pin, along the ground. */
export const PIN_DISTANCE = Math.hypot(GOLF_HOLE.x - GOLF_TEE.ball.x, GOLF_HOLE.z - GOLF_TEE.ball.z);

// ---- The course -------------------------------------------------------------------------------------

/** The green's collar of longer grass. */
const FRINGE = 0.7;
/** The fairway starts past the far sidewalk. */
const FAIRWAY_Z0 = ROAD.maxZ + 2.5;
/** Sand traps round the green: [x, z, radius]. The first two make one kidney-shaped trap in front. */
const BUNKERS: [number, number, number][] = [
  [GOLF_HOLE.x - 5.4, GOLF_HOLE.z - 4.4, 1.7],
  [GOLF_HOLE.x - 3.7, GOLF_HOLE.z - 5.7, 1.25],
  [GOLF_HOLE.x + 5.6, GOLF_HOLE.z + 3.2, 1.6],
];
/** How far from the pin a ball drops in: rolling in slower than CUP_SPEED, or landing straight in. */
const CUP = 0.12;
const CUP_SPEED = 1.8;
/** The flagstick, taller than a real one so it shows up from the balcony. */
const STICK = 3.4;

/** What a ball can come down on. `below` is a balcony further down the building. */
export type Lie = 'green' | 'fringe' | 'fairway' | 'rough' | 'sand' | 'road' | 'deck' | 'roof' | 'below';

/** How each surface takes a ball: how much of its fall it bounces back up, how much speed along it keeps on a bounce, and how fast it slows a rolling ball (m/s²). */
const GROUND: Record<Lie, { bounce: number; keep: number; roll: number }> = {
  green: { bounce: 0.28, keep: 0.45, roll: 2.5 },
  fringe: { bounce: 0.28, keep: 0.45, roll: 3.2 },
  fairway: { bounce: 0.32, keep: 0.55, roll: 2.4 },
  rough: { bounce: 0.22, keep: 0.35, roll: 5.5 },
  sand: { bounce: 0.04, keep: 0.1, roll: 20 },
  road: { bounce: 0.5, keep: 0.8, roll: 1.1 },
  deck: { bounce: 0.42, keep: 0.7, roll: 1.8 },
  roof: { bounce: 0.42, keep: 0.7, roll: 1.8 },
  below: { bounce: 0, keep: 0, roll: 99 },
};

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/** What's underfoot at (x, z) down on the street. */
function lieAt(x: number, z: number): Lie {
  for (const [bx, bz, r] of BUNKERS) if (Math.hypot(x - bx, z - bz) < r) return 'sand';
  const d = Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z);
  if (d < GOLF_HOLE.green) return 'green';
  if (d < GOLF_HOLE.green + FRINGE) return 'fringe';
  if (x > GOLF_HOLE.fairway[0] && x < GOLF_HOLE.fairway[1] && z > FAIRWAY_Z0 && z < GOLF_HOLE.z) return 'fairway';
  // The road and its sidewalks, the lot out front, the one beside the building, and the garage under it.
  if (z > ROAD.minZ - 2 && z < ROAD.maxZ + 2) return 'road';
  if (Math.abs(x) < 30 && z > B.minZ && z < ROAD.minZ - 2) return 'road';
  if (x > B.maxX && x < B.maxX + 12 && z > B.minZ - 2 && z < B.maxZ + 4) return 'road';
  return 'rough';
}

/** A square of green stripes, mown two ways, for the fairway and the tee's mat. */
function mownTexture(light: string, dark: string, stripes: number, border?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? dark : light;
    g.fillRect(0, (i * 128) / stripes, 128, 128 / stripes + 1);
  }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.strokeRect(5, 5, 118, 118);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function flat(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = mesh(geo.rotateX(-Math.PI / 2), mat, x, y, z, false);
  return m;
}

export interface Tee {
  /** The ball waiting on the tee; hidden from the moment it's hit until the next one's teed up. */
  ball: THREE.Mesh;
}

/**
 * The tee on the balcony: a square of turf, a ball on a tee, a pair of tee markers along its front,
 * and a golf bag leaning on the wall behind it.
 */
export function buildTee(group: THREE.Group, colliders: Collider[], interactables: Interactable[]): Tee {
  const { x, z, size } = GOLF_TEE;
  const it: Interactable = { kind: 'golf', x, z, radius: 1.5 };
  interactables.push(it);
  const mat = new THREE.Mesh(new THREE.BoxGeometry(size, MAT_H, size), [
    toon('#3f8f45'),
    toon('#3f8f45'),
    new THREE.MeshToonMaterial({ map: mownTexture('#7ed957', '#6cc24a', 6, '#fffaf3'), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }),
    toon('#3f8f45'),
    toon('#3f8f45'),
    toon('#3f8f45'),
  ]);
  mat.position.set(x, MAT_H / 2, z);
  mat.receiveShadow = true;
  mat.userData.interact = it;
  group.add(mat);

  const parts = new THREE.Group();
  const { ball: b } = GOLF_TEE;
  parts.add(mesh(new THREE.CylinderGeometry(0.012, 0.006, TEE_H + 0.02, 8), toon('#ffd166'), b.x, MAT_H + (TEE_H + 0.02) / 2 - 0.01, b.z, false));
  // Tee markers: a red ball either side, a little in front of the ball.
  for (const s of [-1, 1]) parts.add(mesh(new THREE.SphereGeometry(0.06, 12, 8), toon('#ef476f'), b.x + s * 0.55, MAT_H + 0.05, z + size / 2 - 0.12));
  // The bag: leaning back on the wall, three clubs sticking out of the top.
  const bag = new THREE.Group();
  bag.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.85, 14), toon('#1d3557'), 0, 0.43, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.1, 14), toon('#ef476f'), 0, 0.62, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 14), toon('#fffaf3'), 0, 0.86, 0));
  for (const [cx, cz, tilt] of [
    [-0.06, 0.04, -0.12],
    [0.05, 0.05, 0.1],
    [0, -0.06, 0.02],
  ]) {
    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), toon('#adb5bd'), 0, 0.25, 0, false));
    club.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon('#8d99ae'), 0.03, 0.52, 0));
    club.position.set(cx, 0.8, cz);
    club.rotation.z = tilt;
    bag.add(club);
  }
  bag.rotation.x = -0.14;
  bag.position.set(GOLF_TEE.bag.x, 0, GOLF_TEE.bag.z);
  parts.add(bag);
  colliders.push({ minX: GOLF_TEE.bag.x - 0.2, maxX: GOLF_TEE.bag.x + 0.2, minZ: BALCONY.minZ, maxZ: GOLF_TEE.bag.z + 0.2, top: 1 });
  const merged = mergeByMaterial(parts);
  for (const m of merged.children) m.userData.interact = it;
  group.add(merged);

  const ball = golfBall();
  ball.position.copy(TEE_BALL);
  ball.userData.interact = it;
  group.add(ball);
  return { ball };
}

export function golfBall(): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(BALL_R, 14, 10), toon('#ffffff'), 0, 0, 0, false);
}

export interface Green {
  /** The flag, which flaps in the wind. */
  update(t: number): void;
}

/**
 * The hole across the street, in `ground` (with its colliders): a mown fairway from the far sidewalk
 * up to a round green with the cup and the flag in it, bunkers either side, trees behind, a lamp
 * that lights it at night, and a sign.
 */
export function buildGreen(ground: THREE.Group, colliders: Collider[], night: NightParts): Green {
  const G = STREET_Y;
  const { x: px, z: pz } = GOLF_HOLE;
  const [fx0, fx1] = GOLF_HOLE.fairway;
  const fairLen = pz - FAIRWAY_Z0;
  const fairTex = mownTexture('#8fd16f', '#7fc463', 2);
  fairTex.wrapT = THREE.RepeatWrapping;
  fairTex.repeat.set(1, fairLen / 4);
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const fairway = flat(new THREE.PlaneGeometry(fx1 - fx0, fairLen), new THREE.MeshToonMaterial({ map: fairTex, gradientMap: gradient }), (fx0 + fx1) / 2, G + 0.004, FAIRWAY_Z0 + fairLen / 2);
  fairway.receiveShadow = true;
  ground.add(fairway);

  const parts = new THREE.Group();
  parts.add(flat(new THREE.CircleGeometry(GOLF_HOLE.green + FRINGE, 48), toon('#6cc24a'), px, G + 0.008, pz));
  parts.add(flat(new THREE.CircleGeometry(GOLF_HOLE.green, 48), toon('#9be07a'), px, G + 0.012, pz));
  for (const [bx, bz, r] of BUNKERS) {
    parts.add(flat(new THREE.CircleGeometry(r + 0.12, 32), toon('#d9c48a'), bx, G + 0.016, bz));
    parts.add(flat(new THREE.CircleGeometry(r, 32), toon('#f3e3b3'), bx, G + 0.02, bz));
  }
  // The cup (bigger than a real one, like the ball) with a white rim.
  parts.add(flat(new THREE.CircleGeometry(0.17, 20), toon('#fffaf3'), px, G + 0.016, pz));
  parts.add(flat(new THREE.CircleGeometry(0.13, 20), toon('#1d1d1d'), px, G + 0.02, pz));
  parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, STICK, 8), toon('#fffaf3'), px, G + STICK / 2, pz));
  parts.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#ffd166'), px, G + STICK + 0.03, pz));
  // Trees round the back of the green.
  for (const [tx, tz, s] of [
    [px - 9, pz + 7, 1.2],
    [px + 8.5, pz + 8, 1.05],
    [px - 1, pz + 12, 1.3],
    [px + 11, pz - 3, 0.95],
  ]) {
    const t = tree(s);
    t.position.set(tx, G, tz);
    parts.add(t);
    colliders.push({ minX: tx - 0.3 * s, maxX: tx + 0.3 * s, minZ: tz - 0.3 * s, maxZ: tz + 0.3 * s, bottom: G, top: G + 2.2 * s });
  }
  // A street lamp behind the green, reaching out over it, so the hole's there to aim at after dark.
  streetLamp(parts, night, bulb(night, '#fff3d6'), colliders, px + 1.5, pz + 6.8, -1);
  // A sign where the fairway starts, facing the office: which hole it is.
  const sx = fx1 + 1.8;
  const sz = FAIRWAY_Z0 + 0.6;
  for (const dx of [-1.1, 1.1]) {
    parts.add(mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), toon('#8a5a3b'), sx + dx, G + 0.75, sz));
    colliders.push({ minX: sx + dx - 0.08, maxX: sx + dx + 0.08, minZ: sz - 0.08, maxZ: sz + 0.08, bottom: G, top: G + 1.5 });
  }
  ground.add(mergeByMaterial(parts));
  const sign = textPlane('⛳ Hole 1 · Par 1', { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
  sign.position.set(sx, G + 1.5, sz - 0.07);
  sign.rotation.y = Math.PI;
  ground.add(sign);
  colliders.push({ minX: px - 0.05, maxX: px + 0.05, minZ: pz - 0.05, maxZ: pz + 0.05, bottom: G, top: G + STICK });

  // The flag: a red pennant off the top of the stick, rippling.
  const flagGeo = new THREE.PlaneGeometry(1.2, 0.75, 8, 1);
  flagGeo.translate(0.6, 0, 0);
  const rest = Float32Array.from(flagGeo.getAttribute('position').array);
  const flag = mesh(flagGeo, new THREE.MeshToonMaterial({ color: '#ef476f', side: THREE.DoubleSide, gradientMap: gradient }), px + 0.03, G + STICK - 0.42, pz, false);
  ground.add(flag);
  return {
    update(t: number) {
      const pos = flagGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = rest[i * 3];
        // Pinned at the stick, flapping more toward its tail, and swinging round a little in the wind.
        pos.setZ(i, Math.sin(t * 5 - u * 4) * 0.12 * u);
        pos.setY(i, rest[i * 3 + 1] - u * u * 0.06);
      }
      pos.needsUpdate = true;
      flagGeo.computeVertexNormals();
      flag.rotation.y = -0.5 + Math.sin(t * 0.7) * 0.25;
    },
  };
}

// ---- A ball on its way ------------------------------------------------------------------------------

/** Steps a second the flight's worked out in, and every how many of them the path keeps a point (60 a second). */
const STEPS = 240;
const KEEP = 4;
const GRAVITY = 9.81;
/** Air slows it a little. */
const DRAG = 0.05;
/** Coming down slower than this, it stops bouncing and rolls. */
const ROLL_V = 1.2;
/** Longest a ball's followed. */
const MAX_SECONDS = 25;
/** The top of the balcony's railing, and the balcony inside it that a ball rattles round (its center, at least). */
const RAIL_TOP = 1.11;
const INSIDE = { minX: BALCONY.minX + 0.12 + BALL_R, maxX: BALCONY.maxX - 0.12 - BALL_R, minZ: BALCONY.minZ + BALL_R, maxZ: BALCONY.maxZ - 0.12 - BALL_R };

export interface Hit {
  /** Seconds after the shot. */
  t: number;
  kind: 'bounce' | 'rail' | 'wall' | 'cup';
  at: THREE.Vector3;
  /** How hard, in m/s. */
  speed: number;
  lie?: Lie;
}

export interface Flight {
  shot: Shot;
  /** Where the ball is, every 1/60 s from the moment it's hit: x, y, z. */
  path: Float32Array;
  hits: Hit[];
  /** From the hit until it stops. */
  seconds: number;
  rest: THREE.Vector3;
  holed: boolean;
  /** What it stopped on; `lost` is off out of the world. */
  lie: Lie | 'lost';
  /** How far from the pin it stopped, or NaN if it isn't down on the street. */
  fromPin: number;
}

/**
 * Where a shot goes, from the tee on a floor `index` up the building (the street is `street` below
 * it): up off the tee, over the railing (or off it), down onto the street, a roof or a balcony
 * further down, bouncing and rolling to a stop, or into the cup. The same shot always goes the same
 * way, so the one number sent round is enough for everyone to see it.
 */
export function fly(shot: Shot, street: number, index: number): Flight {
  const power = THREE.MathUtils.clamp(shot.power, 0, 1);
  const loft = THREE.MathUtils.clamp(shot.loft, LOFT_MIN, LOFT_MAX);
  const yaw = THREE.MathUtils.clamp(shot.yaw, -AIM_MAX, AIM_MAX);
  const v = SPEED * power;
  let x = TEE_BALL.x;
  let y = TEE_BALL.y;
  let z = TEE_BALL.z;
  let vx = v * Math.cos(loft) * Math.sin(yaw);
  let vy = v * Math.sin(loft);
  let vz = v * Math.cos(loft) * Math.cos(yaw);
  const dt = 1 / STEPS;
  const path: number[] = [x, y, z];
  const hits: Hit[] = [];
  // The neighbours stand on the street; the building's floors above its garage stand in the way too.
  const boxes = [
    ...neighbourBoxes().map((n) => ({ ...n, bottom: street, top: street + n.top, roof: true })),
    { ...B, bottom: street - STREET_Y - SLAB, top: Infinity, roof: false },
  ];
  let rolling = false;
  let holed = false;
  let lie: Lie | 'lost' = 'rough';
  let step = 0;
  const hit = (kind: Hit['kind'], speed: number, at?: Lie) => hits.push({ t: step * dt, kind, at: new THREE.Vector3(x, y, z), speed, lie: at });

  /** What's under the ball at (x, z), coming down from `from`: the ground, a neighbour's roof, or a balcony. */
  const under = (px: number, pz: number, from: number): [number, Lie] => {
    if (px > BALCONY.minX && px < BALCONY.maxX && pz > BALCONY.minZ && pz < BALCONY.maxZ) {
      // This floor's balcony, or one further down the building.
      for (let k = 0; k <= index; k++) {
        const deck = -k * STOREY;
        if (from > deck - 0.1) return [deck, k ? 'below' : 'deck'];
      }
    }
    for (const b of boxes) if (b.roof && px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ && from > b.top - 0.1) return [b.top, 'roof'];
    return [street, lieAt(px, pz)];
  };

  for (; step < MAX_SECONDS * STEPS; step++) {
    if (!rolling) {
      vy -= GRAVITY * dt;
      const k = 1 - DRAG * dt;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    let nx = x + vx * dt;
    let ny = y + vy * dt;
    let nz = z + vz * dt;

    // Round the balcony: the railing on three sides, as high as its top, and the wall behind.
    if (x > INSIDE.minX - 0.01 && x < INSIDE.maxX + 0.01 && z > INSIDE.minZ - 0.01 && z < INSIDE.maxZ + 0.01 && y > -0.2 && y < WALL_HEIGHT) {
      if (ny < RAIL_TOP + BALL_R) {
        if (nz > INSIDE.maxZ) {
          nz = INSIDE.maxZ;
          hit('rail', Math.abs(vz));
          vz = -vz * 0.35;
          vx *= 0.8;
        }
        if (nx < INSIDE.minX || nx > INSIDE.maxX) {
          nx = THREE.MathUtils.clamp(nx, INSIDE.minX, INSIDE.maxX);
          hit('rail', Math.abs(vx));
          vx = -vx * 0.35;
          vz *= 0.8;
        }
      }
      if (nz < INSIDE.minZ) {
        nz = INSIDE.minZ;
        hit('wall', Math.abs(vz));
        vz = -vz * 0.3;
        vx *= 0.8;
      }
    }
    // Off the side of a building.
    for (const b of boxes) {
      if (nx <= b.minX || nx >= b.maxX || nz <= b.minZ || nz >= b.maxZ || ny >= b.top || ny <= b.bottom) continue;
      if (y >= b.top) continue; // onto its roof: that's the ground, below
      if (x <= b.minX || x >= b.maxX) {
        nx = x <= b.minX ? b.minX : b.maxX;
        hit('wall', Math.abs(vx));
        vx = -vx * 0.35;
        vz *= 0.7;
      } else {
        nz = z <= b.minZ ? b.minZ : b.maxZ;
        hit('wall', Math.abs(vz));
        vz = -vz * 0.35;
        vx *= 0.7;
      }
    }

    const [floor, on] = under(nx, nz, y - BALL_R);
    x = nx;
    y = ny;
    z = nz;
    if (y - BALL_R <= floor) {
      y = floor + BALL_R;
      lie = on;
      if (on === 'below') {
        // Onto a balcony further down: it's not coming back from there.
        hit('bounce', -vy, on);
        break;
      }
      const g = GROUND[on];
      const pin = Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z);
      if (-vy > ROLL_V) {
        // Straight into the cup.
        if (on === 'green' && pin < CUP) {
          holed = true;
          break;
        }
        hit('bounce', -vy, on);
        vy = -vy * g.bounce;
        vx *= g.keep;
        vz *= g.keep;
        rolling = false;
      } else {
        vy = 0;
        rolling = true;
        const speed = Math.hypot(vx, vz);
        if (on === 'green' && pin < CUP && speed < CUP_SPEED) {
          holed = true;
          break;
        }
        const slow = g.roll * dt;
        if (speed <= slow) break;
        vx *= (speed - slow) / speed;
        vz *= (speed - slow) / speed;
      }
    } else if (rolling && y - BALL_R > floor + 0.01) rolling = false; // off an edge
    if (Math.abs(x) > 190 || Math.abs(z) > 190 || y < street - 1) {
      lie = 'lost';
      break;
    }
    if ((step + 1) % KEEP === 0) path.push(x, y, z);
  }
  if (holed) {
    // Down into the cup.
    x = GOLF_HOLE.x;
    z = GOLF_HOLE.z;
    y = street + BALL_R - 0.12;
    lie = 'green';
    hit('cup', 0, 'green');
  }
  path.push(x, y, z);
  const down = lie !== 'lost' && lie !== 'deck' && lie !== 'roof' && lie !== 'below';
  return {
    shot: { yaw, loft, power },
    path: Float32Array.from(path),
    hits,
    seconds: (path.length / 3 - 1) / (STEPS / KEEP),
    rest: new THREE.Vector3(x, y, z),
    holed,
    lie,
    fromPin: holed ? 0 : down ? Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z) : NaN,
  };
}

/** A distance to the pin, as it's read out: "40 cm", "3.4 m", "27 m". */
export function pinText(m: number): string {
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}

/** Where a ball stopped, in words. */
export function lieText(f: Flight): string {
  if (f.holed) return 'In the hole!';
  switch (f.lie) {
    case 'lost':
      return 'Lost';
    case 'deck':
      return "Didn't clear the railing";
    case 'below':
      return 'Onto the balcony below';
    case 'roof':
      return 'On the roof';
    case 'sand':
      return `In the bunker · ${pinText(f.fromPin)}`;
    case 'green':
      return `On the green · ${pinText(f.fromPin)}`;
    default:
      return `${pinText(f.fromPin)} from the pin`;
  }
}

interface Flying {
  flight: Flight;
  /** Seconds since the hit. */
  t: number;
  ball: THREE.Mesh;
  trail: THREE.Line;
  /** The next of `flight.hits` still to happen. */
  next: number;
  who: string;
  mine: boolean;
  /** Seconds since it stopped, or -1 while it's still going. */
  still: number;
  label: THREE.Sprite | null;
}

/** How long a stopped ball stays lying there, and its label over it, in seconds. */
const LIE_SECONDS = 90;
const LABEL_SECONDS = 14;
/** At most this many balls lying about: the oldest go first. */
const MAX_BALLS = 12;

/** The balls in the air or lying where they stopped, everyone's, played back along their flights. */
export class GolfBalls {
  readonly group = new THREE.Group();
  private balls: Flying[] = [];
  /** It hit something: `mine` if it's your ball. */
  onHit: ((hit: Hit, mine: boolean) => void) | null = null;
  /** It stopped (or went in). */
  onRest: ((flight: Flight, who: string, mine: boolean) => void) | null = null;

  /** Sends a ball off along `flight`, hit by `who`. */
  launch(flight: Flight, who: string, mine: boolean): void {
    const ball = golfBall();
    ball.position.set(flight.path[0], flight.path[1], flight.path[2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(flight.path, 3));
    geo.setDrawRange(0, 1);
    const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: mine ? '#ffd166' : '#fffaf3', transparent: true, opacity: 0.85 }));
    trail.frustumCulled = false;
    this.group.add(ball, trail);
    this.balls.push({ flight, t: 0, ball, trail, next: 0, who, mine, still: -1, label: null });
    while (this.balls.length > MAX_BALLS) this.drop(this.balls[0]);
  }

  /** Your ball still on its way (or just stopped), for the camera to follow. */
  get mine(): { at: THREE.Vector3; flight: Flight; still: number } | null {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.mine) return { at: b.ball.position, flight: b.flight, still: b.still };
    }
    return null;
  }

  update(dt: number): void {
    for (const b of [...this.balls]) {
      const f = b.flight;
      if (b.still < 0) {
        b.t = Math.min(b.t + dt, f.seconds);
        const i = b.t * (STEPS / KEEP);
        const i0 = Math.min(Math.floor(i), f.path.length / 3 - 1);
        const i1 = Math.min(i0 + 1, f.path.length / 3 - 1);
        const k = i - i0;
        const p = f.path;
        b.ball.position.set(p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k, p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k, p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k);
        b.trail.geometry.setDrawRange(0, i1 + 1);
        while (b.next < f.hits.length && f.hits[b.next].t <= b.t) this.onHit?.(f.hits[b.next++], b.mine);
        if (b.t >= f.seconds) {
          b.still = 0;
          // In the cup, it's out of sight.
          b.ball.visible = !f.holed;
          const text = `${b.mine ? '' : `${b.who} · `}${f.holed ? '⛳ ' : ''}${lieText(f)}`;
          b.label = textSprite(text, { bg: f.holed ? '#ffd166' : '#2b2d42', color: f.holed ? '#2b2d42' : '#fffaf3', size: 44, border: '#fffaf3' });
          b.label.position.copy(f.rest).add(new THREE.Vector3(0, f.holed ? 1.2 : 0.7, 0));
          this.group.add(b.label);
          this.onRest?.(f, b.who, b.mine);
        }
        continue;
      }
      b.still += dt;
      // The trail fades once it's down, then the label, and in the end the ball's picked up.
      const trail = b.trail.material as THREE.LineBasicMaterial;
      trail.opacity = Math.max(0, 0.85 - b.still * 0.5);
      b.trail.visible = trail.opacity > 0;
      if (b.label) {
        b.label.material.opacity = THREE.MathUtils.clamp(LABEL_SECONDS - b.still, 0, 1);
        if (b.still > LABEL_SECONDS) {
          this.group.remove(b.label);
          disposeSprite(b.label);
          b.label = null;
        }
      }
      if (b.still > LIE_SECONDS) this.drop(b);
    }
  }

  /** Every ball, gone: off to another floor. */
  clear(): void {
    for (const b of [...this.balls]) this.drop(b);
  }

  private drop(b: Flying) {
    this.balls = this.balls.filter((o) => o !== b);
    this.group.remove(b.ball, b.trail);
    b.ball.geometry.dispose();
    b.trail.geometry.dispose();
    (b.trail.material as THREE.Material).dispose();
    if (b.label) {
      this.group.remove(b.label);
      disposeSprite(b.label);
    }
  }
}
