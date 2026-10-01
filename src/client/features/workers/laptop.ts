import * as THREE from 'three';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG, type Run } from '../../../shared/protocol';
import { mesh, roundedBox, toon } from '../../world/toon';
import { TERM_THEME } from '../../ui/termtheme';
import type { ScreenState } from '../../state/store';


const BASE16 = [
  TERM_THEME.black, TERM_THEME.red, TERM_THEME.green, TERM_THEME.yellow, TERM_THEME.blue, TERM_THEME.magenta, TERM_THEME.cyan, TERM_THEME.white,
  TERM_THEME.brightBlack, TERM_THEME.brightRed, TERM_THEME.brightGreen, TERM_THEME.brightYellow, TERM_THEME.brightBlue, TERM_THEME.brightMagenta, TERM_THEME.brightCyan, TERM_THEME.brightWhite,
];

const PALETTE: string[] = (() => {
  const p = [...BASE16];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push(`rgb(${steps[r]},${steps[g]},${steps[b]})`);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p.push(`rgb(${v},${v},${v})`);
  }
  return p;
})();

function color(c: number, fallback: string): string {
  if (c < 0) return fallback;
  if (c >= RGB_FLAG) {
    const rgb = c & 0xffffff;
    return `rgb(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255})`;
  }
  return PALETTE[c] ?? fallback;
}

const runLen = (runs: Run[] | undefined) => (runs ? runs.reduce((n, r) => n + [...r[0]].length, 0) : 0);
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.25;
const MIN_ZOOM_ROWS = 12;
const MIN_ZOOM_COLS = 56;

/**
 * The part of a terminal worth showing on a small laptop. Keep the usual recent rows, then add
 * surrounding rows for its natural character aspect ratio to use the available canvas.
 */
function activeWindow(s: ScreenState, width: number, height: number, preferredRows: number): { top: number; rows: number; cols: number; first: number; last: number } {
  let first = -1;
  let last = -1;
  let cols = MIN_ZOOM_COLS;
  for (let y = 0; y < s.rows; y++) {
    const runs = s.lines[y];
    if (!runs?.some((r) => r[0].trim() || r[2] !== -1)) continue;
    if (first < 0) first = y;
    last = y;
    cols = Math.max(cols, runLen(runs));
  }
  cols = Math.min(s.cols, cols);
  // A natural terminal cell is about .6 characters wide by 1.25 characters high. Add enough
  // surrounding rows for a wide PTY to use the laptop's height without vertically stretching glyphs.
  const aspectRows = Math.ceil((height * CHAR_WIDTH * cols) / (width * LINE_HEIGHT));
  const rows = Math.min(s.rows, Math.max(MIN_ZOOM_ROWS, preferredRows, aspectRows));
  const top = last < 0 ? 0 : Math.max(0, Math.min(last + 1 - rows, s.rows - rows));
  const contentFirst = first < 0 ? top : Math.max(top, first);
  const contentLast = last < 0 ? top : Math.min(top + rows - 1, last);
  return { top, rows, cols, first: contentFirst, last: contentLast };
}

/** Paints a terminal screen onto a canvas. Shared by the 3D laptops and the HUD previews. */
export function paintScreen(ctx: CanvasRenderingContext2D, w: number, h: number, s: ScreenState | undefined, placeholder?: string, zoomRows = 0) {
  ctx.fillStyle = TERM_THEME.background;
  ctx.fillRect(0, 0, w, h);
  if (!s) {
    ctx.fillStyle = '#6c7086';
    ctx.font = `700 ${Math.round(h / 12)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(placeholder ?? 'booting…', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }
  const pad = w * 0.02;
  const win = zoomRows
    ? activeWindow(s, w - pad * 2, h - pad * 2, zoomRows)
    : { top: 0, rows: s.rows, cols: s.cols, first: 0, last: s.rows - 1 };
  const cellW = (w - pad * 2) / win.cols;
  const cellH = (h - pad * 2) / win.rows;
  const fontSize = Math.max(4, Math.min(cellW / CHAR_WIDTH, cellH / LINE_HEIGHT));
  const charW = fontSize * CHAR_WIDTH;
  const lineH = fontSize * LINE_HEIGHT;
  const gridW = win.cols * charW;
  const contentRows = Math.max(1, win.last - win.first + 1);
  const gridH = contentRows * lineH;
  const left = pad + (w - pad * 2 - gridW) / 2;
  const top = pad + (h - pad * 2 - gridH) / 2;
  ctx.textBaseline = 'top';
  for (let y = 0; y < win.rows; y++) {
    const runs = s.lines[win.top + y];
    if (!runs) continue;
    let x = 0;
    const py = top + (win.top + y - win.first) * lineH;
    for (const [text, fgc, bgc, flags] of runs) {
      const len = [...text].length;
      let fg = color(fgc, TERM_THEME.foreground);
      let bg = bgc < 0 ? null : color(bgc, TERM_THEME.background);
      if (flags & FLAG_INVERSE) {
        const tmp = fg;
        fg = bg ?? TERM_THEME.background;
        bg = tmp;
      }
      const px = left + x * charW;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(px, py, len * charW + 0.5, lineH + 0.5);
      }
      if (text.trim()) {
        ctx.font = `${flags & FLAG_BOLD ? 700 : 400} ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.globalAlpha = flags & FLAG_DIM ? 0.55 : 1;
        ctx.fillStyle = fg;
        ctx.fillText(text, px, py + (lineH - fontSize) / 2);
        ctx.globalAlpha = 1;
      }
      x += len;
    }
  }
}

