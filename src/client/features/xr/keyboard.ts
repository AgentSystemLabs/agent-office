/**
 * A full virtual keyboard floating in VR: QWERTY, shift / caps, a symbols page, and the keys a
 * prompt box needs (Enter, Tab, Esc, arrows, Backspace, Space). Points at a focused text field, or
 * at the open terminal panel when nothing else is focused.
 */
import * as THREE from 'three';
import type { Hand } from './rays';
import { planeHit, type SurfaceHit, type XrSurface } from './surface';

const W = 1400;
const H = 520;
const PAD = 12;
const GAP = 8;
const KEY_H = 72;
/** How wide the keyboard is, in meters. */
export const KEYBOARD_WIDTH = 0.9;

type KeyDef =
  | { label: string; code: string; text?: string; wide?: number; shift?: string }
  | { label: string; action: 'backspace' | 'enter' | 'tab' | 'esc' | 'shift' | 'caps' | 'symbols' | 'abc' | 'space' | 'mic' | 'hide' | 'left' | 'right' | 'up' | 'down'; wide?: number };

const ROW1: KeyDef[] = [
  { label: '`', code: 'Backquote', text: '`', shift: '~' },
  ...('1234567890'.split('').map((c, i) => ({ label: c, code: `Digit${c}`, text: c, shift: '!@#$%^&*()'[i]! })) as KeyDef[]),
  { label: '⌫', action: 'backspace', wide: 1.4 },
];
const ROW2: KeyDef[] = [
  { label: '⇥', action: 'tab', wide: 1.2 },
  ...'qwertyuiop'.split('').map((c) => ({ label: c, code: `Key${c.toUpperCase()}`, text: c })),
  { label: 'Esc', action: 'esc', wide: 1.2 },
];
const ROW3: KeyDef[] = [
  { label: '⇪', action: 'caps', wide: 1.4 },
  ...'asdfghjkl'.split('').map((c) => ({ label: c, code: `Key${c.toUpperCase()}`, text: c })),
  { label: '⏎', action: 'enter', wide: 1.6 },
];
const ROW4: KeyDef[] = [
  { label: '⇧', action: 'shift', wide: 1.8 },
  ...'zxcvbnm'.split('').map((c) => ({ label: c, code: `Key${c.toUpperCase()}`, text: c })),
  { label: ',', code: 'Comma', text: ',', shift: '<' },
  { label: '.', code: 'Period', text: '.', shift: '>' },
  { label: '/', code: 'Slash', text: '/', shift: '?' },
  { label: '⇧', action: 'shift', wide: 1.4 },
];
const ROW5: KeyDef[] = [
  { label: '?123', action: 'symbols', wide: 1.4 },
  { label: '🎤', action: 'mic', wide: 1.2 },
  { label: '␣', action: 'space', wide: 6 },
  { label: '←', action: 'left' },
  { label: '↑', action: 'up' },
  { label: '↓', action: 'down' },
  { label: '→', action: 'right' },
  { label: '⬇', action: 'hide', wide: 1.2 },
];

