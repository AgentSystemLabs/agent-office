import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let gradient: THREE.DataTexture | null = null;

/** Three-step ramp that gives MeshToonMaterial its flat cartoon banding. */
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
  if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
  if (opts.transparent || (opts.opacity ?? 1) < 1) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 1;
  }
  cache.set(key, m);
  return m;
}

/** A fresh (uncached) toon material, for things whose color animates. */
export function toonUnique(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function roundedBox(w: number, h: number, d: number, r = 0.06): THREE.BufferGeometry {
  // Cheap rounded box: an extruded rounded rectangle, centered.
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

type TextOpts = { color?: string; bg?: string; size?: number; border?: string };
const TEXT_SCALE = 0.0055;

/** A pill-shaped text label drawn to a texture; `w`/`h` are the canvas size in pixels. */
function textTexture(text: string, opts: TextOpts) {
  const size = opts.size ?? 48;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  const h = Math.ceil(size * 1.6);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, h - 6, r - 3);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = opts.border ?? '#2b2d42';
    ctx.stroke();
  }
  ctx.fillStyle = opts.color ?? '#2b2d42';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.05);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w, h };
}

/** A camera-facing text label. */
export function textSprite(text: string, opts: TextOpts = {}): THREE.Sprite {
  const { tex, w, h } = textTexture(text, opts);
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w * TEXT_SCALE, h * TEXT_SCALE, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** A flat text sign facing +Z, for mounting on a wall (a sprite would swing into the wall). */
export function textPlane(text: string, opts: TextOpts = {}): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const { tex, w, h } = textTexture(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w * TEXT_SCALE, h * TEXT_SCALE), mat);
}

export interface CardOpts {
  /** A small pill across the top edge, e.g. "⌨️ WORKING". */
  chip?: { text: string; bg: string; color: string };
  title: string;
  body?: string;
  bg: string;
  /** Widest a line of text may get, in textSprite `size` pixels. */
  maxWidth?: number;
}

/** Cards are drawn at twice the pixels of other labels so their smaller text stays crisp up close. */
const CARD_RES = 2;
const INK = '#2b2d42';
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/**
 * A speech-bubble card: status pill, bold title (up to 2 lines) and a smaller body (up to 3), with a
 * tail pointing down. Its position is the tip of the tail, so it sits right on top of what it's about.
 */
export function cardSprite(o: CardOpts): THREE.Sprite {
  const R = CARD_RES;
  const maxW = (o.maxWidth ?? 400) * R;
  const pad = 16 * R;
  const lw = 5 * R;
  const tail = 14 * R;
  const chipFont = `800 ${19 * R}px ${FONT}`;
  const chipH = 30 * R;
  const titleFont = `800 ${30 * R}px ${FONT}`;
  const titleLH = 36 * R;
  const bodyFont = `700 ${23 * R}px ${FONT}`;
  const bodyLH = 29 * R;

  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = titleFont;
  const title = wrap(ctx, o.title, maxW, 2);
  const titleW = Math.max(...title.map((l) => ctx.measureText(l).width));
  ctx.font = bodyFont;
  const body = o.body ? wrap(ctx, o.body, maxW, 3) : [];
  const bodyW = body.length ? Math.max(...body.map((l) => ctx.measureText(l).width)) : 0;
  ctx.font = chipFont;
  const chipW = o.chip ? ctx.measureText(o.chip.text).width + 24 * R : 0;

  const w = Math.ceil(Math.max(titleW, bodyW, chipW + 2 * pad) + 2 * pad);
  const top = o.chip ? chipH / 2 : lw;
  const titleY = top + (o.chip ? chipH / 2 + 6 * R : pad);
  const bodyY = titleY + title.length * titleLH + 4 * R;
  const bottom = bodyY + body.length * bodyLH + pad * 0.7;
  const h = Math.ceil(bottom + tail + lw);

  const canvas = ctx.canvas;
  canvas.width = w;
  canvas.height = h;
  // One outline for the card and its tail, so the border runs unbroken down the tail.
  const x0 = lw / 2;
  const x1 = w - lw / 2;
  const cx = w / 2;
  const r = 18 * R;
  ctx.beginPath();
  ctx.moveTo(x0 + r, top);
  ctx.arcTo(x1, top, x1, bottom, r);
  ctx.arcTo(x1, bottom, x0, bottom, r);
  ctx.lineTo(cx + tail, bottom);
  ctx.lineTo(cx, bottom + tail);
  ctx.lineTo(cx - tail, bottom);
  ctx.arcTo(x0, bottom, x0, top, r);
  ctx.arcTo(x0, top, x1, top, r);
  ctx.closePath();
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.chip) {
    ctx.beginPath();
    ctx.roundRect(cx - chipW / 2, lw / 2, chipW, chipH, chipH / 2);
    ctx.fillStyle = o.chip.bg;
    ctx.fill();
    ctx.lineWidth = 4 * R;
    ctx.stroke();
    ctx.font = chipFont;
    ctx.fillStyle = o.chip.color;
    ctx.fillText(o.chip.text, cx, lw / 2 + chipH / 2 + R);
  }
  ctx.font = titleFont;
  ctx.fillStyle = INK;
  title.forEach((l, i) => ctx.fillText(l, cx, titleY + (i + 0.5) * titleLH));
  ctx.font = bodyFont;
  ctx.fillStyle = '#5c5f77';
  body.forEach((l, i) => ctx.fillText(l, cx, bodyY + (i + 0.5) * bodyLH));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set((w / R) * TEXT_SCALE, (h / R) * TEXT_SCALE, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  return sprite;
}

/** Greedy word wrap to at most `maxLines`, ending in "…" when the text doesn't fit. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    // A word wider than a whole line gets cut where it has to be.
    while (!fits(word)) {
      let n = word.length - 1;
      while (n > 1 && !fits(word.slice(0, n))) n--;
      if (line) lines.push(line);
      lines.push(word.slice(0, n));
      line = '';
      word = word.slice(n);
    }
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last.replace(/[\s,.;:—-]+$/, '')}…`;
  return kept;
}

export function disposeSprite(s: THREE.Sprite) {
  s.material.map?.dispose();
  s.material.dispose();
}

/**
 * Merges every (untextured) mesh under `root` into one per material, keeping which ones cast
 * shadows: a few draw calls instead of dozens, for things that never move on their own.
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}${m.castShadow ? '+' : '-'}`;
    if (!byKey.has(key)) byKey.set(key, { mat, cast: m.castShadow, geos: [] });
    byKey.get(key)!.geos.push(geo);
  });
  const out = new THREE.Group();
  for (const { mat, cast, geos } of byKey.values()) {
    out.add(mesh(mergeGeometries(geos)!, mat, 0, 0, 0, cast));
    for (const geo of geos) geo.dispose();
  }
  return out;
}
