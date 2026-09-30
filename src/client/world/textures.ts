import * as THREE from 'three';

/*
 * Canvas-texture helpers the map styles share (world/castle.ts, world/cyberpunk.ts): a texture
 * painted with a 2D context (and optionally tiled), a little seeded randomness that's the same in
 * every browser, and a color lightened or darkened by a step.
 */

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** A little randomness that's the same every time, so every browser sees the same stones (and neon). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}
