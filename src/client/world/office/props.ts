import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../toon';
import { palette, piece } from '../models';
import { PALETTE } from './materials';

// The office's furnishings: the potted plants, the desks' knick-knacks and the lounge's furniture (all
// modelled in Blender), the pendant lamps and the framed boards on the walls. The lab (lab/props.ts), the
// holidays and the castle use some of them too.

// The potted plants are modelled in Blender (blender/scripts/build_plants.py): each plant is a painted
// copy of one species in plants.glb (see piece()). A species is its pot, named after it, with everything that
// grows out of the pot hung under it as `<species>_leaves` (see plantLeaves()). The colors are the old
// code-built plants' pot and greens, the Christmas tree's trunk brown for the soil, the street trees'
// trunk brown for the ficus's, and the kitchen cupboards' blue for the snake plant's glazed pot.
export type PlantSpecies = 'monstera' | 'snake_plant' | 'ficus' | 'succulent';
/** The species that stand on the floor, which a row of plants takes turns with (see floorPlant()). */
export const FLOOR_PLANTS = ['monstera', 'snake_plant', 'ficus'] as const satisfies readonly PlantSpecies[];
const PLANT_COLORS = { Pot: PALETTE.pot, Glaze: '#8ecae6', Soil: '#6b4226', Bark: '#8a5a3b', Leaf: PALETTE.plant, LeafDark: PALETTE.plantDark };
const paintPlant = palette(PLANT_COLORS);

/**
 * A potted plant of `species`, `scale` times its modelled size, its origin on the floor in the middle of
 * its pot. At scale 1 a floor species' pot is the old one's size (0.28 round at the top, 0.5 tall, its
 * soil at 0.45), so colliders of 0.3 * scale still fit it; the succulent is desk-sized as it is. If the
 * model didn't load, an empty group: the office opens without it.
 */
export function plant(species: PlantSpecies, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('plants', species, paintPlant));
  g.scale.setScalar(scale);
  return g;
}

/** The floor species for the `i`th of a row of plants: they take turns, so no two neighbours match. */
export function floorPlant(i: number): PlantSpecies {
  return FLOOR_PLANTS[i % FLOOR_PLANTS.length];
}

/**
 * A plant's leaves, and whatever else grows out of its pot (stalks, a trunk): everything but the pot and
 * its soil. Christmas hides them and stands a little tree in the pot instead (world/holiday.ts). None if
 * the model didn't load.
 */
export function plantLeaves(potted: THREE.Object3D): THREE.Object3D[] {
  const leaves: THREE.Object3D[] = [];
  potted.traverse((o) => {
    if (o.name.endsWith('_leaves')) leaves.push(o);
  });
  return leaves;
}

// The desks' knick-knacks are modelled in Blender (blender/scripts/build_desk_props.py): a mug of coffee,
// and books in a few arrangements, each a piece of desk_props.glb (see piece()). The colors are the old
// code-built books' covers, features/bookshelf/book.ts's page edges and the coffee in a worker's mug (coffeeMug() in
// character/props.ts); the mug itself is painted whatever color it's given.
const DESK_PROP_COLORS = { CoverRed: '#e63946', CoverBlue: '#457b9d', CoverOrange: '#f4a261', Pages: '#f3ead8', Coffee: '#6f4518' };
const paintDeskProp = palette(DESK_PROP_COLORS);
/** The arrangements of books, which the desks with books take turns with (see deskBooks()). */
export const DESK_BOOKS = ['books_upright', 'books_leaning', 'books_stack'] as const;

/**
 * A mug of coffee, its body `color`, its origin on the desk under the middle of its body and its handle out
 * to +x. The body is the old code-built mug's size (0.06 round at the top, 0.12 tall). If the model didn't
 * load, an empty group.
 */
export function deskMug(color: string): THREE.Object3D {
  const body = toon(color);
  return piece('desk_props', 'mug', (name) => (name === 'Mug' ? body : paintDeskProp(name)));
}

