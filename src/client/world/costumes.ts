import * as THREE from 'three';
import { mesh, toon, toonUnique } from './toon';

/*
 * Holiday costumes (see world/holiday.ts for the decorations): the workers go as zombies for
 * Halloween and elves for Christmas, people wear a warlock's hat or a Santa hat, and the dog gets bat
 * wings and a witch's hat, or antlers and a glowing red nose. Each piece is built here and hung on
 * the model that wears it.
 */

/** What undead skin is mixed toward, for Halloween: a warlock's hands and face. */
export const UNDEAD_SKIN = new THREE.Color('#a3bf98');

const details = new Map<string, THREE.MeshToonMaterial>();
/** A material for small bits (stitches, bells), drawn without the cartoon outline, which would swallow them. */
function detail(color: string): THREE.MeshToonMaterial {
  let m = details.get(color);
  if (!m) {
    m = toonUnique(color);
    m.userData.outlineParameters = { visible: false };
    details.set(color, m);
  }
  return m;
}

const Z = new THREE.Vector3(0, 0, 1);

// ---- The workers --------------------------------------------------------------------------------

/** The worker's bean-shaped body (see Worker): a capsule standing at y 0.4..0.7, 0.28 round. */
const BEAN = { y: 0.55, half: 0.15, r: 0.28 } as const;

/** A point on the bean at height `y`, `a` round from the front (+z; +x is positive), `out` off its surface, and which way is out there. */
function onBean(y: number, a: number, out = 0): { at: THREE.Vector3; normal: THREE.Vector3 } {
  const c = THREE.MathUtils.clamp(y, BEAN.y - BEAN.half, BEAN.y + BEAN.half);
  const dy = y - c;
  const rr = Math.sqrt(Math.max(0, BEAN.r * BEAN.r - dy * dy));
  const normal = new THREE.Vector3(Math.sin(a) * rr, dy, Math.cos(a) * rr).normalize();
  return { at: new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr).addScaledVector(normal, out), normal };
}

/** Lays `m` on the bean at (y, a), its +z pointing out of the surface. */
function stick<T extends THREE.Object3D>(m: T, y: number, a: number, out = 0): T {
  const { at, normal } = onBean(y, a, out);
  m.position.copy(at);
  m.quaternion.setFromUnitVectors(Z, normal);
  return m;
}

/** A stitched-up line over the bean from (y0, a0) to (y1, a1): thread, with cross stitches every so often. */
function stitches(g: THREE.Group, from: [number, number], to: [number, number], crossings: number, wobble = 0) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push(onBean(THREE.MathUtils.lerp(from[0], to[0], k) + Math.sin(k * 9) * wobble, THREE.MathUtils.lerp(from[1], to[1], k), 0.004).at);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const thread = detail('#3b2a2a');
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.009, 5), thread, 0, 0, 0, false));
  const stitch = new THREE.BoxGeometry(0.075, 0.014, 0.014);
  for (let i = 0; i < crossings; i++) {
    const k = (i + 0.5) / crossings;
    const at = curve.getPointAt(k);
    const along = curve.getTangentAt(k);
    const normal = at.clone().setY(at.y - THREE.MathUtils.clamp(at.y, BEAN.y - BEAN.half, BEAN.y + BEAN.half)).normalize();
    const across = new THREE.Vector3().crossVectors(normal, along).normalize();
    const up = new THREE.Vector3().crossVectors(normal, across).normalize();
    const s = mesh(stitch, thread, at.x, at.y, at.z, false);
    s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, normal));
    s.rotateZ(i % 2 ? 0.25 : -0.25);
    g.add(s);
  }
}

