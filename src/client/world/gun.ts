import * as THREE from 'three';

/**
 * A .44 Magnum: brushed silver, wood grip, pointing down +z with its grip under the origin (where
 * the fist closes round it). Built from primitives, like the golf club: a long barrel with a
 * ventilated rib and a front sight, the frame, a six-shot cylinder that turns, a hammer and trigger
 * in a guard, and a walnut grip. No DOM or WebGL at import time, so tests can load it in Node.
 */

/** How long the gun is from the grip to the muzzle, in meters. */
export const GUN_LEN = 0.34;
/** How high the barrel sits above the origin. */
const BORE_Y = 0.035;

const silver = () => new THREE.MeshToonMaterial({ color: '#c8ccd4' });
const darkSilver = () => new THREE.MeshToonMaterial({ color: '#8f959e' });
const walnut = () => new THREE.MeshToonMaterial({ color: '#6f4518' });
const ink = () => new THREE.MeshToonMaterial({ color: '#2b2d42' });

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function magnum(): THREE.Group {
  const gun = new THREE.Group();
  const steel = silver();
  const dark = darkSilver();
  // The barrel: octagonal up top, round underneath, with a ventilated rib and a ramped front sight.
  gun.add(part(new THREE.CylinderGeometry(0.021, 0.023, 0.21, 8).rotateX(Math.PI / 2), steel, 0, BORE_Y, 0.14));
  gun.add(part(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10).rotateX(Math.PI / 2), dark, 0, BORE_Y - 0.02, 0.135));
  gun.add(part(new THREE.BoxGeometry(0.014, 0.012, 0.2), dark, 0, BORE_Y + 0.026, 0.135));
  for (let i = 0; i < 4; i++) gun.add(part(new THREE.BoxGeometry(0.016, 0.008, 0.02), steel, 0, BORE_Y + 0.026, 0.06 + i * 0.048));
  gun.add(part(new THREE.BoxGeometry(0.01, 0.02, 0.03), ink(), 0, BORE_Y + 0.035, 0.235));
  // The muzzle: a dark ring round the bore.
  gun.add(part(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12).rotateX(Math.PI / 2), dark, 0, BORE_Y, 0.248));
  gun.add(part(new THREE.CylinderGeometry(0.011, 0.011, 0.014, 10).rotateX(Math.PI / 2), ink(), 0, BORE_Y, 0.248));
  // The frame and the six-shot cylinder, with its flutes.
  gun.add(part(new THREE.BoxGeometry(0.034, 0.05, 0.07), steel, 0, BORE_Y - 0.005, 0.0));
  const cylinder = new THREE.Group();
  cylinder.position.set(0, BORE_Y, -0.005);
  cylinder.add(part(new THREE.CylinderGeometry(0.032, 0.032, 0.062, 12).rotateX(Math.PI / 2), steel, 0, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cylinder.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.064, 6).rotateX(Math.PI / 2), dark, Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0));
  }
  gun.add(cylinder);
  // The hammer, cocked back, and the rear sight groove.
  const hammer = part(new THREE.BoxGeometry(0.012, 0.035, 0.02), dark, 0, BORE_Y + 0.028, -0.048);
  hammer.rotation.x = -0.5;
  gun.add(hammer);
  gun.add(part(new THREE.BoxGeometry(0.02, 0.006, 0.03), ink(), 0, BORE_Y + 0.028, -0.03));
  // The trigger in its guard.
  gun.add(part(new THREE.TorusGeometry(0.026, 0.005, 6, 14, Math.PI * 1.5).rotateZ(Math.PI * 0.75), dark, 0, BORE_Y - 0.045, 0.005));
  const trigger = part(new THREE.BoxGeometry(0.008, 0.028, 0.01), ink(), 0, BORE_Y - 0.038, 0.008);
  trigger.rotation.x = 0.25;
  gun.add(trigger);
  // The walnut grip, swelling toward the butt, with a silver medallion on each side.
  const grip = part(new THREE.BoxGeometry(0.036, 0.11, 0.05), walnut(), 0, -0.075, -0.03);
  grip.rotation.x = 0.35;
  gun.add(grip);
  for (const s of [-1, 1]) {
    const medal = part(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 10).rotateZ(Math.PI / 2), steel, s * 0.019, -0.075, -0.038);
    medal.rotation.x = 0.35;
    gun.add(medal);
  }
  gun.add(part(new THREE.BoxGeometry(0.038, 0.014, 0.052), dark, 0, -0.128, -0.048));
  return gun;
}