/**
 * The `i`th arrangement of books (they take turns, see DESK_BOOKS), spines to +z, its origin on the desk in
 * the middle of its footprint, which is at most the old code-built books' 0.26 by 0.18, and 0.24 tall. If
 * the model didn't load, an empty group.
 */
export function deskBooks(i: number): THREE.Object3D {
  return piece('desk_props', DESK_BOOKS[i % DESK_BOOKS.length], paintDeskProp);
}

// The lounge's furniture is modelled in Blender (blender/scripts/build_lounge.py): the sofa, a throw pillow, a
// floor pouf and the coffee table, each a piece of lounge.glb placed on its own (see piece()), so they can be
// moved round one by one. Sofa is the old couch's blue, Wood and Frame the old coffee table's top and pedestal,
// and WoodDark the sofa's feet (the desk furniture's darker wood). A pillow's or a pouf's Cloth is each copy's
// own color, so it has none here: a copy that forgets its color comes out magenta.
const LOUNGE_COLORS = { Sofa: '#5b8def', WoodDark: '#8a5a3b', Wood: PALETTE.wood, Frame: PALETTE.deskLeg };
const paintLounge = palette(LOUNGE_COLORS);

/** A pillow or a pouf, its Cloth in `color`. */
function upholstered(part: 'pillow' | 'pouf', color: string): THREE.Object3D {
  const cloth = toon(color);
  return piece('lounge', part, (name) => (name === 'Cloth' ? cloth : paintLounge(name)));
}

/**
 * The lounge's couch: the sofa, facing +z like every model, with a throw pillow leaning on its back cushions
 * either side of its middle, halfway between its places (SEATING's couch, 1.2 apart), clear of whoever sits
 * there. Its origin is on the floor under its middle, it's 4.2 long across x and 1.0 deep, and its seat
 * cushions' tops are 0.47 up. The pillows hang under it, so a click on one is a click on the couch.
 */
export function loungeCouch(): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('lounge', 'sofa', paintLounge));
  for (const [x, color] of [
    [0.6, '#ffd166'],
    [-0.6, '#ef476f'],
  ] as const) {
    const pillow = upholstered('pillow', color);
    // Standing on the seat, sunk in a little, its top tipped back onto the back cushions.
    pillow.position.set(x, 0.46, -0.08);
    pillow.rotation.x = -0.15;
    g.add(pillow);
  }
  return g;
}

/** A floor pouf in `color`, about 1.05 round and 0.4 tall, its origin on the floor under its middle. */
export function pouf(color: string): THREE.Object3D {
  return upholstered('pouf', color);
}

/** The lounge's round coffee table, 0.9 round, its top 0.46 up (where the holiday pumpkin stands). */
export function coffeeTable(): THREE.Object3D {
  return piece('lounge', 'coffee_table', paintLounge);
}

// The chess corner behind the couch is code-built (toon/roundedBox like the pendants and wall
// boards above), its board in modern contrasting colors: deep teal and sea foam in an ink frame.

/** A modern side table for the chess board: a white square top on a dark pedestal, its top 0.75 up. */
export function chessTable(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(1.1, 0.06, 1.1, 0.05), toon('#f8fafc'), 0, 0.72, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.66, 12), toon('#1e293b'), 0, 0.39, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 20), toon('#1e293b'), 0, 0.025, 0));
  return g;
}

/**
 * A modern molded chair in `color`, facing +z (its backrest behind it at -z), its origin on the
 * floor under its middle. The seat's top is 0.49 up, where a chess sitter's hips (SEATING, 0.5) go.
 */
export function chessChair(color: string): THREE.Group {
  const g = new THREE.Group();
  const shell = toon(color);
  g.add(mesh(roundedBox(0.55, 0.08, 0.5, 0.09), shell, 0, 0.45, 0));
  const back = mesh(roundedBox(0.5, 0.55, 0.08, 0.09), shell, 0, 0.78, -0.24);
  back.rotation.x = 0.12;
  g.add(back);
  const legs = toon('#1e293b');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.42, 8), legs, sx * 0.22, 0.21, sz * 0.19));
  return g;
}

