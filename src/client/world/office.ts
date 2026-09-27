import * as THREE from 'three';
import { ASHTRAY, BALCONY, BALCONY_DOOR, BEANBAGS, BOARDS, DESKS, DESK_SIZE, ELEVATOR, EXIT_DOOR, EXIT_STAIRS, FLOOR, GONG, JUKEBOX, KIOSK, LOFT, PLANTS, SEATING_BY_ID, SLAB, STAIRS, STATIONS, STATION_AGENT, STREET_Y, TV, WALL_HEIGHT, WALL_T, WINDOWS, deskSeat, type DeskDef, type Opening, type Side, type StationKind } from '../../shared/layout';
import { wallFacing, type WallId, type WallRect } from '../../shared/decor';
import { deskPoint } from '../../shared/nav';
import { FLOOR_PALETTES, type FloorPalette } from '../../shared/floors';
import { buildGarage, buildStreet, bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import { buildElevator, type Elevator } from './elevator';
import { buildGong, type Gong } from './gong';
import { buildJukebox, type JukeboxView } from './jukebox';
import { buildWhiteboard, type WhiteboardStand } from './whiteboard';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  /** Underside, for things you walk beneath (the loft). Defaults to the floor. */
  bottom?: number;
}

export type InteractKind = 'desk' | 'station' | 'issues' | 'pulls' | 'services' | 'queue' | 'tv' | 'coffee' | 'decor' | 'smoke' | 'elevator' | 'gong' | 'dog' | 'jukebox' | 'seat' | 'whiteboard';

/** Something you can use. Its scene object carries it as `userData.interact`, for clicking. */
export interface Interactable {
  kind: InteractKind;
  x: number;
  z: number;
  /** The floor it's on, when that's not the office floor (the loft's). */
  y?: number;
  radius: number;
  deskId?: string;
  decorId?: string;
  seatId?: string;
  /** Put away for now (a bean bag nobody needs yet): can't be used. */
  off?: boolean;
}

/** A desk, a bean bag or a board agent's kiosk: somewhere a worker sits (or stands). */
export interface DeskView {
  def: DeskDef;
  group: THREE.Group;
  /** The laptop goes in here: placed, turned and sized for this seat. */
  laptopAnchor: THREE.Object3D;
  /** The worker goes in here, the same way. */
  seatAnchor: THREE.Object3D;
  chair: THREE.Group;
  /** Shown while nobody is there: the "+" over a free seat, or the board agent waiting to be asked. */
  vacancy: THREE.Group;
  /** How high the vacancy marker floats. */
  vacancyY: number;
}

export interface Office {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Every seat by id: the desks, the bean bags and the board agents' kiosks. */
  desks: Map<string, DeskView>;
  /**
   * Brings out the bean bags in `out` and puts the rest away. Returns the colliders of the ones that
   * just came out, in case someone is standing there.
   */
  setBeanbags(out: Set<string>): Collider[];
  boardMeshes: Record<keyof typeof BOARDS, THREE.Mesh>;
  tvScreen: THREE.Mesh;
  /** The monitor on the boss's desk upstairs, where Minesweeper plays (ui/arcade.ts). */
  bossScreen: THREE.Mesh;
  /** What's already on the walls (boards, the TV, windows…), so pictures don't hang over it. */
  fixtures(): WallRect[];
  elevator: Elevator;
  /** The merge gong by the PR board. */
  gong: Gong;
  jukebox: JukeboxView;
  /** The rolling whiteboard everyone draws on together. */
  whiteboard: WhiteboardStand;
  /** The sign over the elevator doors: which floor you're on. */
  setProjectName(name: string): void;
  /** Paints the walls, their trim and the floor in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  /** Lights, windows and glass for the sky to change with the time of day and the weather. */
  night: NightParts;
  /** Animates the office; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}

/** A door that opens by itself when someone comes up to it, and closes behind them. */
interface Door {
  x: number;
  y: number;
  z: number;
  /** 0 shut, 1 wide open. */
  open: number;
  show(open: number): void;
}

const PALETTE = {
  floor: FLOOR_PALETTES[0].floor,
  floorAlt: FLOOR_PALETTES[0].floorAlt,
  wall: FLOOR_PALETTES[0].wall,
  wallTrim: FLOOR_PALETTES[0].trim,
  desk: '#f7f3ea',
  deskLeg: '#3d405b',
  wood: '#c98b5a',
  cork: '#d8a86a',
  chairs: ['#ff8a5b', '#5bc0eb', '#9bc53d', '#b388eb', '#ffb400', '#f7aef8'],
  rugs: ['#bde0fe', '#ffd6a5', '#caffbf', '#ffc6ff'],
  plant: '#5fb760',
  plantDark: '#3f8f45',
  pot: '#e76f51',
  ink: '#2b2d42',
  /** The building's outside paint. */
  exterior: '#e07a5f',
};

/** Window glass: faintly blue and see-through. */
const GLASS = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
const SHINE = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

/** A sheet of glass `w` by `h`, centered, with a couple of cartoon glints so it reads as glass. */
function glassPane(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.PlaneGeometry(w, h), GLASS, 0, 0, 0, false));
  for (const [gx, gw] of [
    [-w * 0.2, 0.18],
    [-w * 0.2 + 0.32, 0.08],
  ]) {
    const glint = mesh(new THREE.PlaneGeometry(gw, h * 0.55), SHINE, gx, h * 0.07, 0.01, false);
    glint.rotation.z = -0.5;
    g.add(glint);
  }
  return g;
}

/** The middle of an outside wall at `u` along it, and the turn that makes local +z point outdoors. */
function onWall(side: Side, u: number): { x: number; z: number; rotY: number } {
  switch (side) {
    case 'north':
      return { x: u, z: FLOOR.minZ - WALL_T / 2, rotY: Math.PI };
    case 'south':
      return { x: u, z: FLOOR.maxZ + WALL_T / 2, rotY: 0 };
    case 'west':
      return { x: FLOOR.minX - WALL_T / 2, z: u, rotY: -Math.PI / 2 };
    case 'east':
      return { x: FLOOR.maxX + WALL_T / 2, z: u, rotY: Math.PI / 2 };
  }
}

/** Chunky planks in a floor's colors. */
function paintPlanks(c: HTMLCanvasElement, p: FloorPalette) {
  const g = c.getContext('2d')!;
  g.fillStyle = p.floor;
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + offset;
      g.fillStyle = (row + col) % 3 === 0 ? p.floorAlt : p.floor;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
    }
    g.fillStyle = p.seam;
    g.fillRect(0, row * 64, 512, 3);
  }
}

function floorTexture(width = FLOOR.maxX - FLOOR.minX, depth = FLOOR.maxZ - FLOOR.minZ): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  paintPlanks(c, FLOOR_PALETTES[0]);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(width / 6, depth / 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

function plant(scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), toon(PALETTE.pot), 0, 0.25, 0));
  g.add(mesh(new THREE.SphereGeometry(0.42, 12, 10), toon(PALETTE.plant), 0, 0.85, 0));
  g.add(mesh(new THREE.SphereGeometry(0.3, 12, 10), toon(PALETTE.plantDark), 0.22, 1.1, 0.1));
  g.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), toon(PALETTE.plant), -0.2, 1.15, -0.08));
  g.scale.setScalar(scale);
  return g;
}