/** A zombie's bits, over the worker's own body: a stitched grin and scar, a drooping eyelid, bandages, rot. */
export function zombieWorker(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // A grim stitched mouth across the front, and a scar over the top of the head.
  stitches(g, [0.5, -0.42], [0.5, 0.42], 6, 0.012);
  stitches(g, [0.93, -0.9], [0.82, -0.1], 4);
  // The right eye (the one on +x) half shut under a drooping lid.
  const lid = mesh(new THREE.SphereGeometry(0.098, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0.11, 0.7, 0.235, false);
  lid.scale.set(1.04, 1, 0.64);
  lid.rotation.x = 0.55;
  lid.rotation.z = -0.25;
  g.add(lid);
  // Rotten patches.
  const rot = detail('#4d6b3c');
  for (const [y, a, r] of [
    [0.38, 0.55, 0.06],
    [0.62, -1.95, 0.075],
    [0.84, 2.3, 0.06],
    [0.3, -2.8, 0.05],
  ]) {
    const patch = stick(mesh(new THREE.SphereGeometry(r, 10, 8), rot, 0, 0, 0, false), y, a, -0.012);
    patch.scale.z = 0.3;
    g.add(patch);
  }
  // Grubby bandages round the middle, one wrap coming loose.
  const linen = toon('#e3dcc4');
  for (const [y, tilt, r] of [
    [0.33, 0.22, 0.284],
    [0.4, -0.16, 0.29],
  ]) {
    const wrap = mesh(new THREE.TorusGeometry(r, 0.028, 6, 28), linen, 0, y, 0);
    wrap.rotation.set(Math.PI / 2 + tilt, 0, 0);
    wrap.scale.z = 1.4;
    g.add(wrap);
  }
  const loose = stick(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.012), linen, 0, 0, 0), 0.26, 2.2, 0.01);
  loose.rotateX(0.25);
  g.add(loose);
  g.add(stick(mesh(new THREE.SphereGeometry(0.022, 8, 6), detail('#8f1d21'), 0, 0, 0, false), 0.36, -0.7, 0.03));
  return g;
}

/** An elf's hat, whose pom-pom is the worker's status bulb (it sits right on the tip). */
export function elfHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = mesh(new THREE.TorusGeometry(0.205, 0.05, 8, 28), toon('#fffaf3'), 0, 0.9, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.3, 24), toon('#2e9e48'), 0, 1.05, 0));
  const band = mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 24), toon('#d62828'), 0, 1.0, 0, false);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  return g;
}

/** An elf's pointy ears (in the worker's own color), a jester's collar with bells, and a belt. */
export function elfWorker(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.045, 0.17, 10), skin, sx * 0.27, 0.85, 0.0);
    ear.rotation.set(0, 0, -sx * 1.05);
    g.add(ear);
  }
  const flap = new THREE.ConeGeometry(0.075, 0.15, 4).rotateX(Math.PI).scale(1, 1, 0.35).translate(0, -0.07, 0.01);
  const red = toon('#d62828');
  const green = toon('#2e9e48');
  const gold = detail('#ffc233');
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const f = stick(mesh(flap, i % 2 ? green : red, 0, 0, 0, false), 0.57, a, 0.012);
    f.rotateX(-0.3);
    g.add(f);
    if (i % 2 === 0) g.add(stick(mesh(new THREE.SphereGeometry(0.022, 8, 6), gold, 0, 0, 0, false), 0.43, a, 0.045));
  }
  const belt = mesh(new THREE.TorusGeometry(0.273, 0.03, 6, 28), toon('#2b2d42'), 0, 0.3, 0, false);
  belt.rotation.x = Math.PI / 2;
  g.add(belt);
  g.add(stick(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.02), detail('#ffc233'), 0, 0, 0, false), 0.3, 0, 0.03));
  g.add(stick(mesh(new THREE.BoxGeometry(0.055, 0.035, 0.02), detail('#2b2d42'), 0, 0, 0, false), 0.3, 0, 0.037));
  return g;
}

/** A curly-toed elf boot with a bell on the toe, for a worker's foot (its capsule's middle is 0,0,0). */
export function elfBoot(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const sole = mesh(new THREE.SphereGeometry(0.075, 12, 8), red, 0, -0.06, 0.02);
  sole.scale.set(1, 0.65, 1.3);
  g.add(sole);
  const toe = new THREE.Group();
  toe.position.set(0, -0.06, 0.09);
  toe.rotation.x = -0.75;
  toe.add(mesh(new THREE.ConeGeometry(0.04, 0.13, 8).rotateX(Math.PI / 2).translate(0, 0, 0.06), red, 0, 0, 0, false));
  toe.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), detail('#ffc233'), 0, 0, 0.135, false));
  g.add(toe);
  return g;
}

// ---- People -------------------------------------------------------------------------------------

/** A tall, crooked warlock's hat for a person's head (its middle is 0,0,0, 0.34 round; the face looks down +z). */
export function warlockHat(): THREE.Group {
  const g = new THREE.Group();
  const felt = toon('#2d1b3d');
  g.add(mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.03, 32), felt, 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.31, 0.42, 24), felt, 0, 0.46, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.305, 0.312, 0.08, 24), toon('#ff7b00'), 0, 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.11, 0.08, 0.02), detail('#ffd166'), 0, 0.3, 0.315, false));
  const bend = new THREE.Group();
  bend.position.set(0, 0.66, 0);
  bend.rotation.set(-0.55, 0, 0.25);
  bend.add(mesh(new THREE.ConeGeometry(0.13, 0.36, 20), felt, 0, 0.17, 0));
  g.add(bend);
  g.rotation.x = -0.15;
  return g;
}

