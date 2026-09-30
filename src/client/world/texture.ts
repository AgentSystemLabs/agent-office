import * as THREE from 'three';

/**
 * A picture drawn once on a `w` by `h` canvas, as a texture: in sRGB, and sharp even at a glancing
 * angle. With `repeat`, it tiles that many times across whatever it's on.
 */
export function canvasTexture(w: number, h: number, draw?: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw?.(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** A canvas texture (see canvasTexture) that tiles: for UVs that run past 1, or a repeat set later. */
export function tilingCanvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const t = canvasTexture(w, h, draw);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