function pendant(): THREE.Group {
  const lamp = new THREE.Group();
  lamp.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), toon(PALETTE.ink), 0, 0.3, 0, false));
  lamp.add(mesh(new THREE.ConeGeometry(0.5, 0.45, 16, 1, true), toon('#ffd166'), 0, 0, 0, false));
  lamp.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, -0.15, 0, false));
  lamp.scale.setScalar(0.8);
  return lamp;
}

/** A window filling its hole in an outside wall: a frame lining the hole, a mullion, sills and real glass. */
function windowIn(o: Opening): THREE.Group {
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
function wetPane(o: Opening, mat: THREE.Material): THREE.Group {
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
function exitDoor(night: NightParts): { group: THREE.Group; door: Door } {
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
  night.halos.push({ at: lampAt, size: 0.9, color: '#ffe08a' });
  night.lamps.push({ x: lampAt.x - 0.6, y: lampAt.y, z: lampAt.z, reach: 5, color: '#ffe3a3', power: 2.2 });
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
function balconyDoor(): { group: THREE.Group; door: Door } {
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

/** A sagging string of party bulbs from `a` to `b`, in `bulbs` (one per color); they light up at night. */
function stringLights(a: THREE.Vector3, b: THREE.Vector3, sag: number, bulbs: [string, THREE.Material][], night: NightParts): THREE.Group {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag * 2;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const g = new THREE.Group();
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.012, 4), toon(PALETTE.ink), 0, 0, 0, false));
  const n = Math.max(2, Math.round(curve.getLength() / 0.5));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint(i / n);
    const [color, mat] = bulbs[i % bulbs.length];
    g.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), mat, p.x, p.y - 0.06, p.z, false));
    night.halos.push({ at: new THREE.Vector3(p.x, p.y - 0.06, p.z), size: 0.55, color });
  }
  return mergeByMaterial(g);
}

/**
 * The smoking balcony off the south wall, over the garage entrance: a deck with a glass railing on
 * its three open sides, string lights, a bench under the window, a bistro table, plants and the
 * ashtray, where you take a smoke break.
 */
function buildBalcony(group: THREE.Group, colliders: Collider[], interactables: Interactable[], night: NightParts) {
  const { minX, maxX, minZ, maxZ } = BALCONY;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Everything that doesn't move and isn't textured goes in here, merged at the end.
  const parts = new THREE.Group();
  parts.add(mesh(box(w, SLAB - 0.01, d), toon(PALETTE.wallTrim), cx, -SLAB / 2 - 0.005, cz));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: floorTexture(w, d), color: '#d6a574', gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, 0.002, cz);
  deck.receiveShadow = true;
  group.add(deck);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: -SLAB, top: 0 });

  // Posts down to the street at the outer corners.
  const postH = -SLAB - STREET_Y;
  for (const x of [minX + 0.25, maxX - 0.25]) {
    parts.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, postH, 12), toon('#e6e8ee'), x, STREET_Y + postH / 2, maxZ - 0.25));
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: maxZ - 0.39, maxZ: maxZ - 0.11, bottom: STREET_Y, top: -SLAB });
  }

  // The railing: posts, a wooden top rail and glass between, on the three open sides.
  const railH = 1.05;
  const ink = toon(PALETTE.deskLeg);
  const wood = toon(PALETTE.wood);
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
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      parts.add(mesh(box(0.06, railH, 0.06), ink, x0 + (x1 - x0) * t, railH / 2, z0 + (z1 - z0) * t, false));
    }
    const rail = mesh(alongX ? box(len + 0.1, 0.07, 0.12) : box(0.12, 0.07, len + 0.1), wood, (x0 + x1) / 2, railH + 0.02, (z0 + z1) / 2);
    parts.add(rail);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const pane = glassPane(len / n - 0.1, railH - 0.2);
      pane.position.set(x0 + (x1 - x0) * t, (railH - 0.2) / 2 + 0.08, z0 + (z1 - z0) * t);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
    colliders.push({ minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05, minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05, bottom: -SLAB, top: 99 });
  }

  // Lamp poles on the outer corners, with string lights to them from the wall and between them.
  const poleH = 2.7;
  const sw = new THREE.Vector3(minX + inset, poleH, maxZ - inset);
  const se = new THREE.Vector3(maxX - inset, poleH, maxZ - inset);
  for (const p of [sw, se]) parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, poleH - railH, 6), ink, p.x, (poleH + railH) / 2, p.z, false));
  const bulbs = ['#ffd166', '#ff8fa3', '#8ecae6', '#caffbf'].map((c): [string, THREE.Material] => [c, bulb(night, c, 0.4)]);
  parts.add(stringLights(sw, se, 0.35, bulbs, night));
  parts.add(stringLights(sw, new THREE.Vector3(-6.5, 3.5, minZ + 0.02), 0.3, bulbs, night));
  parts.add(stringLights(new THREE.Vector3(-6.5, 3.5, minZ + 0.02), se, 0.35, bulbs, night));
  // At night they light the deck, the table and whoever's out there.
  for (const x of [cx - 3.2, cx + 3.2]) night.lamps.push({ x, y: 2.4, z: cz, reach: 5.5, color: '#ffc9a6', power: 2.4 });

  // A bench under the window, a bistro table with two stools, and plants.
  const bench = new THREE.Group();
  bench.add(mesh(roundedBox(2, 0.08, 0.46, 0.05), wood, 0, 0.45, 0));
  bench.add(mesh(box(2, 0.32, 0.06), wood, 0, 0.78, -0.2));
  for (const sx of [-0.85, 0.85]) bench.add(mesh(box(0.06, 0.45, 0.4), ink, sx, 0.22, 0));
  bench.position.set(-9, 0, minZ + 0.3);
  // Somewhere to sit, so not merged with the rest: its own meshes carry what E is about when you look at it.
  group.add(bench);
  colliders.push({ minX: -10, maxX: -8, minZ, maxZ: minZ + 0.55, top: 0.49 });
  seatable(bench, 'bench', 1.6, interactables);
  const tx = 0.2;
  const tz = cz + 0.2;
  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), toon('#fffaf3'), 0, 0.74, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), ink, 0, 0.37, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.04, 16), ink, 0, 0.02, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ef476f'), 0.15, 0.82, 0.05));
  table.position.set(tx, 0, tz);
  parts.add(table);
  colliders.push({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, top: 0.77 });
  for (const sx of [-1, 1]) {
    const x = tx + sx * 0.8;
    const stool = new THREE.Group();
    stool.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), toon(sx < 0 ? '#5bc0eb' : '#ff8a5b'), 0, 0.46, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), ink, 0, 0.22, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 12), ink, 0, 0.015, 0));
    stool.position.set(x, 0, tz);
    group.add(stool);
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: tz - 0.2, maxZ: tz + 0.2, top: 0.49 });
    seatable(stool, sx < 0 ? 'stool-1' : 'stool-2', 0.9, interactables);
  }
  for (const [px, pz, sc] of [
    [maxX - 0.55, minZ + 0.5, 1.1],
    [minX + 0.55, maxZ - 0.55, 0.9],
  ]) {
    const p = plant(sc);
    p.position.set(px, 0, pz);
    parts.add(p);
    const r = 0.3 * sc;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, top: 0.5 * sc });
  }

  group.add(mergeByMaterial(parts));

  // The ashtray: a standing bin with a sand-filled bowl and a couple of butts in it.
  const tray = new THREE.Group();
  const steel = toon('#8d99ae');
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), steel, 0, 0.025, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), steel, 0, 0.45, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 16), steel, 0, 0.9, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 16), toon('#e9d8a6'), 0, 0.965, 0, false));
  for (const [bx, bz, a] of [
    [0.06, 0.02, 0.4],
    [-0.05, -0.06, 2.1],
    [-0.02, 0.08, 1.2],
  ]) {
    const butt = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6).rotateZ(Math.PI / 2), toon(a > 1 ? '#fffaf3' : '#e9a03b'), bx, 0.98, bz, false);
    butt.rotation.y = a;
    tray.add(butt);
  }
  tray.position.set(ASHTRAY.x, 0, ASHTRAY.z);
  group.add(tray);
  colliders.push({ minX: ASHTRAY.x - 0.2, maxX: ASHTRAY.x + 0.2, minZ: ASHTRAY.z - 0.2, maxZ: ASHTRAY.z + 0.2, top: 1 });
  const it: Interactable = { kind: 'smoke', x: ASHTRAY.x, z: ASHTRAY.z, radius: 1.8 };
  interactables.push(it);
  tray.userData.interact = it;

  const sign = textPlane('🚬 Smoke break', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  sign.scale.multiplyScalar(0.8);
  sign.position.set(-6.5, 2.2, minZ + 0.02);
  group.add(sign);
}

