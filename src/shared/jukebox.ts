// The lounge jukebox: the tunes it has, what it's playing and where it stands, shared by the server
// (which keeps one per floor) and the browser (which synthesizes the tunes, see client/music.ts).

import { BALCONY_DOOR, ELEVATOR, EXIT_DOOR, FLOOR, JUKEBOX, WINDOWS, type Opening } from './layout.js';
import { wallPose, type WallId } from './decor.js';

export interface JukeboxTune {
  id: string;
  title: string;
  /** A few words on the card in its list. */
  mood: string;
}

export const JUKEBOX_TUNES: readonly JukeboxTune[] = [
  { id: 'rainy-window', title: 'Rainy Window', mood: 'slow and dreamy' },
  { id: 'coffee-break', title: 'Coffee Break', mood: 'jazzy, easy swing' },
  { id: 'late-commit', title: 'Late Commit', mood: 'minor key, 2 a.m.' },
  { id: 'green-build', title: 'Green Build', mood: 'bright and bouncy' },
];

/** The `track` of a stream someone pasted. */
export const STREAM = 'stream';

/**
 * Where the jukebox stands: its middle on the floor, and the way it faces (0 = +z, like a desk's
 * worker). People move it, the way they hang pictures on the walls, so it's part of its state.
 */
export interface JukeboxSpot {
  x: number;
  z: number;
  /** A quarter turn, so its back is flat to a wall. */
  rotY: number;
}

/** How far its back stands off the wall behind it. */
const STAND_OFF = JUKEBOX.depth / 2 + 0.06;

/** Where the jukebox stands against a wall, `u` along it, facing into the room. */
export function jukeboxSpot(wall: WallId, u: number): JukeboxSpot {
  const p = wallPose(wall, u, 0, STAND_OFF);
  return { x: p.x, z: p.z, rotY: p.rotY };
}

/** Where it stands until somebody moves it: in the corner of the lounge, as it always has. */
export const JUKEBOX_HOME = jukeboxSpot('east', JUKEBOX.z);

/** The floor its cabinet takes standing at a spot, `pad` clear of it on every side. */
export function jukeboxBox(spot: JukeboxSpot, pad = 0): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const c = Math.abs(Math.cos(spot.rotY));
  const s = Math.abs(Math.sin(spot.rotY));
  const hx = c * JUKEBOX.width / 2 + s * JUKEBOX.depth / 2 + pad;
  const hz = s * JUKEBOX.width / 2 + c * JUKEBOX.depth / 2 + pad;
  return { minX: spot.x - hx, maxX: spot.x + hx, minZ: spot.z - hz, maxZ: spot.z + hz };
}

/** The elevator's doors, as an opening on the north wall: the one way in nobody may stand in. */
const ELEVATOR_DOORS: Opening = { wall: 'north', u: ELEVATOR.x, width: ELEVATOR.width, y0: 0, y1: ELEVATOR.doorHeight };

/**
 * Whether a cabinet `span` wide, stood against a wall at `u`, would stand in front of a window, the
 * balcony doors, the exit door or the elevator.
 */
export function blocksOpening(wall: WallId, u: number, span: number): boolean {
  const u0 = u - span / 2;
  const u1 = u + span / 2;
  return [...WINDOWS, EXIT_DOOR, BALCONY_DOOR, ELEVATOR_DOORS].some((o) => o.wall === wall && u0 < o.u + o.width / 2 && o.u - o.width / 2 < u1);
}

/** Whether two spots stand the jukebox in the same place. */
export function sameSpot(a: JukeboxSpot, b: JukeboxSpot): boolean {
  return a.x === b.x && a.z === b.z && a.rotY === b.rotY;
}

/** Checks a spot from a client: squares it up to a wall and keeps the cabinet inside the office. */
export function sanitizeSpot(input: unknown): JukeboxSpot | string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const x = n(o.x);
  const z = n(o.z);
  const turned = n(o.rotY);
  if ([x, z, turned].some(Number.isNaN)) return 'The office does not know where to stand the jukebox';
  // Whatever way it was sent, its back goes to a wall.
  const rotY = Math.round(turned / (Math.PI / 2)) * (Math.PI / 2);
  // The whole cabinet has to stay inside the room: what comes back is the nearest spot it fits in.
  const { minX, maxX, minZ, maxZ } = jukeboxBox({ x: 0, z: 0, rotY });
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const clamp = (v: number, lo: number, hi: number) => round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  return {
    x: clamp(x, FLOOR.minX - minX, FLOOR.maxX - maxX),
    z: clamp(z, FLOOR.minZ - minZ, FLOOR.maxZ - maxZ),
    rotY,
  };
}

export interface JukeboxState {
  on: boolean;
  /** One of JUKEBOX_TUNES, or STREAM for `url`. It stays put while the jukebox is off, to turn back on. */
  track: string;
  /** Internet radio or an audio file someone pasted. */
  url?: string;
  /** Where its cabinet stands; where it stood until somebody moved it. */
  spot?: JukeboxSpot;
  /** Who last put something on, or turned it off. */
  by?: string;
  /** When the track started, on the office's clock (see the 'pong' message), so everyone hears the same bar. */
  startedAt: number;
  /** How far into the track it was when this was sent, in ms, for until the clocks are compared. */
  elapsed: number;
}

export const tuneById = (id: string): JukeboxTune | undefined => JUKEBOX_TUNES.find((t) => t.id === id);

/** What's on, for the hint bar and the jukebox's own display: a tune's title, or where the stream comes from. */
export function trackTitle(s: Pick<JukeboxState, 'track' | 'url'>): string {
  if (s.track !== STREAM) return tuneById(s.track)?.title ?? 'A tune';
  try {
    const u = new URL(s.url ?? '');
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return file ? `${u.hostname} · ${file}` : u.hostname;
  } catch {
    return 'A stream';
  }
}

export function checkStreamUrl(raw: unknown): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a link to a stream or an audio file' };
  if (s.length > 2048) return { error: 'That link is too long' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web link. Paste an address that starts with https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links can play on the jukebox' };
  return { url: u.href };
}
