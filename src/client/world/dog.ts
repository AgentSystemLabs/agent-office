import * as THREE from 'three';
import { BARK_EVERY_S, BARK_FOR_S, DOG_COATS, dogAt, dogBreed, legSeconds, type DogAct, type DogBreed, type DogState } from '../../shared/dog';
import type { Theme } from '../../shared/protocol';
import { dogAntlers, dogBatWings, dogRedNose, dogScarf, dogWitchHat } from './costumes';
import { loadModel, type Model } from './models';
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
 * Meters a second that the walk and run clips carry it at their own pace, whatever its breed (a short-legged
 * one's clips are quicker, its strides shorter): played at its speed over this, its paws keep pace with the floor.
 */
const STRIDE_SPEED = { walk: 0.8, run: 1.2 };

/**
 * How high its name tag floats over the top of it standing, and its bubbles over that. Both sink as far as
 * the top of it does in what it's doing (see Rig.drop), a little less for the tag.
 */
const TAG_OVER = 0.29;
const BUBBLE_OVER = 0.57;
/** How tall it's taken to be before its model is in: the pup's height. */
const PUP_TOP = 0.71;

/** Seconds it takes to go from one clip to the next. */
const FADE = 0.4;

/**
 * What each part of the model is painted with, by its material's name in dog-<breed>.glb: a coat color
 * (0 body, 1 belly and muzzle, 2 ears, recolored on sync) or a fixed one. Anything else wears the body's
 * coat. Only the coat casts a shadow, not the little bits.
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

/**
 * What the mouse picks it by: a capsule on each of these bones, from the bone to the next one down its
 * chain (null at the end of one), fitted to whichever breed it is (see fitPicking). Picking its skin
 * itself, three would pose every vertex in JavaScript for each ray, some 6 ms a ray, and in first person
 * the crosshair casts one every frame.
 */
const PICK: [bone: string, next: string | null][] = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['head', null],
  ['jaw', null],
  ['tail_1', 'tail_2'],
  ['tail_2', 'tail_3'],
  ['tail_3', null],
  ...['L', 'R'].flatMap((s): [string, string | null][] => [
    [`front_upper_${s}`, `front_lower_${s}`],
    [`front_lower_${s}`, `front_paw_${s}`],
    [`front_paw_${s}`, null],
    [`back_upper_${s}`, `back_lower_${s}`],
    [`back_lower_${s}`, `back_paw_${s}`],
    [`back_paw_${s}`, null],
    [`ear_${s}`, `ear_tip_${s}`],
    [`ear_tip_${s}`, null],
  ]),
];

/** How much of the skin a bone pulls on its capsule is thick enough to take in (the odd stray vertex is left out). */
const PICK_REACH = 0.9;

/**
 * The picking capsules' material: never drawn (nor outlined), yet rays still hit them. Hiding the capsules
 * with `visible = false` instead would get their hits skipped in main.ts.
 */
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });

/**
 * costumes.ts puts every piece where it goes on the pup, from the pup's socket_head. Rudolph's nose and the
 * scarf go on the breed's own nose and collar sockets instead, so they're moved back by where those are
 * on the pup (from its socket_head, and the pup collar's half width, which the scarf is sized to).
 */
const PUP_NOSE = new THREE.Vector3(0, 0, 0.207);
const PUP_COLLAR = new THREE.Vector3(0, -0.1138, -0.0864);
const PUP_COLLAR_WIDTH = 0.119;

/** The loaded model's moving parts. */
interface Rig {
  breed: DogBreed;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Each clip's action and how much of the pose is its: they fade in and out over FADE, adding up to 1. */
  clips: Map<string, { action: THREE.AnimationAction; w: number }>;
  /** Bones the clips hold still and the code moves (see animate), with how they sit at rest. */
  jaw: { bone: THREE.Object3D; rest: THREE.Quaternion };
  eyes: { bone: THREE.Object3D; rest: THREE.Vector3 }[];
  /** Where costumes go: on its head, on its back, on its nose and round its collar. */
  head: THREE.Object3D;
  back: THREE.Object3D;
  noseTip: THREE.Object3D;
  neck: THREE.Object3D;
  /** How big its collar is next to the pup's, for the scarf. */
  collar: number;
  /** Its own nose, hidden under Rudolph's. */
  nose: THREE.Object3D[];
  /** The picking capsules, whose geometry is this copy's own. */
  pick: THREE.Mesh[];
  /** How tall it stands, and how far the top of it sinks from that in each clip (see drops). */
  top: number;
  drop: Partial<Record<Act, number>>;
}