/**
 * Outside the exit: a concrete landing level with the office floor, and steps running south
 * along the west wall down to the street, with a railing on the open side.
 */
function buildExitStairs(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, landingZ0, landingZ1, steps, run } = EXIT_STAIRS;
  const width = maxX - minX;
  const rise = -STREET_Y / steps;
  const treads = steps - 1;
  const L = landingZ1 - landingZ0;
  // Side profile: x runs south from the landing's north end, y is height.
  const profile = new THREE.Shape();
  profile.moveTo(0, STREET_Y);
  profile.lineTo(0, 0);
  profile.lineTo(L, 0);
  for (let i = 1; i <= treads; i++) {
    profile.lineTo(L + (i - 1) * run, -i * rise);
    profile.lineTo(L + i * run, -i * rise);
  }
  profile.lineTo(L + treads * run, STREET_Y);
  profile.closePath();
  const block = mesh(new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false }), toon('#d3d6dd'), maxX, 0, landingZ0);
  block.rotation.y = -Math.PI / 2;
  group.add(block);
  const tread = toon('#b9bdc6');
  const cx = (minX + maxX) / 2;
  group.add(mesh(box(width, 0.04, L), tread, cx, -0.015, landingZ0 + L / 2, false));
  colliders.push({ minX, maxX, minZ: landingZ0, maxZ: landingZ1, bottom: STREET_Y, top: 0 });
  for (let i = 1; i <= treads; i++) {
    const z0 = landingZ1 + (i - 1) * run;
    group.add(mesh(box(width, 0.04, run + 0.02), tread, cx, -i * rise - 0.015, z0 + run / 2, false));
    colliders.push({ minX, maxX, minZ: z0, maxZ: z0 + run, bottom: STREET_Y, top: -i * rise });
  }

  // The railing: round the landing's open sides, then down the stairs.
  const ink = toon(PALETTE.deskLeg);
  const railX = minX + 0.06;
  const railH = 1.0;
  const post = (x: number, y: number, z: number) => group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), ink, x, y + railH / 2, z, false));
  const rail = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const r = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), ink, (x0 + x1) / 2, (y0 + y1) / 2 + railH, (z0 + z1) / 2, false);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    group.add(r);
  };
  const nz = landingZ0 + 0.06;
  post(maxX - 0.05, 0, nz);
  post(railX, 0, nz);
  post(railX, 0, landingZ1);
  rail(maxX - 0.05, 0, nz, railX, 0, nz);
  rail(railX, 0, nz, railX, 0, landingZ1);
  const bottomZ = landingZ1 + (treads - 0.5) * run;
  for (let i = 2; i <= treads; i += 3) post(railX, -i * rise, landingZ1 + (i - 0.5) * run);
  post(railX, -treads * rise, bottomZ);
  rail(railX, 0, landingZ1, railX, -treads * rise, bottomZ);
  colliders.push({ minX: minX - 0.05, maxX: minX + 0.1, minZ: landingZ0, maxZ: bottomZ, bottom: STREET_Y, top: 99 });
  colliders.push({ minX, maxX, minZ: landingZ0 - 0.05, maxZ: landingZ0 + 0.1, bottom: STREET_Y, top: 99 });
}

/**
 * The four outside walls, built in pieces around their windows and doors. Each is painted inside in
 * the floor's colors and outside in the building's. Behind the loft they carry on up past the
 * ceiling downstairs, to the loft's roof.
 */
function buildWalls(group: THREE.Group, colliders: Collider[], openings: Opening[], looks: Looks) {
  const inside = looks.wall;
  const outside = toon(PALETTE.exterior);
  const trimMat = looks.trim;
  const T = WALL_T;
  const loftTop = LOFT.y + LOFT.height + 0.2;
  const walls: { side: Side; at: number; spans: [number, number, number][] }[] = [
    { side: 'north', at: FLOOR.minZ - T / 2, spans: [[FLOOR.minX - T, FLOOR.maxX + T, WALL_HEIGHT]] },
    {
      side: 'south',
      at: FLOOR.maxZ + T / 2,
      spans: [
        [FLOOR.minX - T, LOFT.minX, WALL_HEIGHT],
        [LOFT.minX, FLOOR.maxX + T, loftTop],
      ],
    },
    { side: 'west', at: FLOOR.minX - T / 2, spans: [[FLOOR.minZ, FLOOR.maxZ, WALL_HEIGHT]] },
    {
      side: 'east',
      at: FLOOR.maxX + T / 2,
      spans: [
        [FLOOR.minZ, LOFT.minZ, WALL_HEIGHT],
        [LOFT.minZ, FLOOR.maxZ, loftTop],
      ],
    },
  ];
  for (const w of walls) {
    const alongX = w.side === 'north' || w.side === 'south';
    // A box's faces go +x, -x, +y, -y, +z, -z; the one facing outdoors gets the outside paint.
    const out = { east: 0, west: 1, south: 4, north: 5 }[w.side];
    const mats = Array.from({ length: 6 }, (_, i) => (i === out ? outside : inside));
    const at = (u: number, y: number) => (alongX ? new THREE.Vector3(u, y, w.at) : new THREE.Vector3(w.at, y, u));
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
      // Up past the ceiling downstairs the sun shines through, as it does through the loft's roof.
      if (y0 < WALL_HEIGHT && y1 > WALL_HEIGHT) {
        piece(u0, u1, y0, WALL_HEIGHT);
        piece(u0, u1, WALL_HEIGHT, y1);
        return;
      }
      const m = new THREE.Mesh(alongX ? box(u1 - u0, y1 - y0, T) : box(T, y1 - y0, u1 - u0), mats);
      m.position.copy(at((u0 + u1) / 2, (y0 + y1) / 2));
      m.castShadow = y1 <= WALL_HEIGHT;
      m.receiveShadow = true;
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

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = SEATING_BY_ID.get(seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(roundedBox(0.62, 0.1, 0.58, 0.12), mat, 0, 0.5, 0));
  const back = mesh(roundedBox(0.62, 0.1, 0.6, 0.12), mat, 0, 0.86, 0.27);
  back.rotation.x = Math.PI / 2 - 0.12;
  g.add(back);
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), toon(PALETTE.deskLeg), 0, 0.26, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(box(0.05, 0.04, 0.32), toon(PALETTE.deskLeg), Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    g.add(leg);
  }
  return g;
}

