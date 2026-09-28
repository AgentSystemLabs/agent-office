import * as THREE from 'three';
import { BARK_EVERY_S, BARK_FOR_S, DOG_COATS, dogAt, legSeconds, type DogAct, type DogState } from '../../shared/dog';
import type { Theme } from '../../shared/protocol';
import { dogAntlers, dogBatWings, dogRedNose, dogScarf, dogWitchHat } from './costumes';
import { loadDog, type Model } from './models';
import type { Interactable } from './office';
import { disposeSprite, textSprite, toon, toonUnique } from './toon';

export interface DogSounds {
  bark(x: number, z: number, times: number): void;
  /** A happy little yip, when someone pets it. */
  yip(x: number, z: number): void;
}

/** What it's doing, as its clips have it: one of its acts, or on its way there at a trot or, in a hurry, a gallop. */
type Act = DogAct | 'walk' | 'run';

/**
 * Meters a second from which it gallops rather than trots. The server trots it at 1.3 and has it keep up
 * with someone at 1.8 or 2.7, or run at 3.4; trotting at 1.8 its legs would be a blur.
 */
const RUN_FROM = 1.6;

/**
 * Meters a second that the walk and run clips carry it at their own pace (0.4 and 0.944 m a cycle of 0.5 s):
 * played at its speed over this, its paws keep pace with the floor.
 */
const STRIDE_SPEED = { walk: 0.8, run: 1.89 };

/**
 * How far its head is below where it is standing up, in each of its clips, so its name tag and bubbles
 * sink with it: it sits up tall, and lies with its head up, or down on its paws asleep.
 */
const DROP: Record<Act, number> = { walk: 0, run: 0, stand: 0, wag: 0, sniff: 0.06, sit: 0, bark: 0, lie: 0.21, nap: 0.28 };

/** Seconds it takes to go from one clip to the next. */
const FADE = 0.4;

/**
 * What each part of the model is painted with, by its material's name in dog.glb: a coat color (0 body,
 * 1 belly and muzzle, 2 ears, recolored on sync) or a fixed one. Anything else wears the body's coat.
 * Only the coat casts a shadow, not the little bits.
 */
const PAINT: Record<string, number | string> = {
  Fur: 0,
  Light: 1,
  Ear: 2,
  Ink: '#1d1d1d',
  Shine: '#ffffff',
  Nose: '#1d1d1d',
  Tongue: '#ff7f9a',
  Collar: '#ef476f',
  Tag: '#ffd166',
};

type V3 = [number, number, number];

/**
 * What the mouse picks it by: capsules that move with its bones (each the bone, its radius, and the ends
 * of its middle, as it stands at rest; +x is its left). Picking its skin itself, three would pose every
 * vertex in JavaScript for each ray, some 6 ms a ray, and in first person the crosshair casts one every frame.
 */
const PICK: [bone: string, radius: number, from: V3, to: V3][] = [
  ['hips', 0.155, [0, 0.355, -0.12], [0, 0.355, 0]],
  ['chest', 0.15, [0, 0.36, 0.1], [0, 0.37, 0.17]],
  ['head', 0.15, [0, 0.575, 0.26], [0, 0.52, 0.39]],
  ['tail_1', 0.045, [0, 0.4, -0.22], [0, 0.47, -0.29]],
  ['tail_2', 0.035, [0, 0.47, -0.29], [0, 0.55, -0.325]],
  ['tail_3', 0.035, [0, 0.55, -0.325], [0, 0.63, -0.33]],
  ...[1, -1].flatMap((sx): [string, number, V3, V3][] => {
    const s = sx > 0 ? 'L' : 'R';
    return [
      [`front_upper_${s}`, 0.055, [sx * 0.078, 0.31, 0.17], [sx * 0.082, 0.15, 0.194]],
      [`front_lower_${s}`, 0.05, [sx * 0.082, 0.15, 0.194], [sx * 0.082, 0.05, 0.19]],
      [`front_paw_${s}`, 0.045, [sx * 0.082, 0.04, 0.17], [sx * 0.082, 0.04, 0.24]],
      [`back_upper_${s}`, 0.055, [sx * 0.088, 0.3, -0.145], [sx * 0.088, 0.13, -0.195]],
      [`back_lower_${s}`, 0.05, [sx * 0.088, 0.13, -0.195], [sx * 0.088, 0.05, -0.16]],
      [`back_paw_${s}`, 0.045, [sx * 0.088, 0.04, -0.165], [sx * 0.088, 0.04, -0.1]],
    ];
  }),
];

