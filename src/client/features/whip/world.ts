/**
 * The whip's 3D things: the whip itself, held in your hand (and your character's), and the lash, the
 * thong rolling out from a hand to whoever's being whipped and cracking at the far end.
 */
import * as THREE from 'three';
import { disposeSprite, mesh, textSprite, toon } from '../../world/toon';

/** How far (meters) a lash reaches. */
export const WHIP_REACH = 5;
/** How long a lash takes, start to slack (seconds), and how far into it the tip cracks at the far end. */
export const LASH_TIME = 0.55;
export const CRACK_AT = 0.24;

const LEATHER = '#5b3a21';
const WRAP = '#2b2d42';
const THONG = '#7a4b2a';

/** A whip in hand: its handle, along +y from the grip at the origin, and the thong coiled off its end. */
export interface HeldWhip {
  group: THREE.Group;
  /** The coiled thong, out of sight while a lash has it out. */
  coil: THREE.Object3D;
  /** The end of the handle, where a lash starts from. */
  tip: THREE.Object3D;
}

/** The coils of thong hanging off the end of the handle, in the handle's frame. */
const COIL = [
  [0, 0.24, 0],
  [0.03, 0.27, 0.02],
  [0.06, 0.2, 0.05],
  [0.07, 0.06, 0.05],
  [0.03, -0.06, 0.03],
  [-0.04, -0.09, 0],
  [-0.07, -0.01, -0.01],
  [-0.04, 0.07, 0.02],
  [0.02, 0.07, 0.05],
  [0.06, -0.03, 0.06],
  [0.05, -0.17, 0.04],
  [0.02, -0.3, 0.02],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

export function heldWhip(scale: number): HeldWhip {
  const group = new THREE.Group();
  const leather = toon(LEATHER);
  const wrap = toon(WRAP);
  // A wrapped grip, a knob at the butt and a keeper ring where the thong comes off.
  group.add(mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.24, 10), leather, 0, 0.11, 0, false));
  for (const y of [0.03, 0.07, 0.11, 0.15]) group.add(mesh(new THREE.TorusGeometry(0.02, 0.004, 4, 12).rotateX(Math.PI / 2), wrap, 0, y, 0, false));
  group.add(mesh(new THREE.SphereGeometry(0.026, 10, 8), wrap, 0, -0.012, 0, false));
  group.add(mesh(new THREE.TorusGeometry(0.018, 0.005, 4, 12).rotateX(Math.PI / 2), wrap, 0, 0.232, 0, false));
  const coil = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(COIL), 48, 0.008, 5, false), toon(THONG), 0, 0, 0, false);
  group.add(coil);
  const tip = new THREE.Object3D();
  tip.position.y = 0.24;
  group.add(tip);
  group.scale.setScalar(scale);
  return { group, coil, tip };
}

/** Takes a held whip's meshes apart (the materials are the shared toon ones). */
export function disposeWhip(w: HeldWhip) {
  w.group.removeFromParent();
  w.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

const smooth = (a: number, b: number, x: number) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** How the wrist goes through a lash, `t` seconds in: back (positive) over the shoulder, then snapped forward, then still. */
export function flick(t: number): number {
  if (t < 0.16) return 0.7 * smooth(0, 0.16, t);
  if (t < CRACK_AT) return 0.7 - 1.3 * smooth(0.16, CRACK_AT, t);
  return -0.6 * (1 - smooth(CRACK_AT, LASH_TIME, t));
}

interface Lash {
  /** Where it starts: the hand, wherever that's got to this frame. */
  from: () => THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.Material>;
  cracked: boolean;
}

const POINTS = 18;
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * Lashes going out: the thong arcs up over the shoulder, rolls out toward its target with a wave
 * running down it, cracks there with a 💥, and falls slack as it's drawn back in.
 */
export class Lashes {
  private live: Lash[] = [];
  private pops: { sprite: THREE.Sprite; t: number }[] = [];
  private readonly mat = toon(THONG);

  constructor(private readonly scene: THREE.Object3D) {}

  /** A lash from `from()` (read every frame) to `to`. */
  add(from: () => THREE.Vector3, to: THREE.Vector3) {
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve(from(), to, 0), 40, 0.012, 5, false), this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.live.push({ from, to: to.clone(), t: 0, mesh, cracked: false });
  }

  /** Whether a lash is still out. */
  get busy(): boolean {
    return this.live.length > 0;
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt;
      if (!l.cracked && l.t >= CRACK_AT) {
        l.cracked = true;
        this.pop(l.to);
      }
      if (l.t >= LASH_TIME) {
        l.mesh.removeFromParent();
        l.mesh.geometry.dispose();
        this.live.splice(i, 1);
        continue;
      }
      l.mesh.geometry.dispose();
      l.mesh.geometry = new THREE.TubeGeometry(this.curve(l.from(), l.to, l.t), 40, 0.012, 5, false);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const k = p.t / 0.35;
      p.sprite.scale.setScalar(0.35 + 0.45 * Math.min(1, k * 3));
      p.sprite.material.opacity = 1 - smooth(0.5, 1, k);
      if (k < 1) continue;
      p.sprite.removeFromParent();
      disposeSprite(p.sprite);
      this.pops.splice(i, 1);
    }
  }

  /** The 💥 where the tip cracks. */
  private pop(at: THREE.Vector3) {
    const sprite = textSprite('💥', { size: 64 });
    sprite.position.copy(at);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    this.pops.push({ sprite, t: 0 });
  }

  /** Where the thong is `t` seconds into a lash from `a` to `b`. */
  private curve(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.CatmullRomCurve3 {
    const span = v1.subVectors(b, a);
    const len = Math.max(0.3, span.length());
    side.crossVectors(span, UP).normalize();
    // How far out it's reached, how high it still arcs, the wave running down it, and the slack after.
    const out = 0.12 + 0.88 * smooth(0.02, CRACK_AT, t) - 0.75 * smooth(0.36, LASH_TIME, t);
    const arc = (0.55 + 0.12 * len) * (1 - smooth(0, CRACK_AT, t));
    const wave = 0.16 * (1 - smooth(CRACK_AT, 0.4, t));
    const slack = 0.35 * smooth(CRACK_AT, LASH_TIME, t);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < POINTS; i++) {
      const u = i / (POINTS - 1);
      const bell = Math.sin(Math.PI * u);
      const p = a.clone().addScaledVector(span, u * out);
      p.y += arc * Math.sin(Math.PI * u * 0.85) + wave * Math.sin(2 * Math.PI * (1.5 * u - 3 * t)) * bell - slack * bell;
      p.addScaledVector(side, 0.08 * bell * Math.sin(9 * t));
      // Never two points in the same place, or the tube can't tell which way it's facing.
      p.x += u * 1e-3;
      pts.push(p);
    }
    return new THREE.CatmullRomCurve3(pts);
  }
}
