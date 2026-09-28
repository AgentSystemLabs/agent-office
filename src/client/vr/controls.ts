/**
 * The VR controls card: the first thing a session shows, because nobody reads the docs from
 * inside a headset. One follow panel with the hand gestures and controller buttons side by
 * side, a GOT IT button to dismiss it, and a `show()` the ☰ menu's ❓ row calls back to.
 */

import type * as THREE from 'three';
import { TERM_FONT } from '../fonts';
import type { HeadPose, Rect } from './math';
import { WorldPanel } from './panel';

const DISMISS: Rect = { x: 0.31, y: 0.87, w: 0.38, h: 0.1 };

interface GestureRow {
  gesture: string;
  does: string;
}

const HANDS: GestureRow[] = [
  { gesture: '👌 Pinch', does: 'use it (E)' },
  { gesture: '👌… hold', does: 'aim teleport, let go to land' },
  { gesture: '🤏🤏 both', does: 'hold together, rays off the panels: ☰ menu' },
  { gesture: '🪜 Ladder', does: 'hold right climbs · left goes down · tap lets go' },
  { gesture: '🚶 walk', does: 'the room is the room: just walk' },
];

const CONTROLLERS: GestureRow[] = [
  { gesture: '🔫 Trigger', does: 'use it (E)' },
  { gesture: '🅰️ Hold A', does: 'aim teleport, let go to land' },
  { gesture: '🫳 Squeeze', does: 'cancel / ☰ menu' },
  { gesture: '🅱️ / stick-click', does: 'N: next waiting worker' },
  { gesture: '🕹️ Sticks', does: 'right turns · left glides or aims*' },
  { gesture: '🪜 Ladder', does: 'E grabs · left stick climbs · E lets go' },
];

export class VrControls {
  readonly panel: WorldPanel;
  /** Fires when the card dismisses (attach.ts shows the menu here on session enter). */
  onHide: (() => void) | null = null;

  constructor(widthM = 0.74, heightM = 0.66) {
    this.panel = new WorldPanel({ width: widthM, height: heightM, paint: (ctx, w, h, _dirty, state) => this.paint(ctx, w, h, state) });
    this.panel.setButtons([{ id: 'gotit', rect: DISMISS, onClick: () => this.hide() }]);
    this.panel.setFollow(true, 1.0, 0.1);
    this.panel.setVisible(false);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  show() {
    this.panel.setVisible(true);
    this.panel.markDirty();
  }

  hide() {
    if (!this.panel.visible) return;
    this.panel.setVisible(false);
    this.onHide?.();
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, state: { hoverId: string | null; pressedId: string | null; time: number }) {
    ctx.fillStyle = 'rgba(12,12,15,0.96)';
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

    ctx.fillStyle = '#eeeeee';
    ctx.font = `700 ${Math.round(h * 0.055)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('🥽 VR controls', w * 0.05, h * 0.075);
    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.032)}px ${TERM_FONT}`;
    ctx.fillText('aim the ray, then:', w * 0.05, h * 0.145);
    ctx.strokeStyle = '#ee6018';
    ctx.lineWidth = Math.max(2, h * 0.005);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.19);
    ctx.lineTo(w, h * 0.19);
    ctx.stroke();

    this.paintColumn(ctx, w, h, '🤲 HANDS', HANDS, 0.05, 0.42);
    this.paintColumn(ctx, w, h, '🎮 CONTROLLERS', CONTROLLERS, 0.53, 0.42);

    ctx.fillStyle = '#8c8c8c';
    ctx.font = `500 ${Math.round(h * 0.026)}px ${TERM_FONT}`;
    ctx.fillText('* left stick glides with ⚙️ glide on · aims a teleport with it off', w * 0.05, h * 0.79);
    ctx.fillText('on a panel: tap clicks · stick or hold-drag scrolls', w * 0.05, h * 0.825);

    const hot = state.hoverId === 'gotit' || state.pressedId === 'gotit';
    ctx.fillStyle = hot ? '#ff7a2e' : '#ee6018';
    ctx.beginPath();
    ctx.roundRect(DISMISS.x * w, DISMISS.y * h, DISMISS.w * w, DISMISS.h * h, DISMISS.h * h * 0.35);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `700 ${Math.round(DISMISS.h * h * 0.42)}px ${TERM_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('GOT IT', (DISMISS.x + DISMISS.w / 2) * w, (DISMISS.y + DISMISS.h / 2) * h);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  private paintColumn(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, rows: GestureRow[], x0: number, colW: number) {
    ctx.fillStyle = '#ee6018';
    ctx.font = `700 ${Math.round(h * 0.034)}px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(title, w * x0, h * 0.245);
    // Long columns tighten up so the last row lands above the footnotes.
    const step = Math.min(0.088, 0.36 / Math.max(1, rows.length - 1));
    rows.forEach((row, i) => {
      const y = h * (0.32 + i * step);
      ctx.fillStyle = '#eeeeee';
      ctx.font = `700 ${Math.round(h * 0.026)}px ${TERM_FONT}`;
      ctx.fillText(row.gesture, w * x0, y, w * colW);
      ctx.fillStyle = '#bdbdbd';
      ctx.font = `500 ${Math.round(h * 0.023)}px ${TERM_FONT}`;
      ctx.fillText(row.does, w * x0, y + h * 0.04, w * colW);
    });
  }

  update(dt: number, head?: HeadPose | null) {
    this.panel.update(dt, head);
  }

  dispose() {
    this.panel.dispose();
  }
}
