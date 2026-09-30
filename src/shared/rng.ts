/**
 * A small seeded random (Mulberry32): the same numbers from 0 to 1, in the same order, for the same
 * seed on every machine. The scenery is laid out with it (the trees along the scenic loop, the city
 * round the roof, the Christmas trees and bats), and so are the jukebox's melodies and the DJ's
 * tracks, so everyone sees and hears the same thing. Changing it moves all of that: tests/rng.test.ts
 * pins it.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
