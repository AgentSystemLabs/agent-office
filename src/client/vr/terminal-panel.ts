/**
 * A world-space worker terminal: the same PTY the DOM terminal shows, painted onto a panel.
 *
 * Data handling mirrors the DOM terminal (see ui/terminal.ts): opening attaches to the worker
 * (`worker.attach`), closing detaches, and keys go out as `term.input`. Where the DOM window
 * feeds the raw term.data stream into xterm, this panel paints the server's parsed screen frames
 * (the store's `screens`, the same grid the 3D laptops show) with the laptop palette, so ANSI
 * colors match everywhere. Frames that scrolled accumulate into a local scrollback buffer;
 * dragging the terminal looks back through it, and new output auto-scrolls only while pinned
 * to the bottom.
 */

import type * as THREE from 'three';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, type Run, type WorkerInfo } from '../../shared/protocol';
import { TERM_FONT } from '../fonts';
import { TERM_THEME, type ScreenState } from '../world/laptop';
import { fullPalette, pushHistory, runColor, scrolledOffLines } from './ansi';
import { clampScroll, gridMetrics, type HeadPose, type Rect } from './math';
import { WorldPanel } from './panel';

export type VrTerminalMsg =
  | { t: 'worker.attach'; workerId: string }
  | { t: 'worker.detach'; workerId: string }
  | { t: 'worker.prompt'; workerId: string; prompt: string }
  | { t: 'term.input'; workerId: string; data: string }
  | { t: 'term.typing'; workerId: string }
  | { t: 'term.resize'; workerId: string; cols: number; rows: number };

export interface VrTerminalDeps {
  send: (msg: VrTerminalMsg) => void;
  subscribe: (topic: 'screens' | 'workers', fn: () => void) => () => void;
  getScreen: (workerId: string) => ScreenState | undefined;
  getWorker: (workerId: string) => WorkerInfo | undefined;
}

/** Grid size the VR terminal claims while typing (latest typist wins, like the DOM terminal). */
export const VR_TERM_COLS = 96;
export const VR_TERM_ROWS = 28;
/** Rows kept above the live grid for scrollback. */
const HISTORY_CAP = 500;
/** Rows shown at once: big enough to read at a meter, small enough to leave scrollback. */
const VISIBLE_ROWS = 26;

const HEADER_H = 0.11;
const BODY: Rect = { x: 0.015, y: HEADER_H + 0.015, w: 0.97, h: 1 - HEADER_H - 0.03 };
const CLOSE_BTN: Rect = { x: 0.93, y: 0.012, w: 0.058, h: 0.086 };
const ASK_BTN: Rect = { x: 0.845, y: 0.012, w: 0.075, h: 0.086 };
const JUMP_BTN: Rect = { x: 0.78, y: 0.895, w: 0.2, h: 0.085 };

export class VrTerminalPanel {
  readonly panel: WorldPanel;
  /** Fires when the panel closes itself (its ✕ button); attach.ts hides the keyboard here. */
  onClose: (() => void) | null = null;
  /** Fires from the ✉ button; attach.ts opens the ask prompt for the focused worker. */
  onAsk: ((workerId: string) => void) | null = null;
  private deps: VrTerminalDeps;
  private workerId: string | null = null;
  private unsubs: (() => void)[] = [];
  private palette = fullPalette(TERM_THEME);
  private history: Run[][] = [];
  private prevGrid: Run[][] = [];
  private prevVersion = -1;
  private prevCols = 0;
  private headerKey = '';
  private cursorRect: Rect | null = null;
  private blinkOn = true;
  private blinkAt = 0;
  private typingAt = 0;
  private lastSentSize = '';
  /** Pinned to the live bottom: new output auto-scrolls until the user drags back. */
  private stickToBottom = true;

