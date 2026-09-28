/**
 * World-space UI panels: a plane with a live canvas texture, sized in meters, driven by a
 * controller ray. Content classes (terminal, keyboard, menu) own a WorldPanel each: they paint
 * onto its 2D context, register rectangular buttons and scroll regions in normalized panel
 * coordinates, and the panel maps ray hits to clicks and drags.
 *
 * Repaints are dirty-region based: markDirty() unions a rect, update() repaints once per frame
 * clipped to it. (The GPU upload is still the whole canvas — CanvasTexture has no partial
 * upload — but canvas text painting is the dominant cost, and that part is clipped.)
 */

import * as THREE from 'three';
import {
  canvasSize, clampScroll, followStep, followTarget, hitTest, isOnPanel, rectToPx, scrollByDrag, scrollByStick, unionRect, uvToPanel,
  type HeadPose, type Point, type Rect,
} from './math';

/** What a painter needs to draw hover, press and blink states. */
export interface PanelPaintState {
  hoverId: string | null;
  pressedId: string | null;
  /** Seconds on performance.now()'s clock, for cursor blinks and press fades. */
  time: number;
}

/**
 * Paints the panel. `dirty` is the normalized rect that changed (null for a full repaint);
 * painters may ignore it and repaint everything — the panel already clips the context to it.
 */
export type PanelPainter = (ctx: CanvasRenderingContext2D, w: number, h: number, dirty: Rect | null, state: PanelPaintState) => void;

export interface PanelButton {
  id: string;
  rect: Rect;
  onClick: () => void;
}

interface ScrollState {
  rect: Rect;
  offset: number;
  contentH: number;
  viewH: number;
}

export interface WorldPanelOpts {
  /** Panel size in meters. */
  width: number;
  height: number;
  /** Canvas density before the devicePixelRatio multiplier (default 1400 px/m). */
  pxPerMeter?: number;
  paint: PanelPainter;
}

type Press = { kind: 'button'; id: string } | { kind: 'scroll'; id: string; startOffset: number; startY: number; unitsPerY: number } | null;

export class WorldPanel {
  /** Add this to the scene (or to a controller grip for a wrist menu). */
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly width: number;
  readonly height: number;
  /** Fires when a scroll region's offset changes (ray drag or thumbstick). */
  onScroll: ((id: string, offset: number) => void) | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private painter: PanelPainter;
  private buttons: PanelButton[] = [];
  private scrolls = new Map<string, ScrollState>();
  private dirty: Rect | null = null;
  private full = true;
  private hoverId: string | null = null;
  private pressedId: string | null = null;
  private press: Press = null;
  private follow = false;
  private followDistance = 1.1;
  private followDrop = 0.12;
  private tmpV = new THREE.Vector3();

  constructor(opts: WorldPanelOpts) {
    this.width = opts.width;
    this.height = opts.height;
    this.painter = opts.paint;
    const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    const { w, h } = canvasSize(opts.width, opts.height, dpr, opts.pxPerMeter);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(opts.width, opts.height);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.userData.panel = this;
    this.group.add(this.mesh);
  }

  get canvasW(): number {
    return this.canvas.width;
  }

  get canvasH(): number {
    return this.canvas.height;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  // ---- Content ------------------------------------------------------------------------------

  /** Replaces the clickable buttons (ids double as hover/press paint keys). */
  setButtons(buttons: PanelButton[]) {
    this.buttons = buttons;
    if (this.hoverId && !buttons.some((b) => b.id === this.hoverId)) this.hoverId = null;
    this.markDirty();
  }

  /** Adds or moves a scroll region; content sizes arrive via setScrollContent during paint. */
  setScrollRegion(id: string, rect: Rect) {
    const cur = this.scrolls.get(id);
    this.scrolls.set(id, cur ? { ...cur, rect } : { rect, offset: 0, contentH: 0, viewH: 0 });
  }

  removeScrollRegion(id: string) {
    this.scrolls.delete(id);
  }

  /** Current scroll offset of a region, in content units (rows, pixels — whatever the painter uses). */
  scrollOffset(id: string): number {
    return this.scrolls.get(id)?.offset ?? 0;
  }

  /** Painters report their content size here; the offset clamps and a change repaints. */
  setScrollContent(id: string, contentH: number, viewH: number) {
    const s = this.scrolls.get(id);
    if (!s) return;
    const offset = clampScroll(s.offset, contentH, viewH);
    if (offset !== s.offset || contentH !== s.contentH || viewH !== s.viewH) {
      s.offset = offset;
      s.contentH = contentH;
      s.viewH = viewH;
      this.markDirty(s.rect);
    }
  }

  setScrollOffset(id: string, offset: number) {
    const s = this.scrolls.get(id);
    if (!s) return;
    const next = clampScroll(offset, s.contentH, s.viewH);
    if (next !== s.offset) {
      s.offset = next;
      this.onScroll?.(id, next);
      this.markDirty(s.rect);
    }
  }

  /** Thumbstick scrolling: axis -1..1 (positive scrolls down), dt seconds. */
  scrollStick(id: string, axis: number, dt: number, unitsPerSec: number): number {
    const s = this.scrolls.get(id);
    if (!s) return 0;
    const next = clampScroll(scrollByStick(s.offset, axis, dt, unitsPerSec), s.contentH, s.viewH);
    if (next !== s.offset) {
      s.offset = next;
      this.onScroll?.(id, next);
      this.markDirty(s.rect);
    }
    return next;
  }

  // ---- Ray input ----------------------------------------------------------------------------

  /** Raycasts a controller ray against the panel; null when it misses or the panel is hidden. */
  raycast(raycaster: THREE.Raycaster): { u: number; v: number } | null {
    if (!this.group.visible) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    const uv = hit?.uv;
    if (!uv || !isOnPanel(uv.x, uv.y)) return null;
    return { u: uv.x, v: uv.y };
  }

  /** Maps a ray UV to panel-local coordinates (normalized, origin top-left). */
  toLocal(uv: { u: number; v: number }): Point {
    return uvToPanel(uv.u, uv.v);
  }

  /** Which button (if any) a ray UV sits on. */
  buttonAt(uv: { u: number; v: number }): PanelButton | null {
    return hitTest(this.buttons, uvToPanel(uv.u, uv.v));
  }

  /** Hover update; pass null when the ray points elsewhere. Returns the hovered button, if any. */
  pointerMove(uv: { u: number; v: number } | null): PanelButton | null {
    if (this.press?.kind === 'scroll') {
      if (!uv) return null;
      const s = this.scrolls.get(this.press.id);
      if (s) {
        const p = uvToPanel(uv.u, uv.v);
        const next = clampScroll(scrollByDrag(this.press.startOffset, this.press.startY, p.y, this.press.unitsPerY), s.contentH, s.viewH);
        if (next !== s.offset) {
          s.offset = next;
          this.onScroll?.(this.press.id, next);
          this.markDirty(s.rect);
        }
      }
      return null;
    }
    if (this.press?.kind === 'button') {
      // Slide off the button and the press cancels (slide back on and it re-arms).
      const id = uv ? (hitTest(this.buttons, uvToPanel(uv.u, uv.v))?.id ?? null) : null;
      const armed = id === this.press.id ? id : null;
      if (armed !== this.pressedId) {
        this.pressedId = armed;
        this.markDirty();
      }
      return uv ? this.buttonAt(uv) : null;
    }
    const id = uv ? (hitTest(this.buttons, uvToPanel(uv.u, uv.v))?.id ?? null) : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.markDirty();
    }
    return uv ? this.buttonAt(uv) : null;
  }

