import type * as THREE from 'three';
import { boxFootprint } from '../../../shared/maps/props';
import type { Gong } from '../../features/gong/world';
import type { Collider, DeskView, Interactable } from '../types';
import { toon } from '../toon';
import { shade } from './textures';

// What every part of the castle is built with: its sizes, the Kit the builder hands each part, the
// materials in the map's colors, and how a part says what's in the way.

/** The most torches and braziers that light the room for real (the rest just glow). */
export const MAX_LIGHTS = 8;
export const TABLE_TOP = 0.78;
export const BENCH_TOP = 0.45;
export const DOORWAY = { width: 5, height: 6.6 } as const;

/** The hall's outside walls are this thick. */
export const WALL = 0.6;

/** What the builder hands the props: where to put meshes, what's in the way, and the fires to animate. */
export interface Kit {
  /** The top of whatever the floor is at (x, z): the dais, or the floor. */
  floorAt(x: number, z: number): number;
  group: THREE.Group;
  /** Merged into a few draw calls at the end: whatever never moves. */
  still: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  flames: Flame[];
  lights: { light: THREE.PointLight; base: number; phase: number }[];
  mats: Mats;
  height: number;
  /** Every seat by id, as it's built. */
  desks: Map<string, DeskView>;
  /** What paints itself over later: the stained glass (dimmer at night), the banners and the shields (in a floor's colors). */
  glass: THREE.MeshBasicMaterial[];
  banners: Banner[];
  shields: THREE.MeshToonMaterial[];
  /** How many windows so far, so each one's glass is its own pattern. */
  windows: number;
  gong?: Gong;
}

export interface Mats {
  stone: THREE.Material;
  stoneDark: THREE.Material;
  wood: THREE.Material;
  woodDark: THREE.Material;
  iron: THREE.Material;
  steel: THREE.Material;
  gold: THREE.Material;
  carpet: THREE.Material;
  velvet: THREE.Material;
  parchment: THREE.Material;
  candle: THREE.Material;
}

export interface Flame {
  mesh: THREE.Object3D;
  glow: THREE.Sprite;
  size: number;
  phase: number;
}

/** The banners, to repaint in a floor's colors; the great one with the project's name on it. */
export interface Banner {
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
  great: boolean;
}

/** The colors of the stone and the rest, as the map's palette has them. */
export function materials(pal: { stone: string; wood: string; trim: string; carpet: string }): Mats {
  return {
    stone: toon(pal.stone),
    stoneDark: toon(shade(pal.stone, -0.1)),
    wood: toon(pal.wood),
    woodDark: toon(shade(pal.wood, -0.1)),
    iron: toon('#2f3036'),
    steel: toon('#a3a9b2'),
    gold: toon(pal.trim),
    carpet: toon(pal.carpet),
    velvet: toon('#6d1414'),
    parchment: toon('#efe3c2'),
    candle: toon('#f3ead2'),
  };
}

/** Something `w` by `d` at (x, z), turned `rotY`, standing `top` high: in the way (see Collider). */
export function collide(kit: Kit, x: number, z: number, w: number, d: number, rotY: number, top: number, extra: Partial<Collider> = {}) {
  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, d, rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top, ...extra });
}

export const xz = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });
