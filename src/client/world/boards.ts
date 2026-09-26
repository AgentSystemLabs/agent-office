import * as THREE from 'three';
import { DESK_BY_ID } from '../../shared/layout';
import type { GhIssue, GhPull, GhState, ServiceInfo, WorkerInfo } from '../../shared/protocol';
import { workerForPull } from '../state';

const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];
const PINS = ['#ef476f', '#118ab2', '#06d6a0', '#ffd166'];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = next;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  return lines;
}

/** Renders a cork board with pinned sticky notes onto a canvas texture. */
export class BoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  constructor(private kind: 'issues' | 'pulls') {
    this.canvas.width = 1200;
    this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  /** `workers` lets PR notes name the desk they came from. */
  render(state: GhState<GhIssue> | GhState<GhPull>, workers?: Map<string, WorkerInfo>) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#d8a86a';
    g.fillRect(0, 0, W, H);
    // cork speckles
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,70,30,.18)' : 'rgba(255,240,210,.18)';
      g.fillRect(rnd() * W, rnd() * H, 3, 3);
    }
    const open = (state.items as (GhIssue | GhPull)[]).filter((i) => i.state === 'OPEN');
    if (!open.length) {
      const note = state.error ? `⚠️ ${state.error}` : state.loading && !state.fetchedAt ? 'Loading…' : this.kind === 'issues' ? 'No open issues 🎉' : 'No open PRs';
      g.font = '800 40px Nunito, ui-rounded, system-ui, sans-serif';
      const lines = wrap(g, note.replace(/`/g, ''), 760, 4);
      const boxH = 60 + lines.length * 50;
      g.fillStyle = '#fffaf3';
      g.fillRect(W / 2 - 420, H / 2 - boxH / 2, 840, boxH);
      g.fillStyle = '#2b2d42';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((line, i) => g.fillText(line, W / 2, H / 2 - ((lines.length - 1) * 50) / 2 + i * 50));
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      this.texture.needsUpdate = true;
      return;
    }
    // Fewer notes -> bigger notes, so a quiet board is still readable from across the room.
    const n = Math.min(open.length, 15);
    const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
    const rows = Math.min(3, Math.ceil(n / cols));
    const scale = Math.min(2, Math.max(1, 3 / Math.max(cols, rows * 1.3)));
    const nw = Math.min(208 * scale, (W - 40) / cols - 30);
    const nh = Math.min(164 * scale, (H - 40) / rows - 30);
    const gx = (W - cols * nw) / (cols + 1);
    const gy = (H - rows * nh) / (rows + 1);
    open.slice(0, cols * rows).forEach((it, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = gx + c * (nw + gx);
      const y = gy + r * (nh + gy);
      g.save();
      g.translate(x + nw / 2, y + nh / 2);
      g.rotate(((it.number * 37) % 7 - 3) * 0.012);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(-nw / 2 + 5, -nh / 2 + 7, nw, nh);
      const draft = this.kind === 'pulls' && (it as GhPull).isDraft;
      g.fillStyle = draft ? '#e9ecef' : NOTE_COLORS[it.number % NOTE_COLORS.length];
      g.fillRect(-nw / 2, -nh / 2, nw, nh);
      g.fillStyle = '#2b2d42';
      const fs = Math.round(22 * Math.min(scale, nh / 164));
      const w = this.kind === 'pulls' && workers ? workerForPull(workers.values(), it as GhPull) : undefined;
      const footer = w ? fs * 1.3 : 0;
      g.font = `900 ${Math.round(fs * 1.35)}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillText(`#${it.number}`, -nw / 2 + 14, -nh / 2 + fs * 2);
      g.font = `700 ${fs}px Nunito, ui-rounded, system-ui, sans-serif`;
      wrap(g, it.title, nw - 28, Math.max(2, Math.floor((nh - fs * 3 - footer) / (fs * 1.1)))).forEach((line, li) => g.fillText(line, -nw / 2 + 14, -nh / 2 + fs * 3.4 + li * fs * 1.1));
      if (w) {
        // A dot in the worker's color and its desk, so you can tell whose PR it is from across the room.
        const r = fs * 0.3;
        const y = nh / 2 - fs * 0.75;
        g.beginPath();
        g.arc(-nw / 2 + 14 + r, y, r, 0, Math.PI * 2);
        g.fillStyle = w.color;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#2b2d42';
        g.stroke();
        g.fillStyle = '#5c5f73';
        g.font = `800 ${Math.round(fs * 0.78)}px Nunito, ui-rounded, system-ui, sans-serif`;
        g.fillText(clip(g, `${w.name} · ${DESK_BY_ID.get(w.deskId)?.label ?? 'desk'}`, nw - 28 - r * 2 - 8), -nw / 2 + 14 + r * 2 + 8, y + fs * 0.28);
      }
      g.beginPath();
      g.arc(0, -nh / 2 + 10, 11, 0, Math.PI * 2);
      g.fillStyle = PINS[i % PINS.length];
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#2b2d42';
      g.stroke();
      g.restore();
    });
    if (open.length > cols * rows) {
      g.fillStyle = '#2b2d42';
      g.font = '800 26px Nunito, ui-rounded, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(`+${open.length - cols * rows} more`, W - 20, H - 16);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}

/** The services board: a chalkboard listing the web servers workers are running. */
export class ServicesBoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private drawn = '';

  constructor() {
    this.canvas.width = 1200;
    this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  render(items: ServiceInfo[], workers: Map<string, WorkerInfo>) {
    const rows = items.map((s) => {
      const w = workers.get(s.workerId);
      return { port: s.port, title: s.title || s.command, who: [w?.name ?? 'A worker', w?.worktree?.branch].filter(Boolean).join(' · '), color: w?.color ?? '#8d99ae' };
    });
    // Worker updates stream in constantly; only redraw when what's shown changes.
    const key = JSON.stringify(rows);
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#23303b';
    g.fillRect(0, 0, W, H);
    // chalk smudges
    g.fillStyle = 'rgba(255,255,255,.025)';
    for (let i = 0; i < 18; i++) g.fillRect(((i * 997) % W) - 60, ((i * 613) % H) - 20, 260, 34);
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#e9ecef';
      g.font = '900 52px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText('No web servers running', W / 2, H / 2 - 20);
      g.fillStyle = 'rgba(233,236,239,.6)';
      g.font = '700 32px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText('When a worker starts one, it shows up here', W / 2, H / 2 + 36);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    const shown = rows.slice(0, 5);
    const rowH = Math.min(140, (H - 40) / shown.length);
    const fs = Math.round(rowH * 0.36);
    shown.forEach((r, i) => {
      const y = 20 + i * rowH;
      g.fillStyle = 'rgba(255,255,255,.06)';
      g.fillRect(24, y + 6, W - 48, rowH - 12);
      g.beginPath();
      g.arc(70, y + rowH / 2, fs * 0.42, 0, Math.PI * 2);
      g.fillStyle = r.color;
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = '#e9ecef';
      g.stroke();
      g.fillStyle = '#ffd166';
      g.font = `900 ${fs}px ui-monospace, Menlo, monospace`;
      g.textAlign = 'right';
      g.fillText(`:${r.port}`, W - 50, y + rowH / 2 + fs * 0.35);
      g.textAlign = 'left';
      const textW = W - 120 - 50 - g.measureText(`:${r.port}`).width - 30;
      g.fillStyle = '#f8f9fa';
      g.font = `800 ${fs}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillText(clip(g, r.title, textW), 110, y + rowH / 2 - fs * 0.08);
      g.fillStyle = 'rgba(233,236,239,.65)';
      g.font = `700 ${Math.round(fs * 0.62)}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillText(clip(g, r.who, textW), 110, y + rowH / 2 + fs * 0.72);
    });
    if (rows.length > shown.length) {
      g.fillStyle = '#e9ecef';
      g.font = '800 26px Nunito, ui-rounded, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText(`+${rows.length - shown.length} more`, W - 24, H - 10);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}

function clip(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}