/**
 * The office dog, as everyone on the floor sees it: a chunky cartoon dog of its floor's breed that walks
 * where the server says (see shared/dog.ts), sits, lies down, naps with its head on its paws, sniffs, barks
 * at a worker that needs input and wags when it's petted. Forward is +z. Every breed is modelled and
 * animated in Blender (dog-<breed>.glb, see models.ts) with the same rig, and loads the first time a floor
 * has one; the woof, the panting, blinking and dressing up are done here.
 */
export class Dog {
  readonly root = new THREE.Group();
  readonly interactable: Interactable = { kind: 'dog', x: 0, z: 0, radius: 1.5 };
  /** Holds the model, and lifts it off the floor for the little hop it gives with a woof. */
  private body = new THREE.Group();
  /** The model, once it's loaded; until then there's only its name tag and bubbles. */
  private rig: Rig | null = null;
  /** The breed it last synced as, whose model it has on or is loading. */
  private wants: DogBreed | null = null;
  private loading: Promise<boolean> = Promise.resolve(false);
  private firstIn = () => {};
  /**
   * Settles the first time there's a dog to see: the model of the breed it was synced as is on, or couldn't
   * be loaded, or the first sync had no dog at all (a building without floors). The loading screen waits on
   * it; unlike `ready`, a later breed never makes it wait again. Never rejects.
   */
  readonly firstReady = new Promise<void>((resolve) => (this.firstIn = resolve));
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
  /** How far it has sunk toward the floor (see Rig.drop) and how open its eyes are, easing toward what it's doing. */
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
  }

  /**
   * True once the model of the breed it last synced as is on, false if it couldn't be loaded (or another
   * breed was asked for meanwhile). Never rejects.
   */
  get ready(): Promise<boolean> {
    return this.loading;
  }

  /** The breed whose model it has on, if any. */
  get breed(): DogBreed | null {
    return this.rig?.breed ?? null;
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
      this.firstIn();
      return;
    }
    // Another floor's dog (someone took the elevator): its breed's model, once that's in.
    const breed = dogBreed(state.breed);
    if (breed !== this.wants) this.wear(breed);
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

  /**
   * Loads a breed's model and puts it on. The one it has on stays until then, so a floor's dog never goes
   * missing while another breed loads; one that finishes loading after yet another breed was asked for is
   * dropped.
   */
  private wear(breed: DogBreed) {
    this.wants = breed;
    this.loading = loadModel(`dog-${breed}`)
      .then((m) => {
        if (this.wants !== breed) return false;
        this.attach(m, breed);
        return true;
      })
      // A file that didn't load, or isn't the model the code knows (a part missing): no dog but its name tag.
      .catch((err: unknown) => {
        console.error(`The office dog's model (${breed}) didn't load`, err);
        return false;
      });
    // On or not coming, unless another breed was asked for meanwhile: then it's that one's turn.
    void this.loading.then(() => this.wants === breed && this.firstIn());
  }

  /**
   * Puts a loaded model on in place of the one it had: paints it, fits its picking capsules, finds the
   * bones the code moves and the costume sockets, and dresses it.
   */
  private attach({ scene: model, clips }: Model, breed: DogBreed) {
    const nose: THREE.Object3D[] = [];
    let collar = PUP_COLLAR_WIDTH;
    // The model comes split into one part per material; its materials are only names for what to paint.
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      if (name === 'Collar') {
        const box = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox);
        if (box) collar = (box.max.x - box.min.x) / 2;
      }
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
      if (!o) throw new Error(`dog-${breed}.glb has no ${name}`);
      return o;
    };
    // Everything here reads the model at rest, before any clip has posed it.
    const { pick, top } = fitPicking(model);
    const jaw = part('jaw');
    const jawRest = jaw.quaternion.clone();
    const eyes = ['eye_L', 'eye_R'].map((n) => {
      const bone = part(n);
      return { bone, rest: bone.scale.clone() };
    });
    const drop = drops(model, clips, top);
    const mixer = new THREE.AnimationMixer(model);
    const rig: Rig = {
      breed,
      model,
      mixer,
      clips: new Map(clips.map((c) => [c.name, { action: mixer.clipAction(c), w: 0 }])),
      jaw: { bone: jaw, rest: jawRest },
      eyes,
      head: part('socket_head'),
      back: part('socket_back'),
      noseTip: part('socket_nose'),
      neck: part('socket_neck'),
      collar: collar / PUP_COLLAR_WIDTH,
      nose,
      pick,
      top,
      drop,
    };
    if (this.rig) this.detach(this.rig);
    this.body.add(model);
    this.rig = rig;
    this.dress();
  }

  /**
   * Takes a model off for good: what's this copy's own goes (its capsules, its skeleton's bone texture,
   * the mixer's bindings). The breed's geometry stays: it's shared with every other copy of the breed,
   * and kept for the next one by models.ts.
   */
  private detach(rig: Rig) {
    rig.mixer.stopAllAction();
    rig.mixer.uncacheRoot(rig.model);
    rig.model.removeFromParent();
    for (const c of rig.pick) c.geometry.dispose();
    rig.model.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
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
      // Round its own collar, as big as that is.
      const scarf = dogScarf();
      scarf.scale.setScalar(rig.collar);
      scarf.position.copy(PUP_COLLAR).multiplyScalar(-rig.collar);
      wear(rig.neck, scarf);
      const red = dogRedNose();
      red.nose.position.sub(PUP_NOSE);
      wear(rig.noseTip, red.nose);
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
    this.tag.position.y = (this.rig?.top ?? PUP_TOP) + TAG_OVER;
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
    const rig = this.rig;
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    this.drop += ((rig?.drop[act] ?? 0) - this.drop) * k;
    this.eyes += ((act === 'nap' ? 0 : 1) - this.eyes) * k;
    const t = this.t;
    const moving = act === 'walk' || act === 'run';

    // A little hop with each woof.
    this.body.position.y = this.woofT < 0.25 ? Math.sin((this.woofT / 0.25) * Math.PI) * 0.05 : 0;
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
    const top = rig?.top ?? PUP_TOP;
    if (act === 'nap' && !this.bubble) this.say('nap', '💤', 1e9);
    if (this.bubble) {
      const b = this.bubble;
      if ((b.kind === 'nap' && act !== 'nap') || this.t > b.until) this.hush();
      else {
        const rise = b.kind === 'wag' ? (1 - (b.until - this.t) / 2.2) * 0.35 : Math.sin(t * 2) * 0.03;
        b.sprite.position.y = top + BUBBLE_OVER - this.drop + rise;
      }
    }
    if (this.tag) this.tag.position.y = top + TAG_OVER - this.drop * 0.8;
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

/**
 * A vertex belongs to a bone's capsule when the bone pulls on it this much or more (not the blend between
 * two). A bone with fewer than PICK_FEW such (a short leg shared out between its bones) takes the vertices
 * it pulls on more than any other bone does instead.
 */
const PICK_OWN = 0.6;
const PICK_FEW = 12;

/**
 * The picking capsules for a model at rest (see PICK), on its bones, and how tall it stands. Each bone's
 * capsule runs from it to the next bone down its chain, or at the end of a chain through the middle of the
 * skin the bone pulls on, the way that's longest, its round ends where the skin ends. It's as thick as
 * that skin reaches round it (see PICK_REACH), so it fits a corgi's legs as well as a dachshund's head.
 */
function fitPicking(model: THREE.Object3D): { pick: THREE.Mesh[]; top: number } {
  model.updateMatrixWorld(true);
  // Every vertex at rest, under the bone that pulls on it (see PICK_OWN), and under the one that pulls most.
  const owned = new Map<string, THREE.Vector3[]>();
  const most = new Map<string, THREE.Vector3[]>();
  const add = (map: Map<string, THREE.Vector3[]>, bone: string, v: THREE.Vector3) => {
    const list = map.get(bone);
    if (list) list.push(v);
    else map.set(bone, [v]);
  };
  let top = 0;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const { position, skinIndex, skinWeight } = m.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld);
      top = Math.max(top, v.y);
      let k = 0;
      for (let c = 1; c < 4; c++) if (skinWeight.getComponent(i, c) > skinWeight.getComponent(i, k)) k = c;
      add(most, m.skeleton.bones[skinIndex.getComponent(i, k)].name, v);
      if (skinWeight.getComponent(i, k) >= PICK_OWN) add(owned, m.skeleton.bones[skinIndex.getComponent(i, k)].name, v);
    }
  });
  const pick: THREE.Mesh[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const on = new THREE.Vector3();
  /** How far out from a to b the skin reaches (see PICK_REACH). */
  const thickness = (verts: THREE.Vector3[], a: THREE.Vector3, b: THREE.Vector3) => {
    const line = new THREE.Line3(a, b);
    return quantile(verts.map((v) => line.closestPointToPoint(v, true, on).distanceTo(v)));
  };
  for (const [name, next] of PICK) {
    const bone = model.getObjectByName(name);
    const own = owned.get(name);
    const verts = own && own.length >= PICK_FEW ? own : most.get(name);
    if (!bone || !verts) continue;
    const a = bone.getWorldPosition(new THREE.Vector3());
    const child = next ? model.getObjectByName(next) : undefined;
    let b: THREE.Vector3;
    let radius: number;
    if (child) {
      b = child.getWorldPosition(new THREE.Vector3());
      radius = thickness(verts, a, b);
    } else {
      // The end of a chain (a paw, the head, the tip of the tail or an ear): through the middle of its
      // skin, the way that skin is longest, with its round ends where it ends.
      const middle = verts.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(verts.length);
      const along = longest(verts, middle);
      let near = 0;
      let far = 0;
      for (const v of verts) {
        const t = on.subVectors(v, middle).dot(along);
        near = Math.min(near, t);
        far = Math.max(far, t);
      }
      radius = thickness(verts, middle.clone().addScaledVector(along, near), middle.clone().addScaledVector(along, far));
      const ends = [Math.min(near + radius, 0), Math.max(far - radius, 0)];
      a.copy(middle).addScaledVector(along, ends[0]);
      b = middle.clone().addScaledVector(along, ends[1]);
    }
    const length = a.distanceTo(b);
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 2, 8), UNSEEN);
    capsule.position.lerpVectors(a, b, 0.5);
    if (length > 1e-6) capsule.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    bone.attach(capsule);
    pick.push(capsule);
  }
  return { pick, top };
}