  constructor(deps: VrTerminalDeps, widthM = 0.92, heightM = 0.6) {
    this.deps = deps;
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setScrollRegion('term', BODY);
    this.panel.onScroll = () => {
      this.stickToBottom = false;
      this.syncButtons();
    };
    this.panel.setVisible(false);
    this.unsubs = [deps.subscribe('screens', () => this.refresh()), deps.subscribe('workers', () => this.refresh())];
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  /** The worker whose terminal is up, if any. */
  focused(): string | null {
    return this.workerId;
  }

  /** Opens the terminal for a worker, attaching to its PTY (switches focus when another is up). */
  open(workerId: string) {
    if (this.workerId === workerId) {
      this.panel.setVisible(true);
      this.panel.markDirty();
      return;
    }
    this.detach();
    this.workerId = workerId;
    this.history = [];
    this.prevGrid = [];
    this.prevVersion = -1;
    this.prevCols = 0;
    this.headerKey = '';
    this.lastSentSize = '';
    this.deps.send({ t: 'worker.attach', workerId });
    this.stickToBottom = true;
    this.panel.setScrollOffset('term', Number.MAX_SAFE_INTEGER);
    this.panel.setVisible(true);
    this.refresh();
    this.panel.markDirty();
  }

  /** Closes the terminal, detaching from its PTY. */
  close() {
    if (!this.workerId && !this.panel.visible) return;
    this.detach();
    this.workerId = null;
    this.panel.setVisible(false);
    this.onClose?.();
  }

  /** Feeds keystrokes to the focused terminal (the VR keyboard's target). */
  type(data: string) {
    if (!this.workerId) return;
    const w = this.deps.getWorker(this.workerId);
    if (w && (w.cols !== VR_TERM_COLS || w.rows !== VR_TERM_ROWS)) {
      // Typing claims the shared PTY's size, exactly like the DOM terminal's sendSize(true).
      const key = `${VR_TERM_COLS}x${VR_TERM_ROWS}`;
      if (key !== this.lastSentSize) {
        this.lastSentSize = key;
        this.deps.send({ t: 'term.resize', workerId: this.workerId, cols: VR_TERM_COLS, rows: VR_TERM_ROWS });
      }
    }
    const now = performance.now();
    if (now - this.typingAt > 1000) {
      this.typingAt = now;
      this.deps.send({ t: 'term.typing', workerId: this.workerId });
    }
    this.deps.send({ t: 'term.input', workerId: this.workerId, data });
    // Typing drops back to the live bottom, where the echo lands.
    const s = this.deps.getScreen(this.workerId);
    if (s) {
      this.panel.setScrollOffset('term', Number.MAX_SAFE_INTEGER);
      this.stickToBottom = true; // after: setScrollOffset's onScroll unsticks first
    }
  }

  /** Folds new screen frames into scrollback; repaints when something visible changed. */
  refresh() {
    if (!this.workerId || !this.panel.visible) return;
    const w = this.deps.getWorker(this.workerId);
    if (!w) {
      this.close();
      return;
    }
    const headerKey = `${w.name}|${w.status}|${w.color}`;
    const s = this.deps.getScreen(this.workerId);
    if (s && s.version !== this.prevVersion) {
      this.prevVersion = s.version;
      if (s.cols !== this.prevCols) {
        // A reflowed grid doesn't line up with the old one: history would paint ragged.
        if (this.prevCols !== 0) this.history = [];
        this.prevCols = s.cols;
        this.prevGrid = [];
      }
      if (this.prevGrid.length) pushHistory(this.history, scrolledOffLines(this.prevGrid, s.lines), HISTORY_CAP);
      this.prevGrid = (s.lines as Run[][]).map((runs) => (runs ? runs.map((r): Run => [r[0], r[1], r[2], r[3]]) : []));
    }
    if (headerKey !== this.headerKey) this.headerKey = headerKey;
    this.panel.markDirty();
    this.syncButtons();
  }

  private detach() {
    if (this.workerId) this.deps.send({ t: 'worker.detach', workerId: this.workerId });
  }

  /** The live grid plus scrollback as one row list (oldest first). */
  private rows(s: ScreenState | undefined): Run[][] {
    if (!s) return [];
    return [...this.history, ...s.lines.map((runs) => runs ?? [])];
  }

  /** Whether the view sits at the live bottom (auto-scrolls) or looks back (Jump ↓ shows). */
  private pinned(total: number, visible: number): boolean {
    const max = Math.max(0, total - visible);
    return this.panel.scrollOffset('term') >= max - 0.5;
  }

  private syncButtons() {
    if (!this.workerId) {
      this.panel.setButtons([]);
      return;
    }
    const s = this.deps.getScreen(this.workerId);
    const total = this.rows(s).length;
    const visible = Math.min(total || VISIBLE_ROWS, VISIBLE_ROWS);
    const buttons = [
      { id: 'close', rect: CLOSE_BTN, onClick: () => this.close() },
      { id: 'ask', rect: ASK_BTN, onClick: () => { if (this.workerId) this.onAsk?.(this.workerId); } },
    ];
    if (s && total > visible && !this.pinned(total, visible)) {
      buttons.push({ id: 'jump', rect: JUMP_BTN, onClick: () => { this.panel.setScrollOffset('term', Number.MAX_SAFE_INTEGER); this.stickToBottom = true; } });
    }
    this.panel.setButtons(buttons);
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    const id = this.workerId;
    const worker = id ? this.deps.getWorker(id) : undefined;
    // Window chrome: near-black, rounded, orange rule — the HUD panels' family.
    ctx.fillStyle = 'rgba(10,10,12,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.025));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.025));
    ctx.clip();

    const hx = w * 0.03;
    const hy = h * HEADER_H * 0.5;
    if (worker) {
      ctx.fillStyle = worker.color;
      ctx.beginPath();
      ctx.arc(hx + h * 0.02, hy, h * 0.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(h * 0.05)}px ${TERM_FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const label = `${worker.name} · ${worker.status}`;
      ctx.fillText(label, hx + h * 0.055, hy + 1, w * 0.8);
    }
    // Ask button.
    const a = { x: ASK_BTN.x * w, y: ASK_BTN.y * h, w: ASK_BTN.w * w, h: ASK_BTN.h * h };
    const askHot = state.hoverId === 'ask' || state.pressedId === 'ask';
    ctx.fillStyle = askHot ? '#ee6018' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(a.x, a.y, a.w, a.h, a.h * 0.3);
    ctx.fill();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(a.h * 0.55)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('✉', a.x + a.w / 2, hy + 1);
    // Close button.
    const c = { x: CLOSE_BTN.x * w, y: CLOSE_BTN.y * h, w: CLOSE_BTN.w * w, h: CLOSE_BTN.h * h };
    const closeHot = state.hoverId === 'close' || state.pressedId === 'close';
    ctx.fillStyle = closeHot ? '#ee6018' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, c.h * 0.3);
    ctx.fill();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(c.h * 0.55)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('✕', c.x + c.w / 2, hy + 1);
    ctx.strokeStyle = '#ee6018';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(0, h * HEADER_H);
    ctx.lineTo(w, h * HEADER_H);
    ctx.stroke();

    const s = id ? this.deps.getScreen(id) : undefined;
    if (!s) {
      ctx.fillStyle = '#8c8c8c';
      ctx.font = `500 ${Math.round(h * 0.045)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(worker ? 'connecting…' : 'no worker', w / 2, h * 0.55);
      ctx.restore();
      return;
    }
    const rows = this.rows(s);
    const visible = Math.min(Math.max(rows.length, 1), VISIBLE_ROWS);
    const total = Math.max(rows.length, 1);
    this.panel.setScrollContent('term', total, visible);
    if (this.stickToBottom) {
      // Pin to the live bottom (suppressing onScroll's unstick for this programmatic move).
      const max = Math.max(0, total - visible);
      if (this.panel.scrollOffset('term') !== max) {
        this.stickToBottom = false;
        this.panel.setScrollOffset('term', max);
        this.stickToBottom = true;
        this.syncButtons();
      }
    }
    const top = Math.round(clampScroll(this.panel.scrollOffset('term'), total, visible));

    const bx = BODY.x * w;
    const by = BODY.y * h;
    const bw = BODY.w * w;
    const bh = BODY.h * h;
    const cols = Math.max(1, s.cols);
    const m = gridMetrics(bw, bh, cols, visible);
    const charW = m.cellW;
    const lineH = m.cellH;
    const left = bx + m.left;
    const topPx = by + m.top;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let v = 0; v < visible; v++) {
      const runs = rows[top + v];
      if (!runs) continue;
      let x = 0;
      const py = topPx + v * lineH;
      for (const [text, fgc, bgc, flags] of runs) {
        const len = [...text].length;
        if (x >= cols) break;
        const show = Math.min(len, cols - x);
        let fg = runColor(fgc, TERM_THEME.foreground, this.palette);
        let bg = bgc < 0 ? null : runColor(bgc, TERM_THEME.background, this.palette);
        if (flags & FLAG_INVERSE) {
          const tmp = fg;
          fg = bg ?? TERM_THEME.background;
          bg = tmp;
        }
        const px = left + x * charW;
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(px, py, show * charW + 0.5, lineH + 0.5);
        }
        if (text.trim()) {
          ctx.font = `${flags & FLAG_BOLD ? 700 : 400} ${m.fontPx}px ${TERM_FONT}`;
          ctx.globalAlpha = flags & FLAG_DIM ? 0.55 : 1;
          ctx.fillStyle = fg;
          ctx.fillText(show < len ? [...text].slice(0, show).join('') : text, px, py + (lineH - m.fontPx) / 2);
          ctx.globalAlpha = 1;
        }
        x += len;
      }
    }
    // The cursor, blinking at the live grid's position when it's on screen.
    this.cursorRect = null;
    const [cx, cy] = s.cursor;
    const liveTop = total - s.rows; // live grid's first row in the combined list
    const cursorRow = liveTop + cy - top;
    if (this.blinkOn && cx >= 0 && cx < cols && cursorRow >= 0 && cursorRow < visible) {
      const px = left + cx * charW;
      const py = topPx + cursorRow * lineH;
      ctx.fillStyle = TERM_THEME.cursor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(px, py, charW, lineH);
      ctx.globalAlpha = 1;
      this.cursorRect = { x: px / w, y: py / h, w: charW / w, h: lineH / h };
    }
    // Scrollbar on the right edge.
    if (total > visible) {
      const trackH = bh * 0.9;
      const trackY = by + bh * 0.05;
      const trackX = w * 0.985;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(trackX, trackY, Math.max(3, w * 0.004), trackH);
      const thumbH = Math.max(trackH * 0.06, (trackH * visible) / total);
      const thumbY = trackY + ((trackH - thumbH) * top) / (total - visible);
      ctx.fillStyle = '#ee6018';
      ctx.fillRect(trackX, thumbY, Math.max(3, w * 0.004), thumbH);
    }
    // "Back to live" pill while looking at scrollback.
    if (total > visible && !this.pinned(total, visible)) {
      const j = { x: JUMP_BTN.x * w, y: JUMP_BTN.y * h, w: JUMP_BTN.w * w, h: JUMP_BTN.h * h };
      const hot = state.hoverId === 'jump' || state.pressedId === 'jump';
      ctx.fillStyle = hot ? '#ee6018' : 'rgba(238,96,24,0.85)';
      ctx.beginPath();
      ctx.roundRect(j.x, j.y, j.w, j.h, j.h * 0.4);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `700 ${Math.round(j.h * 0.42)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('↓ live', j.x + j.w / 2, j.y + j.h * 0.3);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  update(dt: number, head?: HeadPose | null) {
    if (this.panel.visible) {
      const now = performance.now();
      if (now - this.blinkAt > 530) {
        this.blinkAt = now;
        this.blinkOn = !this.blinkOn;
        this.panel.markDirty(this.cursorRect ?? BODY);
      }
    }
    this.panel.update(dt, head);
  }

  dispose() {
    this.detach();
    this.unsubs.forEach((u) => u());
    this.panel.dispose();
  }
}