/**
 * The picking capsules' material: never drawn (nor outlined), yet rays still hit them. Hiding the capsules
 * with `visible = false` instead would get their hits skipped in main.ts.
 */
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });

/** The loaded model's moving parts. */
interface Rig {
  mixer: THREE.AnimationMixer;
  /** Each clip's action and how much of the pose is its: they fade in and out over FADE, adding up to 1. */
  clips: Map<string, { action: THREE.AnimationAction; w: number }>;
  /** Bones the clips hold still and the code moves (see animate), with how they sit at rest. */
  jaw: { bone: THREE.Object3D; rest: THREE.Quaternion };
  eyes: { bone: THREE.Object3D; rest: THREE.Vector3 }[];
  /** Where costumes go: on its head, and on its back. */
  head: THREE.Object3D;
  back: THREE.Object3D;
  /** Its own nose, hidden under Rudolph's. */
  nose: THREE.Object3D[];
}

/**
 * The office dog, as everyone on the floor sees it: a chunky cartoon pup that walks where the server
 * says (see shared/dog.ts), sits, lies down, naps with its head on its paws, sniffs, barks at a
 * worker that needs input and wags when it's petted. Forward is +z. It's modelled and animated in
 * Blender (dog.glb, see models.ts); the woof, the panting, blinking and dressing up are done here.
 */
export class Dog {
  readonly root = new THREE.Group();
  readonly interactable: Interactable = { kind: 'dog', x: 0, z: 0, radius: 1.5 };
  /** True once the model has loaded and is on, false if it couldn't be loaded. Never rejects. */
  readonly ready: Promise<boolean>;
  /** Holds the model, and lifts it off the floor for the little hop it gives with a woof. */
  private body = new THREE.Group();
  /** The model, once it's loaded; until then there's only its name tag and bubbles. */
  private rig: Rig | null = null;
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
  /** How far it has sunk toward the floor (see DROP) and how open its eyes are, easing toward what it's doing. */
  private drop = 0;
  private eyes = 1;
  /** Seconds since the last woof, for the jaw and the hop. */
  private woofT = 9;
  private t = 0;
  private placed = false;
  /** Dressed up for a holiday (see setCostume): what it's wearing, its bat wings, and Rudolph's nose. */
  private costume: Theme | null = null;
  private outfit: THREE.Object3D[] = [];
  private wings: THREE.Object3D[] = [];
  private rudolph: THREE.MeshToonMaterial | null = null;

  constructor(
    private sounds: DogSounds,
    /** Someone already has this worker's terminal open, so there's no one to bark for. */
    private hushed: (workerId: string) => boolean,
  ) {
    this.coatMats = [toonUnique(DOG_COATS[0][0]), toonUnique(DOG_COATS[0][1]), toonUnique(DOG_COATS[0][2])];
    this.root.add(this.body);
    this.root.visible = false;
    this.root.userData.interact = this.interactable;
    this.ready = loadDog()
      .then((m) => this.attach(m))
      .then(
        () => true,
        (err: unknown) => {
          console.error("The office dog's model didn't load", err);
          return false;
        },
      );
  }

