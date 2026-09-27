import * as THREE from 'three';
import { BARK_EVERY_S, BARK_FOR_S, DOG_COATS, dogAt, legSeconds, type DogAct, type DogState } from '../../shared/dog';
import type { Interactable } from './office';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from './toon';

export interface DogSounds {
  bark(x: number, z: number, times: number): void;
  /** A happy little yip, when someone pets it. */
  yip(x: number, z: number): void;
}

/** What the body eases toward for each thing it does. */
interface Pose {
  /** How far the whole dog sinks toward the floor. */
  drop: number;
  /** How far the front end tips up, sitting. */
  sit: number;
  /** Front legs swung forward (lying down). */
  front: number;
  /** Back legs folded forward under it. */
  rear: number;
  /** Head tipped down (+) or up (-). */
  nod: number;
  /** Eyes open (1) or shut (0). */
  eyes: number;
  /** How far back the tail leans from straight up. */
  tail: number;
}

const POSES: Record<DogAct | 'walk', Pose> = {
  walk: { drop: 0, sit: 0, front: 0, rear: 0, nod: 0, eyes: 1, tail: 0.8 },
  stand: { drop: 0, sit: 0, front: 0, rear: 0, nod: 0, eyes: 1, tail: 0.8 },
  wag: { drop: 0, sit: 0, front: 0, rear: 0, nod: -0.15, eyes: 1, tail: 0.55 },
  sniff: { drop: 0, sit: 0, front: 0, rear: 0, nod: 0.75, eyes: 1, tail: 0.7 },
  sit: { drop: 0.13, sit: 0.55, front: 0, rear: 1.35, nod: 0, eyes: 1, tail: 1.5 },
  bark: { drop: 0.13, sit: 0.55, front: 0, rear: 1.35, nod: -0.3, eyes: 1, tail: 1.1 },
  lie: { drop: 0.19, sit: 0, front: 1.45, rear: 1.25, nod: 0.1, eyes: 1, tail: 1.45 },
  nap: { drop: 0.19, sit: 0, front: 1.45, rear: 1.25, nod: 0.45, eyes: 0, tail: 1.6 },
};

/** Where the torso hinges (at the back hips), above the floor when standing. */
const HIP_Y = 0.3;
const HIP_Z = -0.17;
/** The front shoulders, from the hinge. */
const SHOULDER: [number, number] = [-0.02, 0.53];
const LEG = 0.27;

/**
 * The office dog, as everyone on the floor sees it: a chunky cartoon pup that walks where the server
 * says (see shared/dog.ts), sits, lies down, naps with its head on its paws, sniffs, barks at a
 * worker that needs input and wags when it's petted. Forward is +z.
 */
export class Dog {
  readonly root = new THREE.Group();
  readonly interactable: Interactable = { kind: 'dog', x: 0, z: 0, radius: 1.5 };
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private tail = new THREE.Group();
  private legs: { front: THREE.Group[]; rear: THREE.Group[] } = { front: [], rear: [] };
  private ears: THREE.Group[] = [];
  private eyes: THREE.Mesh[] = [];
  private coatMats: [THREE.MeshToonMaterial, THREE.MeshToonMaterial, THREE.MeshToonMaterial];
  private coat = -1;
  private tag: THREE.Sprite | null = null;
  private tagName = '';
  private bubble: { sprite: THREE.Sprite; kind: string; until: number } | null = null;

  private state: DogState | null = null;
  /** performance.now() when the current leg began. */
  private start = 0;
  private arriveAt = 0;
  private nextBark = 0;
  private barks = 0;
  private pose: Pose = { ...POSES.lie };
  private phase = 0;
  /** Seconds since the last woof, for the jaw and the hop. */
  private woofT = 9;
  private t = 0;
  private placed = false;

  constructor(
    private sounds: DogSounds,
    /** Someone already has this worker's terminal open, so there's no one to bark for. */
    private hushed: (workerId: string) => boolean,
  ) {
    this.coatMats = [toonUnique(DOG_COATS[0][0]), toonUnique(DOG_COATS[0][1]), toonUnique(DOG_COATS[0][2])];
    this.build();
    this.root.visible = false;
    this.root.userData.interact = this.interactable;
  }

  /** Nothing to pet in a building without floors. */
  get interactables(): Interactable[] {
    return this.state ? [this.interactable] : [];
  }

  get name(): string {
    return this.state?.name ?? '';
  }

