import * as THREE from 'three';
import { mergeByColor, mesh, toon } from './toon';
import type { Interactable } from './office';

// The kitchen's fridge, built in code rather than modelled in Blender: kitchen.glb's fridge is one
// solid object with its doors baked into the shell, so nothing about it could open. kitchen.ts takes
// that part out of the .glb and puts this in its place, at the same spot and footprint, so the
// office's collider, its hum and the wall's fixture stay as they are.
//
// It's the stock that does the selling: shelves of Diet Coke (cans and bottles) and a variety of ice
// creams. E opens the door in front of you, and the freezer over it; both swing on eased hinges, or
// snap in one go when the system asks for less motion. With the door open, takeCan hands a can off
// the front row (see main.ts: drinking one does for your energy what the coffee machine does), and
// the shelf is that much shorter for as long as the office is up.

/** The fridge outside, in metres, in its own space: x across, y up, z forward (+z is the doors). */
const W = 1.1;
const D = 1.0;
const H = 2.2;
/** The shell stands on chrome feet this tall, so the cavity doesn't start at the floor. */
const LEG = 0.11;
/** How thick the shell's walls are: the cavity is this much smaller all round. */
const WALL = 0.09;
/** The doors' thickness, hung on the front. */
const DOOR_T = 0.06;
/** The divider between the freezer over it and the big fridge under it. */
const FREEZER_Y = 1.65;
/** Where the shell's opening starts, and where its shelves are. */
const CAVITY_BOTTOM = LEG + WALL;
const SHELVES = [0.5, 0.88, 1.26];
/** The hinge is the west edge of the front; both doors swing toward the room about it. */
const HINGE_X = -W / 2;
const DOOR_Z = D / 2;
/** Wide open, a little past right angles so the inside is fully in view. */
const OPEN_ANGLE = 2.02;

const SHELL = '#f4f6f9';
const ICE = '#dcedfa';
const CHROME = '#c3c9d2';
const DARK = '#3a3f4b';
const COLA = '#b01020';
const RED = '#ef476f';
const NOTE = '#ffd166';
const MEMO = '#bde0fe';
/** The ice creams' colors: tubs, scoops and lollies, one after another. */
const FLAVORS = ['#ff8fab', '#f6c177', '#8ac6d1', '#a3d977', '#c084fc', '#e07a5f'];

export interface Fridge {
  group: THREE.Group;
  /** Walk up and press E: the door in front of you. */
  interactable: Interactable;
  /** Whether the doors are open, or on their way there. */
  readonly open: boolean;
  /**
   * Opens the doors if they're shut, shuts them if they're open. `instant` skips the swing, for the
   * reduced-motion setting and for building one already open (the props lab). Returns the new state.
   */
  toggle(instant?: boolean): boolean;
  /** Swings the doors toward where they're going; call it with the frame time. */
  update(dt: number): void;
  /**
   * Takes a can off the front shelf, the one nearest the door, so the shelf is short one until the
   * next time the office is reloaded. Only while the door is open — the cans are behind it — and
   * only when the shelf isn't bare. Returns whether one was taken.
   */
  takeCan(): boolean;
  /** How many cans are still on the front shelf. */
  readonly cans: number;
}

/**
 * The fridge the office kitchen has, at the spot the Blender model's fridge stood: `x`, `z` and
 * `rotY` place it (its origin is the middle of its feet on the floor, its front toward +z before
 * `rotY`). kitchen.ts has taken that part of the .glb out and adds this in its place.
 */
