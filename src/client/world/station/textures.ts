import * as THREE from 'three';
import { toonUnique } from '../toon';
import { shade } from './kit';

// The pictures the station's surfaces are painted with: the hull's panelling, the deck's plating,
// and what its displays show. The planets outside are in planets.ts.

/** The same numbers every time, so a station looks the same in everyone's browser. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A toon material with `map` painted on it. */
export function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  const m = toonUnique('#ffffff');
  m.map = map;
  return m;
}

/** The hull's panelling: big pale panels with seams between, a rivet at every corner, and the odd vent or hatch. One tile is 3 m square. */
export function hullPanels(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const S = 512;
    const rand = seeded(42);
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    // Two rows of panels a tile, the lower row's joints half a panel along from the upper's.
    const rows = 2;
    const cols = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = S / cols;
        const h = S / rows;
        const x = c * w + (r % 2 ? w / 2 : 0);
        const y = r * h;
        for (const dx of [0, -S]) {
          g.fillStyle = shade(color, (rand() - 0.5) * 0.035);
          g.fillRect(x + dx + 3, y + 3, w - 6, h - 6);
          // A lighter edge along the top of each panel, a darker one along the bottom: it's pressed, not flat.
          g.fillStyle = shade(color, 0.05);
          g.fillRect(x + dx + 3, y + 3, w - 6, 3);
          g.fillStyle = shade(color, -0.07);
          g.fillRect(x + dx + 3, y + h - 6, w - 6, 3);
        }
      }
    }
    g.fillStyle = shade(color, -0.2);
    for (let r = 0; r < rows; r++) {
      g.fillRect(0, r * (S / rows) - 1.5, S, 3);
      for (let c = 0; c < cols; c++) g.fillRect(c * (S / cols) + (r % 2 ? S / cols / 2 : 0) - 1.5, r * (S / rows), 3, S / rows);
    }
    g.fillRect(0, S - 1.5, S, 3);
    // Rivets down the joints.
    g.fillStyle = shade(color, -0.26);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * (S / cols) + (r % 2 ? S / cols / 2 : 0);
        for (let k = 1; k < 6; k++) {
          for (const side of [-9, 9]) {
            g.beginPath();
            g.arc((x + side + S) % S, r * (S / rows) + (k * (S / rows)) / 6, 2.2, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
    // A vent, and a little hatch with a label.
    g.fillStyle = shade(color, -0.3);
    for (let i = 0; i < 6; i++) g.fillRect(60, 60 + i * 9, 70, 4);
    g.strokeStyle = shade(color, -0.22);
    g.lineWidth = 3;
    g.strokeRect(340, 330, 90, 56);
    g.fillStyle = '#d9822b';
    g.fillRect(346, 336, 22, 8);
    g.fillStyle = shade(color, -0.3);
    g.fillRect(374, 337, 44, 3);
    g.fillRect(374, 344, 30, 3);
  };
}

/** The deck's plating: dark square plates, a tread pressed into each, a bolt at every corner. One tile is 2 m square. */
export function deckPlates(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const S = 512;
    const rand = seeded(7);
    const n = 2;
    const w = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = shade(color, (rand() - 0.5) * 0.04);
        g.fillRect(i * w, j * w, w, w);
        // Tread: short bars, turned on every other plate.
        g.fillStyle = shade(color, 0.045);
        const turned = (i + j) % 2 === 1;
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b < 6; b++) {
            const x = i * w + 30 + a * 36 + (b % 2 ? 12 : 0);
            const y = j * w + 30 + b * 36;
            if (turned) g.fillRect(x, y, 5, 18);
            else g.fillRect(x, y, 18, 5);
          }
        }
        g.fillStyle = shade(color, -0.12);
        for (const [x, y] of [
          [10, 10],
          [w - 10, 10],
          [10, w - 10],
          [w - 10, w - 10],
        ]) {
          g.beginPath();
          g.arc(i * w + x, j * w + y, 3.5, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.fillStyle = shade(color, -0.14);
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * w - 2, 0, 4, S);
      g.fillRect(0, i * w - 2, S, 4);
    }
  };
}

/** The ceiling: panels between the ribs, darker than the walls. One tile is 3 m square. */
export function ceilingPanels(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const S = 256;
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    g.fillStyle = shade(color, -0.08);
    g.fillRect(0, 0, S, 4);
    g.fillRect(0, 0, 4, S);
    g.fillRect(S / 2 - 2, 0, 4, S);
    g.fillStyle = shade(color, 0.04);
    g.fillRect(4, 4, S / 2 - 6, 3);
    g.fillRect(S / 2 + 2, 4, S / 2 - 6, 3);
  };
}

const READOUTS = ['ORBIT 412 KM', 'O₂ 98.6%', 'HULL OK', 'PRESSURE 101 kPa', 'SOLAR 84 kW', 'CREW ABOARD', 'AIRLOCK SEALED', 'COMMS LINKED', 'THRUST STANDBY', 'GRAVITY 1.0 G'];

/**
 * A display's telemetry, `w` by `h` pixels: a graph, a row of bars, a dial and a few read-outs, in
 * `ink` on the dark. `seed` gives each display its own.
 */
export function telemetry(seed: number, w: number, h: number, ink: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed * 97 + 13);
    g.fillStyle = '#071018';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120, 190, 230, 0.13)';
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // A graph across the top half.
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.beginPath();
    let y = h * 0.3;
    for (let x = 16; x < w * 0.62; x += 14) {
      y = Math.min(h * 0.5, Math.max(h * 0.12, y + (rand() - 0.5) * h * 0.14));
      if (x === 16) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Bars along the bottom.
    for (let i = 0; i < 9; i++) {
      const bh = (0.15 + rand() * 0.25) * h;
      g.fillStyle = i % 4 === 3 ? '#ffb347' : ink;
      g.globalAlpha = 0.85;
      g.fillRect(16 + i * (w * 0.065), h - 18 - bh, w * 0.045, bh);
    }
    g.globalAlpha = 1;
    // A dial, top right: an orbit with a blip on it.
    const cx = w * 0.82;
    const cy = h * 0.32;
    const r = Math.min(w, h) * 0.2;
    g.lineWidth = 3;
    g.strokeStyle = ink;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.5;
    g.beginPath();
    g.ellipse(cx, cy, r * 1.25, r * 0.45, -0.4, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = '#ffb347';
    const a = rand() * Math.PI * 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r * 1.25 * Math.cos(-0.4) - Math.sin(a) * r * 0.45 * Math.sin(-0.4), cy + Math.cos(a) * r * 1.25 * Math.sin(-0.4) + Math.sin(a) * r * 0.45 * Math.cos(-0.4), 6, 0, Math.PI * 2);
    g.fill();
    // Read-outs down the right.
    g.fillStyle = ink;
    g.font = `700 ${Math.round(h * 0.075)}px ui-monospace, Menlo, monospace`;
    g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) g.fillText(READOUTS[Math.floor(rand() * READOUTS.length)], w * 0.64, h * (0.64 + i * 0.12));
  };
}
