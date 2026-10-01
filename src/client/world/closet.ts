import * as THREE from 'three';
import { MAINTENANCE, MAINTENANCE_LAPTOP, MAINTENANCE_MODEL } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { mesh, roundedBox, textPlane, toon } from './toon';

// The maintenance closet (see MAINTENANCE in shared/layout.ts): a tiny room in the west wall where a
// window was, with the Maintenance agent at his counter (a kiosk, built with the other board agents'),
// a server rack, a pegboard of tools, a toolbox and a bench with a laptop to ask the office's source
// things on. Its walls take the floor's paint (looks) like the rest of the building's.

const INK = '#2b2d42';
const WALL_THICKNESS = 0.12;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** The laptop's screen: a terminal asking the small model. */
function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#10151f';
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#1f2a3d';
  g.fillRect(0, 0, 256, 20);
  g.font = '700 13px monospace';
  g.fillStyle = '#f08c00';
  g.fillText('🛠 office laptop', 8, 15);
  g.fillStyle = '#7ee787';
  g.fillText('$ ask office', 8, 44);
  g.fillStyle = '#c9d1d9';
  g.fillText(`model: ${MAINTENANCE_MODEL}`, 8, 64);
  g.fillText('> how do floors work?', 8, 92);
  g.fillStyle = '#7ee787';
  g.fillRect(8, 104, 9, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** An open laptop, its screen turned to -z, standing at the origin on whatever it's put on. */
function laptop(): THREE.Group {
  const g = new THREE.Group();
  const shell = toon('#c9ced6');
  g.add(mesh(roundedBox(0.4, 0.025, 0.28, 0.02), shell, 0, 0.0125, 0));
  g.add(mesh(box(0.34, 0.004, 0.16), toon('#4a4f5c'), 0, 0.027, -0.02, false));
  // The lid hinges at the back (+z) and lies over the base at rotation 0, so it's turned up and a
  // little past upright, its screen (on the underside) facing the person at the bench.
  const lid = new THREE.Group();
  lid.position.set(0, 0.03, 0.14);
  lid.rotation.x = Math.PI / 2 + 0.28;
  lid.add(mesh(roundedBox(0.4, 0.018, 0.27, 0.02), shell, 0, 0.009, -0.135));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.22), new THREE.MeshBasicMaterial({ map: screenTexture() }));
  screen.rotation.set(Math.PI / 2, 0, Math.PI);
  screen.position.set(0, -0.0005, -0.135);
  lid.add(screen);
  g.add(lid);
  return g;
}

/** A server rack facing +x: a dark cabinet of units, each with a row of LEDs. */
function rack(): THREE.Group {
  const R = MAINTENANCE.rack;
  const g = new THREE.Group();
  const frame = toon('#3d405b');
  g.add(mesh(roundedBox(R.depth, R.height, R.width, 0.03), frame, 0, R.height / 2, 0));
  const unit = toon('#5b6078');
  const leds = ['#06d6a0', '#ffd166', '#06d6a0', '#ef476f', '#06d6a0'];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const y = 0.22 + (i * (R.height - 0.5)) / (n - 1);
    g.add(mesh(box(0.04, 0.2, R.width - 0.1), unit, R.depth / 2 + 0.005, y, 0, false));
    for (let k = 0; k < 5; k++) {
      const c = leds[(i + k) % leds.length];
      g.add(mesh(box(0.02, 0.025, 0.04), toon(c, { emissive: c }), R.depth / 2 + 0.03, y + 0.05, -0.2 + k * 0.1, false));
    }
    g.add(mesh(box(0.02, 0.012, R.width - 0.3), toon('#1e2030'), R.depth / 2 + 0.03, y - 0.04, 0, false));
  }
  // Cables hanging out of the bottom unit.
  for (const [dz, c] of [
    [-0.15, '#ffd166'],
    [0, '#118ab2'],
    [0.14, '#ef476f'],
  ] as const) {
    const cable = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), toon(c), R.depth / 2 + 0.07, 0.1, dz, false);
    cable.rotation.z = 0.35;
    g.add(cable);
  }
  return g;
}

