/**
 * The whip: J takes it out (J again, or Q, puts it away), and E (or a click) at a worker cracks it.
 * Your crack and your lash play at once; the worker flinches for everyone on the floor (you too) when
 * the office says the lash landed ('worker.whipped'), and then the office sends it an optimization
 * pass over its branch and its task (the 'worker.whip' prompt, see src/shared/prompts.ts).
 */
import * as THREE from 'three';
import { WHIP_COOLDOWN_MS, type WorkerInfo } from '../../../shared/protocol';
import { isAsleep } from '../../../shared/status';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import { clip, toast } from '../../ui/dom';
import type { Person, Worker } from '../../world/character';
import { Flinches } from './flinch';
import { CRACK_AT, LASH_TIME, Lashes, WHIP_REACH, disposeWhip, flick, heldWhip, type HeldWhip } from './world';

export interface WhipDeps {
  /** The workers on this floor, as they're drawn (see features/workers/views.ts). */
  workerViews: ReadonlyMap<string, { model: Worker }>;
  /** Someone else on your floor, as you see them. */
  personOf(id: string): Person | undefined;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

/** How the whip sits in your hand in first person (tipped forward out of the fist), and in your character's (out in front). */
const FIRST_TILT = -0.9;
const THIRD_TILT = 1.6;
/** Where your character's hand is, down its arm (see Person). */
const HAND = new THREE.Vector3(0, -0.38, 0);

export function installWhip(ctx: Ctx, deps: WhipDeps) {
  const { player, camera } = ctx;
  let holding = false;
  /** The whip in your hand in first person, and in your character's for everyone else (and you, in third). */
  let first: HeldWhip | null = null;
  let third: HeldWhip | null = null;
  /** The worker you're aiming at, by id, worked out each frame while the whip's out. */
  let aimed: string | null = null;
  /** When (performance.now()) your last crack went, and seconds into it for the wrist, or -1. */
  let crackedAt = 0;
  let wristT = -1;
  /** When each worker was last lashed (anyone's lash, or yours just sent), and when your lash at it lands. */
  const lashedAt = new Map<string, number>();
  const landsAt = new Map<string, number>();
  const lashes = new Lashes(ctx.scene);
  const flinches = new Flinches(ctx.scene, camera);

  function takeOut() {
    if (holding || ctx.trip()) return;
    if (ctx.carrying()) return void toast('🗂️ Your hands are full: put the card back first (Q)', 'warn');
    if (ctx.holdingBall()) return void toast('🏀 Your hands are full: drop the ball first (Q)', 'warn');
    if (player.seat) return void toast('🪢 Stand up first to crack the whip', 'warn');
    ctx.activities.stopAll('start');
    holding = true;
    first = heldWhip(0.9);
    first.group.rotation.x = FIRST_TILT;
    first.group.position.set(0, -0.01, -0.01);
    ctx.hands.rightHand.add(first.group);
    third = heldWhip(1.5);
    third.group.rotation.x = THIRD_TILT;
    third.group.position.copy(HAND);
    ctx.me.wear(third.group, 'hand');
    ctx.hint.invalidate();
  }

  function putAway() {
    if (!holding) return;
    holding = false;
    aimed = null;
    wristT = -1;
    for (const w of [first, third]) if (w) disposeWhip(w);
    first = third = null;
    ctx.hint.invalidate();
  }

  ctx.activities.add({
    id: 'whip',
    active: () => holding,
    // Anything else you start, a trip or a map change puts it away.
    stop: () => putAway(),
    key: (e) => {
      if (e.code === 'KeyJ' || e.code === 'KeyQ') {
        if (!e.repeat) putAway();
        return true;
      }
      if (e.code !== 'KeyE') return false;
      if (!e.repeat) crack();
      return true;
    },
    click: () => {
      crack();
      return true;
    },
    hint: (el) => renderHint(el),
  });
  ctx.keys.bind({ code: 'KeyJ', repeat: false, run: () => takeOut() });

  /** Why `w` can't be whipped right now, or '' when it can. */
  function cantWhip(w: WorkerInfo): string {
    if (w.kind !== 'agent') return `${w.name} is a shell, not an agent`;
    if (w.lost) return `${w.name}'s worktree was deleted`;
    if (isAsleep(w.status)) return `${w.name} is asleep — resume it first`;
    if (w.status === 'needs_input') return `${w.name} is waiting on an answer — answer it first`;
    return '';
  }

  /** Seconds before `id` can be lashed again (0: now). */
  function smarting(id: string, now = performance.now()): number {
    const left = WHIP_COOLDOWN_MS - (now - (lashedAt.get(id) ?? -Infinity));
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  const scl = new THREE.Vector3();
  /** Where a lash at a worker lands: its middle, wherever it is. */
  const chest = (model: Worker, out = new THREE.Vector3()) => {
    model.root.getWorldPosition(out);
    out.y += 0.75 * model.root.getWorldScale(scl).y;
    return out;
  };
  const eye = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const to = new THREE.Vector3();

  /** Where you look from and which way (first person), or where your character stands and faces (third). */
  function looking() {
    if (player.view === 'first') {
      eye.copy(camera.position);
      camera.getWorldDirection(ahead);
    } else {
      eye.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
      ahead.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    }
  }

  /** The worker the whip would land on: the one nearest the crosshair (or straight ahead of you, in third person) within reach. */
  function aimAt(): string | null {
    looking();
    const firstPerson = player.view === 'first';
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [id, v] of deps.workerViews) {
      if (!v.model.root.parent) continue;
      chest(v.model, to);
      if (Math.abs(to.y - player.pos.y - 0.8) > 2.5) continue;
      to.sub(eye);
      if (!firstPerson) to.y = 0;
      const d = to.length();
      const along = to.dot(ahead);
      if (d > WHIP_REACH || d < 0.2 || along <= 0) continue;
      const off = Math.sqrt(Math.max(0, d * d - along * along));
      // First person, within a hand's breadth or so of the crosshair; third, roughly the way you face.
      const score = firstPerson ? off : Math.acos(Math.min(1, along / d)) + d * 0.05;
      if (firstPerson ? off > 0.45 + d * 0.06 : score > 0.8) continue;
      if (score < bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }
  ctx.ticks.add('aim', () => {
    aimed = holding ? aimAt() : null;
  });

  const handsAt = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  /** Where your lash starts: the end of the handle, as you see it (in first person, your hands are drawn with a camera of their own). */
  function myHand(): THREE.Vector3 {
    if (player.view === 'first' && first) {
      first.tip.getWorldPosition(handsAt);
      ndc.copy(handsAt).project(ctx.hands.camera);
      const far = handsAt.length();
      ndc.z = 0.5;
      ndc.unproject(camera).sub(camera.position).normalize();
      return new THREE.Vector3().copy(camera.position).addScaledVector(ndc, far);
    }
    if (third) return third.tip.getWorldPosition(new THREE.Vector3());
    return ctx.me.rig.armL.localToWorld(HAND.clone());
  }

  /** E (or a click) with the whip out: it cracks at whoever you're aiming at (or the air), and the office hears about it. */
  function crack() {
    const now = performance.now();
    if (!holding || now - crackedAt < LASH_TIME * 900) return;
    crackedAt = now;
    const id = aimed;
    const model = id ? deps.workerViews.get(id)?.model : undefined;
    looking();
    const target = model ? chest(model) : eye.clone().addScaledVector(ahead, 3.2).setY(eye.y - 0.3);
    deps.reach();
    wristT = 0;
    lashes.add(myHand, target);
    ctx.sound.whip(target, CRACK_AT);
    const w = id ? store.workers.get(id) : undefined;
    if (!w) return;
    const why = cantWhip(w);
    if (why) return void toast(`🪢 ${why}`, 'warn');
    const left = smarting(w.id, now);
    if (left) return void toast(`💢 ${w.name} is still smarting — again in ${left}s`, 'warn');
    lashedAt.set(w.id, now);
    landsAt.set(w.id, now + CRACK_AT * 1000);
    ctx.net.send({ t: 'worker.whip', workerId: w.id });
  }

  ctx.messages.on('worker.whipped', (m) => {
    const now = performance.now();
    lashedAt.set(m.workerId, now);
    const v = deps.workerViews.get(m.workerId);
    const w = store.workers.get(m.workerId);
    const mine = m.by === store.you;
    if (mine) toast(`💢 ${w?.name ?? 'The worker'} felt that: it's taking an optimization pass over its work`);
    else toast(`🪢 ${m.name} cracked the whip at ${w?.name ?? 'a worker'}`);
    if (!v) return;
    let delay = 0;
    if (mine) delay = Math.max(0, (landsAt.get(m.workerId) ?? 0) - now) / 1000;
    else {
      // Someone else's: from their hand if they're in sight, else just the crack at the worker.
      const at = chest(v.model);
      const person = deps.personOf(m.by);
      if (person) {
        person.reach();
        lashes.add(() => person.rig.armL.localToWorld(HAND.clone()), at);
        delay = CRACK_AT;
      }
      ctx.sound.whip(at, delay);
    }
    flinches.add(v.model, ctx.reduceMotion.matches, delay);
  });

  // The jolt comes off the workers before anything moves them, and back on once they have (see Flinches).
  ctx.ticks.add('pre', () => flinches.restore());
  ctx.ticks.add('others', ({ dt }) => {
    flinches.update(dt);
    lashes.update(dt);
    // The wrist goes back and snaps forward; the coils are out of your hand while the lash is.
    const out = wristT >= 0;
    if (out) wristT = wristT + dt >= LASH_TIME ? -1 : wristT + dt;
    const k = wristT >= 0 ? flick(wristT) : 0;
    if (first) {
      first.group.rotation.x = FIRST_TILT + k;
      first.coil.visible = !out;
    }
    if (third) {
      third.group.rotation.x = THIRD_TILT - k * 1.2;
      third.coil.visible = !out;
    }
  });
  ctx.ticks.add('play', () => {
    // Sat down, off on a trip, or into something else (hanging a picture, the ladder): it goes away.
    if (holding && (ctx.trip() || player.seat || ctx.carrying() || ctx.holdingBall() || ctx.activities.current((a) => a.id !== 'whip'))) putAway();
  });

  /** With the whip out: who you're aiming at (and whether it can be whipped), and the keys. */
  function renderHint(el: HTMLElement) {
    const w = aimed ? store.workers.get(aimed) : undefined;
    const why = w ? cantWhip(w) : '';
    const left = w && !why ? smarting(w.id) : 0;
    const about = !w ? 'aim at a worker' : why || (left ? `${clip(w.name, 24)} is still smarting · ${left}s` : `at ${clip(w.name, 24)}`);
    ctx.hint.draw(el, `whip|${about}`, () => [hintTitle('🪢 Whip'), aside(about), key('E', 'Crack the whip'), key('J/Q', 'Put it away')]);
  }

  return {
    holding: () => holding,
    aimed: () => aimed,
    takeOut,
    putAway,
    crack,
    /** Makes the worker `id` flinch here as if it had been lashed (for checks from the console). */
    flinch: (id: string) => {
      const v = deps.workerViews.get(id);
      if (v) flinches.add(v.model, ctx.reduceMotion.matches);
    },
  };
}
