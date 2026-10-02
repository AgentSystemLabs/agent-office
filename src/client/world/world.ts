import type * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { LOFT, WALL_HEIGHT, WALL_T, FLOOR, type DeskDef } from '../../shared/layout';
import { OFFICE_PLAN, type BoardKey, type MapPlan, type Spot } from '../../shared/maps';
import { officeNav, wayHome, wayIn, wayToBalcony, type Bounds, type NavGrid, type Pt } from '../../shared/nav';
import type { DungeonView } from './dungeon';
import type { AirlockView } from './station/airlock';
import type { Person } from './character';
import type { Area } from './confetti';
import type { Gong } from '../features/gong/world';
import type { Collider, DeskView, Interactable, Office } from './types';
import type { SkyLights } from './sky';

/*
 * A world: the building's map, built and ready to walk round (see shared/maps). main.ts shows one at
 * a time, the way it swaps the office for the rooftop, and talks to it through this: where the
 * seats and the boards are, what's in the way, how workers walk in and out. The office has a great
 * deal more of its own (the elevator, the balcony, the lounge…), which main.ts only uses while the
 * office is the world.
 */

/** The ways a worker walks, on this map. */
export interface Ways {
  /**
   * Out of the building from `seat`, or from `from` if it's already up and about: the first point
   * is where it gets down. `chute`: it goes over the balcony railing by parachute at the end.
   */
  home(seat: DeskDef, from?: Pt): { way: Pt[]; chute: boolean };
  /** In to beside `seat`'s chair, from wherever workers come in (the office's elevator, the castle's doors). */
  in(seat: DeskDef): Pt[];
}

export interface World {
  plan: MapPlan;
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** What a click at the scene can land on. */
  pickables: THREE.Object3D[];
  /** Every seat by id: the desks, the overflow seats, the board agents' places and the meeting chairs. */
  desks: Map<string, DeskView>;
  boardMeshes: Record<BoardKey, THREE.Mesh>;
  /** The meeting's output as it's written, and how the meeting's going, where the map shows them. */
  meetingBoard?: THREE.Mesh;
  meetingSign?: THREE.Mesh;
  /** The gong a merged pull request rings, if the map has one. */
  gong?: Gong;
  nav: NavGrid;
  ways: Ways;
  /** Where confetti rains when a pull request merges, and from how high over each spot. */
  rain: { area: Area; top: (x: number, z: number) => number }[];
  /** What the workers work on: laptops, or the castle's tomes. */
  device: 'laptop' | 'tome';
  /**
   * How thick its outside walls are, for keeping the camera on your side of them; `enclosed`: walled
   * and roofed all round, so no rain falls in it and there's no street or garage under it. `vault`: a
   * room under the floor (the dungeon), up to `top`, that the camera keeps inside while you're down there.
   */
  room: { wall: number; enclosed: boolean; vault?: Bounds & { top: number } };
  /**
   * Where the sounds are, when it isn't the office: its gong, and the windows sounds from outside come
   * in at. `vacuum`: there's nothing outside to hear (a station out in space).
   */
  acoustics?: { gong: { x: number; y: number; z: number } | null; windows: { x: number; y: number; z: number }[]; vacuum?: boolean };
  /** Whoever stands by the throne and sends out new workers (the map's herald), and where to speak to them. */
  herald?: { person: Person; interactable: Interactable };
  /** Brings out the overflow seats in `out` and puts the rest away: the colliders of the ones that just came out. */
  setBeanbags(out: Set<string>): Collider[];
  /** Paints it in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  setProjectName(name: string): void;
  /** Animates it; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
  /** Lights it its own way, after the sky's had its say (the castle's torchlit hall). `daylight` is 1 by day, 0 at night; `eye` is where you're looking from. */
  mood?(lights: SkyLights & { scene: THREE.Scene }, daylight: number, t: number, eye?: THREE.Vector3): void;
  /** A dungeon under the floor, where workers sent home can be locked up (see shared/maps/dungeon.ts). */
  dungeon?: DungeonView;
  /** An airlock in a wall, which workers sent home can be blown out of (see shared/maps/airlock.ts). */
  airlock?: AirlockView;
  /**
   * Who comes for a worker sent home (MapPlan.sendHome.escort): where they keep watch, the one on
   * watch there, and how to call out another like them while that one's busy.
   */
  escort?: { post: Spot & { below: boolean }; guard: Person; make(): Person };
  /** Frees what it's made of: it's been taken down for good (a map of your own was edited, and is built again). */
  dispose?(): void;
}

/** Where confetti rains from over (x, z) downstairs in the office: the ceiling, or under the loft, the underside of its floor. */
function ceilingOver(x: number, z: number): number {
  const loft = x > LOFT.minX && x < LOFT.maxX && z > LOFT.minZ && z < LOFT.maxZ;
  return loft ? LOFT.y - 0.35 : WALL_HEIGHT - 0.1;
}

/**
 * The office as a world. `upstairs` says whether this floor is above the bottom one (no exit door:
 * workers leave by the balcony), and `wing` how many rows its back office is built out (see WING).
 */
export function officeWorld(office: Office, upstairs: () => boolean, wing: () => number): World {
  return {
    plan: OFFICE_PLAN,
    group: office.group,
    colliders: office.colliders,
    interactables: office.interactables,
    pickables: [office.group],
    desks: office.desks,
    boardMeshes: office.boardMeshes,
    meetingBoard: office.meetingBoard,
    meetingSign: office.meetingSign,
    gong: office.gong,
    get nav() {
      return officeNav(wing());
    },
    ways: {
      home: (seat) => (upstairs() ? { way: wayToBalcony(seat, wing()), chute: true } : { way: wayHome(seat, wing()), chute: false }),
      in: (seat) => wayIn(seat, wing()),
    },
    rain: [
      { area: FLOOR, top: ceilingOver },
      { area: LOFT, top: () => LOFT.y + LOFT.height - 0.1 },
    ],
    device: 'laptop',
    room: { wall: WALL_T, enclosed: false },
    setBeanbags: (out) => office.setBeanbags(out),
    setLook: (p) => office.setLook(p),
    setProjectName: (name) => office.setProjectName(name),
    update: (t, dt, people) => office.update(t, dt, people),
  };
}