/** A pegboard with tools hung on it, facing +z (so it goes on the north wall; turn it for another). */
function pegboard(): THREE.Group {
  const g = new THREE.Group();
  const board = mesh(roundedBox(1.5, 0.04, 0.9, 0.04), toon('#c9a56a'), 0, 0, 0);
  board.rotation.x = Math.PI / 2;
  g.add(board);
  const steel = toon('#aab4be');
  const wrench = (x: number, y: number, rot: number, len: number) => {
    const w = new THREE.Group();
    w.add(mesh(box(0.035, len, 0.02), steel, 0, 0, 0, false));
    w.add(mesh(new THREE.TorusGeometry(0.035, 0.014, 6, 12, Math.PI * 1.5), steel, 0, len / 2, 0, false));
    w.position.set(x, y, 0.04);
    w.rotation.z = rot;
    g.add(w);
  };
  wrench(-0.55, 0.05, 0.1, 0.5);
  wrench(-0.4, 0.07, -0.08, 0.42);
  wrench(-0.25, 0.04, 0.05, 0.6);
  // Screwdrivers, and a hammer.
  for (const [x, c] of [
    [0.0, '#ef476f'],
    [0.1, '#ffd166'],
    [0.2, '#118ab2'],
  ] as const) {
    g.add(mesh(box(0.014, 0.16, 0.014), steel, x, -0.04, 0.04, false));
    g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), toon(c), x, 0.1, 0.04, false));
  }
  g.add(mesh(box(0.03, 0.3, 0.025), toon('#8d6e4a'), 0.5, 0, 0.04, false));
  g.add(mesh(box(0.14, 0.06, 0.04), toon('#555b6e'), 0.5, 0.17, 0.04, false));
  // A hose clamp and a roll of tape on pegs.
  g.add(mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 14), toon('#f08c00'), 0.3, -0.25, 0.04, false));
  return g;
}

/** A red toolbox, lid and handle. */
function toolbox(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.5, 0.22, 0.24, 0.03), toon('#e63946'), 0, 0.11, 0));
  g.add(mesh(roundedBox(0.52, 0.05, 0.26, 0.03), toon('#c1121f'), 0, 0.245, 0));
  const handle = mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 12, Math.PI), toon('#aab4be'), 0, 0.27, 0, false);
  g.add(handle);
  g.add(mesh(box(0.05, 0.03, 0.02), toon('#ffd166'), 0, 0.2, 0.125, false));
  return g;
}

/** Yellow and black hazard stripes across a threshold: `n` stripes along z over `len`. */
function hazard(len: number, depth: number): THREE.Group {
  const g = new THREE.Group();
  const n = 8;
  g.add(mesh(box(depth, 0.012, len), toon('#ffd166'), 0, 0.006, 0, false));
  for (let i = 0; i < n; i += 2) {
    const s = mesh(box(depth, 0.014, len / n), toon(INK), 0, 0.007, -len / 2 + ((i + 0.5) * len) / n, false);
    g.add(s);
  }
  return g;
}

export interface Closet {
  /** The laptop's interactable: E there asks the office's small model something. */
  laptop: Interactable;
}

/**
 * Builds the closet into `group`: its walls and ceiling (painted with `looks`), a doorway in the east
 * wall under a sign, and everything inside it but the agent's counter. Adds the colliders and the
 * laptop's interactable; `fixture` keeps wall decorations (cobwebs, lights) off its wall.
 */
