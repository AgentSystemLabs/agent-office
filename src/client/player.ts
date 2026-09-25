import * as THREE from 'three';
import { FLOOR } from '../shared/layout';
import type { Collider } from './world/office';

const RADIUS = 0.32;
const WALK = 4.6;
const RUN = 7.5;
const JUMP_V = 6.4;
const GRAVITY = 18;

export class PlayerController {
  pos = new THREE.Vector3();
  vy = 0;
  facing = Math.PI;
  moving = false;
  grounded = true;
  camYaw = Math.PI * 0.15;
  camPitch = 0.42;
  camDist = 7.5;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  enabled = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private colliders: Collider[],
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.camYaw -= (e.clientX - this.lastX) * 0.006;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + (e.clientY - this.lastY) * 0.004, 0.05, 1.3);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, 2.5, 16);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  clearKeys() {
    this.keys.clear();
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
    if (this.moving) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      // Camera-relative: "forward" is away from the camera.
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const dx = ix * cos + iz * sin;
      const dz = -ix * sin + iz * cos;
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
      this.tryMove(this.pos.x + dx * speed * dt, this.pos.z);
      this.tryMove(this.pos.x, this.pos.z + dz * speed * dt);
      const want = Math.atan2(dx, dz);
      let diff = want - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * Math.min(1, dt * 14);
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
    this.updateCamera();
  }

  updateCamera() {
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
    this.camera.position.lerp(cam, 0.25);
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
