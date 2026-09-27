import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T, type SeatPlace } from '../shared/layout';
import type { ViewMode } from './state';
import type { Collider } from './world/office';

const RADIUS = 0.32;
/** Top of your head above your feet, for walking under the loft. */
const HEIGHT = 1.7;
/** The tallest ledge you walk up (or down) without jumping, like a stair. */
const STEP = 0.3;
const WALK = 4.6;
const RUN = 7.5;
const JUMP_V = 6.4;
const GRAVITY = 18;
/** Camera height above your feet in first person (the Person's eyes). */
export const EYE_HEIGHT = 1.4;
/** The Person's hips above their feet, standing. Sitting puts them on the seat, and your eyes move with them. */
export const HIPS = 0.42;
/** Keys that get you up off a seat: walking away, or jumping up. */
const GET_UP = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
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
  /** Eased out after a step up or down, so the camera glides up stairs instead of popping. */
  stepOffset = 0;
  /** Walking and running speed, as a multiple of normal (a coffee's buzz). */
  speedBoost = 1;
  /** Jump speed, as a multiple of normal. */
  jumpBoost = 1;
  /** 0 (steady) to 1: how hard the view trembles after one coffee too many. */
  jitter = 0;
  private jitterT = 0;
  /** Where you're sitting, or null on your feet. You stay put there until you walk off or jump up. */
  seat: SeatPlace | null = null;
  /** You got up by walking off or jumping (not by stand()). */
  onStand: (() => void) | null = null;
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

  /** Sits you down in `place`, facing the way it does. In first person you look out from it; in third the camera stays put. */
  sit(place: SeatPlace) {
    this.seat = place;
    this.pos.set(place.x, place.y, place.z);
    this.vy = 0;
    this.grounded = true;
    this.moving = false;
    this.stepOffset = 0;
    this.bob = 0;
    this.facing = place.rotY;
    if (this.view === 'first') {
      this.camYaw = place.rotY - Math.PI;
      this.lookPitch = -0.08;
    }
  }

  /** Gets you up off your seat onto the floor beside it: out in front (or behind), else wherever there's room. */
  stand() {
    const s = this.seat;
    if (!s) return;
    this.seat = null;
    const ahead = s.rotY + (s.out < 0 ? Math.PI : 0);
    const d = Math.abs(s.out);
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const x = s.x + Math.sin(ahead + turn) * d;
      const z = s.z + Math.cos(ahead + turn) * d;
      if (this.blocker(x, z, s.y)) continue;
      this.pos.set(x, s.y, z);
      return;
    }
  }

  /** How far sitting moves your hips (and eyes) from where they are standing. */
  private get lift(): number {
    return this.seat ? this.seat.hips - HIPS : 0;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    if (this.seat) {
      if (!this.enabled || !GET_UP.some((c) => k.has(c))) {
        this.moving = false;
        this.facing = this.seat.rotY;
        this.jitterT += dt;
        this.updateCamera();
        return;
      }
      this.stand();
      this.onStand?.();
    }
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
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * this.speedBoost;
      this.tryMove(this.pos.x + dx * speed * dt, this.pos.z);
      this.tryMove(this.pos.x, this.pos.z + dz * speed * dt);
      if (this.view === 'third') {
        const want = Math.atan2(dx, dz);
        let diff = want - this.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.facing += diff * Math.min(1, dt * 14);
      }
    }

    const ground = groundAt(this.colliders, this.pos.x, this.pos.z, this.pos.y);
    const jump = this.enabled && k.has('Space') && this.grounded;
    if (jump) {
      this.vy = JUMP_V * this.jumpBoost;
      this.grounded = false;
    } else if (this.grounded && this.pos.y > ground && this.pos.y - ground <= STEP + 0.02) {
      // Walking down a stair: stay on your feet rather than falling a step.
      this.stepOffset += this.pos.y - ground;
      this.pos.y = ground;
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
    const ceiling = ceilingAt(this.colliders, this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y + HEIGHT > ceiling) {
      this.pos.y = Math.max(ground, ceiling - HEIGHT);
      this.vy = Math.min(this.vy, 0);
    }
    this.stepOffset *= Math.exp(-dt * 16);
    const walking = this.moving && this.grounded;
    this.walkPhase += dt * (walking ? (k.has('ShiftLeft') || k.has('ShiftRight') ? 14 : 11) * this.speedBoost : 0);
    const bob = walking ? Math.abs(Math.sin(this.walkPhase)) * 0.035 : 0;
    this.bob += (bob - this.bob) * Math.min(1, dt * 18);
    this.jitterT += dt;
    this.updateCamera();
  }

  updateCamera(snap = false) {
    if (this.view === 'first') {
      this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT + this.bob + this.stepOffset + this.lift, this.pos.z);
      this.camera.rotation.set(this.lookPitch, this.camYaw, 0);
      this.shake();
      return;
    }
    const target = new THREE.Vector3(this.pos.x, this.pos.y + this.stepOffset + this.lift + 1.3, this.pos.z);
    const off = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).multiplyScalar(this.camDist);
    const cam = target.clone().add(off);
    // Keep the camera on your side of the outside walls, so they never block the view: inside the
    // room while you're in the office, out of the building while you're outside or on the balcony.
    // And under the loft, its roof or the garage ceiling.
    const m = 0.4;
    const indoors = this.pos.y > -SLAB - 0.5 && this.pos.x > FLOOR.minX && this.pos.x < FLOOR.maxX && this.pos.z > FLOOR.minZ && this.pos.z < FLOOR.maxZ;
    if (indoors) {
      cam.x = THREE.MathUtils.clamp(cam.x, FLOOR.minX + m, FLOOR.maxX - m);
      cam.z = THREE.MathUtils.clamp(cam.z, FLOOR.minZ + m, FLOOR.maxZ - m);
    }
    const floorY = groundAt(this.colliders, this.pos.x, this.pos.z, this.pos.y);
    const roof = ceilingAt(this.colliders, cam.x, cam.z, floorY) - 0.3;
    cam.y = THREE.MathUtils.clamp(cam.y, floorY + 0.6, Math.max(floorY + 0.6, Math.min(floorY + 3.5, roof)));
    // Down on the street, stay under the garage ceiling so its edge never cuts across the view.
    if (this.pos.y < -SLAB - 1) cam.y = Math.min(cam.y, Math.max(floorY + 0.6, -SLAB - 0.3));
    // How far you are out past each outside wall (west, east, north, south), and how far inside them the camera is.
    const e = WALL_T + m;
    const out = [FLOOR.minX - WALL_T - this.pos.x, this.pos.x - FLOOR.maxX - WALL_T, FLOOR.minZ - WALL_T - this.pos.z, this.pos.z - FLOOR.maxZ - WALL_T];
    const side = out.indexOf(Math.max(...out));
    const camIn = Math.min(cam.x - (FLOOR.minX - e), FLOOR.maxX + e - cam.x, cam.z - (FLOOR.minZ - e), FLOOR.maxZ + e - cam.z) > 0;
    // Outside, back the camera out through the wall you're standing beyond: upstairs always, and
    // downstairs where the garage is walled in (the west and north sides).
    if (!indoors && out[side] > 0 && camIn && (cam.y > -SLAB || side === 0 || side === 2)) {
      if (side === 0) cam.x = FLOOR.minX - e;
      else if (side === 1) cam.x = FLOOR.maxX + e;
      else if (side === 2) cam.z = FLOOR.minZ - e;
      else cam.z = FLOOR.maxZ + e;
    }
    if (snap) this.camera.position.copy(cam);
    else this.camera.position.lerp(cam, 0.25);
    this.camera.lookAt(target);
    this.shake();
  }

  /** The jitters: the view trembles a little, on top of wherever you're looking. */
  private shake() {
    if (this.jitter <= 0) return;
    const a = this.jitter * 0.01;
    const t = this.jitterT;
    this.camera.rotation.x += a * (Math.sin(t * 71) + 0.6 * Math.sin(t * 131 + 1));
    this.camera.rotation.y += a * (Math.sin(t * 89 + 2) + 0.6 * Math.sin(t * 157));
    this.camera.rotation.z += a * Math.sin(t * 113 + 3);
  }

  /** Unit vector the character is facing, on the XZ plane. */
  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.facing), Math.cos(this.facing));
  }

  /** What stands in your way at (x, z) with your feet at `y`, or null. */
  private blocker(x: number, z: number, y: number, allowEscape = false): Collider | null {
    let hit: Collider | null = null;
    for (const c of this.colliders) {
      // Stood on top of it, or passing beneath it.
      if (y >= c.top - 0.05 || y + HEIGHT <= (c.bottom ?? 0)) continue;
      // A spawn or height change can leave the body overlapping a solid. Only
      // allow escape toward its near side, never through it to the far side.
      if (allowEscape && touches(c, this.pos.x, this.pos.z, RADIUS)) {
        if (escapes(c, this.pos.x, this.pos.z, x, z)) continue;
      } else if (!touches(c, x, z, RADIUS)) continue;
      if (!hit || c.top > hit.top) hit = c;
    }
    return hit;
  }

  private tryMove(x: number, z: number) {
    const hit = this.blocker(x, z, this.pos.y, true);
    if (!hit) {
      this.pos.x = x;
      this.pos.z = z;
      return;
    }
    // A stair: step up onto it if there's room there.
    const up = hit.top - this.pos.y;
    if (this.grounded && up <= STEP && !this.blocker(x, z, hit.top) && this.pos.y + HEIGHT + up <= ceilingAt(this.colliders, x, z, this.pos.y)) {
      this.pos.set(x, hit.top, z);
      this.stepOffset -= up;
      return;
    }
    // Use the free part of this axis's step instead of throwing it all away.
    // The other axis can then slide along the surface, even on slower frames.
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    let free = 0;
    let blocked = 1;
    for (let i = 0; i < 12; i++) {
      const fraction = (free + blocked) / 2;
      if (this.blocker(this.pos.x + dx * fraction, this.pos.z + dz * fraction, this.pos.y, true)) blocked = fraction;
      else free = fraction;
    }
    this.pos.x += dx * free;
    this.pos.z += dz * free;
  }
}