/** The way a cloud of points around `middle` is longest: its spread's main axis, found by power iteration. */
function longest(points: THREE.Vector3[], middle: THREE.Vector3): THREE.Vector3 {
  let [xx, xy, xz, yy, yz, zz] = [0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const x = p.x - middle.x;
    const y = p.y - middle.y;
    const z = p.z - middle.z;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const spread = new THREE.Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz);
  // Any start that isn't square to the answer will do.
  const axis = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  for (let i = 0; i < 32 && axis.lengthSq() > 0; i++) axis.applyMatrix3(spread).normalize();
  return axis.lengthSq() > 0 ? axis : new THREE.Vector3(0, 1, 0);
}

/** The value PICK_REACH of the way up a list of them. */
function quantile(values: number[]): number {
  values.sort((x, y) => x - y);
  return values[Math.floor((values.length - 1) * PICK_REACH)];
}

/**
 * How far the top of it sinks from standing at rest in each clip, at its tallest of four moments through
 * it, for its name tag and bubbles to sink with it: sitting up it's as tall, sniffing only its tail is up,
 * lying down its head is. Every fifth vertex is posed (in JavaScript, once), on a mixer of its own, which
 * puts every bone back at rest when it stops.
 */
function drops(model: THREE.Object3D, clips: THREE.AnimationClip[], standing: number): Partial<Record<Act, number>> {
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  const v = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(model);
  const drop: Partial<Record<Act, number>> = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip).play();
    let top = 0;
    for (let k = 0; k < 4; k++) {
      mixer.setTime((clip.duration * k) / 4);
      model.updateMatrixWorld(true);
      for (const m of meshes) {
        for (let i = 0; i < m.geometry.attributes.position.count; i += 5) top = Math.max(top, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y);
      }
    }
    drop[clip.name as Act] = Math.max(0, standing - top);
    action.stop();
  }
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return drop;
}
