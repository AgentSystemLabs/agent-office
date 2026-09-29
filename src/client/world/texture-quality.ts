/**
 * How dense the canvas-painted textures are. Every painter keeps drawing in its original pixel
 * coordinates and scales the context by one of these, so the art is unchanged and only the
 * resolution goes up. Loadable from Node: nothing here touches the DOM or WebGL.
 */

/** Tiled surfaces (floors, walls, roads, decking): a repeat of a few meters, seen up close. */
export const TILE_SCALE = 4;

/** Text labels and signs. */
export const LABEL_SCALE = 3;

/** Screens and boards that redraw as things change: each redraw uploads the whole canvas. */
export const SCREEN_SCALE = 2;

/** Asked of every texture; three clamps it to what the GPU supports (16 on Apple GPUs). */
export const ANISOTROPY = 16;

/** The longest side a painted texture gets, so the building-sized ones stay within any GPU's limit. */
const MAX_SIDE = 4096;

/** `scale`, lowered if a `w` by `h` canvas painted at it would pass MAX_SIDE. */
export function fitScale(w: number, h: number, scale: number): number {
  return Math.min(scale, MAX_SIDE / Math.max(w, h));
}
