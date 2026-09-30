import * as THREE from 'three';
import { BALCONY_DOOR, BEANBAGS, BOARDS, BOOKSHELF, CABINET, DESKS, DESK_SIZE, ELEVATOR, EXIT_DOOR, FLOOR, GONG, JUKEBOX, KIOSK, LADDER, LOFT, MACHINE_MONITOR, MEETING_BOARD, PLANTS, SEATING_BY_ID, SLAB, STAIRS, STATIONS, STOREY, STREET_Y, TV, WALL_HEIGHT, WINDOWS, WING, deskSeat, plantByWing, streetBelow } from '../../../shared/layout';
import { wallFacing, type WallId, type WallRect } from '../../../shared/decor';
import { deskPoint } from '../../../shared/nav';
import type { FloorPalette } from '../../../shared/floors';
import { buildGarage, buildStreet, type NightParts } from '../outside';
import { Fleet } from '../cars';
import { buildScenic } from '../scenic';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from '../toon';
import { buildElevator } from '../elevator';
import { buildGong } from '../gong';
import { buildJukebox } from '../jukebox';
import { buildBookshelf } from '../bookshelf';
import { buildCabinet } from '../cabinet';
import { buildWhiteboard } from '../whiteboard';
import { buildGreen, buildTee } from '../golf';
import { buildStack } from '../stack';
import { buildTower } from '../tower';
import { buildHoop } from '../hoop';
import { buildKitchen } from '../kitchen';
import { buildDeskSigns } from '../desksigns';
import { HOOP } from '../../../shared/hoop';
import type { Collider, DeskView, Interactable, Office } from '../types';
import { PALETTE, floorTexture, paintPlanks, type Looks } from './materials';
import { coffeeTable, floorPlant, loungeCouch, pendant, plant, pouf, wallBoard } from './props';
import { balconyDoor, buildWalls, exitDoor, exitPlug, wetPane, windowIn, type Door } from './shell';
import { buildBalcony, buildBalconyPosts, buildExitStairs } from './balcony';
import { buildWing } from './wing';
import { BEANBAG_BOX, buildBeanbag, buildDesk, buildKiosk, seatable } from './seats';
import { buildMeetingRoom } from './meeting-room';
import { buildLoft } from './loft';

// The office floor, put together from the pieces in this folder: the room and its walls, the desks and
// everything else in it, the balcony, the loft and the meeting room under it, the back office, and the
// street, the garage and the rest of the building round it.

