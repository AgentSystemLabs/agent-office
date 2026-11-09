import * as THREE from 'three';
import type { Subagent } from '../../../shared/protocol';
import { cardSprite, disposeSprite, mesh, textSprite, toon, toonUnique } from '../toon';

/** A subagent's colour: its own, picked from its id, so the same one keeps its colour. */
const COLORS = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];

export function subagentColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

/**
 * A subagent: a small helper of a worker or a visitor, standing by it while it runs, with what it's
 * on over its head. Built like the Worker (a bean with a status light), smaller and without the
 * headset, so it never passes for one. Forward is +z.
 */
export class SubagentFigure {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private tag: THREE.Sprite | null = null;
  private tagKey = '';
  private arms: THREE.Object3D[] = [];
  private eyes: THREE.Mesh[] = [];
  private phase = Math.random() * Math.PI * 2;
  private popT = 0;
  private blinkAt = 1 + Math.random() * 3;

  constructor(color: string) {
    const skin = toonUnique(color);
    const white = toon('#ffffff');
    const ink = toon('#1d1d1d');
    this.root.add(this.body);
    this.body.add(mesh(new THREE.CapsuleGeometry(0.28, 0.3, 8, 16), skin, 0, 0.55, 0));
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.09, 12, 10), white, sx * 0.11, 0.7, 0.23, false);
      eye.scale.z = 0.6;
      const pupil = mesh(new THREE.SphereGeometry(0.045, 10, 8), ink, sx * 0.11, 0.7, 0.29, false);
      this.body.add(eye, pupil);
      this.eyes.push(eye, pupil);
      const arm = new THREE.Group();
      arm.position.set(sx * 0.3, 0.55, 0.05);
      arm.add(mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), skin, 0, -0.12, 0));
      this.body.add(arm);
      this.arms.push(arm);
      this.body.add(mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05));
    }
    // A short antenna with a working light: a subagent only exists while it works.
    this.body.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), ink, 0, 1.0, 0, false));
    const bulb = toonUnique('#ffd166');
    bulb.emissive = new THREE.Color('#ffd166').multiplyScalar(0.7);
    this.body.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), bulb, 0, 1.1, 0, false));
    this.root.scale.setScalar(0.001);
  }

  /** What it's on, on a card over its head: its kind on the chip, what it was asked to do, and its latest tool call. */
  setLabel(kind: string, title: string, doing?: string) {
    const key = `${kind}|${title}|${doing ?? ''}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    if (this.tag) {
      this.root.remove(this.tag);
      disposeSprite(this.tag);
    }
    this.tag = cardSprite({ chip: { text: kind, bg: '#ffd166', color: '#2b2d42' }, title, body: doing, bg: '#fffaf3', maxWidth: 340 });
    this.tag.position.y = 1.3;
    this.root.add(this.tag);
  }

  /** Pops in, then bobs and waves its arms about as it works. */
  update(dt: number, t: number, size: number) {
    this.popT = Math.min(1, this.popT + dt * 3);
    const pop = 1 - Math.pow(1 - this.popT, 3);
    this.root.scale.setScalar(Math.max(0.001, size * pop));
    const p = t * 5 + this.phase;
    this.body.position.y = Math.abs(Math.sin(p)) * 0.06;
    this.body.rotation.z = Math.sin(p * 0.5) * 0.06;
    this.arms[0].rotation.x = -0.6 + Math.sin(p) * 0.5;
    this.arms[1].rotation.x = -0.6 - Math.sin(p) * 0.5;
    this.blinkAt -= dt;
    const shut = this.blinkAt < 0;
    for (const e of this.eyes) e.scale.y = shut ? 0.15 : 1;
    if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 3;
  }

  dispose() {
    if (this.tag) disposeSprite(this.tag);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** What a subagent's chip says it is. */
export function subagentKind(s: Pick<Subagent, 'type' | 'phase'>): string {
  if (s.type === 'workflow-subagent') return `🔀 ${s.phase ?? 'workflow'}`.toUpperCase();
  if (s.type === 'Explore') return '🔎 EXPLORE';
  if (s.type === 'Plan') return '📐 PLAN';
  if (s.type === 'general-purpose') return '🤖 AGENT';
  return `🤖 ${s.type}`.toUpperCase();
}

/**
 * Subagents standing together under `parent`, the i-th at `spot(i)` (x, z, and the way it faces),
 * kept in step with a list: new ones pop in, finished ones go, and past what's shown a sign says how
 * many more there are.
 */
export class SubagentCrowd {
  private figures = new Map<string, SubagentFigure>();
  private more: THREE.Sprite | null = null;
  private moreN = 0;

  constructor(
    readonly parent: THREE.Object3D,
    private spot: (i: number) => readonly [x: number, z: number, rotY: number],
    private size: number,
  ) {}

  get count(): number {
    return this.figures.size;
  }

  sync(list: readonly Subagent[], more: number) {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, f] of this.figures) {
      if (ids.has(id)) continue;
      f.root.removeFromParent();
      f.dispose();
      this.figures.delete(id);
    }
    list.forEach((s, i) => {
      let f = this.figures.get(s.id);
      if (!f) {
        f = new SubagentFigure(subagentColor(s.id));
        this.parent.add(f.root);
        this.figures.set(s.id, f);
      }
      const [x, z, rotY] = this.spot(i);
      f.root.position.set(x, 0, z);
      f.root.rotation.y = rotY;
      f.setLabel(subagentKind(s), s.title ?? s.type, s.activity);
    });
    if (more !== this.moreN) {
      this.moreN = more;
      if (this.more) {
        this.more.removeFromParent();
        disposeSprite(this.more);
        this.more = null;
      }
      if (more > 0) {
        this.more = textSprite(`+${more} more`, { bg: '#ffd166', size: 30 });
        const [x, z] = this.spot(list.length);
        this.more.position.set(x, 0.6, z);
        this.parent.add(this.more);
      }
    }
  }

  update(dt: number, t: number) {
    for (const f of this.figures.values()) f.update(dt, t, this.size);
  }

  dispose() {
    this.sync([], 0);
  }
}
