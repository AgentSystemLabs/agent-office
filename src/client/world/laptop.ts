import * as THREE from 'three';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG, type Run } from '../../shared/protocol';
import { mesh, roundedBox, toon } from './toon';

export const TERM_THEME = {
  background: '#1e1f2e',
  foreground: '#e6e6f0',
  cursor: '#ffd166',
  selectionBackground: '#44475a',
  black: '#282a36',
  red: '#ff5c7a',
  green: '#7cf29a',
  yellow: '#ffd166',
  blue: '#6cb6ff',
  magenta: '#d69cff',
  cyan: '#72ddf7',
  white: '#e6e6f0',
  brightBlack: '#6c7086',
  brightRed: '#ff8fa3',
  brightGreen: '#a6f4b8',
  brightYellow: '#ffe29a',
  brightBlue: '#9ccfff',
  brightMagenta: '#e5c1ff',
  brightCyan: '#a5ecfb',
  brightWhite: '#ffffff',
};

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

export interface ScreenState {
  cols: number;
  rows: number;
  lines: Run[][];
  cursor: [number, number];
  version: number;
}

/** Paints a terminal screen onto a canvas. Shared by the 3D laptops and the HUD previews. */
export function paintScreen(ctx: CanvasRenderingContext2D, w: number, h: number, s: ScreenState | undefined, placeholder?: string) {
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
  const cellW = (w - pad * 2) / s.cols;
  const cellH = (h - pad * 2) / s.rows;
  const fontSize = Math.max(4, Math.min(cellW / 0.6, cellH / 1.15));
  const charW = fontSize * 0.6;
  const lineH = Math.min(cellH, fontSize * 1.25);
  ctx.textBaseline = 'top';
  for (let y = 0; y < s.rows; y++) {
    const runs = s.lines[y];
    if (!runs) continue;
    let x = 0;
    const py = pad + y * lineH;
    for (const [text, fgc, bgc, flags] of runs) {
      const len = [...text].length;
      let fg = color(fgc, TERM_THEME.foreground);
      let bg = bgc < 0 ? null : color(bgc, TERM_THEME.background);
      if (flags & FLAG_INVERSE) {
        const tmp = fg;
        fg = bg ?? TERM_THEME.background;
        bg = tmp;
      }
      const px = pad + x * charW;
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
  private openT = 0;
  private placeholder = 'booting…';

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 680;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    const shell = toon('#c9ced6');
    const dark = toon('#2b2d42');
    // Base with keyboard
    this.root.add(mesh(roundedBox(0.78, 0.035, 0.52, 0.04), shell, 0, 0.018, 0.02));
    this.root.add(mesh(new THREE.BoxGeometry(0.66, 0.006, 0.24), dark, 0, 0.037, 0.0, false));
    this.root.add(mesh(new THREE.BoxGeometry(0.2, 0.004, 0.11), toon('#aab1bb'), 0, 0.037, 0.19, false));
    // Lid, hinged along the back edge
    this.lid.position.set(0, 0.035, -0.24);
    this.root.add(this.lid);
    const lidShell = mesh(roundedBox(0.78, 0.025, 0.5, 0.04), shell, 0, 0.25, 0);
    lidShell.rotation.x = Math.PI / 2;
    this.lid.add(lidShell);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    screen.position.set(0, 0.25, 0.014);
    this.lid.add(screen);
    // Sticker on the back of the lid
    const sticker = mesh(new THREE.CircleGeometry(0.07, 20), toon('#ff8a5b'), 0, 0.27, -0.014, false);
    sticker.rotation.y = Math.PI;
    this.lid.add(sticker);
    this.lid.rotation.x = Math.PI / 2; // closed; animates open
    paintScreen(this.ctx, this.canvas.width, this.canvas.height, undefined, this.placeholder);
    this.texture.needsUpdate = true;
  }

  setPlaceholder(text: string) {
    if (text === this.placeholder) return;
    this.placeholder = text;
    this.drawnVersion = -2;
  }

  update(dt: number, screen: ScreenState | undefined) {
    if (this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt * 1.6);
      const e = 1 - Math.pow(1 - this.openT, 3);
      this.lid.rotation.x = Math.PI / 2 - e * (Math.PI / 2 + 0.22);
    }
    const version = screen ? screen.version : -1;
    if (version !== this.drawnVersion) {
      this.drawnVersion = version;
      paintScreen(this.ctx, this.canvas.width, this.canvas.height, screen, this.placeholder);
      this.texture.needsUpdate = true;
    }
  }

  dispose() {
    this.texture.dispose();
  }
}
