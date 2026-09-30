import * as THREE from 'three';
import { PICTURE_MAX, PICTURE_MIN, clampToWall, frameRect, overlaps, pictureSize, type WallId } from '../../../shared/decor';
import type { Net } from '../../net';
import type { PlayerController } from '../../player';
import { store } from '../../state';
import { openHangDialog, openPicture, type HangChoice } from './ui';
import { toast } from '../../ui/dom';
import { Ghost, aimAtWall, brokenTexture, holdPicture, loadPicture, type Gallery } from './world';
import type { Office } from '../../world/types';

interface Hanging {
  url: string;
  title: string;
  frame: number;
  texture: THREE.Texture;
  /** The image's width / height, for cropping it into the frame. */
  aspect: number;
  /** The frame's width / height. */
  shape: number;
  /** Longest side of the picture, in meters. */
  size: number;
  /** Set when moving a picture that's already up. */
  moving?: string;
  release(): void;
}

export interface Spot {
  wall: WallId;
  u: number;
  y: number;
  w: number;
  h: number;
  /** False when something else is on the wall there. */
  ok: boolean;
}

const SIZE_KEY = 'agent-office.picture-size';
function lastSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return n >= PICTURE_MIN && n <= PICTURE_MAX ? n : 1.2;
  } catch {
    return 1.2;
  }
}

/**
 * Hanging pictures: pick an image, then aim at a wall (the crosshair in first person, the mouse in
 * third) and click. Also looking at one closer, moving, editing and taking it down.
 */
export class Hanger {
  readonly ghost = new Ghost();
  /** Called when hanging starts or stops. */
  onChange: () => void = () => {};
  private cur: Hanging | null = null;
  private at: Spot | null = null;
  private mouse = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  /** A moved picture stays hidden until the office confirms where it went. */
  private revealTimer = 0;

