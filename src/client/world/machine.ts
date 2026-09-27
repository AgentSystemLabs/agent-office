import * as THREE from 'three';
import type { MachineState } from '../../shared/protocol';

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#1b1d2e';
const MUTED = '#9aa0b8';

/** Green while there's room, amber when it's getting full, red from where hiring gets a warning. */
export function loadColor(pct: number): string {
  return pct >= 90 ? '#ef476f' : pct >= 70 ? '#ffd166' : '#06d6a0';
}

export function fmtGb(bytes: number): string {
  const gb = bytes / 2 ** 30;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

/** The office has as many workers as it takes. */
export function officeFull(s: MachineState): boolean {
  return s.limit !== undefined && s.workers >= s.limit;
}

/** What the hire dialog says while the machine is under pressure. */
export function pressureNote(s: MachineState): string | undefined {
  return s.pressure ? `⚠️ This machine is under pressure: ${s.pressure}. Another worker may slow down the ones already working.` : undefined;
}

/**
 * The machine monitor on the west wall: how busy the CPU and memory are, with the last few minutes
 * of each, and how many workers the office runs of the most it takes.
 */
export class MachineTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private drawn = '';

  constructor() {
    // The screen's own shape (MACHINE_MONITOR is 2.3 × 1.3 m).
    this.canvas.width = 920;
    this.canvas.height = 520;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  render(s: MachineState) {
    const key = JSON.stringify(s);
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = INK;
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';

    // Header: what this is, and whether there's room for another worker.
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = `900 40px ${FONT}`;
    g.fillText('🖥️ This machine', 30, 62);
    const full = officeFull(s);
    const status = !s.memTotal ? ['…', MUTED] : s.pressure ? ['⚠️ Under pressure', '#ef476f'] : full ? ['🚫 Office full', '#ffd166'] : ['✅ Room to hire', '#06d6a0'];
    g.font = `800 30px ${FONT}`;
    const tw = g.measureText(status[0]).width;
    g.fillStyle = status[1];
    roundRect(g, W - 30 - tw - 32, 24, tw + 32, 50, 25);
    g.fill();
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.fillText(status[0], W - 30 - (tw + 32) / 2, 60);

    const memPct = s.memTotal ? Math.round((s.memUsed / s.memTotal) * 100) : 0;
    this.panel(30, 100, 415, 'CPU', s.cpu, s.cores ? `${s.cores} core${s.cores === 1 ? '' : 's'}` : '', s.history.map(([c]) => c));
    this.panel(475, 100, 415, 'Memory', memPct, s.memTotal ? `${fmtGb(s.memUsed)} of ${fmtGb(s.memTotal)}` : '', s.history.map(([, m]) => m));

    // Footer: the workers, one pip each, against the limit.
    const y = 440;
    g.textAlign = 'left';
    g.font = `800 32px ${FONT}`;
    g.fillStyle = '#ffffff';
    const label = s.limit === undefined ? `👷 ${s.workers} worker${s.workers === 1 ? '' : 's'} · no limit` : `👷 ${s.workers} of ${s.limit} workers`;
    g.fillText(label, 30, y + 12);
    if (s.limit !== undefined) {
      const x0 = 30 + g.measureText(label).width + 28;
      const room = W - 30 - x0;
      const pip = Math.min(34, room / Math.max(s.limit, s.workers));
      for (let i = 0; i < Math.max(s.limit, s.workers); i++) {
        g.fillStyle = i >= s.limit ? '#ef476f' : i < s.workers ? (full ? '#ffd166' : '#06d6a0') : '#3a3d55';
        roundRect(g, x0 + i * pip, y - 14, Math.max(2, pip - 6), 30, Math.min(8, pip / 3));
        g.fill();
      }
    }
    this.texture.needsUpdate = true;
  }

  /** One gauge: its name, the percent now, a line under it, and the last few minutes as a filled graph. */
  private panel(x: number, y: number, w: number, name: string, pct: number, sub: string, history: number[]) {
    const g = this.ctx;
    const color = loadColor(pct);
    g.fillStyle = '#25283d';
    roundRect(g, x, y, w, 300, 18);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = MUTED;
    g.font = `800 28px ${FONT}`;
    g.fillText(name, x + 20, y + 42);
    g.fillStyle = color;
    g.font = `900 84px ${FONT}`;
    g.fillText(`${pct}%`, x + 20, y + 124);
    g.fillStyle = MUTED;
    g.font = `700 24px ${FONT}`;
    g.fillText(sub, x + 20, y + 160);
    // The graph: 0-100%, the newest reading on the right.
    const gx = x + 20;
    const gy = y + 180;
    const gw = w - 40;
    const gh = 100;
    // The 90% line: past it, hiring comes with a warning.
    g.strokeStyle = '#3a3d55';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(gx, gy + gh * 0.1);
    g.lineTo(gx + gw, gy + gh * 0.1);
    g.stroke();
    if (history.length < 2) return;
    const step = gw / (history.length - 1);
    const at = (i: number) => [gx + i * step, gy + gh - (Math.max(0, Math.min(100, history[i])) / 100) * gh] as const;
    g.beginPath();
    g.moveTo(gx, gy + gh);
    for (let i = 0; i < history.length; i++) g.lineTo(...at(i));
    g.lineTo(gx + gw, gy + gh);
    g.closePath();
    g.globalAlpha = 0.28;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    for (let i = 0; i < history.length; i++) (i ? g.lineTo : g.moveTo).call(g, ...at(i));
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.stroke();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