export function buildMaintenanceCloset(
  group: THREE.Group,
  colliders: Collider[],
  interactables: Interactable[],
  looks: { wall: THREE.Material; trim: THREE.Material },
  fixture: (wall: 'west', u: number, y: number, w: number, h: number) => void,
): Closet {
  const M = MAINTENANCE;
  const T = WALL_THICKNESS;
  const H = M.height;
  const midZ = (M.minZ + M.maxZ) / 2;
  const walls = new THREE.Group();
  const wall = (minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number) => {
    walls.add(mesh(box(maxX - minX, y1 - y0, maxZ - minZ), looks.wall, (minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2));
  };
  // North and south walls.
  for (const z of [M.minZ, M.maxZ]) {
    wall(M.minX, M.maxX, z - T / 2, z + T / 2, 0, H);
    colliders.push({ minX: M.minX, maxX: M.maxX, minZ: z - T / 2, maxZ: z + T / 2, top: H });
    walls.add(mesh(box(M.maxX - M.minX, 0.2, T + 0.04), looks.trim, (M.minX + M.maxX) / 2, 0.1, z, false));
  }
  // The east wall, with the doorway in it and a header over that.
  const x = M.maxX;
  wall(x - T / 2, x + T / 2, M.minZ - T / 2, M.door.z0, 0, H);
  wall(x - T / 2, x + T / 2, M.door.z1, M.maxZ + T / 2, 0, H);
  wall(x - T / 2, x + T / 2, M.door.z0, M.door.z1, M.door.height, H);
  colliders.push({ minX: x - T / 2, maxX: x + T / 2, minZ: M.minZ - T / 2, maxZ: M.door.z0, top: H });
  colliders.push({ minX: x - T / 2, maxX: x + T / 2, minZ: M.door.z1, maxZ: M.maxZ + T / 2, top: H });
  // The door frame, in the trim's color.
  const frame = looks.trim;
  walls.add(mesh(box(T + 0.06, 0.08, M.door.z1 - M.door.z0 + 0.16), frame, x, M.door.height + 0.04, midZ, false));
  for (const z of [M.door.z0 - 0.04, M.door.z1 + 0.04]) walls.add(mesh(box(T + 0.06, M.door.height, 0.08), frame, x, M.door.height / 2, z, false));
  // A ceiling, so it's a closet and not a pen.
  walls.add(mesh(box(M.maxX - M.minX + T, 0.08, M.maxZ - M.minZ + T), toon('#e6dfd2'), (M.minX + M.maxX) / 2 + T / 2, H + 0.04, midZ));
  group.add(walls);
  fixture('west', midZ, H / 2 + 1, M.maxZ - M.minZ + 0.6, H + 2);

  // Over the door, on its outside: what it is.
  const sign = textPlane('🛠️ MAINTENANCE', { bg: '#f08c00', color: '#fffaf3', size: 48, border: INK });
  sign.scale.multiplyScalar(0.62);
  sign.position.set(x + T / 2 + 0.02, M.door.height + 0.3, midZ);
  sign.rotation.y = Math.PI / 2;
  group.add(sign);
  const hazardStripe = hazard(M.door.z1 - M.door.z0, 0.3);
  hazardStripe.position.set(x, 0, midZ);
  group.add(hazardStripe);

  // A lamp on the ceiling, lit.
  const lamp = toon('#fff3b0', { emissive: '#fff3b0' });
  group.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), lamp, (M.minX + M.maxX) / 2, H - 0.02, midZ, false));

  // The rack in the north-west corner, facing the door.
  const R = M.rack;
  const r = rack();
  r.position.set(R.x, 0, R.z);
  group.add(r);
  colliders.push({ minX: R.x - R.depth / 2, maxX: R.x + R.depth / 2, minZ: R.z - R.width / 2, maxZ: R.z + R.width / 2, top: R.height });

  // The pegboard on the north wall, with a status plate under it.
  const peg = pegboard();
  peg.position.set(-16.55, 1.5, M.minZ + T / 2 + 0.03);
  group.add(peg);
  const plate = textPlane('uptime 99.9%', { bg: '#10151f', color: '#7ee787', size: 34, border: '#3d405b' });
  plate.scale.multiplyScalar(0.55);
  plate.position.set(-15.4, 1.0, M.minZ + T / 2 + 0.02);
  plate.rotation.y = 0;
  group.add(plate);

  // The bench on the south wall, with the laptop on it, a mug and a cable spool.
  const B = M.bench;
  const bench = new THREE.Group();
  bench.add(mesh(roundedBox(B.width, 0.06, B.depth, 0.04), toon('#c98b5a'), 0, B.height - 0.03, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bench.add(mesh(box(0.06, B.height - 0.06, 0.06), toon('#3d405b'), sx * (B.width / 2 - 0.06), (B.height - 0.06) / 2, sz * (B.depth / 2 - 0.06), false));
  bench.add(mesh(box(B.width - 0.12, 0.05, 0.03), toon('#3d405b'), 0, B.height - 0.12, -B.depth / 2 + 0.06, false));
  const lt = laptop();
  lt.position.set(-0.1, B.height, 0);
  bench.add(lt);
  const mug = mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), toon('#118ab2'), 0.45, B.height + 0.045, -0.1, false);
  bench.add(mug);
  const spool = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14), toon('#ffd166'), -0.62, B.height + 0.04, 0.12, false);
  bench.add(spool);
  bench.position.set(B.x, 0, B.z);
  group.add(bench);
  colliders.push({ minX: B.x - B.width / 2, maxX: B.x + B.width / 2, minZ: B.z - B.depth / 2, maxZ: M.maxZ, top: B.height });

  // A toolbox on the floor in the south-east corner.
  const tb = toolbox();
  tb.position.set(M.maxX - 0.5, 0, M.maxZ - 0.35);
  tb.rotation.y = 0.2;
  group.add(tb);

  const laptopAt: Interactable = { kind: 'maintenance', x: MAINTENANCE_LAPTOP.x, z: MAINTENANCE_LAPTOP.z, radius: 1 };
  interactables.push(laptopAt);
  bench.userData.interact = laptopAt;
  return { laptop: laptopAt };
}