  constructor(
    private net: Net,
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private player: PlayerController,
    private office: Office,
    private gallery: Gallery,
  ) {
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    // The wheel sizes the picture instead of zooming the camera. On window, in the capture phase,
    // so it runs before the player's own wheel handler on the canvas.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.cur || e.target !== canvas) return;
        e.preventDefault();
        e.stopPropagation();
        this.resize(e.deltaY < 0 ? 1 : -1);
      },
      { capture: true, passive: false },
    );
    // Esc frees the mouse before the page ever sees the key; treat that as cancel too.
    document.addEventListener('pointerlockchange', () => {
      if (this.cur && this.player.view === 'first' && !this.player.locked) this.cancel();
    });
    store.on('decor', () => {
      const moving = this.cur?.moving;
      if (moving && !store.decor.some((d) => d.id === moving)) {
        toast('Someone took that picture down', 'warn');
        this.cancel();
      }
      if (this.revealTimer) this.reveal();
    });
  }

  get active(): boolean {
    return !!this.cur;
  }

  get moving(): boolean {
    return !!this.cur?.moving;
  }

  /** Where the picture would hang right now, if you're aiming at a wall. */
  get spot(): Spot | null {
    return this.at;
  }

  /** Pick an image, then a spot on the wall. */
  start() {
    openHangDialog({ onDone: (c) => this.begin(c, lastSize()) });
  }

  /** A closer look at a picture on the wall. */
  view(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    openPicture(d, {
      move: () => this.move(id),
      edit: () => this.edit(id),
      remove: () => this.net.send({ t: 'decor.remove', id }),
    });
  }

  move(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    const release = holdPicture(d.url);
    const go = (texture: THREE.Texture, aspect: number) => {
      if (!store.decor.some((x) => x.id === id)) return release();
      this.stop();
      this.cur = { url: d.url, title: d.title ?? '', frame: d.frame, texture, aspect, shape: d.w / d.h, size: Math.max(d.w, d.h), moving: id, release };
      this.gallery.hide(id);
      this.onChange();
    };
    loadPicture(d.url).then(
      (pic) => go(pic.texture, pic.aspect),
      // Still movable when its image won't load.
      () => go(brokenTexture(), 4 / 3),
    );
  }

  edit(id: string) {
    const d = store.decor.find((x) => x.id === id);
    if (!d) return;
    openHangDialog({
      initial: d,
      onDone: (c) => {
        // A new image keeps the picture's size along its longest side, in the new image's shape.
        const { w, h } = c.picture.url === d.url ? d : pictureSize(Math.max(d.w, d.h), c.picture.aspect);
        this.net.send({ t: 'decor.update', id, decor: { url: c.picture.url, title: c.title, frame: c.frame, w, h } });
      },
    });
  }

  /** Bigger (+1) or smaller (-1). */
  resize(dir: number) {
    if (!this.cur) return;
    // A tall picture tops out below PICTURE_MAX; start shrinking from where it stopped growing.
    const { w, h } = pictureSize(this.cur.size * (dir > 0 ? 1.1 : 1 / 1.1), this.cur.shape);
    this.cur.size = Math.max(w, h);
  }

  /** Hangs the picture where you aim. `ndc` is where you clicked, in third person. */
  place(ndc?: THREE.Vector2) {
    const cur = this.cur;
    if (!cur) return;
    if (ndc && this.player.view === 'third') this.mouse.copy(ndc);
    this.update();
    const at = this.at;
    if (!at) return toast('Aim at a wall to hang it there');
    if (!at.ok) return toast("Something's already on the wall there", 'warn');
    const spot = { wall: at.wall, u: at.u, y: at.y, w: at.w, h: at.h };
    if (cur.moving) {
      this.net.send({ t: 'decor.update', id: cur.moving, decor: spot });
      // Reveal it when the office says where it went (or soon anyway, if it refused).
      this.revealTimer = window.setTimeout(() => this.reveal(), 1500);
    } else {
      this.net.send({ t: 'decor.add', decor: { url: cur.url, title: cur.title || undefined, frame: cur.frame, ...spot } });
    }
    try {
      localStorage.setItem(SIZE_KEY, String(cur.size));
    } catch {
      // storage blocked
    }
    this.stop(!!cur.moving);
  }

  cancel() {
    if (!this.cur) return;
    this.stop();
  }

  /** Every frame: move the ghost to where you aim. */
  update() {
    const cur = this.cur;
    if (!cur) return;
    this.raycaster.setFromCamera(this.player.view === 'first' ? new THREE.Vector2(0, 0) : this.mouse, this.camera);
    const hit = aimAtWall(this.raycaster.ray);
    const { w, h } = pictureSize(cur.size, cur.shape);
    const on = hit && clampToWall(hit.wall, hit.u, hit.y, w, h);
    if (!hit || !on) {
      this.at = null;
      this.ghost.hide();
      return;
    }
    const rect = frameRect({ wall: hit.wall, u: on.u, y: on.y, w, h });
    const ok = ![...this.office.fixtures(), ...this.gallery.rects(cur.moving)].some((r) => overlaps(rect, r));
    this.at = { wall: hit.wall, u: on.u, y: on.y, w, h, ok };
    this.ghost.show(this.at, cur.frame, cur.texture, cur.aspect);
  }

  private begin(c: HangChoice, size: number) {
    this.stop();
    const aspect = c.picture.aspect;
    this.cur = { url: c.picture.url, title: c.title, frame: c.frame, texture: c.picture.texture, aspect, shape: aspect, size, release: holdPicture(c.picture.url) };
    this.onChange();
  }

  /** Stops hanging. A moved picture stays hidden (`keepHidden`) until the office says where it went. */
  private stop(keepHidden = false) {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.at = null;
    this.ghost.clear();
    cur.release();
    if (cur.moving && !keepHidden) this.gallery.hide(null);
    this.onChange();
  }

  private reveal() {
    clearTimeout(this.revealTimer);
    this.revealTimer = 0;
    if (!this.cur?.moving) this.gallery.hide(null);
  }
}