const SYMBOLS: KeyDef[][] = [
  [
    ...'1234567890'.split('').map((c) => ({ label: c, code: `Digit${c}`, text: c })),
    { label: '⌫', action: 'backspace', wide: 1.4 },
  ],
  [
    ...'-[];\'\\'.split('').map((c, i) => {
      const codes = ['Minus', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Backslash'];
      const shifts = ['_', '{', '}', ':', '"', '|'];
      return { label: c, code: codes[i]!, text: c, shift: shifts[i]! };
    }),
    { label: 'abc', action: 'abc', wide: 1.4 },
  ],
  [
    ...'=,+<>?'.split('').map((c, i) => {
      const texts = ['=', ',', '+', '<', '>', '?'];
      return { label: texts[i]!, code: 'KeyA', text: texts[i]! };
    }),
    { label: '⏎', action: 'enter', wide: 1.6 },
  ],
  [
    { label: '!@#$%^&*()'.slice(0, 1), code: 'Digit1', text: '!' },
    ...'@#$%^&*()'.split('').map((c) => ({ label: c, code: 'Digit1', text: c })),
    { label: '⬇', action: 'hide', wide: 1.2 },
  ],
];

interface DrawnKey {
  def: KeyDef;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type KeyboardTarget =
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'term'; send: (data: string) => void }
  | null;

export class XrKeyboard implements XrSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Hold A / the mic key: the XR feature starts dictation. */
  onMic: (() => void) | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private keys: DrawnKey[] = [];
  private hoverBtn = { left: -1, right: -1 };
  private shift = false;
  private caps = false;
  private symbols = false;
  private shown = false;
  private target: KeyboardTarget = null;
  private flashed = -1;
  private flashUntil = 0;
  private drawn = '';
  private caption = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true, depthTest: false });
    mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(KEYBOARD_WIDTH, (KEYBOARD_WIDTH * H) / W), mat);
    this.mesh.name = 'xr-keyboard';
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    this.layout();
  }

  active() {
    return this.shown;
  }

  /** Show the keyboard aimed at `target` (a field, or the terminal). */
  show(target: KeyboardTarget) {
    this.target = target;
    this.shown = true;
    this.mesh.visible = true;
    this.drawn = '';
  }

  hide() {
    this.shown = false;
    this.target = null;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.caption = '';
    this.drawn = '';
  }

  close() {
    this.hide();
  }

  get open() {
    return this.shown;
  }

  /** Words being dictated, drawn above the keys. */
  setCaption(text: string) {
    if (this.caption === text) return;
    this.caption = text;
    this.drawn = '';
  }

  /** Where typed text / dictation goes right now. */
  currentTarget(): KeyboardTarget {
    return this.target;
  }

  hit(raycaster: THREE.Raycaster) {
    return planeHit(this.mesh, raycaster);
  }

  hover(hand: Hand, hit: SurfaceHit | null) {
    this.hoverBtn[hand] = hit ? keyAt(this.keys, hit.u * W, hit.v * H) : -1;
  }

  press(_hand: Hand, hit: SurfaceHit, down: boolean): boolean {
    if (!down) return true;
    const i = keyAt(this.keys, hit.u * W, hit.v * H);
    const k = this.keys[i];
    if (!k) return true;
    this.flashed = i;
    this.flashUntil = performance.now() + 120;
    this.drawn = '';
    this.handle(k.def);
    return true;
  }

  paint(now: number) {
    if (!this.shown) return;
    const flash = now < this.flashUntil ? this.flashed : -1;
    const key = `${this.symbols}|${this.shift}|${this.caps}|${this.hoverBtn.left}|${this.hoverBtn.right}|${flash}|${this.caption}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.g;
    g.fillStyle = '#1b1d2b';
    g.beginPath();
    g.roundRect(0, 0, W, H, 28);
    g.fill();
    if (this.caption) {
      g.fillStyle = '#ffd166';
      g.font = '600 28px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(`🎙️ ${this.caption}`, PAD, 22);
    }
    this.keys.forEach((k, i) => {
      const lit = i === flash;
      const pointed = i === this.hoverBtn.left || i === this.hoverBtn.right;
      const sticky = ('action' in k.def && k.def.action === 'shift' && this.shift) || ('action' in k.def && k.def.action === 'caps' && this.caps);
      g.fillStyle = lit || sticky ? '#ffd166' : pointed ? '#4a5078' : '#2d3047';
      g.beginPath();
      g.roundRect(k.x, k.y, k.w, k.h, 14);
      g.fill();
      g.fillStyle = lit || sticky ? '#2b2d42' : '#f2f2f7';
      g.font = '700 28px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this.labelOf(k.def), k.x + k.w / 2, k.y + k.h / 2 + 1);
      g.textAlign = 'left';
    });
    this.texture.needsUpdate = true;
  }

  /** Insert spoken / typed text into the current target. */
  insertText(text: string) {
    if (!text || !this.target) return;
    if (this.target.kind === 'term') {
      this.target.send(text);
      return;
    }
    const el = this.target.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    if (typeof el.setRangeText === 'function') {
      el.setRangeText(text, start, end, 'end');
    } else {
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.setSelectionRange(start + text.length, start + text.length);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  private layout() {
    const rows = this.symbols ? SYMBOLS : [ROW1, ROW2, ROW3, ROW4, ROW5];
    const top = this.caption || true ? 40 : PAD;
    const rowH = KEY_H;
    const keys: DrawnKey[] = [];
    rows.forEach((row, ri) => {
      const units = row.reduce((n, k) => n + (k.wide ?? 1), 0);
      const unitW = (W - PAD * 2 - GAP * (row.length - 1)) / units;
      let x = PAD;
      const y = top + ri * (rowH + GAP);
      for (const def of row) {
        const w = unitW * (def.wide ?? 1);
        keys.push({ def, x, y, w, h: rowH });
        x += w + GAP;
      }
    });
    this.keys = keys;
  }

  private labelOf(def: KeyDef): string {
    if ('action' in def) return def.label;
    const upper = this.shift || this.caps;
    if (upper && def.shift) return def.shift;
    if (def.text && def.text.length === 1 && /[a-z]/.test(def.text)) return upper ? def.text.toUpperCase() : def.text;
    return def.label;
  }

  private handle(def: KeyDef) {
    if ('action' in def) {
      switch (def.action) {
        case 'shift':
          this.shift = !this.shift;
          this.layout();
          return;
        case 'caps':
          this.caps = !this.caps;
          return;
        case 'symbols':
          this.symbols = true;
          this.shift = false;
          this.layout();
          this.drawn = '';
          return;
        case 'abc':
          this.symbols = false;
          this.layout();
          this.drawn = '';
          return;
        case 'hide':
          this.hide();
          return;
        case 'mic':
          this.onMic?.();
          return;
        case 'space':
          this.typeChar(' ', 'Space', ' ');
          return;
        case 'enter':
          this.special('Enter', '\n', '\r');
          return;
        case 'tab':
          this.special('Tab', '\t', '\t');
          return;
        case 'esc':
          this.special('Escape', 'Escape');
          return;
        case 'backspace':
          this.backspace();
          return;
        case 'left':
          this.special('ArrowLeft', 'ArrowLeft');
          return;
        case 'right':
          this.special('ArrowRight', 'ArrowRight');
          return;
        case 'up':
          this.special('ArrowUp', 'ArrowUp');
          return;
        case 'down':
          this.special('ArrowDown', 'ArrowDown');
          return;
      }
    }
    const upper = this.shift || this.caps;
    let ch = def.text ?? def.label;
    if (upper && def.shift) ch = def.shift;
    else if (ch.length === 1 && /[a-z]/.test(ch) && upper) ch = ch.toUpperCase();
    this.typeChar(ch, def.code, ch);
    if (this.shift && !this.caps) {
      this.shift = false;
      this.drawn = '';
    }
  }

  private typeChar(ch: string, code: string, key: string) {
    if (this.target?.kind === 'term') {
      this.target.send(ch === '\n' ? '\r' : ch);
      return;
    }
    if (this.target?.kind === 'field') {
      this.insertText(ch);
      fireKeyOn(this.target.el, code, key);
      return;
    }
    fireKeyOn(document.activeElement as HTMLElement | null, code, key);
  }

  private special(code: string, key: string, termData?: string) {
    if (this.target?.kind === 'term' && termData !== undefined) {
      this.target.send(termData);
      return;
    }
    const el = this.target?.kind === 'field' ? this.target.el : (document.activeElement as HTMLElement | null);
    if (code === 'Enter' && this.target?.kind === 'field' && this.target.el instanceof HTMLTextAreaElement && !termData) {
      this.insertText('\n');
    }
    fireKeyOn(el, code, key);
  }

  private backspace() {
    if (this.target?.kind === 'term') {
      this.target.send('\x7f');
      return;
    }
    const el = this.target?.kind === 'field' ? this.target.el : null;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      if (start !== end) {
        el.setRangeText('', start, end, 'end');
      } else if (start > 0) {
        el.setRangeText('', start - 1, start, 'end');
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    fireKeyOn(el, 'Backspace', 'Backspace');
  }
}

/** Which key occupies canvas pixel (px, py), or -1. Exported for tests. */
export function keyAt(keys: readonly { x: number; y: number; w: number; h: number }[], px: number, py: number): number {
  return keys.findIndex((k) => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h);
}

/** A default QWERTY row used by tests (same geometry as the live keyboard's letter row). */
export function testLetterRow(): { label: string; x: number; y: number; w: number; h: number }[] {
  const letters = 'qwertyuiop';
  const unit = 100;
  return [...letters].map((label, i) => ({ label, x: 20 + i * (unit + 8), y: 40, w: unit, h: 72 }));
}

function fireKeyOn(el: HTMLElement | null, code: string, key: string) {
  const target = el ?? window;
  const opts: KeyboardEventInit = { code, key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
}

/** Whether `el` is something the virtual keyboard can type into. */
export function isTypable(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (typeof HTMLInputElement === 'undefined' || typeof HTMLTextAreaElement === 'undefined') return false;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (t === 'button' || t === 'submit' || t === 'checkbox' || t === 'radio' || t === 'file' || t === 'color' || t === 'range') return false;
  }
  return true;
}