function buildDesk(def: DeskDef, index: number, trimMat: THREE.Material): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = DESK_SIZE;
  group.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon(PALETTE.desk), 0, height - 0.04, 0));
  const legMat = toon('#8d99ae');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, height - 0.08, 8), legMat, sx * (width / 2 - 0.14), (height - 0.08) / 2, sz * (depth / 2 - 0.12)));
    }
  }
  // Modesty panel facing away from the worker
  group.add(mesh(box(width - 0.3, 0.32, 0.03), trimMat, 0, height - 0.26, -depth / 2 + 0.06));
  // Little desk decorations
  const deco = index % 3;
  if (deco === 0) {
    const mug = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon(PALETTE.chairs[index % 6]), width / 2 - 0.25, height + 0.06, -0.2);
    group.add(mug);
  } else if (deco === 1) {
    const p = plant(0.35);
    p.position.set(-width / 2 + 0.25, height, -0.25);
    group.add(p);
  } else {
    const books = new THREE.Group();
    ['#e63946', '#457b9d', '#f4a261'].forEach((c, i) => books.add(mesh(box(0.08, 0.24, 0.18), toon(c), i * 0.09, 0.12, 0)));
    books.position.set(width / 2 - 0.35, height, -0.3);
    group.add(books);
  }

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, height, -0.06);
  laptopAnchor.scale.setScalar(1.3);
  group.add(laptopAnchor);

  // On the chair, facing the desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.93);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  const ch = chair(PALETTE.chairs[index % PALETTE.chairs.length]);
  ch.position.set(0, 0, 0.9);
  group.add(ch);

  const vacancyY = height + 0.55;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, chair: ch, vacancy, vacancyY };
}

/** The floating green "+" over an empty seat. */
function vacancyMarker(y: number): THREE.Group {
  const vacancy = new THREE.Group();
  const plusMat = toon('#7cf29a', { emissive: '#1f7a3a' });
  vacancy.add(mesh(box(0.28, 0.08, 0.08), plusMat, 0, 0, 0, false));
  vacancy.add(mesh(box(0.08, 0.28, 0.08), plusMat, 0, 0, 0, false));
  vacancy.position.set(0, y, 0);
  return vacancy;
}

const BEANBAG_COLORS = ['#ff6b6b', '#4ecdc4', '#9b5de5', '#ffd166', '#f15bb5', '#00bbf9', '#06d6a0', '#fb8500'];
/** A bean bag's footprint, with the lap desk in front of it (-z). */
const BEANBAG_BOX = { minX: -0.62, maxX: 0.62, minZ: -1.1, maxZ: 0.64, top: 0.62 } as const;

/** An overflow seat: a squashy bean bag, and a low lap desk in front of it for the laptop. */
function buildBeanbag(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const bag = new THREE.Group();
  const cloth = toon(BEANBAG_COLORS[index % BEANBAG_COLORS.length]);
  const seat = mesh(new THREE.SphereGeometry(0.62, 20, 14), cloth, 0, 0.3, 0);
  seat.scale.set(1, 0.52, 1);
  bag.add(seat);
  // Slumped up behind the worker, like a back rest.
  const back = mesh(new THREE.SphereGeometry(0.5, 18, 12), cloth, 0, 0.6, 0.32);
  back.scale.set(1.05, 0.95, 0.7);
  bag.add(back);
  group.add(bag);

  const tray = new THREE.Group();
  const wood = toon(PALETTE.wood);
  tray.add(mesh(roundedBox(0.95, 0.05, 0.6, 0.05), wood, 0, 0.42, 0));
  for (const sx of [-1, 1]) tray.add(mesh(box(0.05, 0.4, 0.5), toon('#8a5a3b'), sx * 0.4, 0.2, 0));
  tray.position.z = -0.8;
  group.add(tray);

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, 0.445, -0.8);
  laptopAnchor.scale.setScalar(1.05);
  group.add(laptopAnchor);

  // Sunk into the bag, facing the lap desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.32, 0.04);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  const vacancyY = 1.25;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, chair: bag, vacancy, vacancyY };
}