export class Laptop {
  readonly root = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private lid = new THREE.Group();
  private drawnVersion = -1;
  private paintedAt = 0;
  private openT = 0;
  private placeholder = 'booting…';
  /** Anything else of its own to free (the tome's page). */
  private owned: THREE.Material[] = [];

  /** `tome`: a leather-bound book whose inside page shows the terminal, for the castle; it opens and shuts like the laptop. */
  constructor(style: 'laptop' | 'tome' = 'laptop') {
    this.canvas.width = 1024;
    this.canvas.height = 680;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    // Lid, hinged along the back edge
    this.lid.position.set(0, 0.035, -0.24);
    this.root.add(this.lid);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    screen.position.set(0, 0.25, 0.014);
    this.lid.add(screen);
    if (style === 'tome') {
      const leather = toon('#5a2a17');
      const gold = toon('#d9ab2e');
      const pages = toon('#efe3c2');
      // The back cover and the block of pages on it, gold on the corners.
      this.root.add(mesh(roundedBox(0.8, 0.03, 0.54, 0.03), leather, 0, 0.015, 0.02));
      this.root.add(mesh(roundedBox(0.74, 0.03, 0.48, 0.02), pages, 0, 0.044, 0.02, false));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.root.add(mesh(new THREE.BoxGeometry(0.07, 0.034, 0.07), gold, sx * 0.37, 0.016, 0.02 + sz * 0.24, false));
      // The front cover, open, with the page inside it (the screen) and a gold seal on the outside.
      const cover = mesh(roundedBox(0.8, 0.025, 0.52, 0.03), leather, 0, 0.25, 0);
      cover.rotation.x = Math.PI / 2;
      this.lid.add(cover);
      const pageMat = new THREE.MeshBasicMaterial({ color: '#efe3c2' });
      this.owned.push(pageMat);
      const page = mesh(new THREE.PlaneGeometry(0.76, 0.49), pageMat, 0, 0.25, 0.0135, false);
      this.lid.add(page);
      // Hinged over the block of pages, so the cover shuts down on top of them.
      this.lid.position.y = 0.072;
      screen.position.z = 0.0145;
      screen.scale.setScalar(0.94);
      const seal = mesh(new THREE.CircleGeometry(0.08, 20), gold, 0, 0.27, -0.014, false);
      seal.rotation.y = Math.PI;
      this.lid.add(seal);
      // A ribbon bookmark hanging out of the pages.
      this.root.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.16), toon('#9b1c1c'), 0.2, 0.06, 0.28, false));
    } else {
      const shell = toon('#c9ced6');
      const dark = toon('#2b2d42');
      // Base with keyboard
      this.root.add(mesh(roundedBox(0.78, 0.035, 0.52, 0.04), shell, 0, 0.018, 0.02));
      this.root.add(mesh(new THREE.BoxGeometry(0.66, 0.006, 0.24), dark, 0, 0.037, 0.0, false));
      this.root.add(mesh(new THREE.BoxGeometry(0.2, 0.004, 0.11), toon('#aab1bb'), 0, 0.037, 0.19, false));
      const lidShell = mesh(roundedBox(0.78, 0.025, 0.5, 0.04), shell, 0, 0.25, 0);
      lidShell.rotation.x = Math.PI / 2;
      this.lid.add(lidShell);
      // Sticker on the back of the lid
      const sticker = mesh(new THREE.CircleGeometry(0.07, 20), toon('#ff8a5b'), 0, 0.27, -0.014, false);
      sticker.rotation.y = Math.PI;
      this.lid.add(sticker);
    }
    this.lid.rotation.x = Math.PI / 2; // closed; animates open
    paintScreen(this.ctx, this.canvas.width, this.canvas.height, undefined, this.placeholder);
    this.texture.needsUpdate = true;
  }

  setPlaceholder(text: string) {
    if (text === this.placeholder) return;
    this.placeholder = text;
    this.drawnVersion = -2;
  }

  /**
   * `distance` to the camera throttles repaints: far-away laptops refresh rarely. `closed`: its worker's
   * away from its desk on a break (see features/breaks), so the lid's down until it's back.
   */
  update(dt: number, screen: ScreenState | undefined, distance = 0, closed = false) {
    if (closed) {
      this.shut(dt);
      return;
    }
    if (this.openT < 1) this.setLid(Math.min(1, this.openT + dt * 1.6));
    const version = screen ? screen.version : -1;
    const now = performance.now();
    const every = distance < 6 ? 150 : distance < 14 ? 600 : 2000;
    if (version !== this.drawnVersion && (now - this.paintedAt > every || this.drawnVersion < 0)) {
      this.paintedAt = now;
      this.drawnVersion = version;
      paintScreen(this.ctx, this.canvas.width, this.canvas.height, screen, this.placeholder, 22);
      this.texture.needsUpdate = true;
    }
  }

  /** Folds the lid down a little further (it snaps shut at the end); true once it's closed. */
  shut(dt: number): boolean {
    this.setLid(Math.max(0, this.openT - dt * 2));
    return this.openT === 0;
  }

  private setLid(open: number) {
    this.openT = open;
    const e = 1 - Math.pow(1 - open, 3);
    this.lid.rotation.x = Math.PI / 2 - e * (Math.PI / 2 + 0.22);
  }

  dispose() {
    this.texture.dispose();
    for (const m of this.owned) m.dispose();
  }
}
