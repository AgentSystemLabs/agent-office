import * as THREE from 'three';
import type { Theme } from '../../../shared/protocol';
import { santaHat, warlockHat } from '../costumes';
import { mesh, toon, toonUnique } from '../toon';
import { undress } from './props';
import type { PersonRig } from './rig';

// A person dressed for a holiday, head to toe, to match the hands you see in first person (see
// world/hands.ts): for Halloween a warlock's hat and a purple robe with a ragged hem, a sash, dark
// trousers and pointed boots; for Christmas a Santa hat and suit, white fur trim, a black belt with a
// gold buckle, black boots and green mittens. It goes on over their own clothes (each piece a little
// bigger than what it covers), hung off the parts it moves with: the torso and legs (which you see
// looking down in first person, see person-first.ts), the arms and the head.

/** Where things are on a person (see Person's constructor): the torso's middle, and down an arm or a leg. */
const TORSO_Y = 0.72;
const LIMB_MID = -0.16;
const HAND = -0.38;
const FOOT = -0.36;

/** A tube, open at both ends, `top` to `bottom` round, its hem cut ragged into `teeth` points. */
function raggedSkirt(top: number, bottom: number, height: number, teeth: number, mat: THREE.Material): THREE.Mesh {
  const n = teeth * 2;
  const geo = new THREE.CylinderGeometry(top, bottom, height, n, 2, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > -height / 2 + 0.001) continue;
    const k = Math.round(((Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI) / (Math.PI * 2)) * n);
    pos.setY(i, pos.getY(i) + (k % 2 ? 0.07 : k % 3 ? 0.02 : 0));
  }
  geo.computeVertexNormals();
  return mesh(geo, mat);
}

/** A capsule over a limb, from its pivot down, a little rounder than it. */
const sleeve = (r: number, mat: THREE.Material) => mesh(new THREE.CapsuleGeometry(r, 0.24, 4, 10), mat, 0, LIMB_MID, 0);

/** A band round something, `r` round, at `y`. */
function band(r: number, h: number, mat: THREE.Material, y: number): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(r, r, h, 24), mat, 0, y, 0);
}

/** A ring of fur round something, `r` round, at `y`. */
function fur(r: number, tube: number, y: number): THREE.Mesh {
  const m = mesh(new THREE.TorusGeometry(r, tube, 8, 24), toon('#fffaf3'), 0, y, 0);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** What a person has on for a holiday (see set), and taking it off again. */
export class HolidayOutfit {
  private parts: THREE.Object3D[] = [];

  constructor(private rig: PersonRig) {}

  /** Dresses them for `theme`, or back in their own clothes (null). */
  set(theme: Theme | null) {
    undress(this.parts);
    if (theme === 'halloween') this.warlock();
    else if (theme === 'christmas') this.santa();
    for (const p of this.parts) p.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  }

  /** Hangs `o` off `on`. */
  private put(on: THREE.Object3D, o: THREE.Object3D) {
    on.add(o);
    this.parts.push(o);
  }

  /** The torso's own mesh, which slims in first person: what goes round it goes on it. */
  private get torso(): THREE.Object3D {
    return this.rig.torso;
  }

  private warlock() {
    const { head, armL, armR, legL, legR } = this.rig;
    const robe = toon('#3b1d5a');
    // Its own material: double-sided, which toon's shared one for this colour mustn't become.
    const rags = toonUnique('#24123a');
    rags.side = THREE.DoubleSide;
    this.put(head, warlockHat());
    this.put(this.torso, mesh(new THREE.CapsuleGeometry(0.272, 0.28, 6, 14), robe));
    // The robe's skirt, down to the shins, ragged at the hem.
    const skirt = raggedSkirt(0.27, 0.36, 0.42, 9, rags);
    skirt.position.y = 0.34 - TORSO_Y;
    this.put(this.torso, skirt);
    this.put(this.torso, band(0.28, 0.06, toon('#ff7b00'), 0.6 - TORSO_Y));
    for (const arm of [armL, armR]) {
      this.put(arm, sleeve(0.09, robe));
      const cuff = raggedSkirt(0.09, 0.115, 0.1, 5, rags);
      cuff.position.y = HAND + 0.07;
      this.put(arm, cuff);
    }
    for (const leg of [legL, legR]) {
      this.put(leg, sleeve(0.106, rags));
      // A pointed boot, its toe curled up.
      const boot = new THREE.Group();
      boot.position.y = FOOT;
      boot.add(mesh(new THREE.SphereGeometry(0.11, 12, 10), toon('#1d1d1d'), 0, 0, 0.02));
      const toe = mesh(new THREE.ConeGeometry(0.06, 0.2, 10), toon('#1d1d1d'), 0, 0.03, 0.16);
      toe.rotation.x = Math.PI / 2 - 0.35;
      boot.add(toe);
      this.put(leg, boot);
    }
  }

  private santa() {
    const { head, armL, armR, legL, legR } = this.rig;
    const red = toon('#d62828');
    this.put(head, santaHat());
    this.put(this.torso, mesh(new THREE.CapsuleGeometry(0.272, 0.28, 6, 14), red));
    // White fur round the jacket's hem and down its front.
    this.put(this.torso, fur(0.27, 0.05, 0.4 - TORSO_Y));
    this.put(this.torso, mesh(new THREE.BoxGeometry(0.08, 0.5, 0.04), toon('#fffaf3'), 0, 0.74 - TORSO_Y, 0.262));
    this.put(this.torso, band(0.282, 0.075, toon('#1d1d1d'), 0.58 - TORSO_Y));
    this.put(this.torso, mesh(new THREE.BoxGeometry(0.11, 0.09, 0.03), toon('#ffd166'), 0, 0.58 - TORSO_Y, 0.285));
    for (const arm of [armL, armR]) {
      this.put(arm, sleeve(0.09, red));
      this.put(arm, fur(0.09, 0.035, HAND + 0.08));
      this.put(arm, mesh(new THREE.SphereGeometry(0.095, 12, 10), toon('#2a9d4b'), 0, HAND, 0));
    }
    for (const leg of [legL, legR]) {
      this.put(leg, sleeve(0.106, red));
      const boot = new THREE.Group();
      boot.position.y = FOOT;
      boot.add(mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.16, 14), toon('#1d1d1d'), 0, 0.03, 0));
      boot.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), toon('#1d1d1d'), 0, -0.03, 0.07));
      this.put(leg, boot);
    }
  }
}