const KIOSK_SIGN: Record<StationKind, string> = { issues: '📌 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/**
 * A board agent's kiosk: a little counter in its color with a sign on the front, and the agent standing
 * behind it. Its `vacancy` is where the agent waits before anyone has asked it anything (main.ts puts
 * one there), in the same spot and pose as the one who gets hired.
 */
function buildKiosk(def: DeskDef): DeskView {
  const kind = def.station!;
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = KIOSK;
  const color = toon(STATION_AGENT[kind].color);
  // Narrower at the foot, like a lectern, with a lip round the top.
  group.add(mesh(roundedBox(width - 0.16, height - 0.1, depth - 0.12, 0.06), color, 0, (height - 0.1) / 2 + 0.04, 0));
  group.add(mesh(roundedBox(width - 0.02, 0.06, depth + 0.02, 0.05), toon(PALETTE.ink), 0, 0.03, 0));
  group.add(mesh(roundedBox(width, 0.06, depth, 0.05), toon(PALETTE.desk), 0, height - 0.03, 0));
  const sign = textPlane(KIOSK_SIGN[kind], { bg: '#fffaf3', size: 56 });
  sign.scale.multiplyScalar(0.62);
  sign.position.set(0, height * 0.55, -(depth - 0.12) / 2 - 0.012);
  sign.rotation.y = Math.PI;
  group.add(sign);

  // No laptop: its lid would hide the agent's face from whoever walks up, and its screen would face
  // the wall. The agent's terminal is a key press away (O).
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  group.add(laptopAnchor);

  // On its feet behind the kiosk, facing it and the room beyond.
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  group.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}

/** A framed board on a wall; the face gets a canvas texture (cork, chalk or whiteboard). */
function wallBoard(width: number, height: number, frameColor: string): { group: THREE.Group; face: THREE.Mesh } {
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

export function buildOffice(): Office {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const fixtures: WallRect[] = [];
  const fixture = (wall: WallId, u: number, y: number, w: number, h: number) => fixtures.push({ wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 });
  const width = FLOOR.maxX - FLOOR.minX;
  const depth = FLOOR.maxZ - FLOOR.minZ;
  const cx = (FLOOR.maxX + FLOOR.minX) / 2;
  const cz = (FLOOR.maxZ + FLOOR.minZ) / 2;

  // What each floor paints its own way (see setLook): the walls, their trim, the planks.
  const looks: Looks = { wall: toonUnique(PALETTE.wall), trim: toonUnique(PALETTE.wallTrim), planks: [] };

  // Floor
  const floorTex = floorTexture();
  looks.planks.push(floorTex);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshToonMaterial({ map: floorTex, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  group.add(floor);

  // Rugs under each desk cluster
  [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
  ].forEach(([x, z], i) => {
    const rug = mesh(roundedBox(6.2, 0.02, 4.6, 0.6), toon(PALETTE.rugs[i]), x, 0.011, z, false);
    group.add(rug);
  });

  const night: NightParts = {
    bulbs: [],
    halos: [],
    lamps: [],
    windows: [],
    clouds: toonUnique('#ffffff'),
    wetGlass: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, visible: false }),
  };

  // Outside walls, with real windows you see out of and a door out.
  const trimMat = looks.trim;
  const openings = [...WINDOWS, EXIT_DOOR, BALCONY_DOOR];
  buildWalls(group, colliders, openings, looks);
  const glazing = new THREE.Group();
  for (const o of WINDOWS) {
    glazing.add(windowIn(o));
    fixture(o.wall, o.u, (o.y0 + o.y1) / 2 - 0.03, o.width + 0.2, o.y1 - o.y0 + 0.12);
    group.add(wetPane(o, night.wetGlass));
  }
  group.add(mergeByMaterial(glazing));
  const doors: Door[] = [];
  const exit = exitDoor(night);
  group.add(exit.group);
  doors.push(exit.door);
  const stairs = new THREE.Group();
  buildExitStairs(stairs, colliders);
  group.add(mergeByMaterial(stairs));
  // The door, its frame and the EXIT sign over it.
  fixture(EXIT_DOOR.wall, EXIT_DOOR.u, (EXIT_DOOR.y1 + 0.7) / 2, EXIT_DOOR.width + 0.3, EXIT_DOOR.y1 + 0.7);
  // Out the glass doors on the south wall: the balcony.
  const slider = balconyDoor();
  group.add(slider.group);
  doors.push(slider.door);
  fixture(BALCONY_DOOR.wall, BALCONY_DOOR.u, (BALCONY_DOOR.y1 + 0.1) / 2, BALCONY_DOOR.width + 0.2, BALCONY_DOOR.y1 + 0.1);
  buildBalcony(group, colliders, interactables, night);

  // Downstairs: the garage under the office, and the street outside.
  buildGarage(group, colliders);
  buildStreet(group, colliders, night);

  // Desks
  const desks = new Map<string, DeskView>();
  DESKS.forEach((def, i) => {
    const view = buildDesk(def, i, trimMat);
    group.add(view.group);
    desks.set(def.id, view);
    const hw = DESK_SIZE.width / 2 - 0.05;
    const hd = DESK_SIZE.depth / 2 - 0.02;
    colliders.push({ minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height });
    const seat = deskSeat(def, 1.25);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: seat.x, z: seat.z, radius: 1.3 };
    interactables.push(it);
    view.group.userData.interact = it;
  });

  // Bean bags, put away until every desk is taken.
  const beanbags = new Map<string, { view: DeskView; it: Interactable; collider: Collider }>();
  BEANBAGS.forEach((def, i) => {
    const view = buildBeanbag(def, i);
    view.group.visible = false;
    group.add(view.group);
    desks.set(def.id, view);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: def.x, z: def.z, radius: 1.8, off: true };
    interactables.push(it);
    view.group.userData.interact = it;
    // Its footprint turned the way it faces (a quarter turn at a time).
    const c = Math.round(Math.cos(def.rotY));
    const s = Math.round(Math.sin(def.rotY));
    const xs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.x + lx * c + lz * s));
    const zs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.z - lx * s + lz * c));
    const collider = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: BEANBAG_BOX.top };
    beanbags.set(def.id, { view, it, collider });
  });
  // The board agents' kiosks, each just west of its board.
  for (const def of STATIONS) {
    const view = buildKiosk(def);
    group.add(view.group);
    desks.set(def.id, view);
    // The kiosk and the agent behind it, back to the wall (they all stand by the north wall) so
    // nobody squeezes in behind, and up over the agent's head so nobody hops on it.
    const corners = [-1, 1].flatMap((t) => [-KIOSK.depth / 2, KIOSK.stand + 0.35].map((sz) => deskPoint(def, (t * KIOSK.width) / 2, sz)));
    const xs = corners.map(([x]) => x);
    const zs = corners.map(([, z]) => z);
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: FLOOR.minZ, maxZ: Math.max(...zs), top: 1.5 });
    // Walk up to its front.
    const [fx, fz] = deskPoint(def, 0, -1);
    const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
    interactables.push(it);
    view.group.userData.interact = it;
    // The agent, its name tag and the card over its head, up against the wall.
    fixture('north', def.x, 1.45, 1.4, 2.9);
  }
  const setBeanbags = (out: Set<string>) => {
    const appeared: Collider[] = [];
    for (const [id, b] of beanbags) {
      const show = out.has(id);
      if (show === b.view.group.visible) continue;
      b.view.group.visible = show;
      b.it.off = !show;
      if (show) {
        colliders.push(b.collider);
        appeared.push(b.collider);
      } else colliders.splice(colliders.indexOf(b.collider), 1);
    }
    return appeared;
  };

  // Cork boards on the walls
  const boardMeshes = {} as Office['boardMeshes'];
  for (const key of Object.keys(BOARDS) as (keyof typeof BOARDS)[]) {
    const b = BOARDS[key];
    // Out from the wall, the way the board faces.
    const nx = Math.sin(b.rotY);
    const nz = Math.cos(b.rotY);
    // The queue is a whiteboard in an aluminium frame; the others hang in wood.
    const { group: bg, face } = wallBoard(b.width, b.height, key === 'queue' ? '#aab4be' : PALETTE.wood);
    bg.position.set(b.x + nx * 0.08, b.y, b.z + nz * 0.08);
    bg.rotation.y = b.rotY;
    group.add(bg);
    boardMeshes[key] = face;
    const label = textPlane(b.label, { bg: '#fffaf3', size: 64 });
    label.scale.multiplyScalar(1.3);
    label.position.set(b.x + nx * 0.04, b.y + b.height / 2 + 0.5, b.z + nz * 0.04);
    label.rotation.y = b.rotY;
    group.add(label);
    const it: Interactable = { kind: key, x: b.x + nx * 1.6, z: b.z + nz * 1.6, radius: 2.4 };
    interactables.push(it);
    bg.userData.interact = it;
    // The board and its label above it, up to the ceiling.
    const wall = wallFacing(b.rotY);
    const bottom = b.y - (b.height + 0.3) / 2;
    fixture(wall, wall === 'north' || wall === 'south' ? b.x : b.z, (bottom + WALL_HEIGHT) / 2, b.width + 0.3, WALL_HEIGHT - bottom);
  }

  // Lounge: TV, couch, coffee table, beanbags, and the jukebox in the corner
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(TV.width + 0.3, 0.14, TV.height + 0.3, 0.12), toon(PALETTE.ink), 0, 0, 0));
  (tvGroup.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(TV.width, TV.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e' }));
  tvScreen.position.z = 0.08;
  tvGroup.add(tvScreen);
  tvGroup.position.set(TV.x - 0.1, TV.y, TV.z);
  tvGroup.rotation.y = -Math.PI / 2;
  group.add(tvGroup);
  const tv: Interactable = { kind: 'tv', x: TV.x - 4.5, z: TV.z, radius: 3.2 };
  interactables.push(tv);
  tvGroup.userData.interact = tv;
  fixture('east', TV.z, TV.y, TV.width + 0.3, TV.height + 0.3);

  const couch = new THREE.Group();
  const couchMat = toon('#5b8def');
  couch.add(mesh(roundedBox(1, 0.45, 4.2, 0.2), couchMat, 0, 0.3, 0));
  couch.add(mesh(roundedBox(0.35, 0.9, 4.2, 0.15), couchMat, -0.45, 0.55, 0));
  couch.add(mesh(roundedBox(1, 0.7, 0.35, 0.15), couchMat, 0, 0.45, -2.0));
  couch.add(mesh(roundedBox(1, 0.7, 0.35, 0.15), couchMat, 0, 0.45, 2.0));
  ['#ffd166', '#ef476f'].forEach((c, i) => couch.add(mesh(roundedBox(0.2, 0.45, 0.5, 0.1), toon(c), -0.2, 0.75, i ? 0.9 : -0.9)));
  couch.position.set(10.5, 0, 0);
  group.add(couch);
  colliders.push({ minX: 10, maxX: 11, minZ: -2.2, maxZ: 2.2, top: 0.55 });
  seatable(couch, 'couch', 2.6, interactables);

  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 24), toon(PALETTE.wood), 0, 0.42, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.4, 12), toon(PALETTE.deskLeg), 0, 0.2, 0));
  table.position.set(13, 0, 0);
  group.add(table);
  colliders.push({ minX: 12.2, maxX: 13.8, minZ: -0.8, maxZ: 0.8, top: 0.46 });
  const lounge = mesh(roundedBox(7, 0.02, 7, 1.2), toon('#ffc6ff'), 13.4, 0.011, 0, false);
  group.add(lounge);

  [
    ['#06d6a0', 12.5, 3.5],
    ['#ffd166', 14.5, -3.4],
  ].forEach(([c, x, z], i) => {
    const bean = mesh(new THREE.SphereGeometry(0.6, 16, 12), toon(c as string), x as number, 0.35, z as number);
    bean.scale.y = 0.6;
    group.add(bean);
    colliders.push({ minX: (x as number) - 0.5, maxX: (x as number) + 0.5, minZ: (z as number) - 0.5, maxZ: (z as number) + 0.5, top: 0.6 });
    seatable(bean, `lounge-beanbag-${i + 1}`, 1.4, interactables);
  });
  const jukebox = buildJukebox();
  group.add(jukebox.group);
  colliders.push(jukebox.collider);
  interactables.push(jukebox.interactable);
  fixture('east', JUKEBOX.z, JUKEBOX.height / 2, JUKEBOX.width + 0.1, JUKEBOX.height);

  // Kitchen corner: counter + coffee machine + fridge
  const kitchen = new THREE.Group();
  kitchen.add(mesh(box(5, 0.95, 1), toon('#8ecae6'), 0, 0.475, 0));
  kitchen.add(mesh(box(5.1, 0.08, 1.1), toon(PALETTE.desk), 0, 0.99, 0));
  const coffee = new THREE.Group();
  coffee.add(mesh(roundedBox(0.6, 0.7, 0.5, 0.08), toon('#343a40'), 0, 0.35, 0));
  coffee.add(mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.14, 10), toon('#ffffff'), 0, 0.1, 0.12));
  coffee.add(mesh(new THREE.SphereGeometry(0.05, 8, 8), toon('#ef476f', { emissive: '#ef476f' }), 0.18, 0.55, 0.26));
  coffee.position.set(-1.2, 1.03, 0);
  kitchen.add(coffee);
  kitchen.add(mesh(roundedBox(1.1, 2.2, 1, 0.1), toon('#f8f9fa'), 3.2, 1.1, 0));
  kitchen.add(mesh(box(0.06, 0.5, 0.06), toon('#adb5bd'), 2.75, 1.4, 0.52));
  kitchen.position.set(-14.5, 0, 12.2);
  group.add(kitchen);
  colliders.push({ minX: -17, maxX: -12, minZ: 11.7, maxZ: 12.7, top: 1.03 });
  colliders.push({ minX: -11.85, maxX: -10.75, minZ: 11.7, maxZ: 12.7, top: 2.2 });
  const cup: Interactable = { kind: 'coffee', x: -15.7, z: 10.9, radius: 1.4 };
  interactables.push(cup);
  coffee.userData.interact = cup;
  // Counter, coffee machine and fridge, in front of the south wall.
  fixture('south', -14.5, 0.55, 5.1, 1.1);
  fixture('south', -15.7, 0.9, 0.6, 1.8);
  fixture('south', -11.3, 1.1, 1.1, 2.2);

  // Plants around the room
  for (const [x, z, s] of PLANTS) {
    const p = plant(s);
    p.position.set(x, 0, z);
    group.add(p);
    const r = 0.3 * s;
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s });
  }

  // Ceiling lamps (floating cartoon pendants)
  for (const [x, z] of [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
    [13, 0],
  ]) {
    const lamp = pendant();
    lamp.position.set(x, WALL_HEIGHT - 0.15, z);
    group.add(lamp);
    night.halos.push({ at: new THREE.Vector3(x, WALL_HEIGHT - 0.27, z), size: 1.3, color: '#ffe08a' });
  }

  const bossScreen = buildLoft(group, colliders, interactables, looks);

  // The elevator to the other floors, against the north wall between the PR board and the gong.
  const elevator = buildElevator();
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  fixture('north', ELEVATOR.x, WALL_HEIGHT / 2, ELEVATOR.width + 0.1, WALL_HEIGHT);

  // The gong, just past the elevator from the PR board.
  const gong = buildGong();
  group.add(gong.group);
  colliders.push(...gong.colliders);
  interactables.push(gong.interactable);
  fixture('north', GONG.x, (GONG.height + 0.3) / 2, GONG.width + 1.2, GONG.height + 0.3);

  // The whiteboard, out on the floor between the desks and the lounge.
  const whiteboard = buildWhiteboard();
  group.add(whiteboard.group);
  colliders.push(...whiteboard.colliders);
  interactables.push(whiteboard.interactable);
  // Pictures stay clear of the stairs (step by step, so they can hang above them) and of what's on
  // the loft's walls upstairs, as buildLoft places it: the couch and the sign.
  const run = (STAIRS.toX - STAIRS.fromX) / STAIRS.steps;
  const rise = LOFT.y / STAIRS.steps;
  for (let i = 1; i <= STAIRS.steps; i++) fixture('south', STAIRS.fromX + (i - 0.5) * run, (i * rise) / 2, run, i * rise);
  const loftZ = (LOFT.minZ + LOFT.maxZ) / 2;
  fixture('east', loftZ, LOFT.y + 0.5, 2.4, 1);
  fixture('south', LOFT.maxX - 3, LOFT.y + 1.9, 2.6, 0.6);

  const setProjectName = (name: string) => elevator.setSign(`🛗 ${name}`);
  const setLook = (p: FloorPalette) => {
    looks.wall.color.set(p.wall);
    looks.trim.color.set(p.trim);
    for (const t of looks.planks) {
      paintPlanks(t.image as HTMLCanvasElement, p);
      t.needsUpdate = true;
    }
  };

  const update = (t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>) => {
    const near = new Set<Door>();
    for (const p of people) for (const d of doors) if (Math.abs(p.y - d.y) < 1.6 && Math.hypot(p.x - d.x, p.z - d.z) < 2.4) near.add(d);
    for (const d of doors) {
      const want = near.has(d) ? 1 : 0;
      if (d.open === want) continue;
      d.open = want > d.open ? Math.min(1, d.open + dt * 2.5) : Math.max(0, d.open - dt * 1.6);
      d.show(d.open);
    }
    for (const d of desks.values()) {
      // A board agent waiting to be asked stands still (its own idle bob is in Worker.update).
      if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
      d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
      d.vacancy.rotation.y = t * 1.2;
    }
    elevator.update(dt);
    gong.update(dt);
  };

  return { group, colliders, interactables, desks, setBeanbags, boardMeshes, tvScreen, bossScreen, fixtures: () => fixtures, elevator, gong, jukebox, whiteboard, setProjectName, setLook, night, update };
}

