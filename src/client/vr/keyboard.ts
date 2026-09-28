/**
 * A world-space QWERTY keyboard for VR: ray-typed keys feeding the focused terminal panel
 * (or any text field via setTarget). Keys are large enough to hit at a meter — the board is
 * ~0.7 m wide with five rows — with press highlights, a one-shot shift (double-tap to lock),
 * and a sticky ctrl latch for terminal shortcuts (tap Ctrl, then C, for Ctrl+C).
 *
 * Output is terminal bytes: letters (shift-cased), digits with US shift symbols, space,
 * backspace as DEL, enter as CR, esc, tab, arrows as CSI, and ctrl+letter as control codes.
 */

import type * as THREE from 'three';
import { TERM_FONT } from '../fonts';
import { keyRects, type KeyDef, type KeyRect, type Rect } from './math';
import { WorldPanel } from './panel';

/** Where keystrokes go: the focused terminal panel, or any VR text field. */
export interface KeyboardTarget {
  sendText: (text: string) => void;
}

/** US shift symbols for the digit and punctuation rows. */
const SHIFTED: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
};

const ARROWS: Record<string, string> = { left: '\x1b[D', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C' };

function row(keys: (string | { id: string; label: string; w?: number })[], fn?: (id: string) => boolean): KeyDef[] {
  return keys.map((k) => {
    const def = typeof k === 'string' ? { id: `k:${k}`, label: k } : { id: k.id, label: k.label, w: k.w };
    return { ...def, kind: (fn?.(def.id) ?? def.id.startsWith('fn:')) ? 'fn' as const : 'char' as const };
  });
}

/** Five rows of large keys: esc/digits, tab/QWERTY, ctrl/ASDF, shift/ZXCV, space/arrows. */
export function keyboardRows(): KeyDef[][] {
  return [
    row([{ id: 'fn:esc', label: 'esc', w: 1.4 }, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', { id: 'fn:back', label: '⌫', w: 1.8 }]),
    row([{ id: 'fn:tab', label: 'tab', w: 1.4 }, 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', { id: 'fn:enter', label: '⏎', w: 1.6 }]),
    row([{ id: 'fn:ctrl', label: 'ctrl', w: 1.6 }, 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", { id: 'fn:enter2', label: '⏎', w: 1.8 }]),
    row([{ id: 'fn:shift', label: '⇧', w: 2.2 }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', { id: 'fn:shift2', label: '⇧', w: 2.2 }]),
    row([
      { id: 'fn:esc2', label: 'esc', w: 1.2 }, { id: 'k: ', label: 'space', w: 7 },
      { id: 'fn:left', label: '←', w: 1 }, { id: 'fn:up', label: '↑', w: 1 }, { id: 'fn:down', label: '↓', w: 1 }, { id: 'fn:right', label: '→', w: 1 },
    ]),
  ];
}

/** Double-tap window (ms) that turns shift from one-shot into caps lock. */
const SHIFT_LOCK_MS = 450;

export class VrKeyboard {
  readonly panel: WorldPanel;
  private keys: KeyRect[] = [];
  private target: KeyboardTarget | null = null;
  private shiftArmed = false;
  private shiftLock = false;
  private shiftTappedAt = 0;
  private ctrlLatched = false;
  private pressedKey: string | null = null;
  private pressedAt = 0;

  constructor(widthM = 0.7, heightM = 0.27) {
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.relayout();
    this.panel.setVisible(false);
  }

  /** Keystrokes go here; null mutes the board. */
  setTarget(t: KeyboardTarget | null) {
    this.target = t;
  }

  get latched(): { shift: boolean; ctrl: boolean } {
    return { shift: this.shiftArmed || this.shiftLock, ctrl: this.ctrlLatched };
  }

  show() {
    this.panel.setVisible(true);
    this.panel.markDirty();
  }

  hide() {
    this.panel.setVisible(false);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  /** The key rects (for the debug preview's synthetic-ray readout). */
  keyRectOf(id: string): Rect | undefined {
    return this.keys.find((k) => k.id === id)?.rect;
  }

  private relayout() {
    this.keys = keyRects(keyboardRows(), { gapX: 0.007, gapY: 0.022, padX: 0.012, padY: 0.03 });
    this.panel.setButtons(this.keys.map((k) => ({ id: k.id, rect: k.rect, onClick: () => this.tap(k.id) })));
  }

  private shiftOn(): boolean {
    return this.shiftArmed || this.shiftLock;
  }

  private tap(id: string) {
    this.pressedKey = id;
    this.pressedAt = performance.now();
    if (id === 'fn:shift' || id === 'fn:shift2') {
      const now = performance.now();
      if (!this.shiftArmed && !this.shiftLock && now - this.shiftTappedAt < SHIFT_LOCK_MS) {
        this.shiftLock = true; // double-tap locks
      } else if (this.shiftLock) {
        this.shiftLock = false;
        this.shiftArmed = false;
      } else {
        this.shiftArmed = !this.shiftArmed;
      }
      this.shiftTappedAt = now;
      this.panel.markDirty();
      return;
    }
    if (id === 'fn:ctrl') {
      this.ctrlLatched = !this.ctrlLatched;
      this.panel.markDirty();
      return;
    }
    const out = this.output(id);
    this.target?.sendText(out);
    if (this.shiftArmed) {
      this.shiftArmed = false; // one-shot
      this.panel.markDirty();
    }
  }

  /** The terminal bytes a key sends, before shift-casing (exported for tests via tap? no — pure helper below). */
  private output(id: string): string {
    const shift = this.shiftOn();
    if (id === 'fn:esc' || id === 'fn:esc2') return '\x1b';
    if (id === 'fn:tab') return '\t';
    if (id === 'fn:enter' || id === 'fn:enter2') return '\r';
    if (id === 'fn:back') return '\x7f';
    const arrow = id.startsWith('fn:') ? ARROWS[id.slice(3)] : undefined;
    if (arrow) return arrow;
    const ch = id.startsWith('k:') ? id.slice(2) : '';
    if (!ch) return '';
    if (this.ctrlLatched && /^[a-zA-Z]$/.test(ch)) {
      return String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 64); // Ctrl+A..Z
    }
    if (this.ctrlLatched && ch === ' ') return '\0';
    if (/^[a-z]$/.test(ch)) return shift ? ch.toUpperCase() : ch;
    if (/^[A-Z]$/.test(ch)) return ch;
    if (shift && SHIFTED[ch]) return SHIFTED[ch];
    return ch;
  }

  private keyLabel(k: KeyRect): string {
    if (k.kind === 'fn') {
      if (k.id === 'fn:shift' || k.id === 'fn:shift2') return this.shiftLock ? '⇪' : k.label;
      return k.label;
    }
    const ch = k.id.startsWith('k:') ? k.id.slice(2) : k.label;
    if (/^[a-z]$/.test(ch)) return this.shiftOn() ? ch.toUpperCase() : ch;
    if (SHIFTED[ch]) return this.shiftOn() ? SHIFTED[ch] : ch;
    return k.label;
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    ctx.fillStyle = 'rgba(14,14,18,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.06));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, h * 0.008);
    ctx.stroke();
    const flash = this.pressedKey && performance.now() - this.pressedAt < 160 ? this.pressedKey : null;
    for (const k of this.keys) {
      const x = k.rect.x * w;
      const y = k.rect.y * h;
      const kw = k.rect.w * w;
      const kh = k.rect.h * h;
      const isFn = k.kind === 'fn';
      const latched = (k.id === 'fn:ctrl' && this.ctrlLatched) || ((k.id === 'fn:shift' || k.id === 'fn:shift2') && this.shiftOn());
      const hot = state.hoverId === k.id || state.pressedId === k.id || flash === k.id;
      ctx.fillStyle = latched ? '#ee6018' : hot ? (isFn ? '#3a3a42' : '#2e2e38') : isFn ? '#232329' : '#1b1b21';
      ctx.beginPath();
      ctx.roundRect(x, y, kw, kh, Math.min(kw, kh) * 0.16);
      ctx.fill();
      ctx.strokeStyle = latched ? '#ffb37a' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = Math.max(1, h * 0.004);
      ctx.stroke();
      ctx.fillStyle = latched ? '#111' : '#eeeeee';
      const label = this.keyLabel(k);
      const fs = Math.min(kh * (label.length > 1 ? 0.34 : 0.52), kw * 0.5);
      ctx.font = `${isFn ? 700 : 500} ${Math.round(fs)}px ${TERM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + kw / 2, y + kh / 2 + 1);
    }
    ctx.textAlign = 'left';
  }

  update(dt: number, camera?: THREE.Camera | null) {
    if (this.pressedKey && performance.now() - this.pressedAt > 160) {
      const id = this.pressedKey;
      this.pressedKey = null;
      const r = this.keyRectOf(id);
      this.panel.markDirty(r);
    }
    this.panel.update(dt, camera);
  }

  dispose() {
    this.panel.dispose();
  }
}