  /**
   * Dresses it up for a holiday: bat wings and a little witch's hat for Halloween, reindeer antlers, a
   * glowing red nose and a scarf for Christmas. Null takes it all off. Asked before the model is in, it
   * puts them on once it is.
   */
  setCostume(theme: Theme | null) {
    if (theme === this.costume) return;
    this.costume = theme;
    this.dress();
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
    // Somewhere new (just synced, or a floor away): straight there, already doing whatever it's doing.
    const jump = !this.placed || Math.hypot(pos.x - at.x, pos.z - at.z) > 3;
    if (jump) {
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
    this.animate(dt, at.moving ? (s.speed >= RUN_FROM ? 'run' : 'walk') : s.act, at.moving ? s.speed : 0, jump);
  }

  // ---- The model ----------------------------------------------------------------------------------

  /** Puts the loaded model on: paints it, finds the bones the code moves and the costume sockets, and dresses it. */
  private attach({ scene: model, clips }: Model) {
    const nose: THREE.Object3D[] = [];
    // The model comes split into one part per material; its materials are only names for what to paint.
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      const paint = PAINT[name] ?? 0;
      m.material = typeof paint === 'number' ? this.coatMats[paint] : toon(paint);
      m.castShadow = typeof paint === 'number';
      m.receiveShadow = true;
      // Culled by bounds worked out standing, it would vanish lying down at the edge of the screen.
      m.frustumCulled = false;
      // Picked by its capsules instead (see PICK).
      m.raycast = () => {};
      if (name === 'Nose') nose.push(m);
    });
    const part = (name: string) => {
      const o = model.getObjectByName(name);
      if (!o) throw new Error(`dog.glb has no ${name}`);
      return o;
    };
    // The model is still at rest here, so each capsule goes on its bone where the table has it.
    const up = new THREE.Vector3(0, 1, 0);
    for (const [bone, r, from, to] of PICK) {
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, a.distanceTo(b), 2, 8), UNSEEN);
      capsule.position.lerpVectors(a, b, 0.5);
      capsule.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
      part(bone).attach(capsule);
    }
    const mixer = new THREE.AnimationMixer(model);
    const jaw = part('jaw');
    const rig: Rig = {
      mixer,
      clips: new Map(clips.map((c) => [c.name, { action: mixer.clipAction(c), w: 0 }])),
      jaw: { bone: jaw, rest: jaw.quaternion.clone() },
      eyes: ['eye_L', 'eye_R'].map((n) => {
        const bone = part(n);
        return { bone, rest: bone.scale.clone() };
      }),
      head: part('socket_head'),
      back: part('socket_back'),
      nose,
    };
    this.body.add(model);
    this.rig = rig;
    this.dress();
  }

  /** Puts on what setCostume last asked for, taking off what it had on. */
  private dress() {
    for (const o of this.outfit) {
      o.removeFromParent();
      o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    }
    // The wings' and the red nose's materials are the costume's own; the rest are shared toon ones.
    for (const w of this.wings) w.traverse((m) => ((m as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
    this.rudolph?.dispose();
    this.outfit = [];
    this.wings = [];
    this.rudolph = null;
    const rig = this.rig;
    if (!rig) return;
    const theme = this.costume;
    const wear = (parent: THREE.Object3D, o: THREE.Object3D) => {
      o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
      parent.add(o);
      this.outfit.push(o);
    };
    if (theme === 'halloween') {
      const bat = dogBatWings();
      wear(rig.back, bat.group);
      this.wings = bat.wings;
      wear(rig.head, dogWitchHat());
    } else if (theme === 'christmas') {
      wear(rig.head, dogAntlers());
      wear(rig.head, dogScarf());
      const red = dogRedNose();
      wear(rig.head, red.nose);
      this.rudolph = red.glow;
    }
    for (const n of rig.nose) n.visible = theme !== 'christmas';
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

  /** `snap`: it's just been put somewhere, so there's nothing to ease or fade from. */
  private animate(dt: number, act: Act, speed: number, snap: boolean) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    this.drop += (DROP[act] - this.drop) * k;
    this.eyes += ((act === 'nap' ? 0 : 1) - this.eyes) * k;
    const t = this.t;
    const moving = act === 'walk' || act === 'run';

    // A little hop with each woof.
    this.body.position.y = this.woofT < 0.25 ? Math.sin((this.woofT / 0.25) * Math.PI) * 0.05 : 0;
    const rig = this.rig;
    if (rig) {
      this.play(rig, dt, act, speed, snap);
      // The clips hold the jaw and eyes still, and the mixer only writes what changed since the last
      // frame, so they're set from rest every frame rather than turned from wherever they were.
      // Jaw: snaps open on a woof, hangs open panting when it's happy or after a run, shut asleep.
      const woof = this.woofT < 0.35 ? Math.sin((this.woofT / 0.35) * Math.PI) : 0;
      const pant = act === 'wag' || act === 'sit' || moving ? 0.25 + Math.sin(t * 14) * 0.08 : 0;
      rig.jaw.bone.quaternion.copy(rig.jaw.rest);
      rig.jaw.bone.rotateX(Math.max(woof * 0.6, pant));
      // Eyes shut to nap; otherwise a blink now and then.
      const blink = this.eyes > 0.5 && t % 4.3 < 0.12 ? 0.1 : this.eyes;
      for (const e of rig.eyes) e.bone.scale.copy(e.rest).setY(e.rest.y * Math.max(0.12, blink));
    }

    // Bat wings flap (fast when it runs or is happy, folded while it naps); Rudolph's nose glows.
    const flap = act === 'nap' ? 0 : moving || act === 'wag' || act === 'bark' ? 1 : 0.35;
    this.wings.forEach((w, i) => {
      const sx = i ? 1 : -1;
      w.rotation.z = sx * (0.75 + (act === 'nap' ? -0.6 : Math.sin(t * (6 + 10 * flap)) * 0.45 * flap));
      w.rotation.y = sx * 0.25;
    });
    if (this.rudolph) this.rudolph.emissiveIntensity = 0.7 + Math.sin(t * 3) * 0.3;

    // Bubbles: 💤 while it naps, gone when it's up.
    if (act === 'nap' && !this.bubble) this.say('nap', '💤', 1e9);
    if (this.bubble) {
      const b = this.bubble;
      if ((b.kind === 'nap' && act !== 'nap') || this.t > b.until) this.hush();
      else {
        const rise = b.kind === 'wag' ? (1 - (b.until - this.t) / 2.2) * 0.35 : Math.sin(t * 2) * 0.03;
        b.sprite.position.y = 1.28 - this.drop + rise;
      }
    }
    if (this.tag) this.tag.position.y = 1.0 - this.drop * 0.8;
  }

  /** Fades toward the clip for what it's doing (or straight to it with `snap`), then poses the model. */
  private play(rig: Rig, dt: number, act: Act, speed: number, snap: boolean) {
    const want = rig.clips.has(act) ? act : 'stand';
    const step = snap ? 1 : dt / FADE;
    let total = 0;
    for (const [name, c] of rig.clips) {
      const w = THREE.MathUtils.clamp(name === want ? c.w + step : c.w - step, 0, 1);
      if (w > 0 && c.w === 0) c.action.reset().play();
      else if (w === 0 && c.w > 0) c.action.stop();
      c.w = w;
      total += w;
    }
    // Weights short of 1 would blend in the model's rest pose, so a fade cut short by another shares out 1.
    if (total > 0) for (const c of rig.clips.values()) if (c.w > 0) c.action.setEffectiveWeight(c.w / total);
    // Its legs keep up with how fast it's going.
    if (act === 'walk' || act === 'run') {
      const gait = rig.clips.get(act);
      if (gait) gait.action.timeScale = speed / STRIDE_SPEED[act];
    }
    rig.mixer.update(dt);
  }
}
