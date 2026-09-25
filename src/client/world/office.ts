import * as THREE from 'three';
import { BOARDS, DESKS, DESK_SIZE, FLOOR, TV, WALL_HEIGHT, deskSeat, type DeskDef } from '../../shared/layout';
import { mesh, roundedBox, textSprite, toon } from './toon';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export type InteractKind = 'desk' | 'issues' | 'pulls' | 'tv' | 'coffee';

export interface Interactable {
  kind: InteractKind;
  x: number;
  z: number;
  radius: number;
  deskId?: string;
}

export interface DeskView {
  def: DeskDef;
  group: THREE.Group;
  /** Local-space anchor for the laptop (on the desk top). */
  laptopAnchor: THREE.Object3D;
  /** Local-space anchor where the worker sits. */
  seatAnchor: THREE.Object3D;
  chair: THREE.Group;
  vacancy: THREE.Group;
}

export interface Office {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  desks: Map<string, DeskView>;
  boardMeshes: { issues: THREE.Mesh; pulls: THREE.Mesh };
  tvScreen: THREE.Mesh;
  setProjectName(name: string): void;
  update(t: number): void;
}

const PALETTE = {
  floor: '#f2d7b0',
  floorAlt: '#e9c89a',
  wall: '#fff6ea',
  wallTrim: '#e8a87c',
  desk: '#f7f3ea',
  deskLeg: '#3d405b',
  wood: '#c98b5a',
  cork: '#d8a86a',
  chairs: ['#ff8a5b', '#5bc0eb', '#9bc53d', '#b388eb', '#ffb400', '#f7aef8'],
  rugs: ['#bde0fe', '#ffd6a5', '#caffbf', '#ffc6ff'],
  plant: '#5fb760',
  plantDark: '#3f8f45',
  pot: '#e76f51',
  glass: '#bfe6ff',
  ink: '#2b2d42',
};

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE.floor;
  g.fillRect(0, 0, 512, 512);
  // Chunky planks
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + offset;
      g.fillStyle = (row + col) % 3 === 0 ? PALETTE.floorAlt : PALETTE.floor;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
    }
    g.fillStyle = '#d9b88c';
    g.fillRect(0, row * 64, 512, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((FLOOR.maxX - FLOOR.minX) / 6, (FLOOR.maxZ - FLOOR.minZ) / 6);
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

function buildDesk(def: DeskDef, index: number): DeskView {
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
  group.add(mesh(box(width - 0.3, 0.32, 0.03), toon(PALETTE.wallTrim), 0, height - 0.26, -depth / 2 + 0.06));
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
  laptopAnchor.position.set(0, height, 0.02);
  group.add(laptopAnchor);

  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0, 0.85);
  group.add(seatAnchor);

  const ch = chair(PALETTE.chairs[index % PALETTE.chairs.length]);
  ch.position.set(0, 0, 0.9);
  group.add(ch);

  // Floating "vacancy" marker shown on empty desks.
  const vacancy = new THREE.Group();
  const plus = new THREE.Group();
  const plusMat = toon('#7cf29a', { emissive: '#1f7a3a' });
  plus.add(mesh(box(0.28, 0.08, 0.08), plusMat, 0, 0, 0, false));
  plus.add(mesh(box(0.08, 0.28, 0.08), plusMat, 0, 0, 0, false));
  vacancy.add(plus);
  vacancy.position.set(0, height + 0.55, 0);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, chair: ch, vacancy };
}

