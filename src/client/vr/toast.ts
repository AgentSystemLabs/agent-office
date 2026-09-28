/**
 * The VR toast strip: DOM toasts are invisible in the headset, so the office's short messages
 * (hires, pours, errors, chat) land here instead — a small dash under the view that shows the
 * latest for a few seconds. A sticky line (the issue card in hand) stays up until cleared.
 */

import type * as THREE from 'three';
import { TERM_FONT } from '../fonts';
import type { HeadPose } from './math';
import { WorldPanel } from './panel';

/** How long a toast stays up (the sticky line ignores this). */
const TOAST_MS = 4000;

export class VrToast {
  readonly panel: WorldPanel;
  private text = '';
  private level: 'info' | 'warn' | 'error' = 'info';
  private until = 0;
  private sticky: string | null = null;

  constructor(widthM = 0.62, heightM = 0.1) {
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    // Under the view, out of the work: the menu rides higher, terminals sit still.
    this.panel.setFollow(true, 1.05, 0.52);
    this.panel.setVisible(false);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  /** The fresh toast's words, while one is up (the emulator hook reads this back). */
  get current(): string | null {
    return performance.now() <= this.until ? this.text : null;
  }

  /** Shows a message the way the DOM toast would (level colors the edge). */
  show(text: string, level: 'info' | 'warn' | 'error' = 'info') {
    this.text = text;
    this.level = level;
    this.until = performance.now() + TOAST_MS;
    this.panel.setVisible(true);
    this.panel.markDirty();
  }

  /** A line that stays up until cleared: the card in hand, and what to do with it. */
  setSticky(text: string | null) {
    this.sticky = text;
    this.panel.markDirty();
    if (text) {
      this.panel.setVisible(true);
    } else if (performance.now() > this.until) {
      this.panel.setVisible(false);
    }
  }

  hide() {
    this.until = 0;
    if (!this.sticky) this.panel.setVisible(false);
    this.panel.markDirty();
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, _state: { hoverId: string | null; pressedId: string | null; time: number }) {
    // A fresh toast talks over the sticky line (an error while carrying still shows); once it
    // expires, the sticky line is back underneath.
    const fresh = performance.now() <= this.until;
    const line = fresh ? this.text : (this.sticky ?? this.text);
    const edge = !fresh && this.sticky ? '#ee6018' : this.level === 'error' ? '#ef476f' : this.level === 'warn' ? '#f2b134' : '#06d6a0';
    ctx.fillStyle = 'rgba(12,12,15,0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.3);
    ctx.fill();
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.roundRect(0, 0, w * 0.02, h, h * 0.3);
    ctx.fill();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `500 ${Math.round(h * 0.34)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(line, w * 0.045, h * 0.52, w * 0.93);
  }

  update(dt: number, head?: HeadPose | null) {
    if (!this.panel.visible) return;
    if (!this.sticky && performance.now() > this.until) {
      this.panel.setVisible(false);
      return;
    }
    this.panel.update(dt, head);
  }

  dispose() {
    this.panel.dispose();
  }
}
