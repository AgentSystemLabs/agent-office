import * as THREE from 'three';
import { adrift } from '../../../shared/maps';
import type { AirlockView } from '../../world/station/airlock';
import { ADRIFT_SCALE, float } from './adrift';
import { pick, wrap, type Sendoff, type StepHost } from './sendoff';

/*
 * A send-home script's `eject` step (see sendhome.ts): the worker, brought to the airlock, is shoved
 * in through the inner door, which comes down behind it; the lights go red while it finds out where
 * it is; then the outer hatch parts and it's blown out into space, tumbling, to drift off with
 * everyone who went before it (adrift.ts), which is where it's handed over.
 */

/**
 * Seconds: the inner door going up, the shove through it, the door coming down, the wait under the
 * red lights, the outer hatch parting, being blown out to where it drifts from, and the hatch closing.
 */
const EJECT = { open: 0.5, step: 0.6, seal: 0.5, wait: 1.8, part: 0.22, blow: 5.5, shut: 0.8 } as const;
/** A worker's middle is this far above its feet (see adrift.ts). */
const MIDDLE = 0.45;

const PLEAS = ['😨 Wait, wait, wait!', '🥺 Let’s talk about this!', '😰 I’ll fix the tests!', '🙏 One more chance!', '😳 Is this thing on?', '🚪 Hello? The door?'];
const CRIES = ['😱 AAAAAAH!', '😵 NOOOoooo…', '🫨 WHOAAAA!', '😭 I regret nothiiing!', '🚀 Wheeeee!', '🫠 Tell my PR I loved it!'];

/** Whose turn it is in each airlock: one at a time. */
const using = new WeakMap<AirlockView, string>();

const start = new THREE.Vector3();
const out = new THREE.Vector3();
const to = new THREE.Vector3();
const spin = new THREE.Quaternion();
const want = new THREE.Quaternion();
const tumble = new THREE.Euler();
const AXIS = new THREE.Vector3(1, 0, 0.35).normalize();

/** The airlock shut up again, its lights off, and nobody's turn in it: whoever was being put out of it isn't any more. */
export function shut(lock: AirlockView | undefined) {
  if (!lock) return;
  lock.inner(0);
  lock.outer(0);
  lock.alarm(false);
  using.delete(lock);
}

/** Put out of the airlock: true once it's adrift (or gone) and the hatch has closed behind it. */
export function eject(host: StepHost, s: Sendoff): boolean {
  const j = s.eject!;
  const lock = host.world().airlock;
  // No airlock here (the map changed its mind): it's just gone.
  if (!lock) {
    s.leaving = true;
    return true;
  }
  const a = lock.plan;
  const root = s.model.root;
  const pos = root.position;
  const next = (phase: typeof j.phase) => {
    j.phase = phase;
    j.t = s.t;
  };
  if (j.phase === 'go') {
    // Not at the airlock yet (the script didn't take it there): off it goes, then. And one at a time.
    if (s.state === 'walk' || s.state === 'hop') return false;
    if (Math.hypot(pos.x - a.front[0], pos.z - a.front[1]) > 0.35 && !j.walked) {
      j.walked = true;
      host.walkTo(s, 'airlock');
      return false;
    }
    const turn = using.get(lock);
    if (turn && turn !== s.id) return false;
    using.set(lock, s.id);
    next('open');
    host.sounds.airlock(lock.doorAt, 'door');
  }
  const t = s.t - j.t;
  const outward = Math.atan2(a.out[0], a.out[1]);
  if (j.phase === 'open') {
    lock.inner(Math.min(1, t / EJECT.open));
    root.rotation.y += wrap(outward - root.rotation.y) * 0.2;
    if (t < EJECT.open) return false;
    // A shove from behind.
    s.guard?.person.reach();
    j.from.copy(pos);
    s.state = 'fly';
    next('step');
    return false;
  }
  if (j.phase === 'step') {
    const k = Math.min(1, t / EJECT.step);
    pos.set(THREE.MathUtils.lerp(j.from.x, a.chamber[0], k), j.from.y + Math.sin(k * Math.PI) * 0.22, THREE.MathUtils.lerp(j.from.z, a.chamber[1], k));
    s.model.walking = k < 1;
    if (k < 1) return false;
    s.guard?.person.holdOn(false);
    host.sounds.airlock(lock.doorAt, 'door');
    next('seal');
    return false;
  }
  if (j.phase === 'seal' || j.phase === 'wait') {
    // The door comes down behind it, and it turns round to the porthole.
    root.rotation.y += wrap(outward + Math.PI - root.rotation.y) * 0.18;
    if (j.phase === 'seal') {
      const k = Math.min(1, t / EJECT.seal);
      lock.inner(1 - k);
      if (k < 1) return false;
      lock.alarm(true);
      host.sounds.airlock(lock.doorAt, 'alarm');
      s.model.say(pick(PLEAS));
      next('wait');
      return false;
    }
    // Running on the spot, for all the good it does.
    s.model.walking = true;
    if (t < EJECT.wait) return false;
    host.sounds.airlock(lock.hatchAt, 'blow');
    s.model.say(pick(CRIES));
    j.from.copy(pos);
    j.turn.copy(root.quaternion);
    next('blow');
    return false;
  }
  if (j.phase === 'blow') {
    lock.outer(Math.min(1, t / EJECT.part));
    const k = Math.min(1, t / EJECT.blow);
    // Out like a cork, and ever slower, till it's drifting with the rest.
    const e = 1 - (1 - k) ** 3;
    const kept = host.adrift.where(s.id);
    const d = kept ?? adrift(a, s.id, 0);
    // Straight out of the hatch first, then round to its own heading.
    start.set(j.from.x, j.from.y + MIDDLE * s.scale, j.from.z);
    out.set(a.hatch[0] + a.out[0] * 6, 1.5, a.hatch[1] + a.out[1] * 6);
    to.set(d.x, d.y, d.z);
    const u = 1 - e;
    const x = u * u * start.x + 2 * u * e * out.x + e * e * to.x;
    const y = u * u * start.y + 2 * u * e * out.y + e * e * to.y;
    const z = u * u * start.z + 2 * u * e * out.z + e * e * to.z;
    // Head over heels on the way, settling into the slow turn it drifts with.
    spin.setFromEuler(tumble.set(d.rx, d.ry, d.rz)).multiply(want.setFromAxisAngle(AXIS, (1 - e) * 11));
    want.slerpQuaternions(j.turn, spin, THREE.MathUtils.smoothstep(k, 0, 0.18));
    // One the office isn't keeping (it's not on its list) dwindles to nothing instead.
    const scale = kept ? THREE.MathUtils.lerp(s.scale, ADRIFT_SCALE, e) : Math.max(0.001, s.scale * (1 - e));
    float(root, { ...d, x, y, z }, scale, want);
    s.model.walking = true;
    if (k < 1) return false;
    // Adrift: from here on it's the drifters', where it is now.
    host.adrift.release(s.id);
    host.jail.release(s.id);
    root.removeFromParent();
    s.model.dispose();
    s.state = 'done';
    next('shut');
    return false;
  }
  // The hatch closes on the empty chamber, and the lights go back to what they were.
  const k = Math.min(1, t / EJECT.shut);
  lock.outer(1 - k);
  if (k < 1) return false;
  host.sounds.airlock(lock.hatchAt, 'door');
  shut(lock);
  return true;
}