export function buildOffice(): Office {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const fixtures: WallRect[] = [];
  const fixture = (wall: WallId, u: number, y: number, w: number, h: number) => fixtures.push({ wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 });

  // What each floor paints its own way (see setLook): the walls, their trim, the planks.
  const looks: Looks = { wall: toonUnique(PALETTE.wall), trim: toonUnique(PALETTE.wallTrim), planks: [] };

  // Floor, and the ceiling, with the ways up and down to the other floors through them (see stack.ts).
  const floorTex = floorTexture();
  looks.planks.push(floorTex);
  const floorMat = new THREE.MeshToonMaterial({ map: floorTex, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const stack = buildStack(colliders, floorMat);
  stack.set({ index: 0, count: 1 });
  group.add(stack.group);
  interactables.push(...stack.interactables);
  // The ladder and its sign, up the west wall.
  fixture('west', LADDER.z + 0.6, WALL_HEIGHT / 2, LADDER.width + 2.4, WALL_HEIGHT);

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
    street: STREET_Y,
    clouds: toonUnique('#ffffff'),
    wetGlass: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, visible: false }),
    glows: [],
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
  // Out the glass doors on the south wall: the balcony.
  const slider = balconyDoor();
  group.add(slider.group);
  doors.push(slider.door);
  fixture(BALCONY_DOOR.wall, BALCONY_DOOR.u, (BALCONY_DOOR.y1 + 0.1) / 2, BALCONY_DOOR.width + 0.2, BALCONY_DOOR.y1 + 0.1);
  buildBalcony(group, colliders, interactables, night);
  const tee = buildTee(group, colliders, interactables);

  // Down to the street, which is the bottom floor's: its exit door and the steps down from it, the
  // posts under its balcony, the garage under it and the street out front. On a floor above it, all
  // of it is that many storeys further down (see setLevel).
  const ground = new THREE.Group();
  const groundColliders: Collider[] = [];
  const exit = exitDoor(night);
  ground.add(exit.group);
  doors.push(exit.door);
  const stairs = new THREE.Group();
  buildExitStairs(stairs, groundColliders);
  buildBalconyPosts(stairs, groundColliders);
  ground.add(mergeByMaterial(stairs));
  // The door, its frame and the EXIT sign over it.
  fixture(EXIT_DOOR.wall, EXIT_DOOR.u, (EXIT_DOOR.y1 + 0.7) / 2, EXIT_DOOR.width + 0.3, EXIT_DOOR.y1 + 0.7);
  buildGarage(ground, groundColliders);
  // The cars move, so their boxes follow them (and the street) themselves rather than setLevel.
  const cars = new Fleet(colliders, interactables);
  ground.add(cars.group);
  // The clouds stay up in the sky, however far down the street is.
  buildStreet(ground, groundColliders, night, group);
  const green = buildGreen(ground, groundColliders, night);
  // Off either end of the street, the scenic loop: the farm, the pines, the mountains and the beach.
  const scenic = buildScenic(ground, groundColliders, night);
  group.add(ground);
  colliders.push(...groundColliders);
  const groundBase = groundColliders.map((c) => ({ c, top: c.top, bottom: c.bottom ?? 0 }));
  // Upstairs there's no way out on the west side: the doorway is wall like the rest of it.
  const plug = exitPlug(looks);
  group.add(plug.group);
  // The rest of the building, above and below this floor.
  const tower = buildTower(colliders, night);
  group.add(tower.group);

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
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: FLOOR.minZ, maxZ: Math.max(...zs), top: 1.5, fence: true });
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

  // Lounge: TV, couch, coffee table, beanbags, and the jukebox and the arcade in the corner
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

  // The machine monitor between the west windows, facing the desks.
  const monitor = new THREE.Group();
  const bezel = mesh(roundedBox(MACHINE_MONITOR.width + 0.16, 0.1, MACHINE_MONITOR.height + 0.16, 0.06), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  monitor.add(bezel);
  const machineScreen = new THREE.Mesh(new THREE.PlaneGeometry(MACHINE_MONITOR.width, MACHINE_MONITOR.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  machineScreen.position.z = 0.06;
  monitor.add(machineScreen);
  monitor.position.set(MACHINE_MONITOR.x + 0.07, MACHINE_MONITOR.y, MACHINE_MONITOR.z);
  monitor.rotation.y = Math.PI / 2;
  group.add(monitor);
  fixture('west', MACHINE_MONITOR.z, MACHINE_MONITOR.y, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2);

  // The couch, its back to the room, turned from the model's +z to face the TV on the east wall (+x).
  const couch = loungeCouch();
  couch.position.set(10.5, 0, 0);
  couch.rotation.y = Math.PI / 2;
  group.add(couch);
  // Its top on the seat cushions, so someone standing on the couch stands on them.
  colliders.push({ minX: 10, maxX: 11, minZ: -2.2, maxZ: 2.2, top: 0.47 });
  seatable(couch, 'couch', 2.6, interactables);

  const table = coffeeTable();
  table.position.set(13, 0, 0);
  group.add(table);
  colliders.push({ minX: 12.2, maxX: 13.8, minZ: -0.8, maxZ: 0.8, top: 0.46 });
  const lounge = mesh(roundedBox(7, 0.02, 7, 1.2), toon('#ffc6ff'), 13.4, 0.011, 0, false);
  group.add(lounge);

  // A pouf either side of the lounge (the seats still called beanbags), turned to the TV like whoever sits on it.
  for (const [i, [color, x, z]] of (
    [
      ['#06d6a0', 12.5, 3.5],
      ['#ffd166', 14.5, -3.4],
    ] as const
  ).entries()) {
    const id = `lounge-beanbag-${i + 1}`;
    const seat = pouf(color);
    seat.position.set(x, 0, z);
    seat.rotation.y = SEATING_BY_ID.get(id)!.rotY;
    group.add(seat);
    // Its top on the pouf's, the button in the middle of it.
    colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, top: 0.42 });
    seatable(seat, id, 1.4, interactables);
  }
  const jukebox = buildJukebox();
  group.add(jukebox.group);
  colliders.push(jukebox.collider);
  interactables.push(jukebox.interactable);
  fixture('east', JUKEBOX.z, JUKEBOX.height / 2, JUKEBOX.width + 0.1, JUKEBOX.height);
  const cabinet = buildCabinet();
  group.add(cabinet.group);
  colliders.push(cabinet.collider);
  interactables.push(cabinet.interactable);
  fixture('east', CABINET.z, CABINET.height / 2, CABINET.width + 0.1, CABINET.height);

  // The bookshelf of the project's docs, on the south wall between the middle window and the balcony doors.
  const shelf = buildBookshelf();
  group.add(shelf.group);
  colliders.push(shelf.collider);
  interactables.push(shelf.interactable);
  fixture('south', BOOKSHELF.x, (BOOKSHELF.height + 0.55) / 2, BOOKSHELF.width + 0.2, BOOKSHELF.height + 0.55);

  // Kitchen corner: counter + coffee machine + fridge
  const kitchen = buildKitchen();
  group.add(kitchen.group);
  colliders.push(...kitchen.colliders);
  interactables.push(kitchen.interactable);
  // Counter, coffee machine and fridge, in front of the south wall.
  fixture('south', -14.5, 0.55, 5.1, 1.1);
  fixture('south', -15.7, 0.9, 0.6, 1.8);
  fixture('south', -11.3, 1.1, 1.1, 2.2);

  // Plants around the room
  const plants: THREE.Group[] = [];
  /** The ones in the way into the back office, and their colliders, to put away while it's built. */
  const plantsByWing: { group: THREE.Group; collider: Collider }[] = [];
  for (const [i, spot] of PLANTS.entries()) {
    const [x, z, s] = spot;
    const p = plant(floorPlant(i), s);
    p.position.set(x, 0, z);
    group.add(p);
    plants.push(p);
    const r = 0.3 * s;
    const collider: Collider = { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s };
    colliders.push(collider);
    if (plantByWing(spot)) plantsByWing.push({ group: p, collider });
  }

  // Ceiling lamps (cartoon pendants), hung on long cords down from the high ceiling.
  const lampY = 4.05;
  for (const [x, z] of [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
    [13, 0],
  ]) {
    const lamp = pendant(WALL_HEIGHT - lampY);
    lamp.position.set(x, lampY, z);
    group.add(lamp);
    night.halos.push({ at: new THREE.Vector3(x, lampY - 0.12, z), size: 1.3, color: '#ffe08a' });
  }

  // The back office through the north wall past the gong, walled up until the floor's built out.
  const wing = buildWing(group, colliders, interactables, desks, looks, trimMat, floorMat, stack.ceiling, night);
  fixture('north', (WING.minX + FLOOR.maxX) / 2, WALL_HEIGHT / 2, FLOOR.maxX - WING.minX, WALL_HEIGHT);
  const setWing = (level: number) => {
    wing.set(level);
    for (const p of plantsByWing) {
      const out = wing.level === 0;
      if (p.group.visible === out) continue;
      p.group.visible = out;
      const i = colliders.indexOf(p.collider);
      if (out && i < 0) colliders.push(p.collider);
      else if (!out && i >= 0) colliders.splice(i, 1);
    }
  };
  // The signs over the desks.
  const signs = buildDeskSigns();
  group.add(signs.group);

  const bossScreen = buildLoft(group, colliders, interactables, looks);
  // Under the loft: the meeting room.
  const meeting = buildMeetingRoom(group, colliders, interactables, desks, doors, night);
  fixture('south', MEETING_BOARD.x, MEETING_BOARD.y, MEETING_BOARD.width + 0.4, MEETING_BOARD.height + 0.4);

  // The elevator to the other floors, against the north wall between the PR board and the gong.
  const elevator = buildElevator();
  group.add(elevator.group);
  colliders.push(...elevator.colliders);
  interactables.push(elevator.interactable);
  fixture('north', ELEVATOR.x, WALL_HEIGHT / 2, ELEVATOR.width + 0.1, WALL_HEIGHT);
  // Its stop in the garage, at the bottom of the same shaft: as tall as the garage, and as far down
  // as the street is (see setLevel).
  const garageLift = buildElevator(-SLAB - STREET_Y);
  garageLift.setSign('🛗 Garage');
  group.add(garageLift.group);
  colliders.push(...garageLift.colliders);
  interactables.push(garageLift.interactable);

  // The gong, just past the elevator from the PR board.
  const gong = buildGong();
  group.add(gong.group);
  colliders.push(...gong.colliders);
  interactables.push(gong.interactable);
  fixture('north', GONG.x, (GONG.height + 0.3) / 2, GONG.width + 1.2, GONG.height + 0.3);

  // The basketball hoop, on the west wall between the exit door and the kitchen.
  const hoop = buildHoop();
  group.add(hoop.group);
  colliders.push(...hoop.colliders);
  fixture('west', HOOP.z, (HOOP.board.bottom - 0.6 + HOOP.board.top + 0.1) / 2, HOOP.board.width + 0.2, HOOP.board.top - HOOP.board.bottom + 0.7);

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

  const setLevel = (index: number, count: number, wings: readonly number[] = []) => {
    const drop = index * STOREY;
    ground.position.y = -drop;
    for (const g of groundBase) {
      // Walls up into the sky stay that way.
      if (g.top <= 50) g.c.top = g.top - drop;
      g.c.bottom = g.bottom - drop;
    }
    night.street = streetBelow(index);
    exit.door.y = -drop;
    exit.door.locked = index > 0;
    garageLift.setFloor(streetBelow(index));
    cars.setStreet(streetBelow(index));
    plug.group.visible = index > 0;
    const i = colliders.indexOf(plug.collider);
    if (index > 0 && i < 0) colliders.push(plug.collider);
    else if (index === 0 && i >= 0) colliders.splice(i, 1);
    tower.set(index, count, wings);
  };
  setLevel(0, 1);

  const update = (t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>) => {
    const near = new Set<Door>();
    for (const p of people) for (const d of doors) if (Math.abs(p.y - d.y) < 1.6 && Math.hypot(p.x - d.x, p.z - d.z) < 2.4) near.add(d);
    for (const d of doors) {
      const want = near.has(d) && !d.locked ? 1 : 0;
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
    garageLift.update(dt);
    gong.update(dt);
    green.update(t);
    scenic.update(t);
    hoop.update(dt);
  };

  return { group, colliders, interactables, desks, setBeanbags, boardMeshes, tvScreen, bossScreen, machineScreen, meetingBoard: meeting.board, meetingSign: meeting.sign, fixtures: () => fixtures, elevator, garageLift, cars, scenic, gong, jukebox, cabinet, whiteboard, tee, green, hoop, stack, wing, setWing, signs, setProjectName, setLook, setLevel, night, plants, update };
}
