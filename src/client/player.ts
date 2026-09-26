import * as THREE from 'three';
import { FLOOR } from '../shared/layout';
import type { ViewMode } from './state';
import type { Collider } from './world/office';

const RADIUS = 0.32;
const WALK = 4.6;
const RUN = 7.5;
const JUMP_V = 6.4;
const GRAVITY = 18;
/** Camera height above your feet in first person (the Person's eyes). */
export const EYE_HEIGHT = 1.4;
const LOOK_SPEED = 0.0022; // radians per pixel of mouse movement while the pointer is locked
const DRAG_LOOK_SPEED = 0.005;
const CENTER = new THREE.Vector2(0, 0);

export class PlayerController {
  pos = new THREE.Vector3();
  vy = 0;
  facing = Math.PI;
  moving = false;
  grounded = true;
  /** Heading of the camera. You look along (-sin, -cos) of it on the XZ plane. */
  camYaw = Math.PI * 0.15;
  camPitch = 0.42;
  camDist = 7.5;
  /** First-person look up (+) / down (-). */
  lookPitch = -0.08;
  view: ViewMode = 'first';
  /** Walk cycle phase, shared by the camera bob and the first-person hands. */
  walkPhase = 0;
  private bob = 0;
  /**
   * A click (not a drag) on the scene, in normalized device coordinates.
   * In first person it is always the crosshair, (0, 0).
   */
  onClick: ((ndc: THREE.Vector2) => void) | null = null;
  private keys = new Set<string>();
  private drag: { x: number; y: number; moved: number } | null = null;
  /** Set when this browser won't lock the pointer; first person falls back to drag-to-look. */
  private lockFailed = false;
  private lockPending = false;
  private everLocked = false;
  enabled = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private colliders: Collider[],
  ) {
    camera.rotation.order = 'YXZ';
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.view === 'first' && e.pointerType === 'mouse' && !this.lockFailed) {
        if (this.locked) {
          if (e.button === 0) this.onClick?.(CENTER);
          return;
        }
        this.lock();
      }
      // Drag to orbit (third person) or to look around (first person without pointer lock).
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      // A click that captured the mouse is not also a click on the world.
      if (!d || d.moved > 5 || !this.enabled || this.locked || this.lockPending || e.target !== dom) return;
      if (this.view === 'first') this.onClick?.(CENTER);
      else {
        const r = dom.getBoundingClientRect();
        this.onClick?.(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (this.locked) {
        // Some platforms report a bogus huge jump right after locking.
        const clamp = (v: number) => THREE.MathUtils.clamp(v, -250, 250);
        this.look(clamp(e.movementX) * LOOK_SPEED, clamp(e.movementY) * LOOK_SPEED);
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.view === 'first') this.look(dx * DRAG_LOOK_SPEED, dy * DRAG_LOOK_SPEED);
      else {
        this.camYaw -= dx * 0.006;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.05, 1.3);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.lockPending = false;
      // A lock that lands after a modal opened (e.g. a relock racing the next modal) is let go.
      if (this.locked && !this.enabled) {
        document.exitPointerLock();
        return;
      }
      if (this.locked) {
        this.everLocked = true;
        this.drag = null;
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockPending = false;
      // Locking right after Esc is refused for a moment; only give up if it never worked.
      if (!this.everLocked) this.lockFailed = true;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (this.view === 'third') this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, 2.5, 16);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Whether clicking the scene will capture the mouse for looking around. */
  get canLock(): boolean {
    return this.view === 'first' && !this.lockFailed && typeof this.dom.requestPointerLock === 'function';
  }

  setView(view: ViewMode) {
    if (view === this.view) return;
    if (view === 'first') {
      this.lookPitch = -0.08;
      this.facing = this.camYaw + Math.PI;
    } else {
      // Start the orbit camera behind where you were looking.
      this.camYaw = this.facing - Math.PI;
      this.unlock();
    }
    this.view = view;
    this.updateCamera(true);
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  clearKeys() {
    this.keys.clear();
  }

  /** Captures the mouse for looking around, as the first click on the scene does. */
  lock() {
    if (this.locked || this.lockPending) return;
    if (typeof this.dom.requestPointerLock !== 'function') {
      this.lockFailed = true;
      return;
    }
    this.lockPending = true;
    try {
      // Newer browsers return a promise; older ones report through pointerlockerror.
      const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        this.lockPending = false;
        if (!this.everLocked) this.lockFailed = true;
      });
    } catch {
      this.lockPending = false;
      this.lockFailed = true;
    }
  }

  private look(dx: number, dy: number) {
    this.camYaw -= dx;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy, -1.45, 1.45);
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let ix = 0;
    let iz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    }
    this.moving = ix !== 0 || iz !== 0;
    if (this.view === 'first') this.facing = Math.atan2(Math.sin(this.camYaw + Math.PI), Math.cos(this.camYaw + Math.PI));
    if (this.moving) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      // Camera-relative: "forward" is where the camera looks.
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const dx = ix * cos + iz * sin;
      const dz = -ix * sin + iz * cos;
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
      this.tryMove(this.pos.x + dx * speed * dt, this.pos.z);
      this.tryMove(this.pos.x, this.pos.z + dz * speed * dt);
      if (this.view === 'third') {
        const want = Math.atan2(dx, dz);
        let diff = want - this.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.facing += diff * Math.min(1, dt * 14);
      }
    }

    const ground = this.groundHeight();
    if (this.enabled && k.has('Space') && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
    }
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.02) {
      this.grounded = false;
    }
    const walking = this.moving && this.grounded;
    this.walkPhase += dt * (walking ? (k.has('ShiftLeft') || k.has('ShiftRight') ? 14 : 11) : 0);
    const bob = walking ? Math.abs(Math.sin(this.walkPhase)) * 0.035 : 0;
    this.bob += (bob - this.bob) * Math.min(1, dt * 18);
    this.updateCamera();
  }

  updateCamera(snap = false) {
    if (this.view === 'first') {
      this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT + this.bob, this.pos.z);
      this.camera.rotation.set(this.lookPitch, this.camYaw, 0);
      return;
    }
    const target = new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z);
    const off = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).multiplyScalar(this.camDist);
    const cam = target.clone().add(off);
    // Keep the camera inside the room so walls never block the view.
    const m = 0.4;
    cam.x = THREE.MathUtils.clamp(cam.x, FLOOR.minX + m, FLOOR.maxX - m);
    cam.z = THREE.MathUtils.clamp(cam.z, FLOOR.minZ + m, FLOOR.maxZ - m);
    cam.y = THREE.MathUtils.clamp(cam.y, 0.6, 3.5);
    if (snap) this.camera.position.copy(cam);
    else this.camera.position.lerp(cam, 0.25);
    this.camera.lookAt(target);
  }

  /** Unit vector the character is facing, on the XZ plane. */
  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.facing), Math.cos(this.facing));
  }

  private blocked(x: number, z: number): boolean {
    for (const c of this.colliders) {
      if (this.pos.y >= c.top - 0.05) continue;
      const nx = THREE.MathUtils.clamp(x, c.minX, c.maxX);
      const nz = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
      if ((x - nx) ** 2 + (z - nz) ** 2 < RADIUS * RADIUS) return true;
    }
    return false;
  }

  private tryMove(x: number, z: number) {
    if (!this.blocked(x, z)) {
      this.pos.x = x;
      this.pos.z = z;
    }
  }

  private groundHeight(): number {
    let g = 0;
    const r = RADIUS * 0.6;
    for (const c of this.colliders) {
      if (c.top > 50) continue;
      if (this.pos.x < c.minX - r || this.pos.x > c.maxX + r || this.pos.z < c.minZ - r || this.pos.z > c.maxZ + r) continue;
      if (this.pos.y >= c.top - 0.1 && c.top > g) g = c.top;
    }
    return g;
  }
}

export function isTyping(e?: Event): boolean {
  const el = (e?.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest?.('.xterm');
}