/** Whether the whole axis step moves out of an existing overlap. */
function escapes(c: Collider, fromX: number, fromZ: number, x: number, z: number): boolean {
  if (penetration(c, x, z) >= penetration(c, fromX, fromZ) - 1e-8) return false;
  const nx = fromX - THREE.MathUtils.clamp(fromX, c.minX, c.maxX);
  const nz = fromZ - THREE.MathUtils.clamp(fromZ, c.minZ, c.maxZ);
  if (nx || nz) return nx * (x - fromX) + nz * (z - fromZ) >= 0;
  // Inside the footprint, head toward a nearest face. An endpoint with less
  // overlap alone is insufficient: a long step could cross a thin wall first.
  const nearest = Math.min(fromX - c.minX, c.maxX - fromX, fromZ - c.minZ, c.maxZ - fromZ);
  return (nearest === fromX - c.minX && x < fromX) || (nearest === c.maxX - fromX && x > fromX)
    || (nearest === fromZ - c.minZ && z < fromZ) || (nearest === c.maxZ - fromZ && z > fromZ);
}

/** Signed overlap depth, including when the center is inside the footprint. */
function penetration(c: Collider, x: number, z: number): number {
  const dx = Math.max(c.minX - x, 0, x - c.maxX);
  const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
  if (dx || dz) return RADIUS - Math.hypot(dx, dz);
  return RADIUS + Math.min(x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z);
}

/** Whether a body of radius `r` at (x, z) overlaps the collider's footprint. */
function touches(c: Collider, x: number, z: number, r: number): boolean {
  const nx = THREE.MathUtils.clamp(x, c.minX, c.maxX);
  const nz = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
  return (x - nx) ** 2 + (z - nz) ** 2 < r * r;
}

/** The floor under someone standing at (x, z) with their feet at `y`: the highest top they're on or above, else the street. */
export function groundAt(colliders: Collider[], x: number, z: number, y: number): number {
  let g = STREET_Y;
  for (const c of colliders) {
    if (c.top > 50 || y < c.top - 0.1 || c.top <= g) continue;
    if (touches(c, x, z, RADIUS)) g = c.top;
  }
  return g;
}

/** The underside of whatever is overhead at (x, z) for feet at `y` (the loft, its roof), or Infinity. */
function ceilingAt(colliders: Collider[], x: number, z: number, y: number): number {
  let top = Infinity;
  for (const c of colliders) {
    const b = c.bottom ?? 0;
    if (b <= y + 0.1 || b >= top) continue;
    if (touches(c, x, z, RADIUS)) top = b;
  }
  return top;
}

export function isTyping(e?: Event): boolean {
  const el = (e?.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest?.('.xterm');
}
