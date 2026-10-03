import * as THREE from 'three';
import { CHESS_SEATS, CHESS_TABLES } from '../../../shared/chess-seats';
import type { SeatDef } from '../../../shared/layout';
import { canvasTexture } from '../../world/texture';
import type { Collider, Interactable } from '../../world/types';
import { mesh, roundedBox } from '../../world/toon';
import { ChessTableView, TABLE_H, TABLE_SIZE } from './board';

// The 'Merge Conflict' corner of the rooftop, where the DJ's stage was (see shared/chess-seats.ts): three
// chess tables on a rug, a chair either side of each, and a sign. The game on each table is
// ChessTableView's (board.ts); what's played on it is controller.ts's.

export interface ChessCorner {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** What looking or clicking can land on: the tables, with their men, and the chairs. */
  pickables: THREE.Object3D[];
  /** Each table's board and men, by table number - 1. */
  tables: ChessTableView[];
  /** Slides the men. (features/chess ticks this itself while you're up on the roof.) */
  update(t: number, dt: number): void;
}

const WALNUT = '#5a3a22';
const MAPLE = '#c99a5b';
const CUSHION = '#4f6f64';

const wood = (color: string, roughness = 0.5) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

/** A rug woven in a border and a lattice, in the deep green and gold of a games room. */
function rugTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 560, (g) => {
    g.fillStyle = '#2f453f';
    g.fillRect(0, 0, 1024, 560);
    g.strokeStyle = '#c9a96e';
    g.lineWidth = 10;
    g.strokeRect(26, 26, 972, 508);
    g.lineWidth = 3;
    g.strokeRect(54, 54, 916, 452);
    g.strokeStyle = 'rgba(201,169,110,0.22)';
    g.lineWidth = 2;
    for (let i = -10; i < 30; i++) {
      g.beginPath();
      g.moveTo(i * 56, 60);
      g.lineTo(i * 56 + 460, 500);
      g.moveTo(i * 56 + 460, 60);
      g.lineTo(i * 56, 500);
      g.stroke();
    }
    // Fringe.
    g.strokeStyle = '#e6d6ad';
    g.lineWidth = 3;
    for (let y = 8; y < 560; y += 12) {
      for (const [x0, x1] of [[0, 14], [1024, 1010]]) {
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x1, y);
        g.stroke();
      }
    }
  });
}

function signTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 300, (g) => {
    g.fillStyle = '#33241a';
    g.fillRect(0, 0, 1024, 300);
    g.strokeStyle = '#d9b97c';
    g.lineWidth = 6;
    g.strokeRect(14, 14, 996, 272);
    g.fillStyle = '#f1dfb8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 120px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText('♞ Merge Conflict', 512, 118);
    g.fillStyle = '#d9b97c';
    g.font = '700 50px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText('resolve it over a game of chess', 512, 214);
  });
}

/** A dining chair at the seat's spot, its back away from the table: you sit facing the way the seat does. */
function chair(seat: SeatDef): THREE.Group {
  const g = new THREE.Group();
  const frame = wood(MAPLE, 0.55);
  const cushion = wood(CUSHION, 0.85);
  g.add(mesh(roundedBox(0.44, 0.04, 0.42, 0.04), frame, 0, 0.43, 0));
  g.add(mesh(roundedBox(0.4, 0.035, 0.38, 0.05), cushion, 0, 0.4675, 0.005));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.036, 0.41, 0.036), frame, sx * 0.19, 0.205, sz * 0.18));
    // The back's posts, going on up from the rear legs.
    g.add(mesh(new THREE.BoxGeometry(0.036, 0.48, 0.036), frame, sx * 0.19, 0.66, -0.18));
  }
  g.add(mesh(roundedBox(0.42, 0.075, 0.03, 0.012), frame, 0, 0.9, -0.18));
  g.add(mesh(roundedBox(0.36, 0.2, 0.022, 0.02), cushion, 0, 0.72, -0.175));
  g.position.set(seat.x, seat.y, seat.z);
  g.rotation.y = seat.rotY;
  return g;
}