export function buildFridge(at: { x: number; z: number; rotY?: number }): Fridge {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  group.rotation.y = at.rotY ?? 0;

  // Everything that holds still: the shell, its shelves, the ice creams and the cans' bare ends.
  // Merging it by color leaves a couple of draw calls rather than one per can and scoop, as the
  // office's trees and boats do (see toon.ts).
  const still = new THREE.Group();
  still.add(...shell(), ...legs());
  for (const y of SHELVES) still.add(...shelf(y));
  still.add(divider());
  iceCreams(still);
  // The Diet Coke's labels are painted canvases, so their own meshes are kept out of the merge.
  const painted = new THREE.Group();
  // The front row of cans, one to a group, so a can can be taken off the shelf and left off it.
  const row = new THREE.Group();
  drinks(still, painted, row);
  group.add(mergeByColor(still), painted, row);

  // The doors on their hinges: E opens them, and they stay as you left them.
  const front = door({ y0: CAVITY_BOTTOM - 0.04, y1: FREEZER_Y - 0.04, notes: true });
  const freezer = door({ y0: FREEZER_Y + 0.02, y1: H - 0.05, badge: true });
  group.add(front.hinge, freezer.hinge);

  let open = false;
  /** 0 shut, 1 wide open; the hinges are eased into it. */
  let amount = 0;
  const swing = () => {
    const a = amount * amount * (3 - 2 * amount);
    front.hinge.rotation.y = -OPEN_ANGLE * a;
    freezer.hinge.rotation.y = -OPEN_ANGLE * 0.88 * a;
  };

  const interactable: Interactable = { kind: 'fridge', x: at.x + Math.sin(at.rotY ?? 0) * 0.9, z: at.z + Math.cos(at.rotY ?? 0) * 0.9, radius: 1.7 };
  group.userData.interact = interactable;

  // The front row, nearest the door, one end at a time: the can at the hinge end goes first.
  let taken = 0;
  const take = () => {
    if (!open || taken >= row.children.length) return false;
    row.children[taken++].visible = false;
    return true;
  };

  return {
    group,
    interactable,
    get open() {
      return open;
    },
    toggle(instant = false) {
      open = !open;
      if (instant) {
        amount = open ? 1 : 0;
        swing();
      }
      return open;
    },
    takeCan: take,
    get cans() {
      return row.children.length - taken;
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (amount === target) return;
      const step = dt * (open ? 1.9 : 2.4);
      amount = amount < target ? Math.min(target, amount + step) : Math.max(target, amount - step);
      swing();
    },
  };
}

// ---- The shell, its feet, its shelves and its doors -----------------------------------------------

/** Rounded corners round a rectangle, as [x, y] points: `rBottom` on its bottom ones, `rTop` on its top. */
function rounded(x0: number, x1: number, y0: number, y1: number, rBottom: number, rTop: number): [number, number][] {
  const points: [number, number][] = [];
  for (const [cx, cy, r, a0] of [
    [x1 - rBottom, y0 + rBottom, rBottom, -90],
    [x1 - rTop, y1 - rTop, rTop, 0],
    [x0 + rTop, y1 - rTop, rTop, 90],
    [x0 + rBottom, y0 + rBottom, rBottom, 180],
  ] as const) {
    const n = Math.max(2, Math.round(r / 0.05));
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return points;
}

const path = (points: [number, number][]) => points.map(([x, y]) => new THREE.Vector2(x, y));

/** An outline in x and y pulled `depth` along z, its own middle at `z`. */
function slab(points: [number, number][], depth: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(path(points)), { depth, bevelEnabled: false });
  geo.translate(0, 0, z - depth / 2);
  return geo;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** The shell: a rounded body with its front open from the cavity's floor to the freezer's top. */
function shell(): THREE.Mesh[] {
  const shape = new THREE.Shape(path(rounded(-W / 2, W / 2, LEG, H, 0.05, 0.3)));
  shape.holes.push(new THREE.Path(path(rounded(-W / 2 + WALL, W / 2 - WALL, CAVITY_BOTTOM, H - WALL, 0.03, 0.24))));
  // It stops short of the front by the doors' thickness, so a shut door sits flush with it.
  const depth = D - DOOR_T;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, D / 2 - DOOR_T - depth);
  return [mesh(geo, toon(SHELL))];
}

/** Four chrome feet with a wheel on each, like the model's had. */
function legs(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) {
    for (const z of [-0.3, 0.3]) {
      out.push(mesh(new THREE.CylinderGeometry(0.034, 0.034, LEG - 0.02, 10), toon(CHROME), x, (LEG - 0.02) / 2, z));
      out.push(mesh(new THREE.SphereGeometry(0.03, 10, 8), toon(CHROME), x, 0.03, z));
    }
  }
  return out;
}

