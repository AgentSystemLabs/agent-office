import * as THREE from 'three';

// Confetti: little paper squares shot up out of a point (or let go from the ceiling), fluttering down
// and settling on whatever is below. All of it is one instanced mesh, so a room full of it is still a
// single draw.

const COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#b388eb', '#5bc0eb', '#ffffff'];
const MAX = 5000;
const GRAVITY = 9.8;
/** Air slows the bits down after the pop... */
const DRAG = 2.5;
/** ...and paper can't fall faster than this (m/s): it flutters. */
const FALL = 1.2;

interface Bit {
  life: number;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
  /** How it sways from side to side while falling. */
  sway: number;
  swayAt: number;
  /** What it lands on, worked out once it's lower than `look`; NaN until then. */
  ground: number;
  look: number;
  landed: boolean;
}

/** Where confetti rains over: a rectangle of floor. */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Confetti still to come down from the ceiling: `left` bits at `rate` a second. */
interface Rain {
  area: Area;
  from: (x: number, z: number) => number;
  left: number;
  rate: number;
  /** A part of a bit carried to the next frame, so a slow rain still comes down. */
  owed: number;
}

export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private bits: (Bit | null)[] = new Array(MAX).fill(null);
  private next = 0;
  private live = 0;
  private rains: Rain[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private e = new THREE.Euler();

  /** `groundAt` says how high the surface under (x, z) is, for something falling from `y`. */
  constructor(private groundAt: (x: number, z: number, y: number) => number) {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, hidden);
      this.mesh.setColorAt(i, this.c.set(COLORS[i % COLORS.length]));
    }
  }

  /** How many bits are in the air or on the floor right now. */
  get count(): number {
    return this.live;
  }

  /** Shoots `n` bits up out of (x, y, z); `power` 1 is a party popper, 2 a cannon. */
  burst(x: number, y: number, z: number, n = 180, power = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const out = (0.6 + Math.random() * 2.2) * power;
      this.add(
        new THREE.Vector3(x + (Math.random() - 0.5) * 0.3, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.3),
        new THREE.Vector3(Math.cos(a) * out, (4 + Math.random() * 4) * power, Math.sin(a) * out),
        4 + Math.random() * 3,
        1.5,
      );
    }
  }

  /**
   * Lets `n` bits go all over `area` for `seconds`, from `from(x, z)` overhead (the ceiling), to
   * flutter down on everything and everyone.
   */
  rain(area: Area, n: number, seconds: number, from: (x: number, z: number) => number) {
    this.rains.push({ area, from, left: Math.round(n), rate: n / seconds, owed: 0 });
  }

  private shed(r: Rain, dt: number) {
    const due = r.rate * dt + r.owed;
    const n = Math.min(r.left, Math.floor(due));
    r.owed = due - n;
    r.left -= n;
    const { minX, maxX, minZ, maxZ } = r.area;
    for (let k = 0; k < n; k++) {
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      const y = r.from(x, z) - Math.random() * 0.3;
      // Knowing roughly what's underneath already (the loft's floor, a stair) keeps it from falling through.
      const below = this.groundAt(x, z, y);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
      // As long as it takes to come down, then a few seconds lying there.
      this.add(new THREE.Vector3(x, y, z), vel, (y - below) / FALL + 3 + Math.random() * 2.5, below + 1.5);
    }
  }

  private add(pos: THREE.Vector3, vel: THREE.Vector3, life: number, look: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    if (!this.bits[i]) this.live++;
    this.bits[i] = {
      life,
      age: 0,
      pos,
      vel,
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10),
      sway: 0.4 + Math.random() * 0.6,
      swayAt: Math.random() * Math.PI * 2,
      ground: NaN,
      look,
      landed: false,
    };
    this.mesh.setColorAt(i, this.c.set(COLORS[Math.floor(Math.random() * COLORS.length)]));
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number) {
    for (const r of this.rains) this.shed(r, dt);
    this.rains = this.rains.filter((r) => r.left > 0);
    if (!this.live) return;
    for (let i = 0; i < MAX; i++) {
      const b = this.bits[i];
      if (!b) continue;
      b.age += dt;
      if (b.age >= b.life) {
        this.bits[i] = null;
        this.live--;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      if (!b.landed) {
        const drag = Math.exp(-DRAG * dt);
        b.vel.x *= drag;
        b.vel.z *= drag;
        if (b.vel.y > 0) b.vel.y = (b.vel.y - GRAVITY * dt) * drag;
        else b.vel.y += (-FALL - b.vel.y) * (1 - Math.exp(-4 * dt));
        b.pos.addScaledVector(b.vel, dt);
        // Falling paper drifts side to side.
        if (b.vel.y < 0) {
          b.pos.x += Math.sin(b.age * 5 * b.sway + b.swayAt) * b.sway * dt;
          b.pos.z += Math.cos(b.age * 4 * b.sway + b.swayAt) * b.sway * dt;
        }
        b.angle += b.spin * dt;
        // Low enough to land: look once at what's underneath (a desk, the counter, the floor).
        if (b.vel.y < 0 && Number.isNaN(b.ground) && b.pos.y < b.look) b.ground = this.groundAt(b.pos.x, b.pos.z, b.pos.y);
        const floor = (Number.isNaN(b.ground) ? 0 : b.ground) + 0.01;
        if (b.pos.y <= floor) {
          b.pos.y = floor;
          b.landed = true;
        }
      }
      // Once down it lies flat, turned whichever way it happened to land.
      if (b.landed) this.q.setFromEuler(this.e.set(-Math.PI / 2, 0, b.swayAt));
      else this.q.setFromAxisAngle(b.axis, b.angle);
      // Shrinks away at the end of its life.
      const left = b.life - b.age;
      this.s.setScalar(left < 0.5 ? left / 0.5 : 1);
      this.mesh.setMatrixAt(i, this.m.compose(b.pos, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.live) this.mesh.visible = false;
  }
}
