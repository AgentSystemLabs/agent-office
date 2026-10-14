import type { Opening } from './layout.js';
import { NavGrid, type Bounds, type Pt, type Rect } from './nav.js';

/** Scaled to the existing game characters; room adjacencies follow the Scranton set. */
export const SCRANTON: Bounds = { minX: -18, maxX: 12, minZ: -31, maxZ: -15 };
export const SCRANTON_HEIGHT = 3.4;
export const SCRANTON_DOOR: Opening = { wall: 'east', u: -4.2, width: 1.7, y0: 0, y1: 2.6 };
export const SCRANTON_ENTRY: Pt = [17.5, -4.2];
export const CORRIDORS: readonly Rect[] = [
  [17.3, 22.8, -5.55, -2.85],
  [20.1, 22.8, -25.2, -2.85],
  [12, 22.8, -25.2, -22.5],
];
export const point = (u: number, v: number): Pt => [SCRANTON.minX + u, SCRANTON.minZ + v];

export interface Partition {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  glass?: boolean;
  outer?: boolean;
}
const alongX = (v: number, a: number, b: number, glass = false): Partition => ({ axis: 'x', at: point(0, v)[1], from: point(a, 0)[0], to: point(b, 0)[0], glass });
const alongZ = (u: number, a: number, b: number, glass = false): Partition => ({ axis: 'z', at: point(u, 0)[0], from: point(0, a)[1], to: point(0, b)[1], glass });

/** Door gaps are real gaps in both the visual partitions and collision/navigation geometry. */
export const PARTITIONS: readonly Partition[] = [
  // Outer shell, with the extra connection through the annex's east wall.
  { ...alongX(0, 0, 30, true), outer: true },
  { ...alongX(16, 0, 30, true), outer: true },
  { ...alongZ(0, 0, 16, true), outer: true },
  { ...alongZ(30, 0, 5.8, true), outer: true },
  { ...alongZ(30, 8.5, 16, true), outer: true },
  // Michael's office and the conference room beside it, facing the sales bullpen.
  alongZ(2.6, 0, 4.6), alongZ(6.8, 0, 4.6), alongZ(14.2, 0, 3.7),
  alongX(4.6, 2.6, 3.8, true), alongX(4.6, 5.3, 6.8, true),
  alongX(4.6, 6.8, 7.2, true), alongX(4.6, 8.5, 14.2, true),
  // Building stairwell (closed to this suite), with a landing beside the main entrance.
  alongZ(14.6, 0, 5.0), alongZ(22.4, 0, 7.0), alongX(6.9, 14.6, 22.4),
  // Kitchen links the main room and the annex through two open doorways.
  alongZ(14.2, 7.4, 8.0), alongZ(14.2, 9.5, 13.6), alongZ(14.2, 14.8, 16),
  alongX(7.4, 14.2, 22.4), alongX(10.7, 14.2, 17.0), alongX(10.7, 18.3, 18.7), alongX(10.7, 20.2, 22.4),
  alongZ(22.4, 7.4, 8.0), alongZ(22.4, 9.5, 10.7),
  // Ryan's small closet office, plus the restroom block below the kitchen.
  alongZ(18.7, 10.7, 12.8), alongX(12.8, 14.2, 15.0), alongX(12.8, 16.4, 18.7),
  alongX(13.1, 18.7, 19.4), alongX(13.1, 20.7, 22.4), alongZ(18.7, 13.1, 16),
  alongZ(22.4, 10.7, 16),
  // Copier/quality-assurance area at the far end of the bullpen.
  alongX(11.2, 10.0, 14.2), alongZ(10.0, 11.2, 11.9), alongZ(10.0, 13.7, 16),
  // Break room in the far corner of the annex.
  alongZ(25.5, 0, 4.9), alongX(5.4, 25.5, 26.0), alongX(5.4, 27.4, 30),
  // Hallway walls: the first gap goes through the original office's east wall.
  { axis: 'x', at: -2.85, from: 18.3, to: 22.8 },
  { axis: 'x', at: -5.55, from: 18.3, to: 20.1 },
  { axis: 'z', at: 22.8, from: -25.2, to: -2.85, glass: true },
  { axis: 'z', at: 20.1, from: -22.5, to: -5.55, glass: true },
  { axis: 'x', at: -25.2, from: 12, to: 22.8 },
  { axis: 'x', at: -22.5, from: 12, to: 20.1 },
];

export const ROOMS = {
  reception: { label: 'Reception', at: point(2.0, 7.9) },
  bullpen: { label: 'Sales bullpen', at: point(7.2, 11.2) },
  michael: { label: 'Michael’s office', at: point(4.7, 3.0) },
  conference: { label: 'Conference room', at: point(10.5, 3.1) },
  accounting: { label: 'Accounting', at: point(4.6, 12.0) },
  kitchen: { label: 'Kitchen', at: point(18.8, 9.2) },
  annex: { label: 'Annex · customer service & HR', at: point(25.0, 11.4) },
  breakroom: { label: 'Break room', at: point(27.4, 2.65) },
  ryan: { label: 'Ryan’s closet office', at: point(16.3, 12.0) },
} satisfies Record<string, { label: string; at: Pt }>;