/** A floppy Santa hat for a person's head. */
export function santaHat(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const fur = toon('#fffaf3');
  const brim = mesh(new THREE.TorusGeometry(0.31, 0.075, 10, 30), fur, 0, 0.21, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.31, 0.3, 24), red, 0, 0.36, 0));
  const flop = new THREE.Group();
  flop.position.set(0, 0.5, 0);
  flop.rotation.set(-0.35, 0, -1.05);
  flop.add(mesh(new THREE.ConeGeometry(0.17, 0.4, 20), red, 0, 0.18, 0));
  flop.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), fur, 0, 0.4, 0));
  g.add(flop);
  g.rotation.x = -0.15;
  return g;
}

// ---- The dog ------------------------------------------------------------------------------------

/** A bat wing, root at 0,0,0, reaching out along +x (its leading edge toward +z, the dog's head). */
export function batWingGeometry(span: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.05);
  s.lineTo(0.4, 0.13);
  s.lineTo(1, 0.1);
  s.quadraticCurveTo(0.86, 0, 0.78, -0.12);
  s.quadraticCurveTo(0.66, -0.02, 0.52, -0.14);
  s.quadraticCurveTo(0.4, -0.04, 0.26, -0.13);
  s.quadraticCurveTo(0.14, -0.04, 0, -0.08);
  s.closePath();
  return new THREE.ShapeGeometry(s, 6).rotateX(Math.PI / 2).scale(span, 1, span);
}

/** Bat wings on the dog's back (a torso-local group), and the pivots that flap them. */
export function dogBatWings(): { group: THREE.Group; wings: THREE.Object3D[] } {
  const group = new THREE.Group();
  const mat = toonUnique('#2b1d3a');
  mat.side = THREE.DoubleSide;
  const geo = batWingGeometry(0.42);
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.07, 0.17, 0.26);
    const w = mesh(geo, mat, 0, 0, 0);
    w.scale.x = sx;
    pivot.add(w);
    group.add(pivot);
    wings.push(pivot);
  }
  return { group, wings };
}

/** A little witch's hat between the dog's ears (head-local). */
export function dogWitchHat(): THREE.Group {
  const g = new THREE.Group();
  const felt = toon('#3c1f5c');
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24), felt, 0, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.066, 0.068, 0.03, 16), toon('#ff7b00'), 0, 0.02, 0, false));
  const tip = new THREE.Group();
  tip.position.y = 0.03;
  tip.rotation.set(-0.35, 0, 0.2);
  tip.add(mesh(new THREE.ConeGeometry(0.066, 0.2, 16), felt, 0, 0.1, 0));
  g.add(tip);
  g.position.set(0, 0.13, -0.02);
  g.rotation.set(-0.2, 0, 0.15);
  return g;
}

/** Reindeer antlers (head-local). */
export function dogAntlers(): THREE.Group {
  const g = new THREE.Group();
  const horn = toon('#8b5a2b');
  const tine = (len: number) => new THREE.CapsuleGeometry(0.012, len, 4, 6).translate(0, len / 2, 0);
  for (const sx of [-1, 1]) {
    const beam = new THREE.Group();
    beam.position.set(sx * 0.06, 0.11, -0.01);
    beam.rotation.set(-0.25, 0, -sx * 0.45);
    beam.add(mesh(tine(0.16), horn, 0, 0, 0));
    const front = mesh(tine(0.06), horn, 0, 0.07, 0);
    front.rotation.x = 0.95;
    beam.add(front);
    const out = mesh(tine(0.055), horn, 0, 0.13, 0);
    out.rotation.z = -sx * 0.8;
    beam.add(out);
    g.add(beam);
  }
  return g;
}

/** Rudolph's nose, which glows (head-local, over the dog's own). */
export function dogRedNose(): { nose: THREE.Mesh; glow: THREE.MeshToonMaterial } {
  const glow = toonUnique('#ff3030');
  glow.emissive.set('#ff1a1a');
  glow.emissiveIntensity = 0.8;
  return { nose: mesh(new THREE.SphereGeometry(0.04, 12, 10), glow, 0, -0.005, 0.225, false), glow };
}