/** Where the muzzle is: the flash and the shot's smoke start here. */
export const MUZZLE_AT = new THREE.Vector3(0, BORE_Y, 0.26);

/** Takes a gun from magnum() out of the hand holding it, and frees what it was made of. */
export function disposeGun(prop: THREE.Group) {
  prop.removeFromParent();
  prop.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
}

/** How long a muzzle flash lasts, in seconds. */
const FLASH_TIME = 0.09;

/**
 * The flash at the muzzle when it fires: a star of crossed additive planes round a white-hot core,
 * and a point light that throws it on the walls. fire() pops it; update() fades it back to nothing.
 */
export class Muzzle {
  readonly group = new THREE.Group();
  private t = Infinity;
  private core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private star: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  private light: THREE.PointLight;

  constructor() {
    this.group.position.copy(MUZZLE_AT);
    const additive = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), additive('#fff6d8', 0));
    this.group.add(this.core);
    this.star = [];
    for (const [w, l] of [
      [0.05, 0.22],
      [0.05, 0.22],
      [0.09, 0.12],
    ]) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(w, l), additive('#ffb347', 0));
      if (this.star.length === 1) blade.rotation.z = Math.PI / 2;
      if (this.star.length === 2) blade.rotation.y = Math.PI / 2;
      // Along the barrel, half of it past the muzzle.
      blade.rotation.x = this.star.length === 2 ? 0 : Math.PI / 2;
      blade.position.z = 0.08;
      this.group.add(blade);
      this.star.push(blade);
    }
    this.light = new THREE.PointLight('#ffb347', 0, 7, 2);
    this.light.position.z = 0.1;
    this.group.add(this.light);
  }

  fire() {
    this.t = 0;
  }

  get lit(): boolean {
    return this.t < FLASH_TIME;
  }

  update(dt: number) {
    if (this.t >= FLASH_TIME) return;
    this.t += dt;
    const k = Math.max(0, 1 - this.t / FLASH_TIME);
    this.core.material.opacity = k;
    this.core.scale.setScalar(0.6 + 0.4 * k);
    for (const b of this.star) b.material.opacity = k * 0.9;
    this.group.scale.setScalar(1 + (1 - k) * 0.6);
    this.light.intensity = 14 * k * k;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && 'dispose' in mat) mat.dispose();
    });
  }
}

/** How long an impact puff hangs in the air, in seconds. */
const PUFF_TIME = 0.5;

/**
 * Where a missed shot cracks into the wall or floor: grey dust bursting out, with one orange spark,
 * swelling and fading in half a second. update() returns false once it's gone.
 */
export class Puff {
  readonly group = new THREE.Group();
  private t = 0;
  private bits: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; vel: THREE.Vector3 }[] = [];

  constructor(at: THREE.Vector3, normal: THREE.Vector3 | null) {
    this.group.position.copy(at);
    const away = (normal ?? new THREE.Vector3(0, 1, 0)).clone();
    const mat = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const dust = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.03, 8, 6), mat('#b9b3a8'));
      const v = away.clone().multiplyScalar(1.2 + Math.random());
      v.x += (Math.random() - 0.5) * 2.2;
      v.y += Math.random() * 1.4;
      v.z += (Math.random() - 0.5) * 2.2;
      this.bits.push({ mesh: dust, vel: v });
      this.group.add(dust);
    }
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat('#ffcf5c'));
    this.bits.push({
      mesh: spark,
      vel: away
        .clone()
        .multiplyScalar(4)
        .add(new THREE.Vector3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3)),
    });
    this.group.add(spark);
  }

  /** Moves the dust along; false once it has cleared. */
  update(dt: number): boolean {
    this.t += dt;
    const p = Math.min(1, this.t / PUFF_TIME);
    for (const b of this.bits) {
      b.mesh.position.addScaledVector(b.vel, dt);
      b.vel.multiplyScalar(Math.exp(-dt * 3));
      b.vel.y -= dt * 1.5;
      b.mesh.scale.setScalar(1 + p * 2.2);
      b.mesh.material.opacity = 0.9 * (1 - p);
    }
    return p < 1;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}