const CHESS_SQ = 0.09;
const CHESS_LIGHT = '#e8f1ee';
const CHESS_DARK = '#0f766e';

/** A decorative pawn in `color`: a little turned body with a ball head, `CHESS_SQ`-scale. */
function chessPawn(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.07, 10), mat, 0, 0.035, 0));
  g.add(mesh(new THREE.SphereGeometry(0.021, 10, 8), mat, 0, 0.085, 0));
  return g;
}

/** A decorative king in `color`: a body with a cross on top, `CHESS_SQ`-scale. */
function chessKing(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.034, 0.1, 10), mat, 0, 0.05, 0));
  g.add(mesh(new THREE.SphereGeometry(0.02, 10, 8), mat, 0, 0.11, 0));
  g.add(mesh(new THREE.BoxGeometry(0.036, 0.012, 0.012), mat, 0, 0.14, 0));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.036, 0.012), mat, 0, 0.14, 0));
  return g;
}

/** Where the square of file `f` and rank `r` (both 0–7, rank 0 White's home) sits on the board. */
function chessSquare(f: number, r: number): [number, number] {
  return [(f - 3.5) * CHESS_SQ, (3.5 - r) * CHESS_SQ];
}

/**
 * A modern chessboard prop: an ink frame with deep-teal and sea-foam squares, 0.8 across, its
 * origin under its middle, with a few decorative pieces mid-game on it (the real game is the
 * chess window). Rank 0 (White's home) runs along its +z edge.
 */
export function chessBoard(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.8, 0.04, 0.8, 0.03), toon('#1e293b'), 0, 0.02, 0));
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const [x, z] = chessSquare(f, r);
      g.add(mesh(new THREE.BoxGeometry(CHESS_SQ, 0.045, CHESS_SQ), toon((f + r) % 2 ? CHESS_LIGHT : CHESS_DARK), x, 0.022, z, false));
    }
  }
  // A game in progress: kings castled apart with a few pawns between them.
  const at = (piece: THREE.Group, f: number, r: number) => {
    const [x, z] = chessSquare(f, r);
    piece.position.set(x, 0.045, z);
    g.add(piece);
  };
  at(chessKing('#f8fafc'), 6, 0);
  at(chessPawn('#f8fafc'), 4, 3);
  at(chessPawn('#f8fafc'), 5, 3);
  at(chessPawn('#f8fafc'), 3, 2);
  at(chessKing('#1e293b'), 2, 7);
  at(chessPawn('#1e293b'), 4, 4);
  at(chessPawn('#1e293b'), 3, 5);
  at(chessPawn('#1e293b'), 5, 5);
  return g;
}

/** A pendant lamp, its shade at 0, on a cord `cord` meters long. */
export function pendant(cord = 0.48): THREE.Group {
  const lamp = new THREE.Group();
  const c = cord / 0.8;
  lamp.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, c, 4), toon(PALETTE.ink), 0, c / 2, 0, false));
  lamp.add(mesh(new THREE.ConeGeometry(0.5, 0.45, 16, 1, true), toon('#ffd166'), 0, 0, 0, false));
  lamp.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, -0.15, 0, false));
  lamp.scale.setScalar(0.8);
  return lamp;
}

/** A framed board on a wall; the face gets a canvas texture (cork, chalk or whiteboard). */
export function wallBoard(width: number, height: number, frameColor: string): { group: THREE.Group; face: THREE.Mesh } {
  const group = new THREE.Group();
  const frame = mesh(roundedBox(width + 0.3, 0.12, height + 0.3, 0.1), toon(frameColor), 0, 0, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const faceMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
  face.position.z = 0.07;
  group.add(face);
  return { group, face };
}