/** A shelf with a chrome lip along its front, at `y`. */
function shelf(y: number): THREE.Mesh[] {
  const z0 = -D / 2 + WALL + 0.03;
  const z1 = D / 2 - DOOR_T - 0.06;
  return [
    mesh(box(W - 2 * WALL - 0.02, 0.025, z1 - z0), toon(ICE), 0, y, (z0 + z1) / 2, false),
    mesh(box(W - 2 * WALL - 0.02, 0.03, 0.022), toon(CHROME), 0, y, z1 - 0.011, false),
  ];
}

/** The fixed panel between the freezer and the big fridge, so each door shows its own compartment. */
function divider(): THREE.Mesh {
  return mesh(box(W - 2 * WALL - 0.02, 0.05, D - DOOR_T - 0.12), toon(SHELL), 0, FREEZER_Y - 0.01, -0.02);
}

/** One door of the two: a rounded panel on a hinge at the west edge, with its handle. */
function door({ y0, y1, notes = false, badge = false }: { y0: number; y1: number; notes?: boolean; badge?: boolean }): { hinge: THREE.Group } {
  const parts = new THREE.Group();
  const x0 = 0.03;
  const x1 = W - 0.03;
  parts.add(mesh(slab(rounded(x0, x1, y0, y1, 0.05, 0.12), DOOR_T, 0), toon(SHELL)));
  // The door's inside: a liner panel set into it, so an open door reads as a door and not a slab.
  parts.add(mesh(slab(rounded(x0 + 0.06, x1 - 0.06, y0 + 0.07, y1 - 0.07, 0.05, 0.08), 0.012, -DOOR_T / 2 - 0.004), toon(ICE)));
  const handleX = x1 - 0.13;
  parts.add(mesh(new THREE.CylinderGeometry(0.021, 0.021, y1 - y0 - 0.16, 10), toon(CHROME), handleX, (y0 + y1) / 2, DOOR_T / 2 + 0.05));
  for (const y of [y0 + 0.12, y1 - 0.12]) {
    parts.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 8), toon(CHROME), handleX, y, DOOR_T / 2 + 0.028).rotateX(Math.PI / 2));
  }
  if (badge) {
    const b = mesh(new THREE.SphereGeometry(0.035, 12, 8), toon(CHROME), 0.5, 1.99, DOOR_T / 2 + 0.006, false);
    b.scale.set(1.9, 0.5, 0.24);
    parts.add(b);
  }
  if (notes) {
    // A note and a memo, each with a magnet, then a couple of spare magnets.
    for (const [color, x, y, w, h, tilt] of [
      [NOTE, 0.33, 1.27, 0.21, 0.21, 0.14],
      [MEMO, 0.63, 0.84, 0.25, 0.31, -0.1],
    ] as const) {
      const note = mesh(box(w, h, 0.01), toon(color), x, y, DOOR_T / 2 + 0.004, false);
      note.rotation.z = tilt;
      parts.add(note);
      const magnet = mesh(new THREE.SphereGeometry(0.019, 10, 6), toon(color === NOTE ? RED : NOTE), x - Math.sin(tilt) * h * 0.32, y + Math.cos(tilt) * h * 0.32, DOOR_T / 2 + 0.012, false);
      magnet.scale.set(1.6, 1.6, 0.7);
      parts.add(magnet);
    }
    for (const [color, x, y] of [
      [RED, 0.25, 0.52],
      [MEMO, 0.78, 0.4],
    ] as const) {
      const magnet = mesh(new THREE.SphereGeometry(0.02, 10, 6), toon(color), x, y, DOOR_T / 2 + 0.008, false);
      magnet.scale.set(1.7, 1.7, 0.7);
      parts.add(magnet);
    }
  }
  const hinge = new THREE.Group();
  hinge.position.set(HINGE_X, 0, DOOR_Z - DOOR_T / 2);
  hinge.add(mergeByColor(parts));
  return { hinge };
}

// ---- What's in it ---------------------------------------------------------------------------------

/** The can's own size: how tall it stands and how round it is, as the shelf holds it and the hands do. */
const CAN_H = 0.115;
const CAN_R = 0.033;

