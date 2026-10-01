// The office dog. Every floor has one. The server decides what it does (see server/dog.ts) and sends
// one DogState per leg of its day. Every browser works out from that state where the dog is at any
// moment, so everyone on the floor sees it in the same spot without a stream of moves.

/** What the dog does once it gets where it's going. */
export type DogAct = 'stand' | 'sit' | 'lie' | 'nap' | 'sniff' | 'bark' | 'wag';

export interface DogState {
  name: string;
  /** Which of DOG_COATS it wears. */
  coat: number;
  /** What kind of dog it is (see dogBreed for one the page doesn't know). */
  breed: DogBreed;
  /** This leg: from where it was when the leg began, on through each point in turn. Never empty. */
  path: [number, number][];
  /** Meters per second along the path. */
  speed: number;
  /** How long ago the leg began, in ms, as of when the server sent it. */
  elapsed: number;
  act: DogAct;
  /** Which way it faces once it's there (rotation around y; 0 looks down +z). */
  face?: number;
  /** Barking: the worker that needs input. Napping: the worker whose desk it's under. */
  workerId?: string;
  /** The person it's trotting after. */
  following?: string;
  /** Wagging: who just petted it. */
  petBy?: string;
}

export const DOG_NAME_MAX = 24;

/** A new floor's dog is called one of these until someone names it in ⚙️ Settings (none is a worker's name). */
export const DOG_NAMES = ['Biscuit', 'Pancake', 'Peanut', 'Pepper', 'Cookie', 'Bagel', 'Ziggy', 'Pretzel', 'Maple', 'Scout'];

/** A floor's dog is one of these, each its own model (dog-<breed>.glb) with the same rig and clips. */
export const DOG_BREEDS = ['pup', 'corgi', 'dachshund', 'pug', 'shiba'] as const;
export type DogBreed = (typeof DOG_BREEDS)[number];

/** A breed as the office sent it, or the pup when there's none (an older office) or it's one this page doesn't know (a newer one). */
export function dogBreed(breed: unknown): DogBreed {
  return DOG_BREEDS.find((b) => b === breed) ?? 'pup';
}

/** Coats: [body, belly and muzzle, ears]. */
export const DOG_COATS: [string, string, string][] = [
  ['#e0a458', '#fff1d6', '#b36f35'], // golden
  ['#3b3d4f', '#ffffff', '#23242f'], // black and white
  ['#8a5a3b', '#f0d2b0', '#5e3a24'], // chocolate
  ['#f3dcb0', '#fffaf0', '#d9a066'], // cream
  ['#a4acb6', '#f4f6f8', '#6f7884'], // grey
  ['#cf6a45', '#fbe1d2', '#9c4527'], // red
];

/** Once it gets to a desk whose worker needs input, it barks this often... */
export const BARK_EVERY_S = 14;
/** ...for this long, then sits there quietly (still pointing) until someone answers. */
export const BARK_FOR_S = 120;

/**
 * A name for a floor's dog, a coat and a breed, picked from its id so it keeps them. The name and coat are
 * picked as they were before there were breeds, so a floor's dog kept them. The breed is picked from the
 * same hash stirred once more, so it doesn't follow the name, and floors called much alike (a repo and its
 * "-2", which differ only in the hash's low bits) don't all get the same one.
 */
export function dogDefaults(floorId: string): { name: string; coat: number; breed: DogBreed } {
  let h = 0;
  for (const ch of floorId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const stirred = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return { name: DOG_NAMES[h % DOG_NAMES.length], coat: (h >>> 8) % DOG_COATS.length, breed: DOG_BREEDS[(stirred >>> 16) % DOG_BREEDS.length] };
}

/** Takes control characters out and trims to DOG_NAME_MAX; '' when nothing's left. */
export function cleanDogName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, DOG_NAME_MAX)
    .trim();
}

export function pathLength(path: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return len;
}

/** Seconds from the start of the leg until it arrives. */
export function legSeconds(s: Pick<DogState, 'path' | 'speed'>): number {
  return s.speed > 0 ? pathLength(s.path) / s.speed : 0;
}

export interface DogPose {
  x: number;
  z: number;
  /** Which way it's facing (rotation around y). */
  heading: number;
  /** Still on its way. */
  moving: boolean;
}

/** Where the dog is `t` seconds into its leg, and which way it faces. */
export function dogAt(s: Pick<DogState, 'path' | 'speed' | 'face'>, t: number): DogPose {
  const p = s.path;
  let left = Math.max(0, t) * s.speed;
  let heading = s.face ?? 0;
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0];
    const dz = p[i][1] - p[i - 1][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    heading = Math.atan2(dx, dz);
    if (left < len) {
      const k = left / len;
      return { x: p[i - 1][0] + dx * k, z: p[i - 1][1] + dz * k, heading, moving: true };
    }
    left -= len;
  }
  const [x, z] = p[p.length - 1];
  return { x, z, heading: s.face ?? heading, moving: false };
}
