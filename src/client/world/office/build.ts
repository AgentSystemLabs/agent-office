import * as THREE from 'three';
import type { WallRect } from '../../../shared/decor';
import type { FloorPalette } from '../../../shared/floors';
import { street } from '../outside';
import { cars } from '../../features/cars/world';
import { scenic } from '../scenic';
import { toon, toonUnique } from '../toon';
import { elevator, garageLift } from '../elevator';
import { gong } from '../../features/gong/world';
import { jukebox } from '../../features/jukebox/world';
import { bookshelf } from '../../features/bookshelf/world';
import { cabinet } from '../../features/cabinet/world';
import { whiteboard } from '../../features/whiteboard/world';
import { green, tee } from '../../features/golf/world';
import { stack } from '../stack';
import { tower } from '../tower';
import { hoop } from '../../features/basketball/world';
import { kitchen } from '../kitchen';
import { signs } from '../desksigns';
import type { Collider, DeskView, Interactable, Office, OfficeHandles } from '../types';
import { PALETTE, floorTexture, paintPlanks, type Looks } from './materials';
import { boards, clearOfStairs, lamps, lounge, machineMonitor, nightLights, plants, rugs, tv } from './room';
import { plug, walls, type Door } from './shell';
import { balcony } from './balcony';
import { downstairs } from './ground';
import { wing } from './wing';
import { beanbags, desks, kiosks } from './seats';
import { meetingRoom } from './meeting-room';
import { loft } from './loft';
import type { Fixture, Gives, Site } from './fixture';

// The office floor, put together from its fixtures (see fixture.ts): the room and its walls, the desks
// and everything else in it, the balcony, the loft and the meeting room under it, the back office, and
// the street, the garage and the rest of the building round it.

/**
 * The office floor's fixtures, in the order they're built: which is the order everything in the floor
 * is made and added in, so keep it (a new one goes where it belongs among them).
 */
function floorPlan() {
  return [
    stack,
    rugs,
    nightLights,
    walls,
    balcony,
    tee,
    ...downstairs(cars, street, green, scenic),
    plug,
    tower,
    desks,
    beanbags,
    kiosks,
    boards,
    // The lounge: the TV, the couch and its table and poufs, and the jukebox and the arcade in the corner.
    tv,
    machineMonitor,
    lounge,
    jukebox,
    cabinet,
    bookshelf,
    kitchen,
    plants,
    lamps,
    wing,
    signs,
    loft,
    meetingRoom,
    elevator,
    garageLift,
    gong,
    hoop,
    whiteboard,
    clearOfStairs,
  ] as const;
}

/** Every field of Office some fixture on the plan gives: this fails to typecheck, naming the field, if one goes without. */
type NoneMissing<Missing extends never> = Missing;
export type EveryHandleGiven = NoneMissing<Exclude<keyof OfficeHandles, Gives<ReturnType<typeof floorPlan>[number]>>>;

export function buildOffice(): Office {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const walls: WallRect[] = [];
  // What each floor paints its own way (see setLook): the walls, their trim, the planks.
  const looks: Looks = { wall: toonUnique(PALETTE.wall), trim: toonUnique(PALETTE.wallTrim), planks: [] };
  // The floor's planks, which the stack lays the floor with (and the back office its own).
  const floorTex = floorTexture();
  looks.planks.push(floorTex);
  const planks = new THREE.MeshToonMaterial({ map: floorTex, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const desks = new Map<string, DeskView>();
  const doors: Door[] = [];
  /** What the fixtures built so far give the office. */
  const given: Partial<OfficeHandles> = {};
  const site: Site = {
    group,
    colliders,
    interactables,
    wall: (wall, u, y, w, h) => void walls.push({ wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 }),
    looks,
    planks,
    desks,
    doors,
    inTheWay: [],
    get: (key) => {
      if (!(key in given)) throw new Error(`The office's ${key} isn't built yet: its fixture comes later in the plan`);
      return given[key]!;
    },
  };

  // Each fixture in turn, with what it hands back.
  const updates: ((t: number, dt: number) => void)[] = [];
  const levels: ((index: number, count: number, wings: readonly number[]) => void)[] = [];
  const plan: readonly Fixture[] = floorPlan();
  for (const fixture of plan) {
    const built = fixture(site);
    if (built.group) group.add(built.group);
    if (built.colliders) colliders.push(...built.colliders);
    if (built.interactables) interactables.push(...built.interactables);
    for (const [key, value] of Object.entries(built.handle ?? {})) {
      if (key in given) throw new Error(`Two of the office's fixtures give it ${key}`);
      Object.assign(given, { [key]: value });
    }
    if (built.update) updates.push(built.update);
    if (built.setLevel) levels.push(built.setLevel);
  }

  const setLook = (p: FloorPalette) => {
    looks.wall.color.set(p.wall);
    looks.trim.color.set(p.trim);
    for (const t of looks.planks) {
      paintPlanks(t.image as HTMLCanvasElement, p);
      t.needsUpdate = true;
    }
  };

  const setLevel = (index: number, count: number, wings: readonly number[] = []) => {
    for (const level of levels) level(index, count, wings);
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
    for (const u of updates) u(t, dt);
  };

  return { ...(given as OfficeHandles), group, colliders, interactables, desks, fixtures: () => walls, setLook, setLevel, update };
}