/** Every drink: two rows of cans on the bottom shelf, the bottles standing on the one over it. */
function drinks(still: THREE.Group, painted: THREE.Group, front: THREE.Group) {
  const canSide = new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 18, 1, true);
  const canEnd = new THREE.CylinderGeometry(CAN_R * 1.015, CAN_R * 1.015, 0.009, 18);
  const canMat = labelMaterial(paintCan, 256, 128);
  /** One can at `x`, standing on the bottom shelf at `z` and turned `turn`; the bare aluminium ends
   *  are separate cylinders, so the can's turn never shows on them. */
  const can = (x: number, z: number, turn: number) => {
    const g = new THREE.Group();
    const base = SHELVES[0] + 0.012;
    const side = mesh(canSide, canMat, 0, CAN_H / 2, 0);
    side.rotation.y = turn;
    g.add(side);
    const ends = new THREE.Group();
    for (const at of [CAN_H + 0.004, -0.004]) ends.add(mesh(canEnd, toon(CHROME), 0, at, 0, false));
    g.add(mergeByColor(ends));
    g.position.set(x, base, z);
    return g;
  };
  // The front row, nearest the door, one can to a group so one can can be taken off the shelf.
  for (const [i, x] of [-0.19, -0.095, 0, 0.095, 0.19].entries()) front.add(can(x, 0.02, (i * 1.7) % Math.PI));
  // The back row behind it, and the bottles on the shelf over.
  for (const [i, x] of [-0.1425, -0.0475, 0.0475, 0.1425].entries()) painted.add(can(x, -0.14, (i * 1.7 + 1) % Math.PI));
  const bottleMat = labelMaterial(paintBottle, 256, 64);
  for (const [i, x] of [-0.24, 0, 0.24].entries()) {
    const b = bottleBody();
    b.position.set(x, SHELVES[1] + 0.012, -0.02);
    b.rotation.y = i * 1.1;
    still.add(b);
    const band = mesh(new THREE.CylinderGeometry(0.0385, 0.0385, 0.1, 20, 1, true), bottleMat, x, SHELVES[1] + 0.092, -0.02, false);
    band.rotation.y = i * 1.1;
    painted.add(band);
  }
}

/** A bottle's unlabelled self: a dark body under a black cap. Its origin is its base. */
function bottleBody(): THREE.Group {
  const g = new THREE.Group();
  const profile = [
    [0, 0],
    [0.035, 0],
    [0.038, 0.02],
    [0.038, 0.14],
    [0.033, 0.175],
    [0.023, 0.2],
    [0.016, 0.22],
    [0.016, 0.255],
    [0.02, 0.26],
    [0.02, 0.272],
    [0, 0.272],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(mesh(new THREE.LatheGeometry(profile, 20), toon(COLA)));
  g.add(mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.016, 12), toon(DARK), 0, 0.28, 0, false));
  return g;
}

/** The ice creams: tubs, cones and a sandwich on the top shelf, lollies and more lying in the freezer. */
function iceCreams(still: THREE.Group) {
  const top = SHELVES[2] + 0.013;
  tub(still, -0.32, top, 0.05, FLAVORS[0], 0.3);
  tub(still, -0.2, top, -0.14, FLAVORS[2], -0.6);
  cone(still, 0.05, top, 0.06, FLAVORS[1], 0);
  cone(still, 0.16, top, -0.12, FLAVORS[3], 1.2);
  sandwich(still, 0.33, top - 0.001, 0.02, -0.4);
  // The freezer's floor: two tubs, two lollies laid flat and a sandwich.
  const floor = FREEZER_Y + 0.025;
  tub(still, -0.28, floor, -0.12, FLAVORS[4], 0);
  tub(still, 0.22, floor, -0.1, FLAVORS[5], 1.4);
  for (const [x, turn] of [
    [-0.28, 0.3],
    [0.02, -0.5],
  ] as const) {
    const pop = lolly(FLAVORS[2]);
    pop.rotation.set(-Math.PI / 2, 0, turn);
    pop.position.set(x, floor + 0.016, 0.1);
    still.add(pop);
  }
  sandwich(still, 0.03, floor, 0.16, 0.9);
}