export interface Workstation { id: string; at: Pt; facing: number; desk: Pt }
const station = (id: string, u: number, v: number, facing = Math.PI): Workstation => {
  const at = point(Math.round((u - 0.25) / 0.5) * 0.5 + 0.25, Math.round((v - 0.25) / 0.5) * 0.5 + 0.25);
  return { id, at, facing, desk: [at[0] + Math.sin(facing) * 1.15, at[1] + Math.cos(facing) * 1.15] };
};
export const WORKSTATIONS: readonly Workstation[] = [
  station('michael', 4.7, 1.5, 0),
  station('jim', 6.0, 6.3, 0), station('dwight', 6.0, 10.0),
  station('andy', 10.0, 6.3, 0), station('pam', 10.0, 10.0),
  station('angela', 1.4, 12.0), station('oscar', 3.7, 12.0), station('kevin', 1.4, 14.6),
  station('stanley', 6.0, 14.6), station('phyllis', 8.5, 14.6),
  station('meredith', 12.4, 13.1), station('creed', 13.0, 14.6, -Math.PI / 2),
  station('ryan', 16.75, 11.7, -Math.PI / 2),
  station('toby', 28.6, 11.5, -Math.PI / 2), station('kelly', 27.5, 15.25),
  station('darryl', 24.4, 11.2),
];
export const HOMES: Record<string, Pt> = Object.fromEntries(WORKSTATIONS.map((s) => [s.id, s.at]));
HOMES.erin = point(2.25, 5.75);
HOMES.holly = point(24.75, 13.25);
HOMES.david = point(5.25, 3.75);

export interface Furnishing { kind: 'cabinet' | 'counter' | 'copier' | 'vending' | 'fridge' | 'table' | 'sofa'; at: Pt; width: number; depth: number; height: number }
const item = (kind: Furnishing['kind'], u: number, v: number, width: number, depth: number, height: number): Furnishing => ({ kind, at: point(u, v), width, depth, height });
export const FURNISHINGS: readonly Furnishing[] = [
  item('cabinet', 0.8, 1.2, 1.0, 1.8, 1.25),
  item('sofa', 0.6, 4.7, 0.8, 2.0, 0.75),
  item('copier', 13.6, 5.4, 0.85, 0.9, 1.0),
  item('cabinet', 12.6, 4.0, 2.2, 0.5, 1.0),
  item('counter', 17.8, 7.9, 5.0, 0.7, 0.92),
  item('fridge', 14.8, 7.9, 0.85, 0.85, 1.8),
  item('table', 20.8, 9.0, 1.0, 1.0, 0.73),
  item('cabinet', 23.0, 1.5, 0.75, 2.5, 1.4),
  item('vending', 29.4, 2.0, 0.8, 1.2, 1.85),
  item('vending', 29.4, 3.4, 0.8, 1.2, 1.85),
  item('table', 27.1, 1.6, 1.0, 1.0, 0.73),
  item('table', 27.1, 3.8, 1.0, 1.0, 0.73),
  item('counter', 28.4, 5.0, 2.0, 0.5, 0.92),
  item('table', 25.8, 8.0, 1.8, 1.0, 0.76),
  item('cabinet', 23.0, 14.2, 0.6, 2.4, 1.3),
];
/** The curved reception counter is approximated conservatively by three collision boxes. */
export const RECEPTION_BLOCKS: readonly Rect[] = [
  [point(0.2, 0)[0], point(0.6, 0)[0], point(0, 6.0)[1], point(0, 7.7)[1]],
  [point(3.4, 0)[0], point(3.8, 0)[0], point(0, 6.0)[1], point(0, 7.7)[1]],
  [point(0.6, 0)[0], point(3.4, 0)[0], point(0, 7.0)[1], point(0, 7.7)[1]],
];
export const CONFERENCE_CHAIRS: readonly Pt[] = [5.8, 7.1, 8.4].flatMap((v) => [point(9.1, v - 4.6), point(11.4, v - 4.6)]);

export function partitionRect(p: Partition, thickness = 0.18): Rect {
  return p.axis === 'x' ? [p.from, p.to, p.at - thickness / 2, p.at + thickness / 2] : [p.at - thickness / 2, p.at + thickness / 2, p.from, p.to];
}
export function furnitureRect(f: { at: Pt; width: number; depth: number }): Rect {
  return [f.at[0] - f.width / 2, f.at[0] + f.width / 2, f.at[1] - f.depth / 2, f.at[1] + f.depth / 2];
}
export function deskRect(s: Workstation): Rect {
  const side = Math.abs(Math.sin(s.facing)) > 0.5;
  return furnitureRect({ at: s.desk, width: side ? 1.05 : 2.05, depth: side ? 2.05 : 1.05 });
}
const inside = (r: Rect, x: number, z: number, m: number) => x > r[0] + m && x < r[1] - m && z > r[2] + m && z < r[3] - m;
export function inScranton(x: number, z: number): boolean {
  return inside([SCRANTON.minX, SCRANTON.maxX, SCRANTON.minZ, SCRANTON.maxZ], x, z, 0) || CORRIDORS.some((r) => inside(r, x, z, 0));
}

/** Navigation and player colliders use the same solid footprints. */
export function scrantonNav(): NavGrid {
  const bounds = { ...SCRANTON, maxX: 22.8, maxZ: -2.85 };
  const rects: Rect[] = [...PARTITIONS.map((p) => partitionRect(p)), ...WORKSTATIONS.map(deskRect), ...FURNISHINGS.map(furnitureRect), ...RECEPTION_BLOCKS];
  // The stair core is scenery, reached from the external building stairs rather than the suite.
  rects.push(furnitureRect({ at: point(18.5, 3.2), width: 7.2, depth: 6.0 }));
  return new NavGrid(bounds, { rects, circles: [] }, (x, z) => inScranton(x, z));
}