  /** A new leg of its day from the server; `start` is when it began, on performance.now()'s clock. */
  sync(state: DogState | null, start: number) {
    this.state = state;
    this.start = start;
    this.root.visible = !!state;
    if (!state) {
      this.placed = false;
      return;
    }
    if (state.coat !== this.coat) {
      this.coat = state.coat;
      DOG_COATS[state.coat % DOG_COATS.length].forEach((c, i) => this.coatMats[i].color.set(c));
    }
    if (state.name !== this.tagName) this.setTag(state.name);
    this.arriveAt = start + legSeconds(state) * 1000;
    // The next woof on its schedule (a page opened halfway through picks up where it's at).
    const since = (performance.now() - this.arriveAt) / 1000;
    const k = since <= 0.3 ? 0 : Math.ceil(since / BARK_EVERY_S);
    this.nextBark = this.arriveAt + k * BARK_EVERY_S * 1000;
    this.barks = k;
    // Just petted (not a pat from before this page loaded).
    if (state.act === 'wag' && state.petBy && performance.now() - start < 1000) {
      const p = dogAt(state, 0);
      this.sounds.yip(p.x, p.z);
      this.say('wag', '❤️', 2.2);
    }
  }

  /** What it's up to, for the hint bar: "napping under Ada's desk". */
  doing(workerName: (id: string) => string | undefined, personName: (id: string) => string | undefined): string {
    const s = this.state;
    if (!s) return '';
    const moving = performance.now() < this.arriveAt;
    const w = s.workerId ? (workerName(s.workerId) ?? 'a worker') : 'a worker';
    if (s.following) return `following ${personName(s.following) ?? 'someone'}`;
    switch (s.act) {
      case 'bark':
        return moving ? `running to ${w}, who needs input` : `barking at ${w}: needs input`;
      case 'nap':
        return moving ? 'off for a nap' : `napping under ${w}'s desk`;
      case 'wag':
        return s.petBy ? `wagging at ${s.petBy}` : 'wagging';
      case 'lie':
        return moving ? 'trotting to the lounge' : 'lounging';
      case 'sniff':
        return moving ? 'trotting about' : 'sniffing around';
      case 'sit':
        return 'sitting';
      default:
        return '';
    }
  }

  update(dt: number) {
    const s = this.state;
    if (!s) return;
    this.t += dt;
    const now = performance.now();
    const at = dogAt(s, (now - this.start) / 1000);
    const pos = this.root.position;
    if (!this.placed || Math.hypot(pos.x - at.x, pos.z - at.z) > 3) {
      pos.set(at.x, 0, at.z);
      this.root.rotation.y = at.heading;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      pos.x += (at.x - pos.x) * k;
      pos.z += (at.z - pos.z) * k;
      let turn = at.heading - this.root.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.root.rotation.y += turn * (1 - Math.exp(-dt * 9));
    }
    this.interactable.x = pos.x;
    this.interactable.z = pos.z;

    // Woof, on schedule, while nobody's seeing to the worker yet.
    if (!at.moving && s.act === 'bark' && s.workerId && now >= this.nextBark && now - this.arriveAt < BARK_FOR_S * 1000) {
      if (!this.hushed(s.workerId)) {
        this.sounds.bark(at.x, at.z, this.barks === 0 ? 3 : 2);
        this.woofT = 0;
        this.say('woof', this.barks === 0 ? 'Woof! Woof! Woof!' : 'Woof! Woof!', 1.4);
      }
      this.barks++;
      this.nextBark = this.arriveAt + this.barks * BARK_EVERY_S * 1000;
    }
    this.woofT += dt;
    this.animate(dt, at.moving ? 'walk' : s.act, at.moving ? s.speed : 0);
  }

  // ---- The model ----------------------------------------------------------------------------------