function corkBoard(width: number, height: number): { group: THREE.Group; face: THREE.Mesh } {
  const group = new THREE.Group();
  const frame = mesh(roundedBox(width + 0.3, 0.12, height + 0.3, 0.1), toon(PALETTE.wood), 0, 0, 0);
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
  const width = FLOOR.maxX - FLOOR.minX;
  const depth = FLOOR.maxZ - FLOOR.minZ;
  const cx = (FLOOR.maxX + FLOOR.minX) / 2;
  const cz = (FLOOR.maxZ + FLOOR.minZ) / 2;

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshToonMaterial({ map: floorTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  group.add(floor);

  // Outside ground so windows don't look into the void
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), toon('#a7d98b'));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  group.add(lawn);

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

  // Walls
  const wallMat = toon(PALETTE.wall);
  const trimMat = toon(PALETTE.wallTrim);
  const T = 0.3;
  const walls: [number, number, number, number][] = [
    // x, z, w, d
    [cx, FLOOR.minZ - T / 2, width + T * 2, T],
    [cx, FLOOR.maxZ + T / 2, width + T * 2, T],
    [FLOOR.minX - T / 2, cz, T, depth],
    [FLOOR.maxX + T / 2, cz, T, depth],
  ];
  for (const [x, z, w, d] of walls) {
    group.add(mesh(box(w, WALL_HEIGHT, d), wallMat, x, WALL_HEIGHT / 2, z));
    group.add(mesh(box(w + 0.02, 0.25, d + 0.04), trimMat, x, 0.125, z, false));
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
  }

  // Windows on the south and west walls
  const glass = toon(PALETTE.glass, { emissive: '#4b7fa3' });
  const frameMat = toon('#ffffff');
  for (let x = -14; x <= 14; x += 5) {
    const w = new THREE.Group();
    w.add(mesh(box(3.2, 2, 0.1), frameMat, 0, 0, 0, false));
    w.add(mesh(box(2.9, 1.7, 0.12), glass, 0, 0, 0, false));
    w.add(mesh(box(0.08, 1.7, 0.14), frameMat, 0, 0, 0, false));
    w.position.set(x, 2.2, FLOOR.maxZ - 0.02);
    group.add(w);
  }
  for (let z = -9; z <= 9; z += 6) {
    if (z > 6) continue;
    const w = new THREE.Group();
    w.add(mesh(box(0.1, 2, 3.2), frameMat, 0, 0, 0, false));
    w.add(mesh(box(0.12, 1.7, 2.9), glass, 0, 0, 0, false));
    w.add(mesh(box(0.14, 1.7, 0.08), frameMat, 0, 0, 0, false));
    w.position.set(FLOOR.minX + 0.02, 2.2, z);
    group.add(w);
  }

  // Desks
  const desks = new Map<string, DeskView>();
  DESKS.forEach((def, i) => {
    const view = buildDesk(def, i);
    group.add(view.group);
    desks.set(def.id, view);
    const hw = DESK_SIZE.width / 2 - 0.05;
    const hd = DESK_SIZE.depth / 2 - 0.02;
    colliders.push({ minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height });
    const seat = deskSeat(def, 1.25);
    interactables.push({ kind: 'desk', deskId: def.id, x: seat.x, z: seat.z, radius: 1.3 });
  });

  // Cork boards on the north wall
  const boardMeshes = {} as Office['boardMeshes'];
  for (const key of ['issues', 'pulls'] as const) {
    const b = BOARDS[key];
    const { group: bg, face } = corkBoard(b.width, b.height);
    bg.position.set(b.x, b.y, b.z + 0.08);
    group.add(bg);
    boardMeshes[key] = face;
    const label = textSprite(b.label, { bg: '#fffaf3', size: 64 });
    label.scale.multiplyScalar(1.3);
    label.position.set(b.x, b.y + b.height / 2 + 0.5, b.z + 0.3);
    group.add(label);
    interactables.push({ kind: key, x: b.x, z: b.z + 1.6, radius: 2.4 });
  }

  // Lounge: TV, couch, coffee table, beanbags
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(TV.width + 0.3, 0.14, TV.height + 0.3, 0.12), toon(PALETTE.ink), 0, 0, 0));
  (tvGroup.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(TV.width, TV.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e' }));
  tvScreen.position.z = 0.08;
  tvGroup.add(tvScreen);
  tvGroup.position.set(TV.x - 0.1, TV.y, TV.z);
  tvGroup.rotation.y = -Math.PI / 2;
  group.add(tvGroup);
  interactables.push({ kind: 'tv', x: TV.x - 4.5, z: TV.z, radius: 3.2 });

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
  ].forEach(([c, x, z]) => {
    const bean = mesh(new THREE.SphereGeometry(0.6, 16, 12), toon(c as string), x as number, 0.35, z as number);
    bean.scale.y = 0.6;
    group.add(bean);
    colliders.push({ minX: (x as number) - 0.5, maxX: (x as number) + 0.5, minZ: (z as number) - 0.5, maxZ: (z as number) + 0.5, top: 0.6 });
  });

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
  interactables.push({ kind: 'coffee', x: -15.7, z: 10.9, radius: 1.4 });

  // Plants around the room
  const plants: [number, number, number][] = [
    [-17.2, -12.2, 1.4],
    [17.2, -12.2, 1.5],
    [17.2, 12.2, 1.3],
    [-17.2, 8.5, 1.2],
    [5.5, -12.2, 1.1],
    [-6, 0, 1],
    [3.5, 0, 0.9],
    [8.5, 5, 1.1],
  ];
  for (const [x, z, s] of plants) {
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
    const lamp = new THREE.Group();
    lamp.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), toon(PALETTE.ink), 0, 0.3, 0, false));
    lamp.add(mesh(new THREE.ConeGeometry(0.5, 0.45, 16, 1, true), toon('#ffd166'), 0, 0, 0, false));
    lamp.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, -0.15, 0, false));
    lamp.position.set(x, WALL_HEIGHT - 0.15, z);
    lamp.scale.setScalar(0.8);
    group.add(lamp);
  }

  let nameSprite: THREE.Sprite | null = null;
  const setProjectName = (name: string) => {
    if (nameSprite) group.remove(nameSprite);
    nameSprite = textSprite(`📁 ${name}`, { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
    nameSprite.position.set(8, 2.6, FLOOR.minZ + 0.4);
    nameSprite.scale.multiplyScalar(2.2);
    group.add(nameSprite);
  };

  const update = (t: number) => {
    for (const d of desks.values()) {
      if (!d.vacancy.visible) continue;
      d.vacancy.position.y = DESK_SIZE.height + 0.55 + Math.sin(t * 2 + d.def.x) * 0.06;
      d.vacancy.rotation.y = t * 1.2;
    }
  };

  return { group, colliders, interactables, desks, boardMeshes, tvScreen, setProjectName, update };
}