/** A table with a chess board in its top, at (x, z). */
function table(n: number, x: number, z: number): { root: THREE.Group; view: ChessTableView; collider: Collider } {
  const root = new THREE.Group();
  const walnut = wood(WALNUT, 0.45);
  root.add(mesh(roundedBox(TABLE_SIZE, 0.04, TABLE_SIZE, 0.035), walnut, 0, TABLE_H - 0.02, 0));
  const legAt = TABLE_SIZE / 2 - 0.07;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) root.add(mesh(new THREE.CylinderGeometry(0.026, 0.017, TABLE_H - 0.04, 14), walnut, sx * legAt, (TABLE_H - 0.04) / 2, sz * legAt));
    root.add(mesh(new THREE.BoxGeometry(0.022, 0.07, legAt * 2), walnut, sx * legAt, TABLE_H - 0.075, 0));
    root.add(mesh(new THREE.BoxGeometry(legAt * 2, 0.07, 0.022), walnut, 0, TABLE_H - 0.075, sx * legAt));
  }
  const view = new ChessTableView(n);
  root.add(view.group);
  root.position.set(x, 0, z);
  const half = TABLE_SIZE / 2;
  return { root, view, collider: { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, top: TABLE_H } };
}

let current: ChessCorner | null = null;
/** The corner as last built (there's only the one, on the roof). */
export const chessCorner = (): ChessCorner | null => current;

/**
 * The games corner: three tables, their chairs, a rug under them and a sign over them. Add its group,
 * colliders, interactables and pickables to the roof's (the chairs are `seat`s, the tables `chess`).
 */
export function buildChessCorner(): ChessCorner {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const pickables: THREE.Object3D[] = [];
  const tables: ChessTableView[] = [];

  const xs = CHESS_TABLES.map((t) => t.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = CHESS_TABLES[0].z;
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.95, metalness: 0 });
  rugMat.userData.outlineParameters = { visible: false };
  const rug = mesh(roundedBox(Math.max(...xs) - Math.min(...xs) + 3.6, 0.012, 4.5, 0.1), rugMat, cx, 0.006, cz, false);
  group.add(rug);

  for (const { n, x, z } of CHESS_TABLES) {
    const t = table(n, x, z);
    const it: Interactable = { kind: 'chess', x, y: 0, z, radius: 1.1, chessTable: n };
    t.root.userData.interact = it;
    group.add(t.root);
    interactables.push(it);
    pickables.push(t.root);
    colliders.push(t.collider);
    tables.push(t.view);
  }
  for (const seat of CHESS_SEATS) {
    const c = chair(seat);
    const it: Interactable = { kind: 'seat', seatId: seat.id, x: seat.x, y: seat.y, z: seat.z, radius: 1.1 };
    c.userData.interact = it;
    group.add(c);
    interactables.push(it);
    pickables.push(c);
    colliders.push({ minX: seat.x - 0.23, maxX: seat.x + 0.23, minZ: seat.z - 0.23, maxZ: seat.z + 0.23, top: 0.46 });
  }

  // The sign, on a post at the back of the rug, facing the tables.
  const signZ = cz - 2.55;
  const post = wood(WALNUT, 0.5);
  group.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.9, 10), post, cx, 0.95, signZ));
  group.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 14), post, cx, 0.02, signZ));
  const face = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6, metalness: 0 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.64, 0.05), [post, post, post, post, face, post]);
  board.position.set(cx, 1.55, signZ + 0.06);
  board.castShadow = true;
  group.add(board);
  colliders.push({ minX: cx - 0.1, maxX: cx + 0.1, minZ: signZ - 0.1, maxZ: signZ + 0.1, top: 99 });

  const corner: ChessCorner = { group, colliders, interactables, pickables, tables, update: (_t, dt) => tables.forEach((v) => v.update(dt)) };
  current = corner;
  return corner;
}
