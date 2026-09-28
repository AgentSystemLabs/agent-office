/**
 * The VR aim bar: the desktop hint bar's twin for the headset. A small strip low in the view
 * naming what E (pinch, trigger) would do to whatever the ray aims at — desks, boards, the
 * dog — and going quiet where E would do nothing (out of reach, a panel under the ray, a
 * teleport being aimed). The session feeds it the same target the flat mirror's hint shows.
 */

import { TERM_FONT } from '../fonts';
import type { HeadPose } from './math';
import { WorldPanel } from './panel';

export class VrAim {
  readonly panel: WorldPanel;
  private text: string | null = null;

  constructor(widthM = 0.52, heightM = 0.075) {
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setFollow(true, 1.15, 0.42);
    this.panel.setVisible(false);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  /** What E would do now (null hides the strip). Repaints only when the words change. */
  set(text: string | null) {
    if (text === this.text) return;
    this.text = text;
    this.panel.setVisible(!!text);
    if (text) this.panel.markDirty();
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, _state: { hoverId: string | null; pressedId: string | null; time: number }) {
    const text = this.text;
    if (!text) return;
    ctx.fillStyle = 'rgba(12,12,15,0.85)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(238,96,24,0.6)';
    ctx.lineWidth = Math.max(1.5, h * 0.03);
    ctx.stroke();
    ctx.fillStyle = '#eeeeee';
    ctx.font = `600 ${Math.round(h * 0.42)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(this.clip(ctx, text, w * 0.92), w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  private clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  update(dt: number, head?: HeadPose | null) {
    this.panel.update(dt, head);
  }

  dispose() {
    this.panel.dispose();
  }
}