/** A red scarf round the dog's neck, over its collar, one end hanging down its chest (head-local). */
export function dogScarf(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  // Where the collar is, and turned the way it is.
  const knit = mesh(new THREE.TorusGeometry(0.1, 0.042, 8, 20), red, 0, -0.11, -0.05);
  knit.rotation.x = Math.PI / 2 + 0.5;
  g.add(knit);
  const end = new THREE.Group();
  end.position.set(0.075, -0.15, 0.0);
  end.rotation.set(0.35, 0.5, 0.12);
  end.add(mesh(new THREE.BoxGeometry(0.055, 0.15, 0.025), red, 0, -0.07, 0));
  for (let i = 0; i < 2; i++) end.add(mesh(new THREE.BoxGeometry(0.057, 0.02, 0.027), toon('#fffaf3'), 0, -0.07 - i * 0.05, 0, false));
  g.add(end);
  return g;
}

// ---- Your hands (first person) ------------------------------------------------------------------

/** An open sleeve end flaring out toward the hand, in rags (along -z, like the hands' arms). */
export function raggedCuff(mat: THREE.Material): THREE.Mesh {
  const n = 16;
  const geo = new THREE.CylinderGeometry(0.066, 0.1, 0.15, n, 2, true).rotateX(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > -0.07) continue;
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * n);
    pos.setZ(i, pos.getZ(i) + (k % 2 ? 0.045 : k % 3 ? 0.012 : 0));
  }
  geo.computeVertexNormals();
  return mesh(geo, mat, 0, 0, 0.11, false);
}

/**
 * An undead warlock's hand, in camera space like the hands' own (-z is forward): a bony grey-green
 * palm, long crooked fingers with black claws, and a thumb on the inside (`side` is 1 for the right).
 */
export function warlockHand(side: 1 | -1, skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const palm = mesh(new THREE.SphereGeometry(0.054, 18, 12), skin, 0, 0, 0, false);
  palm.scale.set(1, 0.62, 1.2);
  g.add(palm);
  const claw = detail('#1e1522');
  const knuckle = new THREE.SphereGeometry(0.013, 8, 6);
  const bone = (len: number) => new THREE.CapsuleGeometry(0.0092, len, 4, 8).rotateX(Math.PI / 2).translate(0, 0, -len / 2);
  const tip = new THREE.ConeGeometry(0.0095, 0.038, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.019);
  const fingers: [number, number][] = [
    [-0.032, 0.056],
    [-0.011, 0.064],
    [0.011, 0.06],
    [0.031, 0.046],
  ];
  for (const [fx, len] of fingers) {
    const x = fx * side;
    g.add(mesh(knuckle, skin, x, 0.02, -0.052, false));
    const base = new THREE.Group();
    base.position.set(x, 0.01, -0.058);
    base.rotation.set(-0.2, x * 2.2, 0);
    base.add(mesh(bone(len), skin, 0, 0, 0, false));
    const joint = new THREE.Group();
    joint.position.z = -len;
    joint.rotation.x = -0.55;
    joint.add(mesh(knuckle, skin, 0, 0, 0, false));
    joint.add(mesh(bone(len * 0.8), skin, 0, 0, 0, false));
    const nail = new THREE.Group();
    nail.position.z = -len * 0.8;
    nail.rotation.x = -0.4;
    nail.add(mesh(tip, claw, 0, 0, 0, false));
    joint.add(nail);
    base.add(joint);
    g.add(base);
  }
  // The thumb, on the inside of the hand.
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.045, -0.004, -0.02);
  thumb.rotation.set(-0.1, side * 0.75, 0);
  thumb.add(mesh(bone(0.04), skin, 0, 0, 0, false));
  const tnail = new THREE.Group();
  tnail.position.z = -0.04;
  tnail.rotation.x = -0.35;
  tnail.add(mesh(tip, claw, 0, 0, 0, false));
  thumb.add(tnail);
  g.add(thumb);
  return g;
}

let glow: THREE.CanvasTexture | null = null;

/** Soft round blob, for glows: one texture, shared by everything that glows (so dressing up again doesn't make another). */
export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(c));
}

/** Green witch-fire swirling round a warlock's hand: points to move each frame (see Hands.update). */
export function witchFire(count: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  // Drawn over what's behind, not added to it, so it stays green over a bright floor.
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#5dff2e', size: 0.03, map: glowTexture(), transparent: true, opacity: 0.85, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}
