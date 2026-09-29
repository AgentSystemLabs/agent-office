import * as THREE from 'three';
import { ANISOTROPY } from './texture-quality';
import type { MachineState, ProxyProvider, ProxyState } from '../../shared/protocol';
import { MACHINE_MONITOR, PROXY_REFRESH } from '../../shared/layout';
import { SANS, MONO } from '../fonts';
import { fillGlyphText } from './glyph';

const MUTED = '#8c8c8c';

/** Green while there's room, amber when it's getting full, red from where hiring gets a warning. */
export function loadColor(pct: number): string {
  return pct >= 90 ? '#ef4444' : pct >= 70 ? '#f2b84b' : '#3ccf91';
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

/** "42m", "2h 27m", "3d 4h": how long until a limit starts over. */
export function fmtResetIn(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / (24 * 60))}d ${Math.floor((mins % (24 * 60)) / 60)}h`;
}

const PROVIDER_COLOR: Record<ProxyProvider, string> = { claude: '#e08a5f', codex: '#7aa2f7', grok: '#d4d4d4' };
/** The canvas is 400 px a meter: MACHINE_MONITOR.width × height, or × tallHeight with DroidProxy's limits. */
const PX_PER_M = 400;
const SHORT_H = MACHINE_MONITOR.height * PX_PER_M;
const TALL_H = MACHINE_MONITOR.tallHeight * PX_PER_M;
/** The most account rows that fit under the machine's gauges. */
const MAX_ROWS = 4;

/**
 * The machine monitor on the west wall: how busy the CPU and memory are, with the last few minutes
 * of each, and how many workers the office runs of the most it takes. With DroidProxy on the
 * machine, the monitor is taller and shows how much of each of its accounts' limits is used.
 */
export class MachineTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private drawn = '';

  constructor() {
    // Always the tall size: a short monitor shows the top of it, so the texture never reallocates.
    this.canvas.width = MACHINE_MONITOR.width * PX_PER_M;
    this.canvas.height = TALL_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = ANISOTROPY;
  }

  /** Draws the monitor. Returns whether it should be the tall one. */
  render(s: MachineState, proxy?: ProxyState): boolean {
    const tall = !!proxy?.accounts.length;
    // Reset countdowns move on with the minute.
    const key = JSON.stringify([s, tall && proxy, tall && Math.floor(Date.now() / 60_000)]);
    if (key === this.drawn) return tall;
    this.drawn = key;
    const g = this.ctx;
    const W = this.canvas.width;
    const H = tall ? TALL_H : SHORT_H;
    // flipY puts the canvas top at v = 1: the short monitor shows the top SHORT_H of it.
    this.texture.repeat.set(1, H / TALL_H);
    this.texture.offset.set(0, 1 - H / TALL_H);
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, TALL_H);
    g.textBaseline = 'alphabetic';

    // Header: what this is, and whether there's room for another worker.
    g.textAlign = 'left';
    g.fillStyle = '#eeeeee';
    g.font = `600 34px ${MONO}`;
    g.fillText('🖥️ THIS MACHINE', 30, 62);
    const full = officeFull(s);
    const status = !s.memTotal ? ['…', MUTED] : s.pressure ? ['⚠️ UNDER PRESSURE', '#ef4444'] : full ? ['🚫 OFFICE FULL', '#f2b84b'] : ['✅ ROOM TO HIRE', '#3ccf91'];
    g.font = `600 24px ${MONO}`;
    const tw = g.measureText(status[0]).width;
    g.fillStyle = status[1];
    roundRect(g, W - 30 - tw - 32, 24, tw + 32, 50, 3);
    g.fill();
    g.fillStyle = '#0a0a0a';
    g.textAlign = 'center';
    g.fillText(status[0], W - 30 - (tw + 32) / 2, 60);

    const memPct = s.memTotal ? Math.round((s.memUsed / s.memTotal) * 100) : 0;
    this.panel(
      30,
      100,
      415,
      'CPU',
      s.cpu,
      s.cores ? `${s.cores} core${s.cores === 1 ? '' : 's'}` : '',
      s.history.map(([c]) => c),
    );
    this.panel(
      475,
      100,
      415,
      'Memory',
      memPct,
      s.memTotal ? `${fmtGb(s.memUsed)} of ${fmtGb(s.memTotal)}` : '',
      s.history.map(([, m]) => m),
    );

    // Footer: the workers, one pip each, against the limit.
    const y = 440;
    g.textAlign = 'left';
    g.font = `500 26px ${SANS}`;
    g.fillStyle = '#eeeeee';
    const label = s.limit === undefined ? `👷 ${s.workers} worker${s.workers === 1 ? '' : 's'} · no limit` : `👷 ${s.workers} of ${s.limit} workers`;
    g.fillText(label, 30, y + 12);
    if (s.limit !== undefined) {
      const x0 = 30 + g.measureText(label).width + 28;
      const room = W - 30 - x0;
      const pip = Math.min(34, room / Math.max(s.limit, s.workers));
      for (let i = 0; i < Math.max(s.limit, s.workers); i++) {
        g.fillStyle = i >= s.limit ? '#ef4444' : i < s.workers ? (full ? '#f2b84b' : '#3ccf91') : '#2a2a2a';
        roundRect(g, x0 + i * pip, y - 14, Math.max(2, pip - 6), 30, Math.min(4, pip / 3));
        g.fill();
      }
    }
    if (tall) this.proxy(proxy!, SHORT_H, W, H);
    this.texture.needsUpdate = true;
    return tall;
  }

  /** DroidProxy's accounts, a row each: whose, which plan, and a meter per limit with when it starts over. */
  private proxy(p: ProxyState, top: number, W: number, H: number) {
    const g = this.ctx;
    g.strokeStyle = 'rgba(255, 255, 255, .12)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(30, top);
    g.lineTo(W - 30, top);
    g.stroke();

    g.textAlign = 'left';
    g.fillStyle = '#eeeeee';
    g.font = `600 30px ${MONO}`;
    fillGlyphText(g, 'DroidProxy LIMITS', 30, top + 52, 30);
    const status = p.running === undefined ? ['…', MUTED] : p.running ? ['● RUNNING', '#3ccf91'] : ['● NOT RUNNING', '#ef4444'];
    const bx = PROXY_REFRESH.x * PX_PER_M;
    const by = PROXY_REFRESH.y * PX_PER_M;
    const bw = PROXY_REFRESH.width * PX_PER_M;
    const bh = PROXY_REFRESH.height * PX_PER_M;
    g.font = `600 22px ${MONO}`;
    g.textAlign = 'right';
    g.fillStyle = status[1];
    g.fillText(status[0], bx - 20, top + 50);

    // The refresh button, where the office's hit area for it sits (world/office.ts).
    g.fillStyle = p.refreshing ? '#1c1c1c' : '#202a24';
    g.strokeStyle = p.refreshing ? '#3a3a3a' : '#3ccf91';
    g.lineWidth = 2;
    roundRect(g, bx, by, bw, bh, 6);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = p.refreshing ? MUTED : '#eeeeee';
    g.font = `600 22px ${MONO}`;
    g.fillText(p.refreshing ? 'READING…' : '↻ REFRESH', bx + bw / 2, by + bh / 2 + 8);

    const rowsTop = top + 80;
    const bottom = H - 20;
    const more = p.accounts.length > MAX_ROWS ? p.accounts.length - (MAX_ROWS - 1) : 0;
    const shown = more ? p.accounts.slice(0, MAX_ROWS - 1) : p.accounts;
    const rowH = Math.min(96, (bottom - rowsTop) / (shown.length + (more ? 1 : 0)));
    const nameW = 220;
    const cols = Math.max(1, ...shown.map((a) => a.windows.length));
    const cellGap = 18;
    const cellW = (W - 30 - (30 + nameW) - cellGap * (cols - 1)) / cols;
    const now = Date.now();

    shown.forEach((a, i) => {
      const y = rowsTop + i * rowH;
      g.textAlign = 'left';
      g.fillStyle = PROVIDER_COLOR[a.provider];
      g.font = `700 26px ${SANS}`;
      g.fillText(a.label, 30, y + 30, nameW - 10);
      g.font = `500 18px ${MONO}`;
      g.fillStyle = a.limited ? '#ef4444' : MUTED;
      g.fillText([a.plan?.toUpperCase(), a.limited ? 'LIMIT HIT' : ''].filter(Boolean).join(' · '), 30, y + 58, nameW - 10);
      if (!a.windows.length) {
        g.fillStyle = MUTED;
        g.font = `500 20px ${SANS}`;
        fillGlyphText(g, a.error ?? 'No limits reported', 30 + nameW, y + 42, 20, W - 60 - nameW);
        return;
      }
      a.windows.forEach((w, j) => {
        const x = 30 + nameW + j * (cellW + cellGap);
        const used = Math.round(w.pct);
        const color = loadColor(w.pct);
        g.textAlign = 'left';
        g.fillStyle = MUTED;
        g.font = `600 18px ${MONO}`;
        g.fillText(w.label.toUpperCase(), x, y + 24, cellW - 70);
        g.textAlign = 'right';
        g.fillStyle = color;
        g.font = `700 24px ${MONO}`;
        g.fillText(`${used}%`, x + cellW, y + 26);
        g.fillStyle = '#2a2a2a';
        roundRect(g, x, y + 36, cellW, 12, 6);
        g.fill();
        if (w.pct > 0) {
          g.fillStyle = color;
          roundRect(g, x, y + 36, Math.max(12, (cellW * Math.min(100, w.pct)) / 100), 12, 6);
          g.fill();
        }
        if (w.resetsAt) {
          g.textAlign = 'left';
          g.fillStyle = MUTED;
          g.font = `500 17px ${MONO}`;
          g.fillText(`↻ ${fmtResetIn(w.resetsAt, now)}`, x, y + 70, cellW);
        }
      });
    });
    if (more) {
      g.textAlign = 'left';
      g.fillStyle = MUTED;
      g.font = `500 20px ${SANS}`;
      g.fillText(`+ ${more} more account${more === 1 ? '' : 's'}`, 30, rowsTop + shown.length * rowH + 30);
    }
  }

  /** One gauge: its name, the percent now, a line under it, and the last few minutes as a filled graph. */
  private panel(x: number, y: number, w: number, name: string, pct: number, sub: string, history: number[]) {
    const g = this.ctx;
    const color = loadColor(pct);
    g.fillStyle = '#101010';
    g.strokeStyle = 'rgba(255, 255, 255, .12)';
    g.lineWidth = 2;
    roundRect(g, x, y, w, 300, 6);
    g.fill();
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = MUTED;
    g.font = `600 22px ${MONO}`;
    g.fillText(name.toUpperCase(), x + 20, y + 42);
    g.fillStyle = color;
    g.font = `700 80px ${MONO}`;
    g.fillText(`${pct}%`, x + 20, y + 124);
    g.fillStyle = MUTED;
    g.font = `500 20px ${MONO}`;
    g.fillText(sub, x + 20, y + 160);
    // The graph: 0-100%, the newest reading on the right.
    const gx = x + 20;
    const gy = y + 180;
    const gw = w - 40;
    const gh = 100;
    // The 90% line: past it, hiring comes with a warning.
    g.strokeStyle = 'rgba(255, 255, 255, .14)';
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
