/**
 * Pure layout and hit-testing math for world-space VR panels.
 *
 * No THREE imports here on purpose: everything in this file runs under node:test
 * (see tests/vr-panel-math.test.ts), fed with synthetic ray UVs. Panel-local coordinates
 * are normalized, origin top-left: x in [0,1] runs left to right, y in [0,1] runs top to
 * bottom. Controller-ray intersections arrive as UVs (origin bottom-left); uvToPanel flips
 * them into panel space.
 */

/** A rectangle in normalized panel coordinates (origin top-left, 0..1). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in normalized panel coordinates. */
export interface Point {
  x: number;
  y: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** A controller ray's UV on the panel mesh, flipped into panel-local coordinates. */
export function uvToPanel(u: number, v: number): Point {
  return { x: u, y: 1 - v };
}

/** Whether a ray UV actually landed on the panel face (intersections can report outside 0..1). */
export function isOnPanel(u: number, v: number): boolean {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** Whether a panel-local point falls inside a rectangle (edges count as inside). */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Which registered rectangle a point hits. Later entries draw on top of earlier ones,
 * so the last match wins (a close button over a scroll region, a key over the board).
 */
export function hitTest<T extends { id: string; rect: Rect }>(rects: readonly T[], p: Point): T | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    if (pointInRect(p, rects[i].rect)) return rects[i];
  }
  return null;
}

/** Panel-local point to canvas pixels (for painters). */
export function panelToPx(p: Point, canvasW: number, canvasH: number): { x: number; y: number } {
  return { x: p.x * canvasW, y: p.y * canvasH };
}

/** A normalized rect to canvas pixels. */
export function rectToPx(r: Rect, canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
  return { x: r.x * canvasW, y: r.y * canvasH, w: r.w * canvasW, h: r.h * canvasH };
}

/** The union of two dirty rects (either may be null for "nothing dirty"). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Canvas pixels for a panel of a given size in meters. Text stays crisp in the headset by
 * rendering at a high base density (pixels per meter) times the device pixel ratio, capped so
 * a 4K desktop preview doesn't allocate a billboard.
 */
export function canvasSize(widthM: number, heightM: number, devicePixelRatio: number, pxPerMeter = 1400): { w: number; h: number } {
  const dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  return { w: Math.round(widthM * pxPerMeter * dpr), h: Math.round(heightM * pxPerMeter * dpr) };
}

/** Keeps a scroll offset inside its content: 0 shows the top, max shows the bottom. */
export function clampScroll(offset: number, contentH: number, viewH: number): number {
  if (!Number.isFinite(offset)) return 0;
  if (contentH <= viewH) return 0;
  return Math.max(0, Math.min(contentH - viewH, offset));
}

/** Dragging a scroll region: content follows the ray (drag down to look back up). */
export function scrollByDrag(startOffset: number, startY: number, curY: number, unitsPerPanelY: number): number {
  return startOffset - (curY - startY) * unitsPerPanelY;
}

/** Thumbstick scrolling at a steady rate in content units per second. */
export function scrollByStick(offset: number, axis: number, dt: number, unitsPerSec: number): number {
  if (Math.abs(axis) < 0.12) return offset; // stick dead zone
  return offset + axis * dt * unitsPerSec;
}

/** One gentle step of a following panel towards its target (alpha 0..1, frame-rate independent at the call site). */
export function followStep(current: readonly [number, number, number], target: readonly [number, number, number], alpha: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, alpha));
  return [current[0] + (target[0] - current[0]) * t, current[1] + (target[1] - current[1]) * t, current[2] + (target[2] - current[2]) * t];
}

/** Where a following panel wants to be: a fixed distance along the camera ray, dropped a little so it doesn't cover the face. */
export function followTarget(camPos: readonly [number, number, number], camDir: readonly [number, number, number], distance: number, dropM: number): [number, number, number] {
  return [camPos[0] + camDir[0] * distance, camPos[1] + camDir[1] * distance - dropM, camPos[2] + camDir[2] * distance];
}

/** One key of a keyboard row: `w` is its width in key units (a plain key is 1). */
export interface KeyDef {
  id: string;
  label: string;
  w?: number;
  /** Non-printing keys (shift, backspace…) paint differently and never take shift casing. */
  kind?: 'char' | 'fn';
}

export interface KeyRect {
  id: string;
  label: string;
  kind: 'char' | 'fn';
  rect: Rect;
}

export interface KeyLayoutOpts {
  /** Gap between keys, in normalized panel units. */
  gapX?: number;
  gapY?: number;
  /** Inset of the key field inside the panel, in normalized panel units. */
  padX?: number;
  padY?: number;
}

/**
 * Lays rows of keys out over the whole panel: every row stretches to the same width, each key
 * takes its share of key units, and rows share the height equally. Wide keys (space, shift)
 * stay proportional; gaps never overlap keys even on a narrow panel.
 */
export function keyRects(rows: KeyDef[][], opts: KeyLayoutOpts = {}): KeyRect[] {
  const gapX = opts.gapX ?? 0.008;
  const gapY = opts.gapY ?? 0.02;
  const padX = opts.padX ?? 0.02;
  const padY = opts.padY ?? 0.04;
  const out: KeyRect[] = [];
  const fieldW = 1 - padX * 2;
  const fieldH = 1 - padY * 2;
  const rowH = (fieldH - gapY * (rows.length - 1)) / rows.length;
  rows.forEach((rowKeys, r) => {
    const units = rowKeys.reduce((n, k) => n + (k.w ?? 1), 0);
    const gaps = gapX * (rowKeys.length - 1);
    const unit = (fieldW - gaps) / units;
    let x = padX;
    const y = padY + r * (rowH + gapY);
    for (const k of rowKeys) {
      const w = unit * (k.w ?? 1);
      out.push({ id: k.id, label: k.label, kind: k.kind ?? 'char', rect: { x, y, w, h: rowH } });
      x += w + gapX;
    }
  });
  return out;
}

export interface GridMetrics {
  /** Pixels per cell. */
  cellW: number;
  cellH: number;
  /** Font size in pixels that fits the cell. */
  fontPx: number;
  /** Grid origin in pixels. */
  left: number;
  top: number;
  /** How many rows/cols of the grid fit. */
  cols: number;
  rows: number;
}

/**
 * Fits a monospace grid (cols x rows of cells) into a pixel box. The font is sized from the
 * cell width (a terminal cell is ~0.6 as wide as the font size) so glyphs never overflow.
 */
export function gridMetrics(boxW: number, boxH: number, cols: number, rows: number, charWidth = 0.6, lineHeight = 1.25): GridMetrics {
  const cellW = boxW / Math.max(1, cols);
  const cellH = boxH / Math.max(1, rows);
  const fontPx = Math.max(4, Math.min(cellW / charWidth, cellH / lineHeight));
  const gridW = cols * fontPx * charWidth;
  const gridH = rows * fontPx * lineHeight;
  return { cellW: fontPx * charWidth, cellH: fontPx * lineHeight, fontPx, left: (boxW - gridW) / 2, top: (boxH - gridH) / 2, cols, rows };
}
