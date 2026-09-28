import * as THREE from 'three';
import { DESK_BY_ID } from '../../shared/layout';
import type { GhIssue, GhPull, GhState, QueueState, QueueTask, ServiceInfo, WorkerInfo } from '../../shared/protocol';
import { workerForPull } from '../state';
import { SANS, MONO } from '../fonts';

// The Factory-style world surfaces: near-black panels, light text, orange accents (see ui/boards'
// constants in style.css). The board's cards all read as one family; the marker squares vary.
export const NOTE_COLORS = ['#161616', '#15181c', '#17151a', '#141618', '#16161a'];
export const PINS = ['#ee6018', '#5aa9e6', '#3ccf91', '#f2b84b'];

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
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

/** A note as it was last drawn: its middle, size and tilt on the canvas. */
interface DrawnNote {
  number: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
}

/** Renders a wall display of square task cards onto a canvas texture. */
export class BoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private notes: DrawnNote[] = [];
  /** The note being reached for, drawn lifted off the cork (see lift). */
  private lifted: number | null = null;
  private last: [GhState<GhIssue> | GhState<GhPull>, Map<string, WorkerInfo> | undefined] | null = null;

  constructor(private kind: 'issues' | 'pulls') {
    this.canvas.width = 1200;
    this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  /** Whether any notes are up on the board. */
  get hasNotes(): boolean {
    return this.notes.length > 0;
  }

  /** The note at a point on the board's face (its uv), or undefined over bare cork. */
  noteAt(uv: THREE.Vector2): number | undefined {
    const px = uv.x * this.canvas.width;
    const py = (1 - uv.y) * this.canvas.height;
    // Topmost first: later notes are drawn over earlier ones.
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      // Into the note's own (tilted) frame.
      const dx = px - n.x;
      const dy = py - n.y;
      const c = Math.cos(-n.tilt);
      const s = Math.sin(-n.tilt);
      if (Math.abs(dx * c - dy * s) <= n.w / 2 && Math.abs(dx * s + dy * c) <= n.h / 2) return n.number;
    }
    return undefined;
  }

  /** Draws one note lifted off the cork, the one you're about to take (null for none). */
  lift(number: number | null) {
    if (number === this.lifted) return;
    this.lifted = number;
    if (this.last) this.render(...this.last);
  }

  /** `workers` lets PR notes name the desk they came from. */
  render(state: GhState<GhIssue> | GhState<GhPull>, workers?: Map<string, WorkerInfo>) {
    this.last = [state, workers];
    this.notes = [];
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, H);
    // A faint dot grid, like the board window's background.
    g.fillStyle = 'rgba(255, 255, 255, .045)';
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x, y, 2, 2);
    const open = (state.items as (GhIssue | GhPull)[]).filter((i) => i.state === 'OPEN');
    if (!open.length) {
      const note = state.error ? `⚠️ ${state.error}` : state.loading && !state.fetchedAt ? 'Loading…' : this.kind === 'issues' ? 'No open issues 🎉' : 'No open PRs';
      g.font = `700 34px ${MONO}`;
      const lines = wrap(g, note.replace(/`/g, ''), 820, 4);
      const boxH = 64 + lines.length * 46;
      g.fillStyle = '#161616';
      g.fillRect(W / 2 - 440, H / 2 - boxH / 2, 880, boxH);
      g.strokeStyle = 'rgba(255, 255, 255, .18)';
      g.lineWidth = 3;
      g.strokeRect(W / 2 - 440, H / 2 - boxH / 2, 880, boxH);
      g.fillStyle = '#eeeeee';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((line, i) => g.fillText(line, W / 2, H / 2 - ((lines.length - 1) * 46) / 2 + i * 46));
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
      const tilt = ((it.number * 37) % 7 - 3) * 0.012;
      this.notes.push({ number: it.number, x: x + nw / 2, y: y + nh / 2, w: nw, h: nh, tilt });
      const lifted = it.number === this.lifted;
      g.save();
      g.translate(x + nw / 2, y + nh / 2);
      g.rotate(tilt);
      // Lifted: a little bigger and its shadow further off, as if it's coming away from the board.
      if (lifted) g.scale(1.06, 1.06);
      g.fillStyle = lifted ? 'rgba(0, 0, 0, .5)' : 'rgba(0, 0, 0, .4)';
      g.fillRect(-nw / 2 + (lifted ? 10 : 4), -nh / 2 + (lifted ? 12 : 6), nw, nh);
      const draft = this.kind === 'pulls' && (it as GhPull).isDraft;
      g.fillStyle = draft ? '#101013' : NOTE_COLORS[it.number % NOTE_COLORS.length];
      g.fillRect(-nw / 2, -nh / 2, nw, nh);
      // A hairline border; the one being lifted lights up orange.
      g.lineWidth = lifted ? 6 : 3;
      g.strokeStyle = lifted ? '#ee6018' : 'rgba(255, 255, 255, .18)';
      g.strokeRect(-nw / 2, -nh / 2, nw, nh);
      // The index in orange, the title in light text.
      const fs = Math.round(22 * Math.min(scale, nh / 164));
      const w = this.kind === 'pulls' && workers ? workerForPull(workers.values(), it as GhPull) : undefined;
      const footer = w ? fs * 1.3 : 0;
      g.fillStyle = '#ee6018';
      g.font = `700 ${Math.round(fs * 1.2)}px ${MONO}`;
      g.fillText(`#${it.number}`, -nw / 2 + 14, -nh / 2 + fs * 2);
      g.fillStyle = '#eeeeee';
      g.font = `600 ${fs}px ${SANS}`;
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
        g.strokeStyle = 'rgba(255, 255, 255, .35)';
        g.stroke();
        g.fillStyle = '#8c8c8c';
        g.font = `500 ${Math.round(fs * 0.72)}px ${MONO}`;
        g.fillText(clip(g, `${w.name} · ${DESK_BY_ID.get(w.deskId)?.label ?? 'desk'}`, nw - 28 - r * 2 - 8), -nw / 2 + 14 + r * 2 + 8, y + fs * 0.28);
      }
      g.restore();
    });
    if (open.length > cols * rows) {
      g.fillStyle = '#8c8c8c';
      g.font = `500 22px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`+${open.length - cols * rows} more`, W - 20, H - 16);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}

/** The services board: a wall display listing the web servers workers are running. */
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
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, H);
    // A faint dot grid, like the issues and PRs boards.
    g.fillStyle = 'rgba(255, 255, 255, .045)';
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x, y, 2, 2);
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#eeeeee';
      g.font = `700 44px ${MONO}`;
      g.fillText('No web servers running', W / 2, H / 2 - 20);
      g.fillStyle = 'rgba(140, 140, 140, .9)';
      g.font = `500 28px ${SANS}`;
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
      g.fillStyle = 'rgba(255, 255, 255, .04)';
      g.fillRect(24, y + 6, W - 48, rowH - 12);
      g.strokeStyle = 'rgba(255, 255, 255, .12)';
      g.lineWidth = 2;
      g.strokeRect(24, y + 6, W - 48, rowH - 12);
      g.beginPath();
      g.arc(70, y + rowH / 2, fs * 0.42, 0, Math.PI * 2);
      g.fillStyle = r.color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255, 255, 255, .35)';
      g.stroke();
      g.fillStyle = '#ee6018';
      g.font = `700 ${fs}px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`:${r.port}`, W - 50, y + rowH / 2 + fs * 0.35);
      g.textAlign = 'left';
      const textW = W - 120 - 50 - g.measureText(`:${r.port}`).width - 30;
      g.fillStyle = '#eeeeee';
      g.font = `600 ${fs}px ${SANS}`;
      g.fillText(clip(g, r.title, textW), 110, y + rowH / 2 - fs * 0.08);
      g.fillStyle = 'rgba(140, 140, 140, .9)';
      g.font = `500 ${Math.round(fs * 0.6)}px ${MONO}`;
      g.fillText(clip(g, r.who, textW), 110, y + rowH / 2 + fs * 0.72);
    });
    if (rows.length > shown.length) {
      g.fillStyle = '#8c8c8c';
      g.font = `500 22px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`+${rows.length - shown.length} more`, W - 24, H - 10);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}

/** The task queue: a wall display with what's waiting, who is on what, and the PRs that came out of it. */
export class QueueBoardTexture {
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

  render(state: QueueState, workers: Map<string, WorkerInfo>) {
    const name = (t: QueueTask) => (t.issue !== undefined ? `#${t.issue}  ${t.title.replace(new RegExp(`^#${t.issue}\\s*`), '')}` : t.title);
    const running = state.tasks.filter((t) => t.status === 'running');
    const queued = state.tasks.filter((t) => t.status === 'queued');
    const done = state.tasks.filter((t) => t.status === 'done').slice(-3).reverse();
    const rows = [
      ...running.map((t) => {
        const w = t.workerId ? workers.get(t.workerId) : undefined;
        const st = { starting: 'starting', idle: 'ready', working: 'working', needs_input: 'needs input ✋', done: 'done', exited: 'stopped', offline: 'asleep' }[w?.status ?? 'working'];
        return { icon: '🤖', text: name(t), side: `${t.workerName ?? 'a worker'} · ${st}`, color: '#1e8f4e' };
      }),
      ...queued.map((t, i) => ({ icon: '⏳', text: name(t), side: i === 0 ? 'up next' : `${i + 1}${['th', 'st', 'nd', 'rd'][i + 1 <= 3 ? i + 1 : 0]} in line`, color: '#2b2d42' })),
      ...done.map((t) => ({
        icon: t.outcome === 'done' ? '✅' : '⚠️',
        text: name(t),
        side: t.pr ? `PR #${t.pr.number}${t.pr.state === 'MERGED' ? ' · merged' : ''}` : t.outcome === 'done' ? 'done' : t.outcome === 'failed' ? "didn't start" : t.outcome === 'killed' ? 'sent home' : 'stopped',
        color: '#8a8f98',
      })),
    ];
    const summary = state.maxWorkers === 0 ? 'paused' : `${running.length} working · ${queued.length} waiting · up to ${state.maxWorkers} at once`;
    const key = JSON.stringify([rows, summary]);
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, H);
    // A faint dot grid, like the other boards.
    g.fillStyle = 'rgba(255, 255, 255, .045)';
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x, y, 2, 2);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = '#ee6018';
    g.font = `700 46px ${MONO}`;
    g.fillText('TASK QUEUE', 40, 76);
    // A straight rule under the heading.
    g.strokeStyle = '#ee6018';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(42, 92);
    g.lineTo(400, 92);
    g.stroke();
    g.textAlign = 'right';
    g.fillStyle = '#8c8c8c';
    g.font = `500 24px ${MONO}`;
    g.fillText(summary, W - 40, 72);
    g.textAlign = 'left';
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#eeeeee';
      g.font = `700 46px ${MONO}`;
      g.fillText('Nothing queued', W / 2, H / 2 - 10);
      g.fillStyle = '#8c8c8c';
      g.font = `500 28px ${SANS}`;
      g.fillText('Add issues from the 📌 Issues board, or press E here', W / 2, H / 2 + 44);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    const shown = rows.slice(0, 7);
    const rowH = Math.min(62, (H - 150) / shown.length);
    const fs = Math.round(rowH * 0.5);
    shown.forEach((r, i) => {
      const y = 128 + i * rowH + fs;
      g.fillStyle = r.color;
      g.font = `600 ${fs}px ${SANS}`;
      g.fillText(r.icon, 44, y);
      g.textAlign = 'right';
      g.font = `500 ${Math.round(fs * 0.72)}px ${MONO}`;
      const sideW = g.measureText(r.side).width;
      g.fillStyle = '#8c8c8c';
      g.fillText(r.side, W - 44, y);
      g.textAlign = 'left';
      g.fillStyle = '#eeeeee';
      g.font = `600 ${fs}px ${SANS}`;
      g.fillText(clip(g, r.text, W - 44 - sideW - 30 - 110), 110, y);
      if (r.color === '#8a8f98') {
        g.strokeStyle = 'rgba(140, 140, 140, .7)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(110, y - fs * 0.32);
        g.lineTo(110 + Math.min(g.measureText(clip(g, r.text, W - 44 - sideW - 30 - 110)).width, W - 44 - sideW - 30 - 110), y - fs * 0.36);
        g.stroke();
      }
    });
    if (rows.length > shown.length) {
      g.fillStyle = '#8c8c8c';
      g.font = `500 22px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`+${rows.length - shown.length} more`, W - 44, H - 34);
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
