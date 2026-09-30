import * as THREE from 'three';
import type { FloorPalette } from '../../../shared/floors';
import { toon } from '../toon';

// The castle's pictures: stone, flagstones and boards to tile over its walls, floors and roof,
// stained glass for its windows, and the banners, painted in a floor's colors.

/** A little randomness that's the same every time, so every browser sees the same stones. */
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

/** Courses of dressed stone, with mortar between. One tile is 4 m wide and 2 m high. */
export function ashlar(color: string, seed: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = shade(color, -0.12);
    g.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 64 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * 128 + off;
        g.fillStyle = shade(color, (rand() - 0.5) * 0.09);
        g.fillRect(x + 3, row * 64 + 3, 122, 58);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x + 3, row * 64 + 3, 122, 6);
      }
    }
  };
}

/** Big worn flagstones, 2 m a tile. */
export function flagstones(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(7);
    g.fillStyle = shade(color, -0.14);
    g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const off = r % 2 ? 64 : 0;
        g.fillStyle = shade(color, (rand() - 0.5) * 0.1);
        g.fillRect(c * 128 + off + 4, r * 128 + 4, 120, 120);
        if (off) {
          g.fillStyle = shade(color, (rand() - 0.5) * 0.1);
          g.fillRect(-64 + 4, r * 128 + 4, 120, 120);
        }
      }
    }
  };
}

/** Dark boards, for the roof's underside. */
export function boards(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.fillStyle = shade(color, -0.08);
    g.fillRect(0, 0, 256, 256);
    const rand = seeded(3);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = shade(color, (rand() - 0.5) * 0.08);
      g.fillRect(i * 32 + 1, 0, 30, 256);
    }
  };
}

const GLASS = ['#b3261e', '#1f4fb4', '#d9a520', '#2e8b57', '#6a2c91', '#d8631c', '#1b7a8c'];

/** Stained glass: a diamond lattice of colored panes in lead, and a bright roundel in the middle. */
export function stainedGlass(seed: number, w: number, h: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = '#1b1612';
    g.fillRect(0, 0, w, h);
    const cell = w / 5;
    for (let y = -cell; y < h + cell; y += cell / 2) {
      for (let x = -cell; x < w + cell; x += cell) {
        const cx = x + ((Math.round(y / (cell / 2)) % 2) * cell) / 2;
        g.fillStyle = GLASS[Math.floor(rand() * GLASS.length)];
        g.globalAlpha = 0.75 + rand() * 0.25;
        g.beginPath();
        g.moveTo(cx, y - cell / 2 + 3);
        g.lineTo(cx + cell / 2 - 3, y);
        g.lineTo(cx, y + cell / 2 - 3);
        g.lineTo(cx - cell / 2 + 3, y);
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // A roundel: a gold ring, a star in it.
    const r = w * 0.3;
    g.lineWidth = 8;
    g.strokeStyle = '#1b1612';
    g.fillStyle = '#f2d06b';
    g.beginPath();
    g.arc(w / 2, h * 0.42, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = GLASS[Math.floor(rand() * 3)];
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.42 : r * 0.85;
      g.lineTo(w / 2 + Math.cos(a) * rr, h * 0.42 + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  };
}

/** A rose window: petals of glass round a gold heart, spokes of stone between them. */
export function roseGlass(g: CanvasRenderingContext2D) {
  const s = 512;
  const c = s / 2;
  g.fillStyle = '#1b1612';
  g.fillRect(0, 0, s, s);
  const rand = seeded(11);
  for (let ring = 3; ring >= 1; ring--) {
    const n = ring * 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = GLASS[(i + ring) % GLASS.length];
      g.globalAlpha = 0.8 + rand() * 0.2;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, (ring / 3) * c - 6, (i / n) * Math.PI * 2 + 0.03, ((i + 1) / n) * Math.PI * 2 - 0.03);
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#1b1612';
  g.lineWidth = 10;
  for (const r of [c / 3, (2 * c) / 3]) {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#f2d06b';
  g.beginPath();
  g.arc(c, c, c / 6, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

/** A banner: its field in `color` with a gold border, a crown, and a word or two at the foot. */
export function paintBanner(g: CanvasRenderingContext2D, w: number, h: number, color: string, motto?: string) {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = shade(color, -0.12);
  for (let x = 0; x < w; x += 24) g.fillRect(x, 0, 10, h);
  g.strokeStyle = '#e8b93a';
  g.lineWidth = w * 0.05;
  g.strokeRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12);
  // The crown.
  const cx = w / 2;
  const cy = h * 0.3;
  const cw = w * 0.52;
  g.fillStyle = '#f2c94c';
  g.strokeStyle = '#6b4a10';
  g.lineWidth = w * 0.015;
  g.beginPath();
  g.moveTo(cx - cw / 2, cy + cw * 0.35);
  g.lineTo(cx - cw / 2, cy - cw * 0.15);
  g.lineTo(cx - cw / 4, cy + cw * 0.08);
  g.lineTo(cx, cy - cw * 0.32);
  g.lineTo(cx + cw / 4, cy + cw * 0.08);
  g.lineTo(cx + cw / 2, cy - cw * 0.15);
  g.lineTo(cx + cw / 2, cy + cw * 0.35);
  g.closePath();
  g.fill();
  g.stroke();
  for (const dx of [-cw / 2, 0, cw / 2]) {
    g.beginPath();
    g.arc(cx + dx, cy - (dx ? cw * 0.19 : cw * 0.36), w * 0.035, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (motto) {
    g.fillStyle = '#f7e7b4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = w * 0.13;
    g.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(motto).width > w * 0.8 && size > 10) {
      size *= 0.9;
      g.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
    }
    g.fillText(motto, cx, h * 0.62);
  }
}

/** A toon material with a picture on it (stone, flagstones, boards). */
export const toonMap = (map: THREE.Texture) => new THREE.MeshToonMaterial({ color: '#ffffff', map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });

/** A floor's colors as heraldry: its trim's hue, deep and rich, for the banners and the shields. */
export function heraldry(p: FloorPalette): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(p.trim).getHSL(hsl);
  return `#${new THREE.Color().setHSL(hsl.h, 0.62, 0.3).getHexString()}`;
}