  /** Trigger pressed with the ray at uv. Returns true when the press landed on the panel. */
  pointerDown(uv: { u: number; v: number }): boolean {
    const p = uvToPanel(uv.u, uv.v);
    // Buttons draw above scroll regions, and hitTest lets the last entry win.
    const regions = [...this.scrolls].map(([id, s]) => ({ id, rect: s.rect, scroll: true as const }));
    const hit = hitTest([...regions, ...this.buttons], p);
    if (!hit) return false;
    const s = (hit as { scroll?: boolean }).scroll === true ? this.scrolls.get(hit.id) : undefined;
    if (s) {
      // Dragging the region's height scrolls one viewport.
      const unitsPerY = s.viewH > 0 ? s.viewH / Math.max(0.001, s.rect.h) : 0;
      this.press = { kind: 'scroll', id: hit.id, startOffset: s.offset, startY: p.y, unitsPerY };
      return true;
    }
    this.press = { kind: 'button', id: hit.id };
    this.pressedId = hit.id;
    this.markDirty();
    return true;
  }

  /** Trigger released; clicks the armed button when the ray is still on it. */
  pointerUp(uv: { u: number; v: number } | null): PanelButton | null {
    const press = this.press;
    this.press = null;
    this.pressedId = null;
    if (press?.kind !== 'button') {
      this.markDirty();
      return null;
    }
    const up = uv ? hitTest(this.buttons, uvToPanel(uv.u, uv.v)) : null;
    this.markDirty();
    if (up && up.id === press.id) {
      up.onClick();
      return up;
    }
    return null;
  }

  /** The ray left the panel mid-press (or the controller disconnected): cancel it quietly. */
  pointerCancel() {
    this.press = null;
    this.pressedId = null;
    this.hoverId = null;
    this.markDirty();
  }

  // ---- Frame ----------------------------------------------------------------------------------

  /** Panels that follow stay at a fixed distance, gliding after the camera instead of snapping. */
  setFollow(enabled: boolean, distance = 1.1, dropM = 0.12) {
    this.follow = enabled;
    this.followDistance = distance;
    this.followDrop = dropM;
  }

  get follows(): boolean {
    return this.follow;
  }

  /** Marks a normalized rect dirty (none for the whole panel); update() repaints once per frame. */
  markDirty(rect?: Rect) {
    if (!rect) {
      this.full = true;
      return;
    }
    this.dirty = unionRect(this.dirty, rect);
  }

  /** Repaints immediately (the debug preview uses this; the render loop uses update). */
  repaintNow() {
    const dirty = this.full ? null : this.dirty;
    this.full = false;
    this.dirty = null;
    const { ctx, canvas } = this;
    ctx.save();
    if (dirty) {
      const r = rectToPx(dirty, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.rect(Math.max(0, r.x - 1), Math.max(0, r.y - 1), r.w + 2, r.h + 2);
      ctx.clip();
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.painter(ctx, canvas.width, canvas.height, dirty, { hoverId: this.hoverId, pressedId: this.pressedId, time: performance.now() / 1000 });
    ctx.restore();
    this.texture.needsUpdate = true;
  }

  update(dt: number, head?: HeadPose | null) {
    if (this.full || this.dirty) this.repaintNow();
    if (!this.follow || !head) return;
    const target = followTarget(head.pos, head.dir, this.followDistance, this.followDrop);
    const p = this.group.position;
    const next = followStep([p.x, p.y, p.z], target, 1 - Math.exp(-dt * 4));
    p.set(next[0], next[1], next[2]);
    this.group.lookAt(this.tmpV.set(head.pos[0], head.pos[1], head.pos[2]));
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