  private build() {
    const [fur, light, ear] = this.coatMats;
    const ink = toon('#1d1d1d');
    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.torso.position.set(0, HIP_Y, HIP_Z);

    const body = mesh(new THREE.CapsuleGeometry(0.15, 0.3, 6, 14), fur, 0, 0.05, 0.19);
    body.rotation.x = Math.PI / 2;
    this.torso.add(body);
    const chest = mesh(new THREE.SphereGeometry(0.12, 14, 10), light, 0, 0.0, 0.4);
    chest.scale.set(1, 1.05, 0.7);
    this.torso.add(chest);

    // Head, looking down +z: a round head, a long muzzle, floppy ears.
    this.head.position.set(0, 0.26, 0.46);
    this.torso.add(this.head);
    this.head.add(mesh(new THREE.SphereGeometry(0.14, 18, 14), fur));
    const muzzle = mesh(new THREE.SphereGeometry(0.075, 14, 10), light, 0, -0.035, 0.12);
    muzzle.scale.set(1, 0.85, 1.35);
    this.head.add(muzzle);
    this.head.add(mesh(new THREE.SphereGeometry(0.032, 10, 8), ink, 0, -0.005, 0.22, false));
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.026, 10, 8), ink, sx * 0.062, 0.035, 0.115, false);
      this.eyes.push(eye);
      this.head.add(eye);
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.105, 0.08, -0.01);
      const flap = mesh(new THREE.CapsuleGeometry(0.045, 0.1, 4, 8), ear, 0, -0.08, 0);
      flap.scale.set(0.55, 1, 1);
      pivot.add(flap);
      pivot.rotation.z = sx * 0.3;
      this.ears.push(pivot);
      this.head.add(pivot);
    }
    // The jaw drops open to bark and to pant; the tongue shows when it's happy.
    this.jaw.position.set(0, -0.075, 0.07);
    const chin = mesh(new THREE.SphereGeometry(0.055, 12, 8), light, 0, -0.01, 0.07);
    chin.scale.set(1, 0.5, 1.3);
    this.jaw.add(chin);
    const tongue = mesh(new THREE.SphereGeometry(0.03, 10, 8), toon('#ff7f9a'), 0, 0.005, 0.12, false);
    tongue.scale.set(1, 0.4, 1.4);
    this.jaw.add(tongue);
    this.head.add(this.jaw);
    const collar = mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 18), toon('#ef476f'), 0, -0.11, -0.05, false);
    collar.rotation.x = Math.PI / 2 + 0.5;
    this.head.add(collar);

    // Tail, up and back from the hips.
    this.tail.position.set(0, 0.13, -0.09);
    this.tail.add(mesh(new THREE.CapsuleGeometry(0.03, 0.18, 4, 8), fur, 0, 0.11, 0));
    this.torso.add(this.tail);

    const leg = (parent: THREE.Group, x: number, y: number, z: number, r: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, LEG - 2 * r - 0.03, 4, 8), fur, 0, -(LEG - 0.03) / 2, 0));
      const paw = mesh(new THREE.SphereGeometry(0.052, 10, 8), light, 0, -LEG + 0.03, 0.02);
      paw.scale.set(1, 0.7, 1.25);
      pivot.add(paw);
      parent.add(pivot);
      return pivot;
    };
    for (const sx of [-1, 1]) {
      this.legs.front.push(leg(this.torso, sx * 0.085, SHOULDER[0], SHOULDER[1], 0.045));
      this.legs.rear.push(leg(this.hips, sx * 0.095, HIP_Y + SHOULDER[0], HIP_Z, 0.055));
    }
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  }

  private setTag(name: string) {
    this.tagName = name;
    if (this.tag) {
      this.root.remove(this.tag);
      disposeSprite(this.tag);
    }
    this.tag = textSprite(`🐶 ${name}`, { bg: '#fffaf3', size: 30 });
    this.tag.position.y = 1.0;
    this.root.add(this.tag);
  }

  /** A bubble over its head for a moment: "Woof!", ❤️, 💤. */
  private say(kind: string, text: string, seconds: number) {
    if (this.bubble?.kind === kind && this.bubble.sprite.userData.text === text) {
      this.bubble.until = this.t + seconds;
      return;
    }
    this.hush();
    const sprite = textSprite(text, { bg: kind === 'woof' ? '#ffd6e0' : '#ffffff', size: 34 });
    sprite.userData.text = text;
    this.root.add(sprite);
    this.bubble = { sprite, kind, until: this.t + seconds };
  }

  private hush() {
    if (!this.bubble) return;
    this.root.remove(this.bubble.sprite);
    disposeSprite(this.bubble.sprite);
    this.bubble = null;
  }

  private animate(dt: number, act: DogAct | 'walk', speed: number) {
    const target = POSES[act];
    const k = 1 - Math.exp(-dt * 7);
    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] += (target[key] - p[key]) * k;
    const t = this.t;

    // Gait: a trot, diagonal legs together, faster the faster it goes.
    const walking = act === 'walk';
    if (walking) this.phase += dt * (5 + speed * 4.5);
    const stride = walking ? Math.min(0.9, 0.35 + speed * 0.18) : 0;
    const swing = Math.sin(this.phase) * stride;
    const hop = this.woofT < 0.25 ? Math.sin((this.woofT / 0.25) * Math.PI) * 0.05 : 0;
    this.hips.position.y = -p.drop + (walking ? Math.abs(Math.sin(this.phase)) * 0.035 : 0) + hop;
    this.torso.rotation.x = -p.sit + (walking ? Math.sin(this.phase * 2) * 0.03 : 0);

    // Front legs stay upright when it sits (and stretch to reach the floor); lying, they reach forward.
    const shoulderY = HIP_Y - p.drop + SHOULDER[0] * Math.cos(p.sit) + SHOULDER[1] * Math.sin(p.sit);
    const reach = THREE.MathUtils.clamp(shoulderY / (HIP_Y + SHOULDER[0]), 0.3, 2);
    const [fl, fr] = this.legs.front;
    const [rl, rr] = this.legs.rear;
    fl.rotation.x = p.sit - p.front + swing;
    fr.rotation.x = p.sit - p.front - swing;
    for (const f of this.legs.front) f.scale.y = THREE.MathUtils.lerp(reach, 1, Math.min(1, p.front / POSES.lie.front));
    rl.rotation.x = -p.rear - swing;
    rr.rotation.x = -p.rear + swing;

    // Head: level when sitting, down to sniff (with a busy little bob), resting on its paws asleep.
    const sniffing = act === 'sniff';
    this.head.rotation.x = p.sit * 0.85 + p.nod + (sniffing ? Math.sin(t * 9) * 0.12 : 0);
    this.head.position.y = 0.26 - p.nod * 0.08 - (act === 'nap' ? 0.05 : 0);
    this.head.rotation.y = sniffing ? Math.sin(t * 2.3) * 0.35 : act === 'lie' ? Math.sin(t * 0.4) * 0.4 : 0;

    // Jaw: snaps open on a woof, hangs open panting when it's happy or after a run.
    const woof = this.woofT < 0.35 ? Math.sin((this.woofT / 0.35) * Math.PI) : 0;
    const pant = act === 'wag' || (act === 'sit' && speed === 0) || walking ? 0.25 + Math.sin(t * 14) * 0.08 : 0;
    this.jaw.rotation.x = Math.max(woof * 0.6, pant * (act === 'nap' ? 0 : 1));

    // Ears perk up to bark, flop while trotting.
    const perk = act === 'bark' ? 0.6 : 0;
    this.ears.forEach((e, i) => {
      const sx = i ? 1 : -1;
      e.rotation.z = sx * (0.3 + perk * 0.5) + (walking ? Math.sin(this.phase + i) * 0.15 * sx : 0);
      e.rotation.x = perk * 0.5;
    });

    // Eyes shut to nap; otherwise a blink now and then.
    const blink = p.eyes > 0.5 && t % 4.3 < 0.12 ? 0.1 : p.eyes;
    for (const e of this.eyes) e.scale.y = Math.max(0.12, blink);

    // Tail: a lazy sway, a happy wag, a blur when petted, still in its sleep.
    const wag = act === 'wag' ? [22, 0.75] : act === 'nap' ? [0, 0] : act === 'lie' ? [3, 0.2] : walking ? [12, 0.4] : [8, 0.35];
    this.tail.rotation.x = -p.tail;
    this.tail.rotation.z = Math.sin(t * wag[0]) * wag[1];
    this.hips.rotation.y = act === 'wag' ? Math.sin(t * 11) * 0.1 : 0;
    // Breathing, asleep.
    this.torso.scale.setScalar(act === 'nap' ? 1 + Math.sin(t * 2.2) * 0.02 : 1);

    // Bubbles: 💤 while it naps, gone when it's up.
    if (act === 'nap' && !this.bubble) this.say('nap', '💤', 1e9);
    if (this.bubble) {
      const b = this.bubble;
      if ((b.kind === 'nap' && act !== 'nap') || this.t > b.until) this.hush();
      else {
        const rise = b.kind === 'wag' ? (1 - (b.until - this.t) / 2.2) * 0.35 : Math.sin(t * 2) * 0.03;
        b.sprite.position.y = 1.28 - p.drop + rise;
      }
    }
    if (this.tag) this.tag.position.y = 1.0 - p.drop * 0.8;
  }
}