/** A tub with its lid, in a flavor's color. Its origin is its base. */
function tub(still: THREE.Group, x: number, y: number, z: number, flavor: string, turn: number) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.07, 16), toon('#f3f4f8'), 0, 0.035, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.052, 0.018, 16), toon(flavor), 0, 0.079, 0));
  g.position.set(x, y, z);
  g.rotation.y = turn;
  still.add(g);
}

/** A wafer cone with a scoop and a cherry on it. Its origin is the point of the cone. */
function cone(still: THREE.Group, x: number, y: number, z: number, flavor: string, turn: number) {
  const g = new THREE.Group();
  const wafer = mesh(new THREE.ConeGeometry(0.042, 0.13, 14), toon('#d9a066'), 0, 0.065, 0);
  wafer.rotation.x = Math.PI;
  g.add(wafer);
  g.add(mesh(new THREE.SphereGeometry(0.048, 16, 12), toon(flavor), 0, 0.155, 0));
  g.add(mesh(new THREE.SphereGeometry(0.033, 12, 10), toon(flavor), 0.012, 0.205, 0.008));
  g.add(mesh(new THREE.SphereGeometry(0.011, 8, 6), toon(RED), 0.012, 0.24, 0.008));
  g.position.set(x, y, z);
  g.rotation.y = turn;
  still.add(g);
}

/** An ice cream sandwich: two dark wafers with the ice cream between them. Its origin is its base. */
function sandwich(still: THREE.Group, x: number, y: number, z: number, turn: number) {
  const g = new THREE.Group();
  for (const at of [0.011, 0.079]) g.add(mesh(box(0.11, 0.022, 0.058), toon('#5b3a29'), 0, at, 0));
  g.add(mesh(box(0.096, 0.048, 0.05), toon('#fffaf0'), 0, 0.045, 0));
  g.position.set(x, y, z);
  g.rotation.y = turn;
  still.add(g);
}

/** An ice lolly on its stick, in one color. Its origin is the bottom of the stick. */
function lolly(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.014, 0.075, 0.008), toon('#d9c7a3'), 0, 0.038, 0, false));
  g.add(mesh(slab(rounded(-0.031, 0.031, 0, 0.13, 0.03, 0.03), 0.03, 0), toon(color), 0, 0.065, 0));
  return g;
}

// ---- Painting the Diet Coke -----------------------------------------------------------------------

/** A material with a canvas painted on it, toon-lit like everything else. The canvas is the code's. */
function labelMaterial(paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.MeshToonMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = toon('#ffffff').clone();
  mat.map = tex;
  mat.needsUpdate = true;
  return mat;
}

/** The office's script, for the names on the labels; Nunito until it has loaded, which is close. */
const SCRIPT = 'italic 900 {size}px Nunito, ui-rounded, system-ui, sans-serif';

/** The two places a can's design shows: the front (u 1/4) and the back (u 3/4). */
const SIDES = [0.25, 0.75];

/** A Diet Coke can's sleeve: red, the white wave, and the name, over aluminium ends. */
function paintCan(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9ccd1';
  g.fillRect(0, 0, w, h * 0.075);
  g.fillRect(0, h * 0.925, w, h * 0.075);
  for (const u of SIDES) {
    const x = u * w;
    g.strokeStyle = '#ffffff';
    g.lineWidth = h * 0.07;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - w * 0.16, h * 0.7);
    g.bezierCurveTo(x - w * 0.05, h * 0.54, x + w * 0.05, h * 0.54, x + w * 0.16, h * 0.7);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = SCRIPT.replace('{size}', String(Math.round(h * 0.23)));
    g.fillText('Diet', x, h * 0.28);
    g.font = SCRIPT.replace('{size}', String(Math.round(h * 0.3)));
    g.fillText('Coke', x, h * 0.5);
  }
}

/** A Diet Coke bottle's label: the same red sleeve and name, on a band round the middle of the bottle. */
function paintBottle(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const u of SIDES) {
    g.font = SCRIPT.replace('{size}', String(Math.round(h * 0.32)));
    g.fillText('Diet', u * w, h * 0.3);
    g.fillText('Coke', u * w, h * 0.64);
  }
}
