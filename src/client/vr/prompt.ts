/**
 * A world-space text prompt for VR: the openPrompt/dom-dialog equivalent for the headset.
 * Hiring with a first task, asking a board agent, and chatting all need a line of text; this
 * panel shows the title, the text being typed, and Send/Cancel buttons, fed by the VR keyboard
 * (⏎ sends, esc cancels, ⌫ edits, ←/→ move). Single-line input with wrapped display.
 */

import type * as THREE from 'three';
import { TERM_FONT } from '../fonts';
import type { HeadPose, Rect } from './math';
import { WorldPanel } from './panel';

/** One line of typed text with a cursor: pure, so the host tests drive it directly. */
export class PromptBuffer {
  text = '';
  cursor = 0;

  /** Feeds terminal bytes from the VR keyboard; reports what the key meant. */
  input(data: string): 'submit' | 'cancel' | 'change' | 'noop' {
    if (data === '\r' || data === '\n') return 'submit';
    if (data === '\x1b') return 'cancel';
    if (data === '\x1b[D') {
      if (this.cursor <= 0) return 'noop';
      this.cursor--;
      return 'change';
    }
    if (data === '\x1b[C') {
      if (this.cursor >= [...this.text].length) return 'noop';
      this.cursor++;
      return 'change';
    }
    if (data === '\x7f' || data === '\b') {
      if (this.cursor <= 0) return 'noop';
      const chars = [...this.text];
      chars.splice(this.cursor - 1, 1);
      this.text = chars.join('');
      this.cursor--;
      return 'change';
    }
    // Printable text only (arrows up/down, tab and ctrl codes have no meaning in a prompt box).
    const clean = [...data].filter((c) => c >= ' ' && c !== '\x7f').join('');
    if (!clean) return 'noop';
    const chars = [...this.text];
    chars.splice(this.cursor, 0, ...[...clean].slice(0, Math.max(0, 500 - chars.length)));
    this.text = chars.join('');
    this.cursor = Math.min(chars.length, this.cursor + [...clean].length);
    return 'change';
  }

  clear() {
    this.text = '';
    this.cursor = 0;
  }
}

export interface VrPromptOpts {
  title: string;
  subtitle?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Empty text may be sent (a hire with no first task). */
  allowEmpty?: boolean;
  initial?: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}

const SEND_BTN: Rect = { x: 0.55, y: 0.82, w: 0.4, h: 0.13 };
const CANCEL_BTN: Rect = { x: 0.05, y: 0.82, w: 0.44, h: 0.13 };
const FIELD: Rect = { x: 0.05, y: 0.3, w: 0.9, h: 0.47 };

export class VrPromptPanel {
  readonly panel: WorldPanel;
  readonly buffer = new PromptBuffer();
  private opts: VrPromptOpts | null = null;
  private blinkOn = true;
  private blinkAt = 0;

