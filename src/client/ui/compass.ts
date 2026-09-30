import './compass.css';
import * as THREE from 'three';
import type { WorkerStatus } from '../../shared/protocol';
import { h } from './dom';

/** A worker waiting on you: who, what for, and where its head is. */
export interface Bearing {
  id: string;
  name: string;
  status: WorkerStatus;
  at: THREE.Vector3;
}

/** From a mark's middle to the edge of the screen, or of the HUD it sits beside, with room for its tip (px). */
const MARGIN = 46;
/** How far apart marks on one edge keep: a dial and its name down a side, a name's width along the top or bottom (px). */
const SPACING = { side: 56, across: 110 };

type Edge = 'left' | 'right' | 'top' | 'bottom';

interface Mark {
  el: HTMLElement;
  arrow: HTMLElement;
  dial: HTMLElement;
  who: HTMLElement;
  status: string;
}

/**
 * An arrow at the edge of the screen for each worker waiting on you that's out of view, pointing the
 * way to turn to see it: red for needs input, green for done. They keep inside the HUD's panels.
 */
export class Compass {
  private readonly marks = new Map<string, Mark>();
  /** Where the marks can go: clear of the top bar, the side panels, and the hint and chat along the bottom. */
  private box = { top: 0, right: 0, bottom: 0, left: 0 };
  private measured = -Infinity;
  private readonly cam = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {}

  /** Call after rendering, so the camera's matrices are this frame's. */
  update(camera: THREE.Camera, bearings: readonly Bearing[], now: number) {
    if (now - this.measured > 1000) this.measure(now);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const { top, right, bottom, left } = this.box;
    const placed: { b: Bearing; x: number; y: number; angle: number; edge: Edge }[] = [];
    for (const b of bearings) {
      // Where it is from the camera, which looks down its -z.
      const cam = this.cam.copy(b.at).applyMatrix4(camera.matrixWorldInverse);
      let dx: number;
      let dy: number;
      if (cam.z < -0.01) {
        const ndc = this.ndc.copy(b.at).project(camera);
        // In view already, jumping at its desk.
        if (Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) continue;
        dx = ndc.x * cx;
        dy = -ndc.y * cy;
      } else {
        // Behind you: to the side you'd turn to, or straight down when it's right behind.
        dx = cam.x;
        dy = Math.abs(cam.x) < 0.05 && Math.abs(cam.y) < 0.05 ? 1 : -cam.y;
      }
      // Out from the middle of the screen along that way, to the edge of the box.
      let s = Infinity;
      if (dx > 0) s = (right - cx) / dx;
      else if (dx < 0) s = (left - cx) / dx;
      if (dy > 0) s = Math.min(s, (bottom - cy) / dy);
      else if (dy < 0) s = Math.min(s, (top - cy) / dy);
      if (!Number.isFinite(s)) continue;
      const x = cx + dx * s;
      const y = cy + dy * s;
      const edge = x <= left + 1 ? 'left' : x >= right - 1 ? 'right' : y <= top + 1 ? 'top' : 'bottom';
      placed.push({ b, x, y, angle: Math.atan2(dy, dx), edge });
    }
    // Workers at desks side by side land on top of each other: spread them out along their edge.
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const side = edge === 'left' || edge === 'right';
      const axis = side ? 'y' : 'x';
      const gap = side ? SPACING.side : SPACING.across;
      const row = placed.filter((p) => p.edge === edge).sort((a, b) => a[axis] - b[axis]);
      for (let i = 1; i < row.length; i++) row[i][axis] = Math.max(row[i][axis], row[i - 1][axis] + gap);
      // Pushed off the end: back the lot up.
      const over = row.length ? row[row.length - 1][axis] - (side ? bottom : right) : 0;
      if (over > 0) for (const p of row) p[axis] = Math.max(side ? top : left, p[axis] - over);
    }
    const seen = new Set<string>();
    for (const p of placed) {
      seen.add(p.b.id);
      const m = this.mark(p.b);
      m.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      // The pin's point is its bottom-left corner, which sits at 135° before it's turned.
      m.arrow.style.transform = `rotate(${(p.angle - (3 * Math.PI) / 4).toFixed(3)}rad)`;
    }
    for (const [id, m] of this.marks) {
      if (seen.has(id)) continue;
      m.el.remove();
      this.marks.delete(id);
    }
  }

  private mark(b: Bearing): Mark {
    let m = this.marks.get(b.id);
    if (!m) {
      const arrow = h('span.compass-arrow');
      const dial = h('span.compass-dial');
      const who = h('span.compass-who');
      const el = h('div.compass-mark', {}, arrow, dial, who);
      this.root.append(el);
      m = { el, arrow, dial, who, status: '' };
      this.marks.set(b.id, m);
    }
    if (m.status !== b.status) {
      m.status = b.status;
      m.el.className = `compass-mark ${b.status}`;
      m.dial.textContent = b.status === 'needs_input' ? '🙋' : '✅';
    }
    if (m.who.textContent !== b.name) m.who.textContent = b.name;
    return m;
  }

  /** The HUD moves as the window resizes and the top bar's buttons wrap, so look again now and then. */
  private measure(now: number) {
    this.measured = now;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const side = document.querySelector('.side')?.getBoundingClientRect();
    // Never so tight the marks crowd the middle of the screen.
    this.box = {
      top: Math.min(Math.max(MARGIN, (bar?.bottom ?? 0) + MARGIN), hgt / 2 - 60),
      right: Math.max(side?.width ? side.left - MARGIN : w - MARGIN, w / 2 + 60),
      bottom: Math.max(hgt - 130, hgt / 2 + 60),
      left: MARGIN,
    };
  }
}
