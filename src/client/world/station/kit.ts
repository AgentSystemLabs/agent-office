import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapPlan } from '../../../shared/maps';
import { boxFootprint } from '../../../shared/maps/props';
import type { Gong } from '../../features/gong/world';
import type { Collider, DeskView, Interactable } from '../types';
import { mesh, toon } from '../toon';

// What every part of the station is built with: its sizes, the Kit the builder hands each part, the
// materials in the map's colors, and how a part says what's in the way.

/** The most light pods that light the deck for real (the rest just glow). */
export const MAX_LIGHTS = 6;
export const TABLE_TOP = 0.78;
export const BENCH_TOP = 0.45;
/** How big one tile of the hull's panelling and of the deck's plating is (m). */
export const PANEL = 3;
export const PLATE = 2;

/** What the builder hands each part: where to put meshes, what's in the way, and what moves or glows. */
export interface Kit {
  plan: MapPlan;
  /** The top of whatever the deck is at (x, z): the bridge, or the deck. */
  floorAt(x: number, z: number): number;
  group: THREE.Group;
  /** Merged into a few draw calls at the end: whatever never moves, and has no picture on it. */
  still: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  mats: Mats;
  height: number;
  /** Every seat by id, as it's built. */
  desks: Map<string, DeskView>;
  lights: THREE.PointLight[];
  /** What turns, and how fast (rad/s, about y). */
  spinners: { obj: THREE.Object3D; speed: number }[];
  /** What pulses: `set` is handed 0–1, `rate` times a second, each `phase` out of step. */
  pulses: { set(k: number): void; rate: number; phase: number }[];
  gong?: Gong;
}

export interface Mats {
  /** The hull's panels, pale, and the darker metal of its frames, ribs and furniture. */
  hull: THREE.Material;
  hullDark: THREE.Material;
  panel: THREE.Material;
  metal: THREE.Material;
  metalDark: THREE.Material;
  black: THREE.Material;
  /** Padding: seats, and the captain's chair. */
  pad: THREE.Material;
  white: THREE.Material;
  /** Light that's the map's own (its `glow`): holograms, displays, the pods overhead. */
  glow: THREE.MeshBasicMaterial;
  /** Light in the floor's color, so each project's deck is its own: the strips in the deck, the lines round the walls. */
  accent: THREE.MeshBasicMaterial;
  /** A light pod's lens, and warning red. */
  lamp: THREE.MeshBasicMaterial;
  warn: THREE.MeshBasicMaterial;
  glass: THREE.Material;
}

/** `color`, `k` lighter (or darker, below 0). */
export function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}

/** Something that glows: unlit, and without the toon outline. */
export function lit(color: THREE.ColorRepresentation, opts: { opacity?: number; additive?: boolean; side?: THREE.Side } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: opts.side ?? THREE.FrontSide });
  if (opts.opacity !== undefined || opts.additive) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 1;
    m.depthWrite = false;
    if (opts.additive) m.blending = THREE.AdditiveBlending;
  }
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** The colors of the hull and the rest, as the map's palette has them. */
export function materials(pal: { hull: string; panel: string; metal: string; glow: string }): Mats {
  const glass = new THREE.MeshBasicMaterial({ color: '#a9d8ff', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
  glass.userData.outlineParameters = { visible: false };
  return {
    hull: toon(pal.hull),
    hullDark: toon(shade(pal.hull, -0.12)),
    panel: toon(pal.panel),
    metal: toon(pal.metal),
    metalDark: toon(shade(pal.metal, -0.12)),
    black: toon('#1b212b'),
    pad: toon('#2c3644'),
    white: toon('#f4f7fb'),
    glow: lit(pal.glow),
    accent: lit(pal.glow),
    lamp: lit('#f4fbff'),
    warn: lit('#3a0d0d'),
    glass,
  };
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/**
 * A box whose picture tiles across it at `tile` meters a repeat, laid out by where it is in the
 * world (its middle at `at`), so the panels on one piece of wall line up with the next piece's.
 */
export function tileBox(w: number, h: number, d: number, tile: number, at: { x: number; y: number; z: number }): THREE.BufferGeometry {
  const geo = box(w, h, d);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + at.x;
    const y = pos.getY(i) + at.y;
    const z = pos.getZ(i) + at.z;
    if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  geo.translate(at.x, at.y, at.z);
  return geo;
}

/** Pieces with a picture on them (see tileBox), gathered as they're built and merged into one mesh per material. */
export class Batch {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const list = this.by.get(mat) ?? [];
    list.push(geo);
    this.by.set(mat, list);
  }

  /** One mesh per material, casting shadows or not. */
  build(shadow = true): THREE.Group {
    const out = new THREE.Group();
    for (const [mat, geos] of this.by) {
      out.add(mesh(mergeGeometries(geos)!, mat, 0, 0, 0, shadow));
      for (const g of geos) g.dispose();
    }
    this.by.clear();
    return out;
  }
}

/** Something `w` by `d` at (x, z), turned `rotY`, standing `top` high: in the way (see Collider). */
export function collide(kit: Kit, x: number, z: number, w: number, d: number, rotY: number, top: number, extra: Partial<Collider> = {}) {
  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, d, rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top, ...extra });
}

export const xz = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });

/** A group at (x, y, z), turned `rotY`. */
export function placed(x: number, y: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  return g;
}