  constructor(widthM = 0.56, heightM = 0.4) {
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setVisible(false);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  /** Shows the prompt; attach.ts aims it, shows the keyboard, and retargets the keys here. */
  open(opts: VrPromptOpts) {
    this.opts = opts;
    this.buffer.clear();
    if (opts.initial) {
      this.buffer.text = opts.initial;
      this.buffer.cursor = [...opts.initial].length;
    }
    this.panel.setButtons([
      { id: 'send', rect: SEND_BTN, onClick: () => this.send() },
      { id: 'cancel', rect: CANCEL_BTN, onClick: () => this.close(false) },
    ]);
    this.panel.setVisible(true);
    this.panel.markDirty();
  }

  /** Hides the prompt, submitting when asked (empty text submits only when allowed). */
  close(submit: boolean) {
    const opts = this.opts;
    this.opts = null;
    this.panel.setVisible(false);
    if (submit && opts) {
      const text = this.buffer.text.trim();
      if (text || opts.allowEmpty) opts.onSubmit(text);
      else this.panel.setVisible(true); // nothing to send: stay up
    } else {
      opts?.onCancel?.();
    }
  }

  private send() {
    this.close(true);
  }

  /** The VR keyboard's target while the prompt is up. */
  sendText = (data: string) => {
    if (!this.opts) return;
    const out = this.buffer.input(data);
    if (out === 'submit') this.send();
    else if (out === 'cancel') this.close(false);
    else if (out === 'change') this.panel.markDirty(FIELD);
  };

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    const opts = this.opts;
    ctx.fillStyle = 'rgba(12,12,15,0.97)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.04));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, h * 0.005);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.round(h * 0.04));
    ctx.clip();
    if (!opts) {
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.075)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, w * 0.05, h * 0.1, w * 0.9);
    if (opts.subtitle) {
      ctx.fillStyle = '#8c8c8c';
      ctx.font = `500 ${Math.round(h * 0.052)}px ${TERM_FONT}`;
      ctx.fillText(opts.subtitle, w * 0.05, h * 0.21, w * 0.9);
    }
    // The text field, wrapped; the cursor blinks where the next key lands.
    const fx = FIELD.x * w;
    const fy = FIELD.y * h;
    const fw = FIELD.w * w;
    const fh = FIELD.h * h;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, fh * 0.08);
    ctx.fill();
    const fs = Math.round(h * 0.062);
    ctx.font = `400 ${fs}px ${TERM_FONT}`;
    const pad = fw * 0.03;
    const maxW = fw - pad * 2;
    const text = this.buffer.text || opts.placeholder || '';
    const dimmed = !this.buffer.text;
    ctx.fillStyle = dimmed ? '#6a6a6a' : '#eeeeee';
    ctx.textBaseline = 'top';
    const lh = fs * 1.35;
    const lines = this.wrapLines(ctx, text, maxW);
    const shown = lines.slice(-Math.max(1, Math.floor(fh / lh)));
    shown.forEach((line, i) => ctx.fillText(line, fx + pad, fy + fh * 0.08 + i * lh, maxW));
    if (this.blinkOn && !dimmed) {
      // The cursor: wrap the text before it the same way; it sits at the end of that last line.
      const before = this.wrapLines(ctx, [...this.buffer.text].slice(0, this.buffer.cursor).join(''), maxW);
      const rowVis = before.length - 1 - (lines.length - shown.length);
      if (rowVis >= 0 && rowVis < shown.length) {
        const cx = fx + pad + ctx.measureText(before[before.length - 1]).width;
        const cy = fy + fh * 0.08 + rowVis * lh;
        ctx.fillStyle = '#ee6018';
        ctx.fillRect(Math.min(cx, fx + fw - pad - 2), cy, 2, fs);
      }
    }
    this.paintBtn(ctx, w, h, CANCEL_BTN, 'cancel', 'Cancel', state, false);
    this.paintBtn(ctx, w, h, SEND_BTN, 'send', opts.submitLabel ?? 'Send', state, true);
    ctx.restore();
  }

  /** Wraps text to the field width (long words hard-break); the cursor wraps the same way. */
  private wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(/(\s+)/).filter((s) => s.length > 0);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur + word;
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word.trim() ? word : '';
        while (cur && ctx.measureText(cur).width > maxW) {
          let k = cur.length;
          while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--;
          lines.push(cur.slice(0, k));
          cur = cur.slice(k);
        }
      } else cur = next;
    }
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  private paintBtn(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rect, id: string, label: string, state: { hoverId: string | null; pressedId: string | null }, primary: boolean) {
    const hot = state.hoverId === id || state.pressedId === id;
    ctx.fillStyle = primary ? (hot ? '#ff7a2e' : '#ee6018') : hot ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(r.x * w, r.y * h, r.w * w, r.h * h, r.h * h * 0.3);
    ctx.fill();
    ctx.fillStyle = primary ? '#111' : '#eeeeee';
    ctx.font = `700 ${Math.round(r.h * h * 0.34)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, (r.x + r.w / 2) * w, (r.y + r.h / 2) * h);
    ctx.textAlign = 'left';
  }

  update(dt: number, head?: HeadPose | null) {
    if (this.panel.visible) {
      const now = performance.now();
      if (now - this.blinkAt > 530) {
        this.blinkAt = now;
        this.blinkOn = !this.blinkOn;
        this.panel.markDirty(FIELD);
      }
    }
    this.panel.update(dt, head);
  }

  dispose() {
    this.panel.dispose();
  }
}