/** The materials and textures a floor paints in its own colors. */
interface Looks {
  wall: THREE.MeshToonMaterial;
  trim: THREE.MeshToonMaterial;
  planks: THREE.CanvasTexture[];
}

/**
 * The upstairs office: a loft on posts in the south-east corner, with glass on the two sides that
 * face the desks, reached by stairs along the south wall.
 */
function buildLoft(group: THREE.Group, colliders: Collider[], interactables: Interactable[], looks: Looks): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, y: floorY, height } = LOFT;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const roofY = floorY + height;
  const SLAB = 0.25;
  const T = 0.12; // glass wall thickness
  const wallMat = looks.wall;
  const trimMat = looks.trim;
  const frameMat = toon('#ffffff');
  const woodMat = toon(PALETTE.wood);

  // Floor slab, planked like downstairs, with a trim fascia you see from below.
  group.add(mesh(box(w, SLAB, d), trimMat, cx, floorY - SLAB / 2, cz));
  const planks = floorTexture(w, d);
  looks.planks.push(planks);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: planks, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY + 0.005, cz);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: floorY - SLAB, top: floorY });

  // Posts holding up the open corner.
  for (const x of [minX + 0.15, cx]) {
    group.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, floorY - SLAB, 12), trimMat, x, (floorY - SLAB) / 2, minZ + 0.15));
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: minZ + 0.01, maxZ: minZ + 0.29, top: floorY - SLAB });
  }

  // The outside walls carry on up behind the loft (buildWalls); the sun shines through them and the roof.
  const roof = mesh(box(w + WALL_T, 0.2, d + WALL_T), wallMat, cx + WALL_T / 2, roofY + 0.1, cz + WALL_T / 2, false);
  group.add(roof);
  group.add(mesh(box(w + 0.34, 0.24, 0.04), trimMat, cx + 0.15, roofY + 0.1, minZ - 0.02, false));
  group.add(mesh(box(0.04, 0.24, d + 0.34), trimMat, minX - 0.02, roofY + 0.1, cz + 0.15, false));
  colliders.push({ minX, maxX, minZ, maxZ, bottom: roofY, top: roofY + 0.2 });
  group.add(mesh(box(w, 0.25, 0.04), trimMat, cx, floorY + 0.125, maxZ - 0.02, false));
  group.add(mesh(box(0.04, 0.25, d), trimMat, maxX - 0.02, floorY + 0.125, cz, false));

  // Floor-to-ceiling glass on the north and west sides, so you can look down on everyone working.
  const doorZ = STAIRS.minZ;
  const pane = (len: number, px: number, pz: number, rotY: number) => {
    const g = glassPane(len, height);
    g.position.set(px, floorY + height / 2, pz);
    g.rotation.y = rotY;
    group.add(g);
  };
  const bar = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => group.add(mesh(box(bw, bh, bd), frameMat, x, y, z, false));
  const northZ = minZ + T / 2;
  const westX = minX + T / 2;
  for (let i = 0; i < 6; i++) pane(w / 6, minX + (i + 0.5) * (w / 6), northZ, 0);
  for (let i = 0; i <= 6; i++) bar(0.1, height, T + 0.04, minX + i * (w / 6), floorY + height / 2, northZ);
  bar(w, 0.12, T + 0.06, cx, floorY + 0.06, northZ);
  bar(w, 0.12, T + 0.06, cx, roofY - 0.06, northZ);
  const westLen = doorZ - minZ;
  for (let i = 0; i < 2; i++) pane(westLen / 2, westX, minZ + (i + 0.5) * (westLen / 2), Math.PI / 2);
  for (let i = 0; i <= 2; i++) bar(T + 0.04, height, 0.1, westX, floorY + height / 2, minZ + i * (westLen / 2));
  bar(T + 0.06, 0.12, westLen, westX, floorY + 0.06, minZ + westLen / 2);
  bar(T + 0.06, 0.12, westLen, westX, roofY - 0.06, minZ + westLen / 2);
  colliders.push({ minX, maxX, minZ, maxZ: minZ + T, bottom: floorY, top: 99 });
  colliders.push({ minX, maxX: minX + T, minZ, maxZ: doorZ, bottom: floorY, top: 99 });
  // Over the door at the top of the stairs.
  const doorTop = floorY + 2.3;
  group.add(mesh(box(T + 0.04, roofY - doorTop, maxZ - doorZ), wallMat, westX, (roofY + doorTop) / 2, (doorZ + maxZ) / 2, false));
  colliders.push({ minX, maxX: minX + T, minZ: doorZ, maxZ, bottom: doorTop, top: roofY });

  // Stairs: a solid run of steps up the south wall, wood treads, a handrail on the open side.
  const { fromX, toX, steps } = STAIRS;
  const sw = STAIRS.maxZ - STAIRS.minZ;
  const run = (toX - fromX) / steps;
  const rise = floorY / steps;
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    profile.lineTo(i * run, (i + 1) * rise - 0.04);
    profile.lineTo((i + 1) * run, (i + 1) * rise - 0.04);
  }
  profile.lineTo(toX - fromX, 0);
  profile.closePath();
  const stairs = mesh(new THREE.ExtrudeGeometry(profile, { depth: sw, bevelEnabled: false }), wallMat, fromX, 0, STAIRS.minZ);
  group.add(stairs);
  for (let i = 1; i <= steps; i++) {
    group.add(mesh(box(run + 0.04, 0.06, sw), woodMat, fromX + (i - 0.5) * run - 0.02, i * rise - 0.03, STAIRS.minZ + sw / 2, false));
    colliders.push({ minX: fromX + (i - 1) * run, maxX: fromX + i * run, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ, top: i * rise });
  }
  const railZ = STAIRS.minZ + 0.06;
  const railH = 0.9;
  const inkMat = toon(PALETTE.deskLeg);
  for (let i = 1; i <= steps; i += 2) {
    group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), inkMat, fromX + (i - 0.5) * run, i * rise + railH / 2, railZ, false));
  }
  const x0 = fromX + 0.5 * run;
  const x1 = fromX + (steps - 0.5) * run;
  const handrail = mesh(box(Math.hypot(x1 - x0, (x1 - x0) * (rise / run)) + 0.1, 0.07, 0.07), woodMat, (x0 + x1) / 2, (rise + floorY) / 2 + railH, railZ, false);
  handrail.rotation.z = Math.atan2(rise, run);
  group.add(handrail);
  // You can't step off the side of the stairs, or climb on from it.
  colliders.push({ minX: fromX, maxX: toX, minZ: STAIRS.minZ - 0.1, maxZ: STAIRS.minZ, top: 99 });

  // Inside: the big desk facing the glass, a comfy couch, a telescope aimed at the desks.
  const deskX = cx + 0.5;
  const deskZ = cz - 0.3;
  const desk = new THREE.Group();
  desk.add(mesh(roundedBox(2.6, 0.1, 1.2, 0.1), woodMat, 0, 0.78, 0));
  desk.add(mesh(box(2.4, 0.66, 0.08), toon('#8a5a3b'), 0, 0.4, -0.5));
  for (const sx of [-1, 1]) desk.add(mesh(box(0.1, 0.72, 1.0), toon('#8a5a3b'), sx * 1.15, 0.37, 0));
  desk.add(mesh(roundedBox(0.9, 0.55, 0.06, 0.03), toon(PALETTE.ink), 0, 1.18, -0.2));
  desk.add(mesh(box(0.08, 0.2, 0.08), toon(PALETTE.ink), 0, 0.93, -0.2));
  // Minesweeper plays on it (ui/arcade.ts).
  const screen = mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#4cc9f0' }), 0, 1.18, -0.165, false);
  desk.add(screen);
  desk.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ffd166'), 0.9, 0.89, 0.15));
  const plate = textPlane('👑 BOSS', { bg: '#ffd166', size: 48 });
  plate.scale.multiplyScalar(0.55);
  plate.position.set(0, 0.5, -0.55);
  plate.rotation.y = Math.PI;
  desk.add(plate);
  const bossChair = chair('#2b2d42');
  bossChair.scale.setScalar(1.2);
  bossChair.position.set(0, 0, 1.0);
  desk.add(bossChair);
  seatable(bossChair, 'boss-chair', 1.2, interactables);
  // Clicking the screen is using the chair: sit down, then play.
  screen.userData.interact = bossChair.userData.interact;
  desk.position.set(deskX, floorY, deskZ);
  group.add(desk);
  colliders.push({ minX: deskX - 1.3, maxX: deskX + 1.3, minZ: deskZ - 0.6, maxZ: deskZ + 0.6, bottom: floorY, top: floorY + 0.8 });

  const couch = new THREE.Group();
  const couchMat = toon('#ef476f');
  couch.add(mesh(roundedBox(1, 0.45, 2.4, 0.2), couchMat, 0, 0.3, 0));
  couch.add(mesh(roundedBox(0.35, 0.9, 2.4, 0.15), couchMat, 0.45, 0.55, 0));
  for (const sz of [-1, 1]) couch.add(mesh(roundedBox(1, 0.7, 0.3, 0.15), couchMat, 0, 0.45, sz * 1.1));
  couch.add(mesh(roundedBox(0.2, 0.45, 0.5, 0.1), toon('#ffd166'), 0.2, 0.75, 0.4));
  couch.position.set(maxX - 0.65, floorY, cz);
  group.add(couch);
  colliders.push({ minX: maxX - 1.15, maxX, minZ: cz - 1.2, maxZ: cz + 1.2, bottom: floorY, top: floorY + 0.55 });
  seatable(couch, 'loft-couch', 1.8, interactables);

  const rug = mesh(roundedBox(4.6, 0.02, 3.2, 0.6), toon('#caffbf'), deskX - 0.3, floorY + 0.015, cz + 0.1, false);
  group.add(rug);

  const scope = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), inkMat, Math.sin(a) * 0.2, 0.52, Math.cos(a) * 0.2);
    leg.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
    scope.add(leg);
  }
  const tube = new THREE.Group();
  const tubeGeo = new THREE.CylinderGeometry(0.1, 0.06, 0.9, 14);
  tubeGeo.rotateX(Math.PI / 2);
  tube.add(mesh(tubeGeo, toon('#ffd166'), 0, 0, 0.1));
  tube.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14).rotateX(Math.PI / 2), toon(PALETTE.ink), 0, 0, 0.55));
  tube.position.y = 1.08;
  scope.add(tube);
  scope.position.set(minX + 0.9, floorY, minZ + 0.9);
  group.add(scope);
  tube.lookAt(-6, 0.8, 0);
  colliders.push({ minX: minX + 0.65, maxX: minX + 1.15, minZ: minZ + 0.65, maxZ: minZ + 1.15, bottom: floorY, top: floorY + 1.3 });

  for (const [px, pz, s] of [
    [maxX - 0.6, minZ + 0.6, 1],
    [maxX - 0.6, maxZ - 0.6, 1.2],
  ]) {
    const p = plant(s);
    p.position.set(px, floorY, pz);
    group.add(p);
    const r = 0.3 * s;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, bottom: floorY, top: floorY + 0.5 * s });
  }

  const lamp = pendant();
  lamp.position.set(deskX, roofY - 0.4, cz);
  group.add(lamp);

  // Signs: one on the back wall inside, one over the glass for everyone downstairs.
  const inside = textPlane('👑 Boss Office', { bg: '#fffaf3', size: 64 });
  inside.scale.multiplyScalar(0.8);
  inside.position.set(maxX - 3, floorY + 1.9, maxZ - 0.04);
  inside.rotation.y = Math.PI;
  group.add(inside);
  const outside = textPlane('👑 Boss Office', { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
  outside.scale.multiplyScalar(1.4);
  outside.position.set(cx, roofY + 0.2, minZ - 0.02);
  outside.rotation.y = Math.PI;
  group.add(outside);
  return screen;
}
